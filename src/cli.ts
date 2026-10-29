// AgentShip CLI, called by skills/dev/SKILL.md. Every command prints one JSON object on stdout.
//
//   node src/cli.ts start [--project <dir>]           create a run dir, detect GSD, print run context
//   node src/cli.ts route <run_dir> [--after-discovery] read request.txt + classification.txt, write decision.json
//   node src/cli.ts detect [--project <dir>]          GSD detection only
//
// Task text and classifier output are passed as files, never as shell arguments.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import models from '../config/default-models.json' with { type: 'json' };
import { detectGsd } from './integrations/gsd/detect.ts';
import { parseClassification } from './routing/classification.ts';
import { decide } from './routing/policy.ts';
import { parseRequest } from './routing/request.ts';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const out = (o: unknown) => console.log(JSON.stringify(o, null, 2));
const userClaudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const projectDir = resolve(option('--project') ?? process.cwd());

function start() {
  const base = join(projectDir, '.agentship');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(base, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  // Self-ignoring dir: never touches the project's own .gitignore.
  if (!existsSync(join(base, '.gitignore'))) writeFileSync(join(base, '.gitignore'), '*\n');
  const gsd = detectGsd(projectDir, userClaudeDir);
  const run = { run_id: runId, run_dir: runDir, project_dir: projectDir, created_at: new Date().toISOString(), gsd, roles: models.roles };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run, null, 2));
  out(run);
}

function route() {
  const runDir = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : undefined;
  if (!runDir) return fail('usage: route <run_dir> [--after-discovery]');
  const read = (f: string) => (existsSync(join(runDir, f)) ? readFileSync(join(runDir, f), 'utf8') : null);

  const requestText = read('request.txt');
  const classificationText = read('classification.txt');
  const request = requestText === null ? null : parseRequest(requestText);
  const parsed = classificationText === null ? null : parseClassification(classificationText);

  const errors = [
    ...(request === null ? ['request.txt missing'] : request.errors.map((e) => `request: ${e}`)),
    ...(parsed === null ? ['classification.txt missing'] : parsed.ok ? [] : parsed.errors.map((e) => `classification: ${e}`)),
  ];

  const decision = errors.length
    ? { action: 'error' as const, route: null, risk: null, reasons: ['no route chosen: input invalid'] }
    : decide(parsed!.ok ? parsed!.value : null, { ...request!.overrides, afterDiscovery: flag('--after-discovery') });

  const result = { ...decision, errors, task: request?.task ?? null, overrides: request?.overrides ?? null };
  writeFileSync(join(runDir, flag('--after-discovery') ? 'decision-after-discovery.json' : 'decision.json'), JSON.stringify(result, null, 2));
  out(result);
}

function fail(message: string) {
  out({ error: message });
  process.exitCode = 1;
}

if (cmd === 'start') start();
else if (cmd === 'route') route();
else if (cmd === 'detect') out(detectGsd(projectDir, userClaudeDir));
else fail(`unknown command ${JSON.stringify(cmd ?? '')}; expected start | route | detect`);
