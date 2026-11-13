import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReviewer, summarizeReviews } from '../../src/gates/review.ts';
import { parseAdjudication, parseCodexOutput, type CodexFinding } from '../../src/integrations/codex/codex.ts';
import { buildReport, compareReports, recordEvent } from '../../src/telemetry/telemetry.ts';
import { newState, setRoute } from '../../src/state/state.ts';

const review = (o: object) => JSON.stringify({ verdict: 'PASS', criteria: [], findings: [], ...o });

test('reviewer output: valid, and verdict recomputed from blocking items', () => {
  const ok = parseReviewer('r', review({ criteria: [{ item: 'a', status: 'MET', evidence: 'x' }] }));
  assert.ok(ok.ok && ok.value.verdict === 'PASS');
  const lying = parseReviewer('r', review({ verdict: 'PASS', findings: [{ severity: 'HIGH', file: 'a', line: 1, issue: 'bad', fix: 'x' }] }));
  assert.ok(lying.ok && lying.value.verdict === 'CHANGES_REQUIRED');
  assert.equal(parseReviewer('r', '{"verdict":"MAYBE","criteria":[],"findings":[]}').ok, false);
});

test('review summary uses the latest round and honours exceptions', () => {
  const run = mkdtempSync(join(tmpdir(), 'as-rev-'));
  assert.equal(summarizeReviews(run).passed, false);
  mkdirSync(join(run, 'reviews', 'round-1'), { recursive: true });
  writeFileSync(join(run, 'reviews', 'round-1', 'reviewer.txt'), review({ findings: [{ severity: 'HIGH', file: 'a', line: 1, issue: 'bad', fix: '' }] }));
  writeFileSync(join(run, 'reviews', 'round-1', 'fintech.txt'), review({ criteria: [{ item: 'balanced', status: 'NOT_MET', evidence: '' }] }));
  const r1 = summarizeReviews(run);
  assert.deepEqual([r1.round, r1.passed, r1.blocking.sort()], [1, false, ['fintech#C1', 'reviewer#F1']]);
  writeFileSync(join(run, 'exceptions.json'), JSON.stringify([{ id: 'fintech#C1', reason: 'out of scope, ticket ABC' }]));
  assert.deepEqual(summarizeReviews(run).blocking, ['reviewer#F1']);
  mkdirSync(join(run, 'reviews', 'round-2'), { recursive: true });
  writeFileSync(join(run, 'reviews', 'round-2', 'reviewer.txt'), review({}));
  const r2 = summarizeReviews(run);
  assert.deepEqual([r2.round, r2.passed], [2, true]);
});

const findings: CodexFinding[] = [
  { id: 'F1', severity: 'HIGH', category: 'correctness', file: 'a', line: 1, title: 't', evidence: 'e', recommendation: 'r' },
  { id: 'F2', severity: 'LOW', category: 'tests', file: 'a', line: null, title: 't', evidence: 'e', recommendation: 'r' },
];

test('codex output parsing validates severity, category and required text', () => {
  const base = { summary: 's', coverage: 'complete', limitations: '', reviewed_files: ['a'] };
  assert.ok(parseCodexOutput(JSON.stringify({ ...base, findings })).ok);
  assert.equal(parseCodexOutput('nope').ok, false);
  assert.equal(parseCodexOutput(JSON.stringify({ ...base, coverage: 'most', findings })).ok, false);
  assert.equal(parseCodexOutput(JSON.stringify({ summary: 's', findings })).ok, false); // coverage is mandatory
  assert.equal(parseCodexOutput(JSON.stringify({ ...base, findings: [{ ...findings[0], category: 'style' }] })).ok, false);
  assert.equal(parseCodexOutput(JSON.stringify({ ...base, findings: [findings[0], findings[0]] })).ok, false);
});

test('adjudication must cover every finding; confirmed or uninvestigated HIGH blocks', () => {
  const adj = (a: object[]) => parseAdjudication(JSON.stringify({ adjudications: a }), findings);
  const missing = adj([{ id: 'F1', verdict: 'CONFIRMED', reasoning: 'yes', resolved: false }]);
  assert.match(!missing.ok ? missing.errors.join() : '', /F2 has no adjudication/);
  const confirmed = adj([{ id: 'F1', verdict: 'CONFIRMED', reasoning: 'yes', resolved: false }, { id: 'F2', verdict: 'FALSE_POSITIVE', reasoning: 'tested', resolved: false }]);
  assert.ok(confirmed.ok);
  assert.deepEqual(confirmed.blocking, ['codex#F1']);
  const fixed = adj([{ id: 'F1', verdict: 'CONFIRMED', reasoning: 'fixed in cart.js:12', resolved: true }, { id: 'F2', verdict: 'UNVERIFIABLE', reasoning: 'n/a', resolved: false }]);
  assert.ok(fixed.ok && fixed.blocking.length === 0);
  const investigate = adj([{ id: 'F1', verdict: 'NEEDS_INVESTIGATION', reasoning: 'unsure', resolved: false }, { id: 'F2', verdict: 'CONFIRMED', reasoning: 'yes', resolved: false }]);
  assert.ok(investigate.ok);
  assert.deepEqual(investigate.blocking, ['codex#F1']);
  assert.equal(adj([{ id: 'F9', verdict: 'CONFIRMED', reasoning: 'x', resolved: false }]).ok, false);
});

test('report and profile comparison come only from recorded data', () => {
  const run = mkdtempSync(join(tmpdir(), 'as-tel-'));
  writeFileSync(join(run, 'run.json'), JSON.stringify({ created_at: new Date(Date.now() - 5000).toISOString(), eval_task: 'small-bug' }));
  const s = newState('r1', 'balanced', { git: false, head: null, branch: null, dirty: [] });
  setRoute(s, 'SMALL', 'LOW', 'HIGH');
  recordEvent(run, { role: 'implementer', agent: 'agentship:implementer', model: 'sonnet', effort: 'medium', phase: 'implement', tokens: null, duration_ms: 1200, outcome: 'ok' });
  const noTokens = buildReport(run, s);
  assert.equal(noTokens.tokens_reported, null); // never invented
  recordEvent(run, { role: 'reviewer', agent: 'agentship:reviewer', model: 'sonnet', effort: 'high', phase: 'review', tokens: 3000, duration_ms: null, outcome: 'ok' });
  const r = buildReport(run, s);
  assert.equal(r.tokens_reported, 3000);
  assert.equal(r.agents.length, 2);
  const cmp = compareReports([r, { ...r, run_id: 'r2', profile: 'economy', status: 'done', tokens_reported: 1000 }]);
  assert.equal(cmp.comparable_tasks, 1);
  assert.deepEqual(cmp.profiles.map((p) => p.profile).sort(), ['balanced', 'economy']);
});
