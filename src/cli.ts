// AgentShip CLI, called by skills/dev/SKILL.md. Every command prints one JSON object on stdout.
//
//   start [--project <dir>]                 create a run dir, print the run context
//   route <run_dir> [--after-discovery]     request.txt + classification.txt -> decision.json
//   proposals <run_dir>                     proposals.txt -> proposals.json (validated)
//   select <run_dir> <n>                    route the chosen proposal -> selection.json + decision-final.json
//   agents <run_dir>                        specialists per phase for the task's domains -> agents.json
//   plan-check <run_dir>                    plan.txt -> plan.json (validated waves)
//
// Task text and LLM output are passed as files, never as shell arguments.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import models from '../config/default-models.json' with { type: 'json' };
import packs from '../config/domain-packs.json' with { type: 'json' };
import { planAgents, type Packs } from './agents/matcher.ts';
import { discoverAgents } from './agents/registry.ts';
import { parsePlan } from './engine/plan.ts';
import { chosenClassification, parseProposals, type Proposal } from './proposals/proposals.ts';
import { parseClassification, type Classification } from './routing/classification.ts';
import { decide, DEFAULT_POLICY, type Decision } from './routing/policy.ts';
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
const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

const readIn = (dir: string, f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
const writeJson = (dir: string, f: string, o: unknown) => writeFileSync(join(dir, f), JSON.stringify(o, null, 2));

function fail(message: string) {
  out({ error: message });
  process.exitCode = 1;
}

function runDirArg(): string | undefined {
  const d = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : undefined;
  return d && existsSync(d) ? d : undefined;
}

function start() {
  const base = join(projectDir, '.agentship');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(base, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  // Self-ignoring dir: never touches the project's own .gitignore.
  if (!existsSync(join(base, '.gitignore'))) writeFileSync(join(base, '.gitignore'), '*\n');
  const run = {
    run_id: runId,
    run_dir: runDir,
    project_dir: projectDir,
    created_at: new Date().toISOString(),
    engine: 'native',
    roles: models.roles,
    max_proposals: DEFAULT_POLICY.proposals.max,
  };
  writeJson(runDir, 'run.json', run);
  out(run);
}

function route() {
  const runDir = runDirArg();
  if (!runDir) return fail('usage: route <run_dir> [--after-discovery]');
  const requestText = readIn(runDir, 'request.txt');
  const request = requestText === null ? null : parseRequest(requestText);

  // Resuming a run that stopped at the proposals phase: point the skill at that run.
  if (request?.resume && !request.errors.length) {
    const resumeDir = join(runDir, '..', request.resume.runId);
    const errors = existsSync(join(resumeDir, 'proposals.json')) ? [] : [`run ${request.resume.runId} has no proposals.json to resume`];
    const result = { action: errors.length ? 'error' : 'resume', resume_run_dir: errors.length ? null : resumeDir, proposal: request.resume.proposal, errors };
    writeJson(runDir, 'decision.json', result);
    return out(result);
  }

  const classificationText = readIn(runDir, 'classification.txt');
  const parsed = classificationText === null ? null : parseClassification(classificationText);
  const errors = [
    ...(request === null ? ['request.txt missing'] : request.errors.map((e) => `request: ${e}`)),
    ...(parsed === null ? ['classification.txt missing'] : parsed.ok ? [] : parsed.errors.map((e) => `classification: ${e}`)),
  ];

  const decision: Decision = errors.length
    ? { action: 'error', route: null, risk: null, reasons: ['no route chosen: input invalid'] }
    : decide(parsed!.ok ? parsed!.value : null, { ...request!.overrides, afterDiscovery: flag('--after-discovery') });

  if (!errors.length && parsed?.ok) writeJson(runDir, 'classification.json', parsed.value);
  const result = {
    ...decision,
    errors,
    task: request?.task ?? null,
    overrides: request?.overrides ?? null,
    domains: parsed?.ok ? parsed.value.domains : [],
  };
  writeJson(runDir, flag('--after-discovery') ? 'decision-after-discovery.json' : 'decision.json', result);
  out(result);
}

function proposals() {
  const runDir = runDirArg();
  if (!runDir) return fail('usage: proposals <run_dir>');
  const text = readIn(runDir, 'proposals.txt');
  const parsed = text === null ? { ok: false as const, errors: ['proposals.txt missing'] } : parseProposals(text, DEFAULT_POLICY.proposals.max);
  if (!parsed.ok) return out({ ok: false, errors: parsed.errors });
  writeJson(runDir, 'proposals.json', parsed.value);
  out({
    ok: true,
    proposals: parsed.value.map((p) => ({
      id: p.id,
      title: p.title,
      recommended: p.recommended,
      summary: p.summary,
      complexity: p.classification.complexity,
      risk: p.classification.risk,
      tradeoffs: p.tradeoffs,
    })),
  });
}

function select() {
  const runDir = runDirArg();
  const n = Number(args[1]);
  if (!runDir || !Number.isInteger(n)) return fail('usage: select <run_dir> <n>');
  const list = readIn(runDir, 'proposals.json');
  const analysis = readIn(runDir, 'classification.json');
  const request = parseRequest(readIn(runDir, 'request.txt') ?? '');
  if (!list || !analysis) return fail('run has no proposals.json / classification.json');
  const proposals = JSON.parse(list) as Proposal[];
  const chosen = proposals.find((p) => p.id === n);
  if (!chosen) return fail(`proposal ${n} does not exist; choose 1-${proposals.length}`);

  const c = chosenClassification(JSON.parse(analysis) as Classification, chosen);
  const decision = decide(c, { ...request.overrides, fromProposal: true, afterDiscovery: true });
  writeJson(runDir, 'selection.json', { proposal: chosen, selected_at: new Date().toISOString() });
  writeJson(runDir, 'classification-final.json', c);
  const result = { ...decision, proposal: { id: chosen.id, title: chosen.title }, task: request.task, domains: c.domains };
  writeJson(runDir, 'decision-final.json', result);
  out(result);
}

function agents() {
  const runDir = runDirArg();
  if (!runDir) return fail('usage: agents <run_dir> [--project <dir>]');
  const c = readIn(runDir, 'classification-final.json') ?? readIn(runDir, 'classification.json');
  if (!c) return fail('run has no classification.json; run route first');
  const run = JSON.parse(readIn(runDir, 'run.json') ?? '{}');
  const found = discoverAgents({ projectDir: run.project_dir ?? projectDir, userClaudeDir, pluginRoot });
  const plan = planAgents((JSON.parse(c) as Classification).domains, found, packs as Packs, {
    research: models.roles.domain_research,
    review: models.roles.domain_review,
  });
  const result = { ...plan, agents_scanned: found.length };
  writeJson(runDir, 'agents.json', result);
  out(result);
}

function planCheck() {
  const runDir = runDirArg();
  if (!runDir) return fail('usage: plan-check <run_dir>');
  const decision = JSON.parse(readIn(runDir, 'decision-final.json') ?? readIn(runDir, 'decision.json') ?? '{}');
  const text = readIn(runDir, 'plan.txt');
  if (text === null) return out({ ok: false, errors: ['plan.txt missing'] });
  // MEDIUM keeps plans short; LARGE may split the work into waves.
  const parsed = parsePlan(text, { maxWaves: decision.route === 'MEDIUM' ? 2 : undefined });
  if (!parsed.ok) return out({ ok: false, errors: parsed.errors });
  writeJson(runDir, 'plan.json', parsed.value);
  out({ ok: true, route: decision.route ?? null, waves: parsed.value.waves.map((w) => ({ id: w.id, title: w.title, depends_on: w.depends_on })) });
}

const commands: Record<string, () => void> = { start, route, proposals, select, agents, 'plan-check': planCheck };
if (cmd && Object.hasOwn(commands, cmd)) commands[cmd]();
else fail(`unknown command ${JSON.stringify(cmd ?? '')}; expected ${Object.keys(commands).join(' | ')}`);

