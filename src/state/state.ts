// Run state (H4 §11.4): which phases ran, which gates passed, retries and approvals, validated by code so
// the workflow never depends on the model remembering what it already did.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Level, Rating } from '../routing/classification.ts';
import { RATINGS } from '../routing/classification.ts';
import type { Baseline } from '../git/tree.ts';

export const ROUTE_PHASES: Record<Level, string[]> = {
  SMALL: ['implement', 'test', 'summary'],
  MEDIUM: ['discovery', 'plan', 'implement', 'test', 'review', 'independent_review', 'summary'],
  LARGE: ['discovery', 'research', 'requirements', 'plan', 'human_gate', 'implement', 'test', 'review', 'independent_review', 'uat', 'summary'],
};
const SKIPPABLE = new Set(['discovery', 'research', 'independent_review']);

export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type RunStatus = 'classifying' | 'waiting' | 'running' | 'blocked' | 'done' | 'failed';

export interface PhaseState {
  status: PhaseStatus;
  started_at: string | null;
  ended_at: string | null;
  attempts: number;
  note: string | null;
}

export interface GateRun {
  passed: boolean;
  exit_code: number | null;
  log: string;
  label: string;
  at: string;
}

export interface RunState {
  run_id: string;
  workflow: Level | null;
  risk: Rating | null;
  profile: string;
  status: RunStatus;
  waiting_for: string | null;
  current_phase: string | null;
  phases: Record<string, PhaseState>;
  gates: Record<string, GateRun>; // test | lint | typecheck: last run
  retries: Record<string, number>;
  runs: Record<string, number>; // how many times each validation command ran
  approvals: Record<string, { at: string; mode?: string; via: string }>;
  tree_check: { ok: boolean; at: string; errors: string[] } | null;
  independent_review_required: boolean;
  tests_passed: boolean;
  independent_review_completed: boolean;
  human_approval: boolean;
  baseline: Baseline;
  updated_at: string;
}

const now = () => new Date().toISOString();
export const statePath = (runDir: string) => join(runDir, 'state.json');

export function newState(runId: string, profile: string, baseline: Baseline): RunState {
  return {
    run_id: runId, workflow: null, risk: null, profile, status: 'classifying', waiting_for: null, current_phase: null,
    phases: {}, gates: {}, retries: {}, runs: {}, approvals: {}, tree_check: null, independent_review_required: false,
    tests_passed: false, independent_review_completed: false, human_approval: false, baseline, updated_at: now(),
  };
}

export function loadState(runDir: string): RunState | null {
  return existsSync(statePath(runDir)) ? JSON.parse(readFileSync(statePath(runDir), 'utf8')) : null;
}

export function saveState(runDir: string, s: RunState) {
  s.updated_at = now();
  writeFileSync(statePath(runDir), JSON.stringify(s, null, 2));
}

// Fixes the workflow once routing proceeds. The route can only be set while nothing has run yet.
export function setRoute(s: RunState, route: Level, risk: Rating, requiredAtRisk: Rating): string[] {
  if (s.workflow && Object.values(s.phases).some((p) => p.status !== 'pending')) {
    return s.workflow === route ? [] : [`run already started as ${s.workflow}; cannot switch to ${route}`];
  }
  s.workflow = route;
  s.risk = risk;
  s.independent_review_required = RATINGS.indexOf(risk) >= RATINGS.indexOf(requiredAtRisk);
  // SMALL has no independent review unless the (possibly stricter) policy requires one for this risk.
  const order = route === 'SMALL' && s.independent_review_required ? ['implement', 'test', 'independent_review', 'summary'] : ROUTE_PHASES[route];
  s.phases = Object.fromEntries(order.map((p) => [p, { status: 'pending', started_at: null, ended_at: null, attempts: 0, note: null }]));
  s.status = 'running';
  s.waiting_for = null;
  return [];
}

export function wait(s: RunState, what: string) {
  s.status = 'waiting';
  s.waiting_for = what;
}

// Conditions a phase needs before it may start (in addition to all earlier phases being done/skipped).
function startPreconditions(s: RunState, phase: string): string[] {
  const e: string[] = [];
  if (phase === 'implement') {
    if (s.workflow === 'LARGE' && !s.approvals.human_gate) e.push('LARGE needs the human gate approved before implementing');
    if (!s.tree_check?.ok) e.push('run `tree-check` (and resolve its errors) before implementing');
  }
  return e;
}

export type GateEvaluator = (phase: string, s: RunState) => string[];

export function transition(s: RunState, phase: string, action: 'start' | 'done' | 'fail' | 'skip', note: string | null, gate: GateEvaluator): string[] {
  if (!s.workflow) return ['no route yet: run route (or select) first'];
  const order = Object.keys(s.phases); // the run's own phase order (set by setRoute)
  const p = s.phases[phase];
  if (!p) return [`phase "${phase}" is not part of the ${s.workflow} workflow (${order.join(', ')})`];
  const earlier = order.slice(0, order.indexOf(phase)).filter((x) => !['done', 'skipped'].includes(s.phases[x].status));

  if (action === 'start') {
    if (p.status === 'done' && phase !== 'test' && phase !== 'review') return [`phase ${phase} is already done`];
    const errs = [...earlier.map((x) => `phase ${x} must be done or skipped first`), ...startPreconditions(s, phase)];
    if (errs.length) return errs;
    p.status = 'running';
    p.started_at = now();
    p.ended_at = null;
    p.attempts += 1;
    s.current_phase = phase;
    s.status = 'running';
    s.waiting_for = null;
    return [];
  }
  if (action === 'skip') {
    if (!SKIPPABLE.has(phase)) return [`phase ${phase} cannot be skipped`];
    if (!note) return ['skipping needs a reason'];
    if (phase === 'independent_review' && s.independent_review_required) return ['independent review is required for this risk; use the Codex review or an approved fallback'];
    p.status = 'skipped';
    p.note = note;
    p.ended_at = now();
    return [];
  }
  if (p.status !== 'running') return [`phase ${phase} is ${p.status}, not running`];
  if (action === 'fail') {
    p.status = 'failed';
    p.note = note;
    p.ended_at = now();
    s.status = 'failed';
    return [];
  }
  const errs = gate(phase, s);
  if (errs.length) return errs;
  p.status = 'done';
  p.note = note;
  p.ended_at = now();
  s.status = 'running'; // clears a previous 'blocked'
  if (phase === 'human_gate') s.human_approval = true;
  if (phase === 'summary') {
    s.status = 'done';
    s.current_phase = null;
  }
  return [];
}

export function retryKeyMax(key: string, retries: { tests_per_wave: number; review_rounds: number; llm_output: number }): number | null {
  if (/^tests(:[\w.-]+)?$/.test(key)) return retries.tests_per_wave;
  if (key === 'review') return retries.review_rounds;
  if (/^llm:[\w.-]+$/.test(key)) return retries.llm_output;
  return null;
}
