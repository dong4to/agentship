import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../../src/engine/plan.ts';

const raw = () => JSON.parse(readFileSync(new URL('../fixtures/plan/two-waves.json', import.meta.url), 'utf8'));
const errors = (o: unknown, maxWaves?: number) => {
  const p = parsePlan(JSON.stringify(o), { maxWaves });
  return p.ok ? '' : p.errors.join();
};

test('valid plan parses', () => {
  assert.equal(errors(raw()), '');
});

test('waves may only depend on earlier waves', () => {
  const r = raw();
  r.waves[0].depends_on = [2];
  assert.match(errors(r), /wave 1: depends_on/);
});

test('acceptance criteria, files and verify are required', () => {
  const r = raw();
  r.acceptance_criteria = [];
  r.waves[1].files = [];
  r.waves[1].verify = '';
  const e = errors(r);
  assert.match(e, /acceptance_criteria must not be empty/);
  assert.match(e, /wave 2: files/);
  assert.match(e, /wave 2: verify/);
});

test('wave cap per route', () => {
  assert.match(errors(raw(), 1), /at most 1 wave/);
  assert.equal(errors(raw(), 2), '');
});
