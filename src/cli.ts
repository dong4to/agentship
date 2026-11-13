// AgentShip CLI, called by skills/dev/SKILL.md. Every command prints one JSON object on stdout.
// Task text and LLM output are passed as files in run_dir, never as shell arguments.
//
// Routing         start | route | proposals | select | agents | plan-check
// State & gates   phase | retry | tree-check | commands | approve-command | run | review-check | exception | approve
// Independent     codex-detect | codex-review | adjudicate
// Telemetry       event | report | compare
// Setup           config | doctor
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import { planAgents } from './agents/matcher.ts';
import { discoverAgents } from './agents/registry.ts';
import { COMMAND_NAMES, loadConfig, roleForAttempt, type CommandName, type Config } from './config/config.ts';
import { parsePlan, type Plan } from './engine/plan.ts';
import { approveCommand, declaredCommands, runCommand } from './gates/commands.ts';
import { readExceptions, summarizeReviews, parseReviewer } from './gates/review.ts';
import { checkTree, takeBaseline } from './git/tree.ts';
import { codexReview, detectCodex, parseAdjudication, type CodexReview } from './integrations/codex/codex.ts';
import { chosenClassification, parseProposals, type Proposal } from './proposals/proposals.ts';
import { parseClassification, type Classification } from './routing/classification.ts';
import { decide, type Decision } from './routing/policy.ts';
import { parseRequest } from './routing/request.ts';
import { loadState, newState, retryKeyMax, saveState, setRoute, transition, wait, type RunState } from './state/state.ts';
import { buildReport, compareReports, recordEvent, reportMarkdown, type Report } from './telemetry/telemetry.ts';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const out = (o: unknown) => console.log(JSON.stringify(o, null, 2));
const userClaudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

