// Runs the real CLI the way the skill does: files in a run dir, JSON on stdout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const userDir = mkdtempSync(join(tmpdir(), 'as-user-'));

function run(...args: string[]) {
  try {
    return JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: userDir } }));
  } catch (e) {
    return JSON.parse((e as { stdout: string }).stdout);
  }
}

function newRun(request: string, fixture?: string, project = mkdtempSync(join(tmpdir(), 'as-proj-'))) {
  const ctx = run('start', '--project', project);
  writeFileSync(join(ctx.run_dir, 'request.txt'), request);
  if (fixture) copyFileSync(join(fixtures, 'classifier', fixture), join(ctx.run_dir, 'classification.txt'));
  return { project, ctx };
}

test('start creates a self-ignoring run dir and reports the native engine + roles', () => {
  const { project, ctx } = newRun('fix it');
  assert.equal(readFileSync(join(project, '.agentship', '.gitignore'), 'utf8'), '*\n');
  assert.ok(existsSync(join(ctx.run_dir, 'run.json')));
  assert.equal(ctx.engine, 'native');
  assert.equal(ctx.gsd, undefined);
  assert.equal(ctx.roles.proposer.model, 'opus');
  assert.equal(ctx.max_proposals, 3);
});

for (const [fixture, action, route] of [
  ['small.json', 'proceed', 'SMALL'],
  ['medium.json', 'propose', 'MEDIUM'],
  ['large.json', 'propose', 'LARGE'],
  ['small-high-risk.json', 'propose', 'LARGE'],
] as const) {
  test(`route: ${fixture} -> ${action} ${route}, decision.json written`, () => {
    const { ctx } = newRun('some task', fixture);
    const d = run('route', ctx.run_dir);
    assert.deepEqual([d.action, d.route], [action, route]);
    assert.equal(JSON.parse(readFileSync(join(ctx.run_dir, 'decision.json'), 'utf8')).route, route);
    assert.ok(existsSync(join(ctx.run_dir, 'classification.json')));
  });
}

test('route: --no-proposals proceeds directly', () => {
  const { ctx } = newRun('--no-proposals some task', 'medium.json');
  assert.equal(run('route', ctx.run_dir).action, 'proceed');
});

test('route: invalid classification is an error with no route', () => {
  const { ctx } = newRun('some task', 'invalid-missing-risk.json');
  const d = run('route', ctx.run_dir);
  assert.deepEqual([d.action, d.route], ['error', null]);
  assert.match(d.errors.join(), /risk must be one of/);
});

test('route: missing classification is an error, not SMALL', () => {
  const { ctx } = newRun('some task');
  const d = run('route', ctx.run_dir);
  assert.deepEqual([d.action, d.route], ['error', null]);
});

test('route: shell metacharacters in the task are inert data', () => {
  const { ctx } = newRun('--route large $(rm -rf /) `whoami` ; echo pwned', 'small.json');
  const d = run('route', ctx.run_dir);
  assert.equal(d.route, 'LARGE');
  assert.equal(d.task, '$(rm -rf /) `whoami` ; echo pwned');
});

test('route: HIGH-risk downgrade asks for confirmation, then clamps at MEDIUM', () => {
  const ask = newRun('--route small tweak admin check', 'small-high-risk.json');
  assert.equal(run('route', ask.ctx.run_dir).action, 'confirm_downgrade');
  const ok = newRun('--no-proposals --route small --confirm-downgrade tweak admin check', 'small-high-risk.json');
  const d = run('route', ok.ctx.run_dir);
  assert.deepEqual([d.action, d.route], ['proceed', 'MEDIUM']);
});

test('route: low confidence -> discovery, then clarify after discovery', () => {
  const { ctx } = newRun('make it faster', 'low-confidence.json');
  assert.equal(run('route', ctx.run_dir).action, 'discovery');
  assert.equal(run('route', ctx.run_dir, '--after-discovery').action, 'clarify');
  assert.ok(existsSync(join(ctx.run_dir, 'decision-after-discovery.json')));
});

