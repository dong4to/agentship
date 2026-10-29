import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClassification, type Classification } from '../../src/routing/classification.ts';
import { decide } from '../../src/routing/policy.ts';
import { parseRequest } from '../../src/routing/request.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/classifier/${name}`, import.meta.url), 'utf8');

const load = (name: string): Classification => {
  const p = parseClassification(fixture(name));
  assert.ok(p.ok, `fixture ${name} should be valid`);
  return p.value;
};

// --- classifier output validation

test('valid fixtures parse', () => {
  for (const f of ['small.json', 'medium.json', 'large.json', 'small-high-risk.json', 'low-confidence.json']) load(f);
});

test('JSON wrapped in prose and a fence parses', () => {
  assert.equal(load('fenced.txt').complexity, 'MEDIUM');
});

test('missing field is rejected with a reason', () => {
  const p = parseClassification(fixture('invalid-missing-risk.json'));
  assert.equal(p.ok, false);
  assert.match(!p.ok ? p.errors.join() : '', /risk must be one of/);
});

test('garbage, wrong enums, and empty reasons are rejected', () => {
  assert.equal(parseClassification('I think this is small').ok, false);
  assert.equal(parseClassification('{"complexity": "SMALL",').ok, false);
  const base = JSON.parse(fixture('small.json'));
  assert.equal(parseClassification(JSON.stringify({ ...base, complexity: 'TINY' })).ok, false);
  assert.equal(parseClassification(JSON.stringify({ ...base, risk: 'low' })).ok, false);
  assert.equal(parseClassification(JSON.stringify({ ...base, reasons: [] })).ok, false);
  assert.equal(parseClassification(JSON.stringify({ ...base, affected_modules: 'src' })).ok, false);
  assert.equal(parseClassification('[1,2]').ok, false);
});

// --- policy: the four representative cases (H2.6)

test('SMALL low-risk stays SMALL', () => {
  const d = decide(load('small.json'));
  assert.deepEqual([d.action, d.route], ['proceed', 'SMALL']);
});

test('MEDIUM routes to MEDIUM', () => {
  assert.equal(decide(load('medium.json')).route, 'MEDIUM');
});

test('LARGE routes to LARGE', () => {
  assert.equal(decide(load('large.json')).route, 'LARGE');
});

test('SMALL effort but HIGH risk routes to LARGE', () => {
  const d = decide(load('small-high-risk.json'));
  assert.deepEqual([d.action, d.route, d.risk], ['proceed', 'LARGE', 'HIGH']);
});

// --- policy rules (H2.3)

test('invalid classification never yields a route', () => {
  const d = decide(null);
  assert.deepEqual([d.action, d.route], ['error', null]);
});

test('route never drops below the classifier recommendation', () => {
  const c = { ...load('small.json'), recommended_workflow: 'MEDIUM' as const };
  assert.equal(decide(c).route, 'MEDIUM');
});

test('low confidence asks for discovery, then clarification', () => {
  const c = load('low-confidence.json');
  assert.equal(decide(c).action, 'discovery');
  assert.equal(decide(c, { afterDiscovery: true }).action, 'clarify');
  // a user override does not skip the low-confidence handling
  assert.equal(decide(c, { route: 'LARGE' }).action, 'discovery');
});

test('user can raise the route', () => {
  assert.equal(decide(load('small.json'), { route: 'LARGE' }).route, 'LARGE');
});

test('user can raise risk to HIGH, which forces LARGE', () => {
  const d = decide(load('small.json'), { riskHigh: true });
  assert.deepEqual([d.route, d.risk], ['LARGE', 'HIGH']);
});

test('user can lower a non-HIGH-risk route', () => {
  const d = decide(load('medium.json'), { route: 'SMALL' });
  assert.deepEqual([d.action, d.route], ['proceed', 'SMALL']);
});

test('downgrading a HIGH-risk task needs confirmation', () => {
  const d = decide(load('small-high-risk.json'), { route: 'MEDIUM' });
  assert.deepEqual([d.action, d.route], ['confirm_downgrade', 'LARGE']);
});

test('confirmed HIGH-risk downgrade applies, but never to SMALL', () => {
  const c = load('small-high-risk.json');
  assert.equal(decide(c, { route: 'MEDIUM', confirmDowngrade: true }).route, 'MEDIUM');
  const d = decide(c, { route: 'SMALL', confirmDowngrade: true });
  assert.deepEqual([d.action, d.route], ['proceed', 'MEDIUM']);
});

test('HIGH risk never produces SMALL under any override combination', () => {
  const c = load('small-high-risk.json');
  for (const route of [undefined, 'SMALL', 'MEDIUM', 'LARGE'] as const) {
    for (const confirmDowngrade of [false, true]) {
      for (const afterDiscovery of [false, true]) {
        assert.notEqual(decide(c, { route, confirmDowngrade, afterDiscovery }).route, 'SMALL');
      }
    }
  }
});

// --- request parsing

test('request flags are parsed from the start only', () => {
  const r = parseRequest('--route medium --risk high --confirm-downgrade fix the --route bug in cart');
  assert.deepEqual(r.overrides, { route: 'MEDIUM', riskHigh: true, confirmDowngrade: true });
  assert.equal(r.task, 'fix the --route bug in cart');
  assert.deepEqual(r.errors, []);
});

test('bad flags and empty tasks are errors, not silent defaults', () => {
  assert.match(parseRequest('--route tiny fix it').errors.join(), /--route expects/);
  assert.match(parseRequest('--risk low fix it').errors.join(), /only accepts "high"/);
  assert.match(parseRequest('--fast fix it').errors.join(), /unknown flag/);
  assert.match(parseRequest('--route large').errors.join(), /task description is empty/);
});