const readIn = (dir: string, f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
const readJson = <T>(dir: string, f: string): T | null => {
  const t = readIn(dir, f);
  return t === null ? null : (JSON.parse(t) as T);
};
const writeJson = (dir: string, f: string, o: unknown) => writeFileSync(join(dir, f), JSON.stringify(o, null, 2));

function fail(message: string, extra: object = {}) {
  out({ error: message, ...extra });
  process.exitCode = 1;
}

// --- run context

interface Ctx {
  runDir: string;
  projectDir: string;
  cfg: Config;
  state: RunState;
}

function runDirArg(): string | undefined {
  const d = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : undefined;
  return d && existsSync(join(d, 'run.json')) ? d : undefined;
}

function context(): Ctx | null {
  const runDir = runDirArg();
  if (!runDir) {
    fail(`usage: ${cmd} <run_dir> …  (run_dir must contain run.json)`);
    return null;
  }
  const run = readJson<{ project_dir: string }>(runDir, 'run.json')!;
  const state = loadState(runDir);
  if (!state) {
    fail('run has no state.json');
    return null;
  }
  const cfg = loadConfig({ projectDir: run.project_dir, userClaudeDir, profile: state.profile });
  return { runDir, projectDir: run.project_dir, cfg, state };
}

function routesInfo(cfg: Config) {
  return { profile: cfg.profile, roles: cfg.roles };
}

// --- routing

function start() {
  const projectDir = resolve(option('--project') ?? process.cwd());
  const cfg = loadConfig({ projectDir, userClaudeDir });
  const base = join(projectDir, '.agentship');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(base, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  // Self-ignoring dir: never touches the project's own .gitignore.
  if (!existsSync(join(base, '.gitignore'))) writeFileSync(join(base, '.gitignore'), '*\n');
  const baseline = takeBaseline(projectDir);
  const run = {
    run_id: runId,
    run_dir: runDir,
    project_dir: projectDir,
    created_at: new Date().toISOString(),
    agentship_version: pkg.version,
    engine: 'native',
    eval_task: process.env.AGENTSHIP_EVAL_TASK && /^[\w.-]{1,60}$/.test(process.env.AGENTSHIP_EVAL_TASK) ? process.env.AGENTSHIP_EVAL_TASK : null,
    ...routesInfo(cfg),
    max_proposals: cfg.policy.proposals.max,
    codex: { enabled: cfg.settings.codex.enabled },
    retries: cfg.settings.retries,
    config_sources: cfg.sources,
    config_errors: cfg.errors,
    git: { repo: baseline.git, head: baseline.head, branch: baseline.branch, preexisting_changes: baseline.dirty },
  };
  writeJson(runDir, 'run.json', run);
  saveState(runDir, newState(runId, cfg.profile, baseline));
  out(run);
}

function resumeRun(runDir: string, request: ReturnType<typeof parseRequest>) {
  const r = request.resume!;
  const resumeDir = join(runDir, '..', r.runId);
  const state = loadState(resumeDir);
  const errors: string[] = [];
  if (!state) errors.push(`run ${r.runId} not found in .agentship/runs/`);
  else if (r.proposal !== null && !existsSync(join(resumeDir, 'proposals.json'))) errors.push(`run ${r.runId} has no proposals.json to choose from`);
  else if (r.approve && state.waiting_for !== 'human_gate') errors.push(`run ${r.runId} is not waiting for the human gate (waiting for: ${state.waiting_for ?? 'nothing'})`);
  else if (state.status === 'done') errors.push(`run ${r.runId} is already done`);
  if (errors.length) {
    const result = { action: 'error', errors };
    writeJson(runDir, 'decision.json', result);
    return out(result);
  }
  let answers: string | null = null;
  if (request.task) {
    // Text after --resume is the developer's reply to the questions the run stopped on.
    const n = readdirSync(resumeDir).filter((f) => /^answers-\d+\.md$/.test(f)).length + 1;
    answers = join(resumeDir, `answers-${n}.md`);
    writeFileSync(answers, `# Developer answers (${new Date().toISOString()})

${request.task}
`);
    if (state!.waiting_for?.endsWith(':answers')) {
      state!.waiting_for = null;
      state!.status = 'running';
      saveState(resumeDir, state!);
    }
  }
  if (r.approve) {
    // The developer typed --approve themselves: that is the explicit approval.
    state!.approvals.human_gate = { at: new Date().toISOString(), via: 'resume --approve' };
    state!.waiting_for = null;
    state!.status = 'running';
    saveState(resumeDir, state!);
  }
  const next = Object.keys(state!.phases).find((p) => !['done', 'skipped'].includes(state!.phases[p].status)) ?? null;
  const result = {
    action: 'resume',
    resume_run_dir: resumeDir,
    proposal: r.proposal,
    approved_human_gate: r.approve,
    answers_file: answers,
    status: state!.status,
    waiting_for: state!.waiting_for,
    workflow: state!.workflow,
    next_phase: next,
    errors: [],
  };
  writeJson(runDir, 'decision.json', result);
  out(result);
}

function applyDecision(runDir: string, state: RunState, cfg: Config, d: Decision): string[] {
  if (d.action === 'proceed' && d.route && d.risk) return setRoute(state, d.route, d.risk, cfg.settings.independent_review.required_at_risk);
  if (d.action === 'propose') wait(state, 'proposal');
  if (d.action === 'clarify') wait(state, 'clarification');
  if (d.action === 'confirm_downgrade') wait(state, 'downgrade_confirmation');
  return [];
}

function route() {
  const runDir = runDirArg();
  if (!runDir) return fail('usage: route <run_dir> [--after-discovery]');
  const requestText = readIn(runDir, 'request.txt');
  const request = requestText === null ? null : parseRequest(requestText);
  if (request?.resume && !request.errors.length) return resumeRun(runDir, request);

  const run = readJson<{ project_dir: string }>(runDir, 'run.json')!;
  const state = loadState(runDir)!;
  const cfg = loadConfig({ projectDir: run.project_dir, userClaudeDir, profile: request?.profile ?? undefined });
  const classificationText = readIn(runDir, 'classification.txt');
  const parsed = classificationText === null ? null : parseClassification(classificationText);
  const errors = [
    ...(request === null ? ['request.txt missing'] : request.errors.map((e) => `request: ${e}`)),
    ...cfg.errors.map((e) => `config: ${e}`),
    ...(parsed === null ? ['classification.txt missing'] : parsed.ok ? [] : parsed.errors.map((e) => `classification: ${e}`)),
  ];

  let decision: Decision = errors.length
    ? { action: 'error', route: null, risk: null, reasons: ['no route chosen: input invalid'] }
    : decide(parsed!.ok ? parsed!.value : null, { ...request!.overrides, afterDiscovery: flag('--after-discovery') }, cfg.policy);

  if (!errors.length && parsed?.ok) writeJson(runDir, 'classification.json', parsed.value);
  state.profile = cfg.profile;
  const stateErrors = errors.length ? [] : applyDecision(runDir, state, cfg, decision);
  if (stateErrors.length) decision = { ...decision, action: 'error' };
  saveState(runDir, state);
  const result = {
    ...decision,
    errors: [...errors, ...stateErrors],
    task: request?.task ?? null,
    overrides: request?.overrides ?? null,
    domains: parsed?.ok ? parsed.value.domains : [],
    independent_review_required: state.independent_review_required,
    ...routesInfo(cfg),
  };
  writeJson(runDir, flag('--after-discovery') ? 'decision-after-discovery.json' : 'decision.json', result);
  out(result);
}

function proposals() {
  const c = context();
  if (!c) return;
  const text = readIn(c.runDir, 'proposals.txt');
  const parsed = text === null ? { ok: false as const, errors: ['proposals.txt missing'] } : parseProposals(text, c.cfg.policy.proposals.max);
  if (!parsed.ok) return out({ ok: false, errors: parsed.errors });
  writeJson(c.runDir, 'proposals.json', parsed.value);
  wait(c.state, 'proposal');
  saveState(c.runDir, c.state);
  out({
    ok: true,
    run_id: c.state.run_id,
    proposals: parsed.value.map((p) => ({
      id: p.id, title: p.title, recommended: p.recommended, summary: p.summary,
      complexity: p.classification.complexity, risk: p.classification.risk, tradeoffs: p.tradeoffs,
    })),
  });
}

function select() {
  const c = context();
  if (!c) return;
  const n = Number(args[1]);
  const list = readJson<Proposal[]>(c.runDir, 'proposals.json');
  const analysis = readJson<Classification>(c.runDir, 'classification.json');
  if (!list || !analysis) return fail('run has no proposals.json / classification.json');
  const chosen = list.find((p) => p.id === n);
  if (!chosen) return fail(`proposal ${args[1]} does not exist; choose 1-${list.length}`);
  const request = parseRequest(readIn(c.runDir, 'request.txt') ?? '');
  const cls = chosenClassification(analysis, chosen);
  let decision = decide(cls, { ...request.overrides, fromProposal: true, afterDiscovery: true }, c.cfg.policy);
  const stateErrors = applyDecision(c.runDir, c.state, c.cfg, decision);
  if (stateErrors.length) decision = { ...decision, action: 'error' };
  saveState(c.runDir, c.state);
  writeJson(c.runDir, 'selection.json', { proposal: chosen, selected_at: new Date().toISOString() });
  writeJson(c.runDir, 'classification-final.json', cls);
  const result = { ...decision, errors: stateErrors, proposal: { id: chosen.id, title: chosen.title }, task: request.task, domains: cls.domains, independent_review_required: c.state.independent_review_required };
  writeJson(c.runDir, 'decision-final.json', result);
  out(result);
}

function agents() {
  const c = context();
  if (!c) return;
  const cls = readJson<Classification>(c.runDir, 'classification-final.json') ?? readJson<Classification>(c.runDir, 'classification.json');
  if (!cls) return fail('run has no classification.json; run route first');
  const found = discoverAgents({ projectDir: c.projectDir, userClaudeDir, pluginRoot });
  const plan = planAgents(cls.domains, found, c.cfg.packs, { research: c.cfg.roles.domain_research, review: c.cfg.roles.domain_review });
  const result = { ...plan, agents_scanned: found.length };
  writeJson(c.runDir, 'agents.json', result);
  out(result);
}

function planCheck() {
  const c = context();
  if (!c) return;
  const text = readIn(c.runDir, 'plan.txt');
  if (text === null) return out({ ok: false, errors: ['plan.txt missing'] });
  // MEDIUM keeps plans short; LARGE may split the work into waves.
  const parsed = parsePlan(text, { maxWaves: c.state.workflow === 'MEDIUM' ? 2 : undefined });
  if (!parsed.ok) return out({ ok: false, errors: parsed.errors });
  writeJson(c.runDir, 'plan.json', parsed.value);
  out({ ok: true, route: c.state.workflow, waves: parsed.value.waves.map((w) => ({ id: w.id, title: w.title, depends_on: w.depends_on, files: w.files })) });
}

// --- state and gates

const ARTIFACT_FOR: Record<string, string> = {
  discovery: 'discovery.md',
  research: 'specialists-research.md',
  requirements: 'requirements.md',
  plan: 'plan.json',
  uat: 'uat.md',
};

function independentGate(c: Ctx): string[] {
  const s = c.state;
  const fallback = s.approvals.independent_review_fallback;
  const exceptions = new Set(readExceptions(c.runDir).map((e) => e.id));
  if (fallback?.mode === 'waive') return [];
  if (fallback?.mode === 'claude') {
    const text = readIn(c.runDir, 'independent-fallback.txt');
    if (!text) return ['fallback review approved, but independent-fallback.txt (fresh-context Claude review) is missing'];
    const r = parseReviewer('independent-fallback', text);
    if (!r.ok) return r.errors;
    const blocking = [...r.value.criteria.filter((x) => x.status === 'NOT_MET').map((x) => x.id), ...r.value.findings.filter((f) => f.severity === 'HIGH').map((f) => f.id)];
    const open = blocking.filter((id) => !exceptions.has(id));
    return open.length ? [`fallback review has blocking items: ${open.join(', ')}`] : [];
  }
  const codex = readJson<CodexReview>(c.runDir, 'codex-review.json');
  if (!codex) return ['run codex-review first'];
  if (codex.status !== 'ok') {
    return [`Codex review ${codex.status}: ${codex.errors.join('; ')}. Ask the developer to approve a fallback (approve independent_review_fallback --mode claude|waive)`];
  }
  const adj = readJson<{ blocking: string[] }>(c.runDir, 'adjudication.json');
  if (!adj) return codex.findings.length ? ['adjudicate the Codex findings first'] : [];
  const open = adj.blocking.filter((id) => !exceptions.has(id));
  return open.length ? [`unresolved blocking Codex findings: ${open.join(', ')}`] : [];
}

function gateFor(c: Ctx) {
  return (phase: string, s: RunState): string[] => {
    if (ARTIFACT_FOR[phase] && !existsSync(join(c.runDir, ARTIFACT_FOR[phase]))) return [`${ARTIFACT_FOR[phase]} is missing in run_dir`];
    if (phase === 'human_gate' && !s.approvals.human_gate) return ['the developer has not approved the plan'];
    if (phase === 'test' || phase === 'summary') {
      const e: string[] = [];
      if (!s.gates.test) e.push('the project test command has not run (cli run <run_dir> test)');
      else if (!s.gates.test.passed) e.push(`tests failed (see ${s.gates.test.log})`);
      for (const n of ['lint', 'typecheck']) if (s.gates[n] && !s.gates[n].passed) e.push(`${n} failed (see ${s.gates[n].log})`);
      for (const d of declaredCommands(c.projectDir, c.cfg, userClaudeDir)) {
        if (d.name !== 'test' && d.approved && !s.gates[d.name]) e.push(`${d.name} is declared and approved but has not run`);
      }
      if (e.length) return e;
    }
    if (phase === 'review' || (phase === 'summary' && s.phases.review)) {
      const r = summarizeReviews(c.runDir);
      writeJson(c.runDir, 'review.json', r);
      if (!r.passed) return [...r.errors, ...(r.blocking.length ? [`blocking review items: ${r.blocking.join(', ')}`] : [])];
    }
    if (phase === 'independent_review' || (phase === 'summary' && s.independent_review_required)) {
      const e = independentGate(c);
      if (e.length) return e;
      s.independent_review_completed = true;
    }
    if (phase === 'summary' && !existsSync(join(c.runDir, 'summary.md'))) return ['summary.md is missing in run_dir'];
    return [];
  };
}

function phase() {
  const c = context();
  if (!c) return;
  const [, name, action] = args;
  if (!['start', 'done', 'fail', 'skip', 'wait'].includes(action)) return fail('usage: phase <run_dir> <phase> start|done|fail|skip|wait [--reason "<short text>"]');
  const reason = option('--reason') ?? null;
  if (reason !== null && !/^[\w .,:;()'/-]{1,200}$/.test(reason)) return fail('--reason must be short plain text');
  if (action === 'wait') {
    // The phase stays running; the run waits for the developer's answers (resume with --resume <id> <answers>).
    if (c.state.phases[name]?.status !== 'running') return fail(`phase ${name} is not running`);
    wait(c.state, `${name}:answers`);
    saveState(c.runDir, c.state);
    return out({ ok: true, phase: name, action, status: c.state.status, waiting_for: c.state.waiting_for });
  }
  const errors = transition(c.state, name, action as 'start', reason, gateFor(c));
  if (!errors.length && name === 'human_gate' && action === 'start') wait(c.state, 'human_gate');
  if (errors.length && action === 'done') c.state.status = 'blocked';
  saveState(c.runDir, c.state);
  out({ ok: errors.length === 0, phase: name, action, errors, status: c.state.status, waiting_for: c.state.waiting_for, phases: Object.fromEntries(Object.entries(c.state.phases).map(([k, v]) => [k, v.status])) });
}

function retry() {
  const c = context();
  if (!c) return;
  const key = args[1] ?? '';
  const max = retryKeyMax(key, c.cfg.settings.retries);
  if (max === null) return fail('usage: retry <run_dir> tests[:<wave>] | review | llm:<what> [--role <role>]');
  const used = c.state.retries[key] ?? 0;
  const allowed = used < max;
  if (allowed) c.state.retries[key] = used + 1;
  saveState(c.runDir, c.state);
  const role = option('--role');
  out({
    key, allowed, used: allowed ? used + 1 : used, max,
    ...(allowed ? {} : { message: `retry limit reached for ${key} (${max}); stop and report instead of trying again` }),
    ...(role && c.cfg.roles[role] ? { role: roleForAttempt(c.cfg, role, allowed ? used + 1 : used) } : {}),
  });
}

function treeCheck() {
  const c = context();
  if (!c) return;
  const plan = readJson<Plan>(c.runDir, 'plan.json');
  const files = plan ? plan.waves.flatMap((w) => w.files) : (readJson<Classification>(c.runDir, 'classification.json')?.affected_modules ?? []);
  const r = checkTree(c.projectDir, c.state.baseline, files);
  c.state.tree_check = { ok: r.ok, at: new Date().toISOString(), errors: r.errors };
  saveState(c.runDir, c.state);
  out(r);
}

function commands() {
  const c = context();
  if (!c) return;
  out({ commands: declaredCommands(c.projectDir, c.cfg, userClaudeDir) });
}

function approveCmd() {
  const c = context();
  if (!c) return;
  const name = args[1] as CommandName;
  const d = declaredCommands(c.projectDir, c.cfg, userClaudeDir).find((x) => x.name === name);
  if (!d) return fail(`the project declares no ${name} command`);
  approveCommand(c.projectDir, userClaudeDir, name, d.command);
  out({ approved: true, name, command: d.command, project: c.projectDir });
}

async function runCmd() {
  const c = context();
  if (!c) return;
  const name = args[1] as CommandName;
  if (!COMMAND_NAMES.includes(name)) return fail('usage: run <run_dir> test|lint|typecheck [--label <wave-1>]');
  const label = option('--label') ?? 'final';
  if (!/^[\w.-]{1,40}$/.test(label)) return fail('--label must be a short identifier');
  const d = declaredCommands(c.projectDir, c.cfg, userClaudeDir).find((x) => x.name === name);
  if (!d) return out({ ok: false, needs: 'declaration', errors: [`the project declares no ${name} command; ask the developer which command to use and to add it to agentship.config.json`] });
  if (!d.approved) return out({ ok: false, needs: 'approval', command: d.command, source: d.source, errors: [`"${d.command}" has not been approved for this project; show it to the developer and run approve-command after they agree`] });
  mkdirSync(join(c.runDir, 'logs'), { recursive: true });
  const r = await runCommand(c.projectDir, d.command, join(c.runDir, 'logs', `${name}-${label}.log`), c.cfg.settings.commands.timeout_seconds);
  // Reload state: the command may have run for minutes.
  const s = loadState(c.runDir)!;
  s.gates[name] = { passed: r.passed, exit_code: r.exit_code, log: r.log, label, at: new Date().toISOString() };
  s.runs[name] = (s.runs[name] ?? 0) + 1;
  if (name === 'test') s.tests_passed = r.passed;
  saveState(c.runDir, s);
  out({ ok: true, name, ...r });
}

function reviewCheck() {
  const c = context();
  if (!c) return;
  const r = summarizeReviews(c.runDir);
  writeJson(c.runDir, 'review.json', r);
  out(r);
}

function exception() {
  const c = context();
  if (!c) return;
  const id = args[1] ?? '';
  const reason = readIn(c.runDir, 'exception-request.txt')?.trim();
  if (!reason) return fail('write the developer\'s reason to exception-request.txt first');
  const review = summarizeReviews(c.runDir);
  const adj = readJson<{ blocking: string[] }>(c.runDir, 'adjudication.json');
  const blocking = new Set([...review.blocking, ...(adj?.blocking ?? [])]);
  if (!blocking.has(id)) return fail(`${id} is not a current blocking item`, { blocking: [...blocking] });
  const list = readExceptions(c.runDir).filter((e) => e.id !== id);
  list.push({ id, reason, approved_at: new Date().toISOString() } as never);
  writeJson(c.runDir, 'exceptions.json', list);
  rmSync(join(c.runDir, 'exception-request.txt'));
  out({ ok: true, id, exceptions: list.length });
}

function approve() {
  const c = context();
  if (!c) return;
  const what = args[1];
  if (what === 'human_gate') {
    if (c.state.waiting_for !== 'human_gate') return fail('the run is not waiting for the human gate');
    c.state.approvals.human_gate = { at: new Date().toISOString(), via: 'chat' };
    c.state.status = 'running';
    c.state.waiting_for = null;
  } else if (what === 'independent_review_fallback') {
    const mode = option('--mode');
    if (mode !== 'claude' && mode !== 'waive') return fail('--mode must be claude or waive');
    const codex = readJson<CodexReview>(c.runDir, 'codex-review.json');
    if (codex?.status === 'ok') return fail('the Codex review succeeded; a fallback is not needed');
    c.state.approvals.independent_review_fallback = { at: new Date().toISOString(), mode, via: 'chat' };
  } else {
    return fail('usage: approve <run_dir> human_gate | independent_review_fallback --mode claude|waive');
  }
  saveState(c.runDir, c.state);
  out({ ok: true, approvals: c.state.approvals });
}

// --- independent review (H3)

async function codexDetect() {
  out(await detectCodex());
}

async function codexReviewCmd() {
  const c = context();
  if (!c) return;
  let result: CodexReview;
  if (c.cfg.settings.codex.enabled === false) {
    result = { status: 'disabled', summary: null, findings: [], version: null, exit_code: null, duration_ms: 0, errors: ['codex.enabled is false in the configuration'], logs: { stdout: '', stderr: '', prompt: '' } };
  } else {
    const info = await detectCodex();
    result = await codexReview({ runDir: c.runDir, projectDir: c.projectDir, baseline: c.state.baseline, timeoutSeconds: c.cfg.settings.codex.timeout_seconds, model: c.cfg.settings.codex.model, info });
  }
  writeJson(c.runDir, 'codex-review.json', result);
  if (existsSync(join(c.runDir, 'adjudication.json'))) rmSync(join(c.runDir, 'adjudication.json'));
  out({ ...result, required: c.state.independent_review_required });
}

function adjudicate() {
  const c = context();
  if (!c) return;
  const codex = readJson<CodexReview>(c.runDir, 'codex-review.json');
  if (!codex || codex.status !== 'ok') return fail('no successful codex-review.json to adjudicate');
  const text = readIn(c.runDir, 'adjudication.txt');
  if (text === null) return fail('adjudication.txt missing');
  const r = parseAdjudication(text, codex.findings);
  if (!r.ok) return out({ ok: false, errors: r.errors });
  writeJson(c.runDir, 'adjudication.json', { adjudications: r.value, blocking: r.blocking });
  out({ ok: true, blocking: r.blocking, counts: Object.fromEntries(['CONFIRMED', 'FALSE_POSITIVE', 'NEEDS_INVESTIGATION', 'UNVERIFIABLE'].map((v) => [v, r.value.filter((a) => a.verdict === v).length])) });
}

// --- telemetry (H5)

function event() {
  const c = context();
  if (!c) return;
  const v = (n: string, re = /^[\w.:@/-]{1,80}$/) => {
    const x = option(n);
    return x !== undefined && re.test(x) ? x : null;
  };
  const role = v('--role');
  const agent = v('--agent');
  const model = v('--model');
  if (!role || !agent || !model) return fail('usage: event <run_dir> --role <role> --agent <agent> --model <model> [--effort e] [--phase p] [--tokens n] [--duration-ms n] [--outcome ok|failed|invalid]');
  const num = (n: string) => (option(n) !== undefined && /^\d{1,10}$/.test(option(n)!) ? Number(option(n)) : null);
  recordEvent(c.runDir, { role, agent, model, effort: v('--effort') ?? c.cfg.roles[role]?.effort ?? null, phase: v('--phase'), tokens: num('--tokens'), duration_ms: num('--duration-ms'), outcome: v('--outcome') });
  out({ ok: true });
}

function report() {
  const c = context();
  if (!c) return;
  const r = buildReport(c.runDir, c.state);
  writeJson(c.runDir, 'report.json', r);
  writeFileSync(join(c.runDir, 'report.md'), reportMarkdown(r));
  out(r);
}

function findReports(p: string): string[] {
  const abs = resolve(p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return abs.endsWith('report.json') ? [abs] : [];
  if (existsSync(join(abs, 'report.json'))) return [join(abs, 'report.json')];
  return readdirSync(abs).flatMap((d) => findReports(join(abs, d)));
}

function compare() {
  const files = args.filter((a) => !a.startsWith('--')).flatMap(findReports);
  if (!files.length) return fail('usage: compare <run dirs, report.json files or directories containing them>');
  const reports = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as Report);
  out({ reports: files.length, ...compareReports(reports) });
}

// --- setup (H6)

function config() {
  const projectDir = resolve(option('--project') ?? process.cwd());
  const cfg = loadConfig({ projectDir, userClaudeDir, profile: option('--profile') });
  out({ ok: cfg.errors.length === 0, profile: cfg.profile, profiles: Object.keys(cfg.profiles), roles: cfg.roles, escalation: cfg.escalation, policy: cfg.policy, settings: cfg.settings, domains: Object.keys(cfg.packs.domains), sources: cfg.sources, errors: cfg.errors });
}

async function doctor() {
  const projectDir = resolve(option('--project') ?? process.cwd());
  const cfg = loadConfig({ projectDir, userClaudeDir });
  const [maj, min] = process.versions.node.split('.').map(Number);
  const nodeOk = maj > 22 || (maj === 22 && min >= 18);
  const baseline = takeBaseline(projectDir);
  const codex = cfg.settings.codex.enabled === false ? null : await detectCodex();
  const found = discoverAgents({ projectDir, userClaudeDir, pluginRoot });
  const cmds = declaredCommands(projectDir, cfg, userClaudeDir);
  const checks = [
    { check: 'node', ok: nodeOk, detail: `v${process.versions.node}${nodeOk ? '' : ' (need >= 22.18)'}` },
    { check: 'git repo', ok: baseline.git, detail: baseline.git ? `${baseline.branch} @ ${baseline.head?.slice(0, 8)}` : 'not a git repository: external-change detection and diffs are disabled' },
    { check: 'config', ok: cfg.errors.length === 0, detail: cfg.errors.length ? cfg.errors.join('; ') : `profile ${cfg.profile}; sources: ${cfg.sources.join(', ')}` },
    { check: 'test command', ok: cmds.some((x) => x.name === 'test'), detail: cmds.find((x) => x.name === 'test') ? `${cmds.find((x) => x.name === 'test')!.command} (${cmds.find((x) => x.name === 'test')!.approved ? 'approved' : 'needs approval on first run'})` : 'none declared: add commands.test to agentship.config.json or scripts.test to package.json' },
    { check: 'codex', ok: codex === null || codex.available || cfg.settings.codex.enabled === 'auto', detail: codex === null ? 'disabled by config' : codex.available ? `codex ${codex.version}, logged in` : `${codex.reason}. HIGH-risk runs will need a fallback approval` },
    { check: 'specialists', ok: true, detail: `${found.filter((a) => a.source !== 'agentship').length} external agents found (${[...new Set(found.filter((a) => a.plugin && a.source === 'plugin').map((a) => a.plugin))].join(', ') || 'no agent plugins'})` },
  ];
  out({ agentship: pkg.version, project: projectDir, ok: checks.every((c) => c.ok), checks });
}

const commandsTable: Record<string, () => void | Promise<void>> = {
  start, route, proposals, select, agents, 'plan-check': planCheck,
  phase, retry, 'tree-check': treeCheck, commands, 'approve-command': approveCmd, run: runCmd, 'review-check': reviewCheck, exception, approve,
  'codex-detect': codexDetect, 'codex-review': codexReviewCmd, adjudicate,
  event, report, compare,
  config, doctor,
};
if (cmd && Object.hasOwn(commandsTable, cmd)) await commandsTable[cmd]();
else fail(`unknown command ${JSON.stringify(cmd ?? '')}; expected ${Object.keys(commandsTable).join(' | ')}`);

