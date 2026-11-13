import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, retryKeyMax, setRoute, transition, type RunState } from '../../src/state/state.ts';

const baseline = { git: false, head: null, branch: null, dirty: [] };
const pass = () => [];
const fresh = (route: 'SMALL' | 'MEDIUM' | 'LARGE', risk: 'LOW' | 'HIGH' = 'LOW') => {
  const s = newState('r', 'balanced', baseline);
  assert.deepEqual(setRoute(s, route, risk, 'HIGH'), []);
  s.tree_check = { ok: true, at: '', errors: [] };
  return s;
};
const run = (s: RunState, phase: string, gate = pass) => {
  assert.deepEqual(transition(s, phase, 'start', null, gate), []);
  assert.deepEqual(transition(s, phase, 'done', null, gate), []);
};

test('phases must run in order; skipping only where allowed, with a reason', () => {
  const s = fresh('MEDIUM');
  assert.match(transition(s, 'plan', 'start', null, pass).join(), /discovery must be done or skipped/);
  assert.match(transition(s, 'discovery', 'skip', null, pass).join(), /needs a reason/);
  assert.deepEqual(transition(s, 'discovery', 'skip', 'discovery.md from classification', pass), []);
  assert.match(transition(s, 'test', 'skip', 'x', pass).join(), /cannot be skipped/);
  assert.match(transition(s, 'deploy', 'start', null, pass).join(), /not part of the MEDIUM workflow/);
});

test('a failing gate blocks completing the phase', () => {
  const s = fresh('SMALL');
  run(s, 'implement');
  transition(s, 'test', 'start', null, pass);
  assert.deepEqual(transition(s, 'test', 'done', null, () => ['tests failed']), ['tests failed']);
  assert.equal(s.phases.test.status, 'running');
});

test('LARGE cannot implement before the human gate is approved', () => {
  const s = fresh('LARGE');
  for (const p of ['discovery', 'research', 'requirements', 'plan']) run(s, p);
  transition(s, 'human_gate', 'start', null, pass);
  // the human_gate phase itself would need the approval in its gate; simulate it
  s.approvals.human_gate = { at: 'now', via: 'chat' };
  assert.deepEqual(transition(s, 'human_gate', 'done', null, pass), []);
  assert.equal(s.human_approval, true);
  delete s.approvals.human_gate;
  assert.match(transition(s, 'implement', 'start', null, pass).join(), /human gate approved/);
});

test('implementing needs a passing tree check', () => {
  const s = fresh('SMALL');
  s.tree_check = null;
  assert.match(transition(s, 'implement', 'start', null, pass).join(), /tree-check/);
});

test('independent review cannot be skipped when required by risk', () => {
  const s = fresh('MEDIUM', 'HIGH');
  assert.equal(s.independent_review_required, true);
  for (const p of ['discovery', 'plan', 'implement', 'test', 'review']) run(s, p);
  assert.match(transition(s, 'independent_review', 'skip', 'no codex', pass).join(), /required/);
  const low = fresh('MEDIUM');
  for (const p of ['discovery', 'plan', 'implement', 'test', 'review']) run(low, p);
  assert.deepEqual(transition(low, 'independent_review', 'skip', 'not required', pass), []);
});

test('summary done finishes the run; route cannot change once started', () => {
  const s = fresh('SMALL');
  for (const p of ['implement', 'test', 'summary']) run(s, p);
  assert.equal(s.status, 'done');
  assert.match(setRoute(s, 'LARGE', 'HIGH', 'HIGH').join(), /cannot switch/);
});

test('a gate failure blocks, a later successful done unblocks', () => {
  const s = fresh('SMALL');
  run(s, 'implement');
  transition(s, 'test', 'start', null, pass);
  transition(s, 'test', 'done', null, () => ['tests failed']);
  s.status = 'blocked'; // what the CLI records on a failed done
  assert.deepEqual(transition(s, 'test', 'done', null, pass), []);
  assert.equal(s.status, 'running');
});

test('SMALL gets an independent review phase only when the policy requires it for its risk', () => {
  const s = newState('r', 'balanced', baseline);
  setRoute(s, 'SMALL', 'MEDIUM', 'MEDIUM');
  assert.deepEqual(Object.keys(s.phases), ['implement', 'test', 'independent_review', 'summary']);
  assert.deepEqual(Object.keys(fresh('SMALL').phases), ['implement', 'test', 'summary']);
});

test('retry keys and limits', () => {
  const r = { tests_per_wave: 2, review_rounds: 1, llm_output: 1 };
  assert.equal(retryKeyMax('tests:wave-1', r), 2);
  assert.equal(retryKeyMax('review', r), 1);
  assert.equal(retryKeyMax('llm:planner', r), 1);
  assert.equal(retryKeyMax('whatever', r), null);
});
