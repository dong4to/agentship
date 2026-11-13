// Telemetry (H5 §12.4): per-run events and a reproducible report built only from artifacts in run_dir.
// Tokens are recorded only when the runtime reported them; nothing is estimated or converted to money.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunState } from '../state/state.ts';

export interface AgentEvent {
  type: 'agent';
  at: string;
  phase: string | null;
  role: string;
  agent: string;
  model: string;
  effort: string | null;
  tokens: number | null;
  duration_ms: number | null;
  outcome: string | null;
}

export const telemetryPath = (runDir: string) => join(runDir, 'telemetry.jsonl');

export function recordEvent(runDir: string, e: Omit<AgentEvent, 'type' | 'at'>) {
  appendFileSync(telemetryPath(runDir), JSON.stringify({ type: 'agent', at: new Date().toISOString(), ...e }) + '\n');
}

export function readEvents(runDir: string): AgentEvent[] {
  if (!existsSync(telemetryPath(runDir))) return [];
  return readFileSync(telemetryPath(runDir), 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

const json = (runDir: string, f: string) => (existsSync(join(runDir, f)) ? JSON.parse(readFileSync(join(runDir, f), 'utf8')) : null);

export interface Report {
  run_id: string;
  eval_task: string | null;
  profile: string;
  route: string | null;
  risk: string | null;
  status: string;
  phases: { name: string; status: string; duration_ms: number | null; attempts: number }[];
  total_duration_ms: number | null;
  agents: { role: string; agent: string; model: string; effort: string | null; calls: number; tokens: number | null }[];
  tokens_reported: number | null;
  retries: Record<string, number>;
  tests: { passed: boolean; runs: number } | null;
  gates: Record<string, boolean>;
  review: { blocking: number; excepted: number; findings: number } | null;
  independent_review: { status: string; findings: number; confirmed: number; false_positive: number } | null;
  human_interventions: string[];
  proposal: number | null;
}

export function buildReport(runDir: string, s: RunState): Report {
  const run = json(runDir, 'run.json') ?? {};
  const events = readEvents(runDir);
  const phases = Object.entries(s.phases).map(([name, p]) => ({
    name,
    status: p.status,
    attempts: p.attempts,
    duration_ms: p.started_at && p.ended_at ? Date.parse(p.ended_at) - Date.parse(p.started_at) : null,
  }));
  const agents = new Map<string, Report['agents'][number]>();
  for (const e of events) {
    const k = `${e.role}|${e.agent}|${e.model}`;
    const a = agents.get(k) ?? { role: e.role, agent: e.agent, model: e.model, effort: e.effort, calls: 0, tokens: null };
    a.calls += 1;
    if (e.tokens !== null && e.tokens !== undefined) a.tokens = (a.tokens ?? 0) + e.tokens;
    agents.set(k, a);
  }
  const tokens = events.some((e) => typeof e.tokens === 'number') ? events.reduce((n, e) => n + (e.tokens ?? 0), 0) : null;
  const review = json(runDir, 'review.json');
  const codex = json(runDir, 'codex-review.json');
  const adj = json(runDir, 'adjudication.json');
  const selection = json(runDir, 'selection.json');
  const testRuns = s.runs?.test ?? 0;
  const human = [
    ...(selection ? [`chose proposal ${selection.proposal?.id}`] : []),
    ...Object.entries(s.approvals).map(([k, v]) => `approved ${k}${v.mode ? ` (${v.mode})` : ''} via ${v.via}`),
    ...((json(runDir, 'exceptions.json') as { id: string }[] | null) ?? []).map((e) => `exception for ${e.id}`),
  ];
  const created = Date.parse(run.created_at ?? '');
  return {
    run_id: s.run_id,
    eval_task: run.eval_task ?? null,
    profile: s.profile,
    route: s.workflow,
    risk: s.risk,
    status: s.status,
    phases,
    total_duration_ms: Number.isFinite(created) ? Date.parse(s.updated_at) - created : null,
    agents: [...agents.values()],
    tokens_reported: tokens,
    retries: s.retries,
    tests: s.gates.test ? { passed: s.tests_passed, runs: testRuns } : null,
    gates: Object.fromEntries(Object.entries(s.gates).map(([k, g]) => [k, g.passed])),
    review: review ? { blocking: review.blocking?.length ?? 0, excepted: review.excepted?.length ?? 0, findings: (review.reviewers ?? []).reduce((n: number, r: { findings: unknown[] }) => n + r.findings.length, 0) } : null,
    independent_review: codex
      ? {
          status: codex.status,
          findings: codex.findings?.length ?? 0,
          confirmed: (adj?.adjudications ?? []).filter((a: { verdict: string }) => a.verdict === 'CONFIRMED').length,
          false_positive: (adj?.adjudications ?? []).filter((a: { verdict: string }) => a.verdict === 'FALSE_POSITIVE').length,
        }
      : null,
    human_interventions: human,
    proposal: selection?.proposal?.id ?? null,
  };
}

export function reportMarkdown(r: Report): string {
  const ms = (v: number | null) => (v === null ? '—' : `${(v / 1000).toFixed(1)}s`);
  return [
    `# AgentShip run ${r.run_id}`,
    '',
    `| Route | Risk | Profile | Status | Duration | Tokens (reported) |`,
    `|---|---|---|---|---|---|`,
    `| ${r.route ?? '—'} | ${r.risk ?? '—'} | ${r.profile} | ${r.status} | ${ms(r.total_duration_ms)} | ${r.tokens_reported ?? 'not reported'} |`,
    '',
    '## Phases',
    '',
    '| Phase | Status | Attempts | Duration |',
    '|---|---|---|---|',
    ...r.phases.map((p) => `| ${p.name} | ${p.status} | ${p.attempts} | ${ms(p.duration_ms)} |`),
    '',
    '## Agents',
    '',
    '| Role | Agent | Model | Effort | Calls | Tokens |',
    '|---|---|---|---|---|---|',
    ...r.agents.map((a) => `| ${a.role} | ${a.agent} | ${a.model} | ${a.effort ?? '—'} | ${a.calls} | ${a.tokens ?? '—'} |`),
    '',
    `Gates: ${Object.entries(r.gates).map(([k, v]) => `${k} ${v ? 'pass' : 'FAIL'}`).join(', ') || '—'}`,
    `Review: ${r.review ? `${r.review.findings} findings, ${r.review.blocking} blocking, ${r.review.excepted} excepted` : '—'}`,
    `Independent review: ${r.independent_review ? `${r.independent_review.status}, ${r.independent_review.findings} findings (${r.independent_review.confirmed} confirmed, ${r.independent_review.false_positive} false positives)` : '—'}`,
    `Retries: ${Object.entries(r.retries).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
    `Human interventions: ${r.human_interventions.join('; ') || 'none'}`,
    '',
  ].join('\n');
}

// Evaluation (H5 §12.5): compare profiles over the same tasks, from saved reports only.
export function compareReports(reports: Report[]) {
  const byProfile = new Map<string, Report[]>();
  for (const r of reports) byProfile.set(r.profile, [...(byProfile.get(r.profile) ?? []), r]);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => typeof x === 'number');
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const profiles = [...byProfile.entries()].map(([profile, rs]) => ({
    profile,
    runs: rs.length,
    done: rs.filter((r) => r.status === 'done').length,
    tests_passed: rs.filter((r) => r.tests?.passed).length,
    avg_duration_ms: avg(rs.map((r) => r.total_duration_ms)),
    avg_tokens_reported: avg(rs.map((r) => r.tokens_reported)),
    total_retries: rs.reduce((n, r) => n + Object.values(r.retries).reduce((a, b) => a + b, 0), 0),
    confirmed_findings: rs.reduce((n, r) => n + (r.independent_review?.confirmed ?? 0), 0),
    review_blocking: rs.reduce((n, r) => n + (r.review?.blocking ?? 0), 0),
    human_interventions: rs.reduce((n, r) => n + r.human_interventions.length, 0),
  }));
  const tasks = [...new Set(reports.map((r) => r.eval_task).filter(Boolean))] as string[];
  const perTask = tasks.map((task) => ({
    task,
    results: reports.filter((r) => r.eval_task === task).map((r) => ({ profile: r.profile, status: r.status, route: r.route, tests_passed: r.tests?.passed ?? null, duration_ms: r.total_duration_ms, tokens: r.tokens_reported })),
  }));
  const comparable = tasks.filter((t) => new Set(reports.filter((r) => r.eval_task === t).map((r) => r.profile)).size > 1);
  return { profiles, per_task: perTask, comparable_tasks: comparable.length, note: 'Compare on quality first (done, tests, confirmed findings, interventions); tokens are only what the runtime reported.' };
}
