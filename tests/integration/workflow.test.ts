// Full runs through the real CLI on a throwaway git project: gates, approvals, retries, recovery,
// Codex (faked) and telemetry. No LLM involved: agent outputs are fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const fakeCodex = join(fixtures, 'fake-codex.mjs');

function cliIn(user: string, env: Record<string, string> = {}) {
  return (...args: string[]) => {
    try {
      return JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: user, AGENTSHIP_CODEX_BIN: fakeCodex, ...env } }));
    } catch (e) {
      return JSON.parse((e as { stdout: string }).stdout);
    }
  };
}

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' });

// Project whose test command passes or fails depending on a file we control.
function project(testPasses = true) {
  const dir = mkdtempSync(join(tmpdir(), 'as-wf-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node check.js' } }));
  writeFileSync(join(dir, 'check.js'), "process.exit(require('fs').existsSync('FAIL') ? 1 : 0)\n");
  writeFileSync(join(dir, 'src.js'), 'module.exports = 1\n');
  if (!testPasses) writeFileSync(join(dir, 'FAIL'), '');
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

function classification(over: object = {}) {
  return JSON.stringify({ ...JSON.parse(readFileSync(join(fixtures, 'classifier', 'medium.json'), 'utf8')), ...over });
}

function setup(request: string, cls: string, opts: { testPasses?: boolean; env?: Record<string, string> } = {}) {
  const user = mkdtempSync(join(tmpdir(), 'as-user-'));
  const run = cliIn(user, opts.env);
  const dir = project(opts.testPasses ?? true);
  const ctx = run('start', '--project', dir);
  writeFileSync(join(ctx.run_dir, 'request.txt'), request);
  writeFileSync(join(ctx.run_dir, 'classification.txt'), cls);
  return { run, dir, rd: ctx.run_dir as string, ctx };
}

const review = (o: object = {}) => JSON.stringify({ verdict: 'PASS', criteria: [{ item: 'works', status: 'MET', evidence: 'test' }], findings: [], ...o });

function planAndImplement(run: ReturnType<typeof cliIn>, rd: string, dir: string) {
  assert.ok(run('phase', rd, 'discovery', 'skip', '--reason', 'small module').ok);
  assert.ok(run('phase', rd, 'plan', 'start').ok);
  copyFileSync(join(fixtures, 'plan', 'two-waves.json'), join(rd, 'plan.txt'));
  assert.ok(run('plan-check', rd).ok);
  assert.ok(run('phase', rd, 'plan', 'done').ok);
  assert.ok(run('tree-check', rd).ok);
  assert.ok(run('phase', rd, 'implement', 'start').ok);
  writeFileSync(join(dir, 'src.js'), 'module.exports = 2\n');
  assert.ok(run('phase', rd, 'implement', 'done').ok);
}

test('MEDIUM happy path: approvals, tests, review, Codex + adjudication, report', () => {
  const { run, dir, rd, ctx } = setup('--no-proposals add status', classification());
  assert.equal(ctx.engine, 'native');
  assert.equal(ctx.git.repo, true);
  const d = run('route', rd);
  assert.deepEqual([d.action, d.route], ['proceed', 'MEDIUM']);
  planAndImplement(run, rd, dir);

  assert.ok(run('phase', rd, 'test', 'start').ok);
  const needs = run('run', rd, 'test', '--label', 'wave-1');
  assert.deepEqual([needs.ok, needs.needs, needs.command], [false, 'approval', 'npm test']);
  assert.match(run('phase', rd, 'test', 'done').errors.join(), /has not run/);
  assert.equal(run('approve-command', rd, 'test').approved, true);
  const t = run('run', rd, 'test', '--label', 'wave-1');
  assert.deepEqual([t.ok, t.passed, t.exit_code], [true, true, 0]);
  assert.ok(existsSync(t.log));
  assert.ok(run('phase', rd, 'test', 'done').ok);

  assert.ok(run('phase', rd, 'review', 'start').ok);
  assert.match(run('phase', rd, 'review', 'done').errors.join(), /no review found/);
  mkdirSync(join(rd, 'reviews', 'round-1'), { recursive: true });
  writeFileSync(join(rd, 'reviews', 'round-1', 'reviewer.txt'), review());
  assert.ok(run('phase', rd, 'review', 'done').ok);

  assert.ok(run('phase', rd, 'independent_review', 'start').ok);
  const cx = run('codex-review', rd);
  assert.deepEqual([cx.status, cx.findings.length], ['ok', 2]);
  assert.match(readFileSync(join(rd, 'diff.patch'), 'utf8'), /module.exports = 2/);
  assert.equal(cx.coverage, 'complete'); // the fake only reports complete when the diff came inline
  assert.match(run('phase', rd, 'independent_review', 'done').errors.join(), /adjudicate/);
  writeFileSync(join(rd, 'adjudication.txt'), JSON.stringify({ adjudications: [
    { id: 'F1', verdict: 'FALSE_POSITIVE', reasoning: 'loop bound is correct; test covers it', resolved: false },
    { id: 'F2', verdict: 'CONFIRMED', reasoning: 'no test for 0', resolved: false },
  ] }));
  assert.deepEqual(run('adjudicate', rd).blocking, []);
  assert.ok(run('phase', rd, 'independent_review', 'done').ok);

  assert.ok(run('phase', rd, 'summary', 'start').ok);
  assert.match(run('phase', rd, 'summary', 'done').errors.join(), /summary.md/);
  writeFileSync(join(rd, 'summary.md'), '# done');
  const fin = run('phase', rd, 'summary', 'done');
  assert.deepEqual([fin.ok, fin.status], [true, 'done']);

  run('event', rd, '--role', 'implementer', '--agent', 'agentship:implementer', '--model', 'sonnet', '--tokens', '1200');
  const rep = run('report', rd);
  assert.deepEqual([rep.status, rep.route, rep.tests.passed, rep.tokens_reported, rep.independent_review.false_positive], ['done', 'MEDIUM', true, 1200, 1]);
  assert.ok(existsSync(join(rd, 'report.md')));
  assert.equal(run('compare', rd).reports, 1);
});

