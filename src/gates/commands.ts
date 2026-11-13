// Project validation commands (H4 §11.2, §11.5): test, lint, typecheck.
// A command is only run if the project declares it (agentship.config.json or package.json scripts) AND the
// developer approved that exact command string for that project once. Approvals live in the user's Claude dir,
// never in the repo, so a repository cannot pre-approve its own commands.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CommandName, Config } from '../config/config.ts';
import { COMMAND_NAMES } from '../config/config.ts';

export interface DeclaredCommand {
  name: CommandName;
  command: string;
  source: 'agentship.config.json' | 'package.json';
  approved: boolean;
}

// One file per project, written atomically: parallel runs on different projects never race on a shared file.
const projectKey = (projectDir: string) => {
  const p = resolve(projectDir);
  return createHash('sha256').update(process.platform === 'win32' ? p.toLowerCase() : p).digest('hex').slice(0, 32);
};
export const approvalsPath = (userClaudeDir: string, projectDir: string) =>
  join(userClaudeDir, 'agentship', 'approved-commands', `${projectKey(projectDir)}.json`);

function readApprovals(userClaudeDir: string, projectDir: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(approvalsPath(userClaudeDir, projectDir), 'utf8')).commands ?? {};
  } catch {
    return {};
  }
}

function packageRunner(projectDir: string): string {
  try {
    const pm = String(JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).packageManager ?? '');
    if (pm.startsWith('pnpm')) return 'pnpm';
    if (pm.startsWith('yarn')) return 'yarn';
  } catch {
    // fall through
  }
  if (existsSync(join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function declaredCommands(projectDir: string, cfg: Config, userClaudeDir: string): DeclaredCommand[] {
  const approvals = readApprovals(userClaudeDir, projectDir);
  let scripts: Record<string, string> = {};
  try {
    scripts = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    // no package.json
  }
  const runner = packageRunner(projectDir);
  const out: DeclaredCommand[] = [];
  for (const name of COMMAND_NAMES) {
    const fromConfig = cfg.settings.commands[name];
    const script = name === 'typecheck' ? (scripts.typecheck ? 'typecheck' : scripts['type-check'] ? 'type-check' : undefined) : scripts[name] ? name : undefined;
    const command = fromConfig ?? (script ? (script === 'test' ? `${runner} test` : `${runner} run ${script}`) : undefined);
    if (!command) continue;
    out.push({ name, command, source: fromConfig ? 'agentship.config.json' : 'package.json', approved: approvals[name] === command });
  }
  return out;
}

export function approveCommand(projectDir: string, userClaudeDir: string, name: CommandName, command: string) {
  const path = approvalsPath(userClaudeDir, projectDir);
  const commands = { ...readApprovals(userClaudeDir, projectDir), [name]: command };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ project: resolve(projectDir), commands, updated_at: new Date().toISOString() }, null, 2));
  renameSync(tmp, path);
}

export interface CommandResult {
  name: string;
  command: string;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  log: string;
  passed: boolean;
}

// Runs an approved command through the shell (it is a project-declared command line, never ticket text).
export function runCommand(projectDir: string, command: string, logPath: string, timeoutSeconds: number): Promise<Omit<CommandResult, 'name'>> {
  const startedAt = Date.now();
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    const child = spawn(command, { cwd: projectDir, shell: true, env: { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0' } });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // On Windows the shell's children survive child.kill(); kill the whole tree.
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }, timeoutSeconds * 1000);
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => chunks.push(c));
    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const header = `$ ${command}\n# cwd: ${projectDir}\n# started: ${new Date(startedAt).toISOString()}\n\n`;
      const footer = `\n# exit: ${code}${timedOut ? ' (timed out)' : ''} duration_ms: ${Date.now() - startedAt}\n`;
      writeFileSync(logPath, header + Buffer.concat(chunks).toString('utf8') + footer);
      done({ command, exit_code: code, timed_out: timedOut, duration_ms: Date.now() - startedAt, log: logPath, passed: code === 0 && !timedOut });
    };
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });
}
