// Runs the real CLI the way the skill does: files in a run dir, JSON on stdout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const fixtures = fileURLToPath(new URL('../fixtures/classifier/', import.meta.url));

function run(...args: string[]) {
  try {
    return JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'as-user-')) } }));
  } catch (e) {
    return JSON.parse((e as { stdout: string }).stdout);
  }
}

function newRun(request: string, fixture?: string) {
  const project = mkdtempSync(join(tmpdir(), 'as-proj-'));
  const ctx = run('start', '--project', project);
  writeFileSync(join(ctx.run_dir, 'request.txt'), request);
  if (fixture) copyFileSync(join(fixtures, fixture), join(ctx.run_dir, 'classification.txt'));
  return { project, ctx };
}

test('start creates a self-ignoring run dir and reports GSD + roles', () => {
  const { project, ctx } = newRun('fix it');
  assert.equal(readFileSync(join(project, '.agentship', '.gitignore'), 'utf8'), '*\n');
  assert.ok(existsSync(join(ctx.run_dir, 'run.json')));
  assert.equal(ctx.gsd.installed, false);
  assert.equal(ctx.roles.classifier.model, 'sonnet');
});

for (const [fixture, route] of [
  ['small.json', 'SMALL'],
  ['medium.json', 'MEDIUM'],
  ['large.json', 'LARGE'],
  ['small-high-risk.json', 'LARGE'],
] as const) {
  test(`route: ${fixture} -> ${route}, decision.json written`, () => {
    const { ctx } = newRun('some task', fixture);
    const d = run('route', ctx.run_dir);
    assert.deepEqual([d.action, d.route], ['proceed', route]);
    assert.equal(JSON.parse(readFileSync(join(ctx.run_dir, 'decision.json'), 'utf8')).route, route);
  });
}

test('route: invalid classification is an error with no route', () => {
  const { ctx } = newRun('some task', 'invalid-missing-risk.json');
  const d = run('route', ctx.run_dir);
  assert.deepEqual([d.action, d.route], ['error', null]);
  assert.match(d.errors.join(), /risk must be one of/);
});

test('route: missing classification is an error, not SMALL', () => {
  const { ctx } = newRun('some task');
  assert.deepEqual([run('route', ctx.run_dir).action, run('route', ctx.run_dir).route], ['error', null]);
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
  const ok = newRun('--route small --confirm-downgrade tweak admin check', 'small-high-risk.json');
  assert.deepEqual([run('route', ok.ctx.run_dir).action, run('route', ok.ctx.run_dir).route], ['proceed', 'MEDIUM']);
});

test('route: low confidence -> discovery, then clarify after discovery', () => {
  const { ctx } = newRun('make it faster', 'low-confidence.json');
  assert.equal(run('route', ctx.run_dir).action, 'discovery');
  assert.equal(run('route', ctx.run_dir, '--after-discovery').action, 'clarify');
  assert.ok(existsSync(join(ctx.run_dir, 'decision-after-discovery.json')));
});

test('unknown command fails with a JSON error', () => {
  assert.match(run('deploy').error, /unknown command/);
});