test('failing tests block the run and retries are bounded', () => {
  const { run, dir, rd } = setup('--no-proposals add status', classification(), { testPasses: false });
  run('route', rd);
  planAndImplement(run, rd, dir);
  run('phase', rd, 'test', 'start');
  run('approve-command', rd, 'test');
  const t = run('run', rd, 'test');
  assert.deepEqual([t.passed, t.exit_code], [false, 1]);
  const blocked = run('phase', rd, 'test', 'done');
  assert.deepEqual([blocked.ok, blocked.status], [false, 'blocked']);
  assert.match(blocked.errors.join(), /tests failed/);
  assert.equal(run('retry', rd, 'tests:wave-1').allowed, true);
  const second = run('retry', rd, 'tests:wave-1', '--role', 'implementer');
  assert.deepEqual([second.allowed, second.used, second.role.model], [true, 2, 'opus']); // escalated
  const third = run('retry', rd, 'tests:wave-1');
  assert.deepEqual([third.allowed, third.used], [false, 2]);
  assert.match(third.message, /retry limit/);
});

test('blocking review findings need a fix round or an explicit exception', () => {
  const { run, dir, rd } = setup('--no-proposals add status', classification());
  run('route', rd);
  planAndImplement(run, rd, dir);
  run('phase', rd, 'test', 'start');
  run('approve-command', rd, 'test');
  run('run', rd, 'test');
  run('phase', rd, 'test', 'done');
  run('phase', rd, 'review', 'start');
  mkdirSync(join(rd, 'reviews', 'round-1'), { recursive: true });
  writeFileSync(join(rd, 'reviews', 'round-1', 'reviewer.txt'), review({ verdict: 'PASS', findings: [{ severity: 'HIGH', file: 'src.js', line: 1, issue: 'wrong value', fix: '' }] }));
  assert.match(run('phase', rd, 'review', 'done').errors.join(), /reviewer#F1/);
  assert.match(run('exception', rd, 'reviewer#F1').error, /exception-request.txt/);
  writeFileSync(join(rd, 'exception-request.txt'), 'Developer: accepted, tracked in ticket 42');
  assert.match(run('exception', rd, 'reviewer#F9').error, /not a current blocking item/);
  writeFileSync(join(rd, 'exception-request.txt'), 'Developer: accepted, tracked in ticket 42');
  assert.ok(run('exception', rd, 'reviewer#F1').ok);
  assert.ok(run('phase', rd, 'review', 'done').ok);
});

test('HIGH risk without Codex needs an approved fallback; a fallback review must pass', () => {
  const { run, dir, rd } = setup('--no-proposals --route medium --confirm-downgrade tweak admin', classification({ risk: 'HIGH' }), { env: { AGENTSHIP_CODEX_BIN: join(tmpdir(), 'no-such-codex.js') } });
  const d = run('route', rd);
  assert.deepEqual([d.route, d.independent_review_required], ['MEDIUM', true]);
  planAndImplement(run, rd, dir);
  run('phase', rd, 'test', 'start');
  run('approve-command', rd, 'test');
  run('run', rd, 'test');
  run('phase', rd, 'test', 'done');
  run('phase', rd, 'review', 'start');
  mkdirSync(join(rd, 'reviews', 'round-1'), { recursive: true });
  writeFileSync(join(rd, 'reviews', 'round-1', 'reviewer.txt'), review());
  run('phase', rd, 'review', 'done');
  assert.match(run('phase', rd, 'independent_review', 'skip', '--reason', 'no codex').errors.join(), /required/);
  run('phase', rd, 'independent_review', 'start');
  const cx = run('codex-review', rd);
  assert.notEqual(cx.status, 'ok');
  assert.match(run('phase', rd, 'independent_review', 'done').errors.join(), /approve a fallback/);
  assert.ok(run('approve', rd, 'independent_review_fallback', '--mode', 'claude').ok);
  assert.match(run('phase', rd, 'independent_review', 'done').errors.join(), /independent-fallback.txt/);
  writeFileSync(join(rd, 'independent-fallback.txt'), review());
  assert.ok(run('phase', rd, 'independent_review', 'done').ok);
});

test('Codex adapter: timeout, crash, bad output, file modification and disabled are never a pass', () => {
  for (const [mode, status] of [['crash', 'error'], ['bad-output', 'invalid_output'], ['modify', 'modified_files'], ['unauth', 'unavailable'], ['old', 'unavailable'], ['sandbox-broken', 'incomplete']] as const) {
    const { run, dir, rd } = setup('--no-proposals x', classification(), { env: { FAKE_CODEX_MODE: mode } });
    run('route', rd);
    writeFileSync(join(dir, 'src.js'), 'module.exports = 3\n');
    const r = run('codex-review', rd);
    assert.equal(r.status, status, mode);
    assert.equal(r.findings.length, 0);
    assert.ok(r.errors.length > 0);
  }
  const user = mkdtempSync(join(tmpdir(), 'as-user-'));
  mkdirSync(join(user, 'agentship'));
  writeFileSync(join(user, 'agentship', 'config.json'), JSON.stringify({ codex: { enabled: false, timeout_seconds: 30 } }));
  const run = cliIn(user);
  const ctx = run('start', '--project', project());
  writeFileSync(join(ctx.run_dir, 'request.txt'), 'x');
  writeFileSync(join(ctx.run_dir, 'classification.txt'), classification());
  assert.equal(run('codex-review', ctx.run_dir).status, 'disabled');
});

test('Codex adapter enforces the timeout', { timeout: 120_000 }, () => {
  const user = mkdtempSync(join(tmpdir(), 'as-user-'));
  mkdirSync(join(user, 'agentship'));
  writeFileSync(join(user, 'agentship', 'config.json'), JSON.stringify({ codex: { timeout_seconds: 30 } }));
  const run = cliIn(user, { FAKE_CODEX_MODE: 'timeout' });
  const ctx = run('start', '--project', project());
  writeFileSync(join(ctx.run_dir, 'request.txt'), 'x');
  writeFileSync(join(ctx.run_dir, 'classification.txt'), classification());
  const r = run('codex-review', ctx.run_dir);
  assert.equal(r.status, 'timeout');
});

test('LARGE: human gate stops the run; resume --approve continues it', () => {
  const { run, dir, rd } = setup('--no-proposals redesign store', JSON.stringify({ ...JSON.parse(classification()), complexity: 'LARGE', recommended_workflow: 'LARGE' }));
  assert.equal(run('route', rd).route, 'LARGE');
  run('phase', rd, 'discovery', 'skip', '--reason', 'done in classification');
  run('phase', rd, 'research', 'skip', '--reason', 'no domains');
  run('phase', rd, 'requirements', 'start');
  writeFileSync(join(rd, 'requirements.md'), '# req');
  run('phase', rd, 'requirements', 'done');
  run('phase', rd, 'plan', 'start');
  copyFileSync(join(fixtures, 'plan', 'two-waves.json'), join(rd, 'plan.txt'));
  run('plan-check', rd);
  run('phase', rd, 'plan', 'done');
  const gate = run('phase', rd, 'human_gate', 'start');
  assert.deepEqual([gate.status, gate.waiting_for], ['waiting', 'human_gate']);
  assert.match(run('phase', rd, 'human_gate', 'done').errors.join(), /not approved/);
  run('tree-check', rd);
  assert.match(run('phase', rd, 'implement', 'start').errors.join(), /human_gate must be done/);

  // New session: the developer types --resume <id> --approve
  const ctx2 = run('start', '--project', dir);
  writeFileSync(join(ctx2.run_dir, 'request.txt'), `--resume ${basename(rd)} --approve`);
  const r = run('route', ctx2.run_dir);
  assert.deepEqual([r.action, r.approved_human_gate, r.next_phase, r.resume_run_dir], ['resume', true, 'human_gate', rd]);
  assert.ok(run('phase', rd, 'human_gate', 'done').ok);
  assert.ok(run('phase', rd, 'implement', 'start').ok);
});

test('waiting for answers, then resuming from a new session with the answers', () => {
  const { run, dir, rd } = setup('--no-proposals redesign store', JSON.stringify({ ...JSON.parse(classification()), complexity: 'LARGE', recommended_workflow: 'LARGE' }));
  run('route', rd);
  run('phase', rd, 'discovery', 'skip', '--reason', 'x');
  run('phase', rd, 'research', 'skip', '--reason', 'x');
  run('phase', rd, 'requirements', 'start');
  const w = run('phase', rd, 'requirements', 'wait');
  assert.deepEqual([w.status, w.waiting_for], ['waiting', 'requirements:answers']);
  const ctx2 = run('start', '--project', dir);
  writeFileSync(join(ctx2.run_dir, 'request.txt'), `--resume ${basename(rd)} defaults OK; $(rm -rf /) is just text`);
  const r = run('route', ctx2.run_dir);
  assert.deepEqual([r.action, r.next_phase, r.status], ['resume', 'requirements', 'running']);
  assert.match(readFileSync(r.answers_file, 'utf8'), /defaults OK; \$\(rm -rf \/\) is just text/);
});

test('parallel command approvals on different projects do not lose each other', async () => {
  const user = mkdtempSync(join(tmpdir(), 'as-user-'));
  const run = cliIn(user);
  const runs = Array.from({ length: 4 }, () => run('start', '--project', project()).run_dir as string);
  const { spawn } = await import('node:child_process');
  await Promise.all(runs.map((rd) => new Promise((done) => spawn(process.execPath, [cli, 'approve-command', rd, 'test'], { env: { ...process.env, CLAUDE_CONFIG_DIR: user } }).on('close', done))));
  for (const rd of runs) assert.equal(run('commands', rd).commands[0].approved, true);
});

test('recovery: external commits and pre-existing edits on planned files block implementation', () => {
  const user = mkdtempSync(join(tmpdir(), 'as-user-'));
  const run = cliIn(user);
  const dir = project();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'orders.js'), 'developer work in progress\n'); // untracked, planned by two-waves.json
  const ctx = run('start', '--project', dir);
  assert.deepEqual(ctx.git.preexisting_changes, ['src/orders.js']);
  writeFileSync(join(ctx.run_dir, 'request.txt'), '--no-proposals x');
  writeFileSync(join(ctx.run_dir, 'classification.txt'), classification());
  run('route', ctx.run_dir);
  copyFileSync(join(fixtures, 'plan', 'two-waves.json'), join(ctx.run_dir, 'plan.txt'));
  run('plan-check', ctx.run_dir);
  const t = run('tree-check', ctx.run_dir);
  assert.deepEqual([t.ok, t.overlapping_user_changes], [false, ['src/orders.js']]);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'someone else');
  assert.equal(run('tree-check', ctx.run_dir).head_changed, true);
});

test('config and doctor report problems clearly', () => {
  const user = mkdtempSync(join(tmpdir(), 'as-user-'));
  const run = cliIn(user);
  const dir = project();
  writeFileSync(join(dir, 'agentship.config.json'), JSON.stringify({ policies: { risk_floor: { HIGH: 'SMALL' } } }));
  const c = run('config', '--project', dir);
  assert.equal(c.ok, false);
  assert.match(c.errors.join(), /only make the policy stricter/);
  const doc = run('doctor', '--project', dir);
  assert.equal(doc.checks.find((x: { check: string }) => x.check === 'config').ok, false);
  assert.equal(doc.checks.find((x: { check: string }) => x.check === 'codex').ok, true);
  // a broken config stops routing instead of silently using defaults
  const ctx = run('start', '--project', dir);
  writeFileSync(join(ctx.run_dir, 'request.txt'), 'x');
  writeFileSync(join(ctx.run_dir, 'classification.txt'), classification());
  assert.equal(run('route', ctx.run_dir).action, 'error');
});
