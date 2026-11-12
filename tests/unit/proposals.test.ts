import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClassification } from '../../src/routing/classification.ts';
import { chosenClassification, parseProposals } from '../../src/proposals/proposals.ts';
import { decide } from '../../src/routing/policy.ts';

const raw = () => JSON.parse(readFileSync(new URL('../fixtures/proposals/three.json', import.meta.url), 'utf8'));
const classifier = (name: string) => {
  const p = parseClassification(readFileSync(new URL(`../fixtures/classifier/${name}`, import.meta.url), 'utf8'));
  assert.ok(p.ok);
  return p.value;
};
const errors = (o: unknown, max?: number) => {
  const p = parseProposals(JSON.stringify(o), max);
  return p.ok ? '' : p.errors.join();
};

test('valid proposals parse, also inside a fence', () => {
  const p = parseProposals('Here:\n```json\n' + JSON.stringify(raw()) + '\n```');
  assert.ok(p.ok);
  assert.deepEqual(p.value.map((x) => x.id), [1, 2, 3]);
});

test('more than the max, none, or bad ids are rejected', () => {
  assert.match(errors(raw(), 2), /1 to 2/);
  assert.match(errors({ proposals: [] }), /1 to 3/);
  const r = raw();
  r.proposals[1].id = 5;
  assert.match(errors(r), /proposal 2: id must be 2/);
});

test('exactly one recommended, distinct titles, valid nested classification', () => {
  const two = raw();
  two.proposals[0].recommended = true;
  assert.match(errors(two), /exactly one/);
  const dup = raw();
  dup.proposals[2].title = 'local FIX';
  assert.match(errors(dup), /distinct/);
  const bad = raw();
  delete bad.proposals[0].classification.risk;
  assert.match(errors(bad), /proposal 1: classification: risk/);
});

test('choosing a narrower proposal lowers the route but never the analysis risk', () => {
  const p = parseProposals(JSON.stringify(raw()));
  assert.ok(p.ok);
  // analysis was HIGH risk; proposal 1 claims LOW
  const c = chosenClassification(classifier('small-high-risk.json'), p.value[0]);
  assert.equal(c.risk, 'HIGH');
  const d = decide(c, { fromProposal: true });
  assert.deepEqual([d.action, d.route], ['proceed', 'LARGE']);
  // LOW-risk analysis: picking the local fix routes SMALL
  const small = decide(chosenClassification(classifier('medium.json'), p.value[0]), { fromProposal: true });
  assert.deepEqual([small.action, small.route], ['proceed', 'SMALL']);
});

test('chosen classification merges domains from analysis and proposal', () => {
  const r = raw();
  r.proposals[0].classification.domains = ['payments'];
  const p = parseProposals(JSON.stringify(r));
  assert.ok(p.ok);
  const c = chosenClassification({ ...classifier('small.json'), domains: ['accounting'] }, p.value[0]);
  assert.deepEqual(c.domains.sort(), ['accounting', 'payments']);
});