test('proposals -> select: validated list, then the chosen proposal is routed', () => {
  const { ctx } = newRun('add order status', 'medium.json');
  assert.equal(run('route', ctx.run_dir).action, 'propose');
  copyFileSync(join(fixtures, 'proposals', 'three.json'), join(ctx.run_dir, 'proposals.txt'));
  const p = run('proposals', ctx.run_dir);
  assert.equal(p.ok, true);
  assert.deepEqual(p.proposals.map((x: { recommended: boolean }) => x.recommended), [false, true, false]);

  const pick1 = run('select', ctx.run_dir, '1');
  assert.deepEqual([pick1.action, pick1.route, pick1.proposal.id], ['proceed', 'SMALL', 1]);
  const pick3 = run('select', ctx.run_dir, '3');
  assert.deepEqual([pick3.action, pick3.route], ['proceed', 'LARGE']);
  assert.ok(existsSync(join(ctx.run_dir, 'selection.json')));
  assert.match(run('select', ctx.run_dir, '7').error, /does not exist/);
});

test('proposals: invalid output is reported, nothing written', () => {
  const { ctx } = newRun('add order status', 'medium.json');
  writeFileSync(join(ctx.run_dir, 'proposals.txt'), '{"proposals": []}');
  const p = run('proposals', ctx.run_dir);
  assert.equal(p.ok, false);
  assert.ok(!existsSync(join(ctx.run_dir, 'proposals.json')));
});

test('select keeps the analysis risk: HIGH-risk task never runs SMALL via a proposal', () => {
  const { ctx } = newRun('owner can be admin', 'small-high-risk.json');
  run('route', ctx.run_dir);
  copyFileSync(join(fixtures, 'proposals', 'three.json'), join(ctx.run_dir, 'proposals.txt'));
  run('proposals', ctx.run_dir);
  const d = run('select', ctx.run_dir, '1');
  assert.deepEqual([d.risk, d.route], ['HIGH', 'LARGE']);
});

test('resume: a new run points at the stopped run, which can then select', () => {
  const first = newRun('add order status', 'medium.json');
  run('route', first.ctx.run_dir);
  copyFileSync(join(fixtures, 'proposals', 'three.json'), join(first.ctx.run_dir, 'proposals.txt'));
  run('proposals', first.ctx.run_dir);

  const second = newRun(`--resume ${basename(first.ctx.run_dir)} --proposal 2`, undefined, first.project);
  const r = run('route', second.ctx.run_dir);
  assert.deepEqual([r.action, r.resume_run_dir, r.proposal], ['resume', first.ctx.run_dir, 2]);
  assert.equal(run('select', r.resume_run_dir, '2').route, 'MEDIUM');

  const missing = newRun('--resume 2020-01-01T00-00-00-000Z --proposal 1', undefined, first.project);
  assert.equal(run('route', missing.ctx.run_dir).action, 'error');
});

test('agents: plan with checklist even when no specialist is installed', () => {
  const { ctx } = newRun('post journal entries', 'small.json');
  const c = JSON.parse(readFileSync(join(fixtures, 'classifier', 'small.json'), 'utf8'));
  writeFileSync(join(ctx.run_dir, 'classification.txt'), JSON.stringify({ ...c, domains: ['accounting'] }));
  const d = run('route', ctx.run_dir);
  assert.deepEqual([d.risk, d.domains], ['MEDIUM', ['accounting']]);
  const a = run('agents', ctx.run_dir);
  assert.deepEqual(a.domains, ['accounting']);
  assert.equal(a.phases.research[0].model, 'opus');
  assert.ok(a.agents_scanned >= 5); // AgentShip's own agents
  assert.ok(existsSync(join(ctx.run_dir, 'agents.json')));
});

test('plan-check: validates waves and caps MEDIUM at 2', () => {
  const { ctx } = newRun('--no-proposals add order status', 'medium.json');
  run('route', ctx.run_dir);
  copyFileSync(join(fixtures, 'plan', 'two-waves.json'), join(ctx.run_dir, 'plan.txt'));
  const ok = run('plan-check', ctx.run_dir);
  assert.deepEqual([ok.ok, ok.route, ok.waves.length], [true, 'MEDIUM', 2]);
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan', 'two-waves.json'), 'utf8'));
  plan.waves.push({ ...plan.waves[1], id: 3, depends_on: [2] });
  writeFileSync(join(ctx.run_dir, 'plan.txt'), JSON.stringify(plan));
  assert.match(run('plan-check', ctx.run_dir).errors.join(), /at most 2/);
});

test('unknown command fails with a JSON error', () => {
  assert.match(run('deploy').error, /unknown command/);
  assert.match(run('detect').error, /unknown command/);
});
