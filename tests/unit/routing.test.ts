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

test('MEDIUM routes to MEDIUM (via proposals)', () => {
  const d = decide(load('medium.json'));
  assert.deepEqual([d.action, d.route], ['propose', 'MEDIUM']);
  assert.equal(decide(load('medium.json'), { proposals: 'off' }).action, 'proceed');
});

test('LARGE routes to LARGE', () => {
  assert.equal(decide(load('large.json')).route, 'LARGE');
});

test('SMALL effort but HIGH risk routes to LARGE', () => {
  const d = decide(load('small-high-risk.json'), { proposals: 'off' });
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
  const d = decide(c, { route: 'SMALL', confirmDowngrade: true, proposals: 'off' });
  assert.deepEqual([d.action, d.route], ['proceed', 'MEDIUM']);
});

test('HIGH risk never produces SMALL under any override combination', () => {
  const c = load('small-high-risk.json');
  for (const route of [undefined, 'SMALL', 'MEDIUM', 'LARGE'] as const) {
    for (const confirmDowngrade of [false, true]) {
      for (const afterDiscovery of [false, true]) {
        for (const proposals of [undefined, 'force', 'off'] as const) {
          assert.notEqual(decide(c, { route, confirmDowngrade, afterDiscovery, proposals }).route, 'SMALL');
        }
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
  assert.match(parseRequest('--proposals --no-proposals fix it').errors.join(), /mutually exclusive/);
});

test('resume flags: valid id + proposal, and their misuse', () => {
  const ok = parseRequest('--resume 2026-11-12T10-00-00-000Z --proposal 2');
  assert.deepEqual([ok.errors, ok.resume], [[], { runId: '2026-11-12T10-00-00-000Z', proposal: 2, approve: false }]);
  assert.deepEqual(parseRequest('--resume 2026-11-12T10-00-00-000Z').errors, []);
  assert.equal(parseRequest('--resume 2026-11-12T10-00-00-000Z --approve').resume?.approve, true);
  assert.match(parseRequest('--approve fix it').errors.join(), /only works together with --resume/);
  assert.match(parseRequest('--resume 2026-11-12T10-00-00-000Z --approve --proposal 1').errors.join(), /not both/);
  assert.equal(parseRequest('--profile economy fix it').profile, 'economy');
  assert.match(parseRequest('--profile $(x) fix it').errors.join(), /--profile expects/);
  assert.match(parseRequest('--resume ../../etc --proposal 1').errors.join(), /--resume expects a run id/);
  assert.match(parseRequest('--proposal 2 fix it').errors.join(), /only works together with --resume/);
  assert.match(parseRequest('--resume 2026-11-12T10-00-00-000Z --proposal 4').errors.join(), /expects 1, 2 or 3/);
  assert.match(parseRequest('--resume 2026-11-12T10-00-00-000Z --proposal 1 more text').errors.join(), /takes no extra text/);
  const reply = parseRequest('--resume 2026-11-12T10-00-00-000Z defaults OK, also fix canRefund');
  assert.deepEqual([reply.errors, reply.task], [[], 'defaults OK, also fix canRefund']);
});

// --- classification extensions (H2.7 / H2.9)

test('domains and multiple_approaches are optional, validated, and normalized', () => {
  const base = JSON.parse(fixture('small.json'));
  const c = load('small.json');
  assert.deepEqual([c.domains, c.multiple_approaches], [[], false]);
  const p = parseClassification(JSON.stringify({ ...base, domains: ['Accounting'], multiple_approaches: true }));
  assert.ok(p.ok);
  assert.deepEqual([p.value.domains, p.value.multiple_approaches], [['accounting'], true]);
  assert.equal(parseClassification(JSON.stringify({ ...base, domains: 'accounting' })).ok, false);
  assert.equal(parseClassification(JSON.stringify({ ...base, multiple_approaches: 'yes' })).ok, false);
});

// --- proposals triggers (H2.7)

test('proposals: clear SMALL proceeds; multiple approaches, MEDIUM confidence or --proposals propose', () => {
  const c = load('small.json');
  assert.equal(decide(c).action, 'proceed');
  assert.equal(decide({ ...c, multiple_approaches: true }).action, 'propose');
  assert.equal(decide({ ...c, confidence: 'MEDIUM' }).action, 'propose');
  assert.equal(decide(c, { proposals: 'force' }).action, 'propose');
  assert.equal(decide({ ...c, multiple_approaches: true }, { proposals: 'off' }).action, 'proceed');
  assert.equal(decide(load('large.json'), { fromProposal: true }).action, 'proceed');
});

test('proposals never bypass confirmation or low-confidence handling', () => {
  assert.equal(decide(load('small-high-risk.json'), { route: 'MEDIUM', proposals: 'force' }).action, 'confirm_downgrade');
  assert.equal(decide(load('low-confidence.json'), { proposals: 'force' }).action, 'discovery');
});

// --- domain risk floors (H2.9)

test('domains raise risk to their minimum, never lower it', () => {
  const c = load('small.json');
  const pay = decide({ ...c, domains: ['payments'] }, { proposals: 'off' });
  assert.deepEqual([pay.risk, pay.route], ['HIGH', 'LARGE']);
  assert.equal(decide({ ...c, domains: ['accounting'] }, { proposals: 'off' }).risk, 'MEDIUM');
  assert.equal(decide({ ...load('small-high-risk.json'), domains: ['accounting'] }).risk, 'HIGH');
  assert.equal(decide({ ...c, domains: ['cooking'] }).risk, 'LOW');
});
