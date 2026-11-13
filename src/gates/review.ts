// Review gate (H4 §11.2): reviewer outputs are validated and aggregated by code. A blocking finding (HIGH
// severity or an acceptance criterion NOT_MET) blocks the run unless it is fixed in a later review round or
// the developer granted an explicit exception.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  id: string;
  severity: Severity;
  file: string;
  line: number | null;
  issue: string;
  fix: string;
}

export interface Criterion {
  id: string;
  item: string;
  status: 'MET' | 'NOT_MET' | 'N/A';
  evidence: string;
}

export interface ReviewerResult {
  reviewer: string;
  verdict: 'PASS' | 'CHANGES_REQUIRED';
  criteria: Criterion[];
  findings: Finding[];
}

export interface Exception {
  id: string;
  reason: string;
}

export interface ReviewSummary {
  round: number;
  reviewers: ReviewerResult[];
  blocking: string[];
  excepted: string[];
  passed: boolean;
  errors: string[];
}

function jsonIn(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(text.slice(start, end + 1));
}

export function parseReviewer(name: string, text: string): { ok: true; value: ReviewerResult } | { ok: false; errors: string[] } {
  let o: Record<string, unknown>;
  try {
    o = jsonIn(text) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, errors: [`${name}: ${(e as Error).message}`] };
  }
  const errors: string[] = [];
  if (o.verdict !== 'PASS' && o.verdict !== 'CHANGES_REQUIRED') errors.push(`${name}: verdict must be PASS|CHANGES_REQUIRED`);
  const criteria = Array.isArray(o.criteria) ? o.criteria : (errors.push(`${name}: criteria must be an array`), []);
  const findings = Array.isArray(o.findings) ? o.findings : (errors.push(`${name}: findings must be an array`), []);
  const cs: Criterion[] = criteria.map((c: Record<string, unknown>, i: number) => {
    if (!['MET', 'NOT_MET', 'N/A'].includes(c?.status as string)) errors.push(`${name}: criterion ${i + 1} status must be MET|NOT_MET|N/A`);
    return { id: `${name}#C${i + 1}`, item: String(c?.item ?? ''), status: c?.status as Criterion['status'], evidence: String(c?.evidence ?? '') };
  });
  const fs: Finding[] = findings.map((f: Record<string, unknown>, i: number) => {
    if (!SEVERITIES.includes(f?.severity as Severity)) errors.push(`${name}: finding ${i + 1} severity must be LOW|MEDIUM|HIGH`);
    if (typeof f?.issue !== 'string' || !f.issue) errors.push(`${name}: finding ${i + 1} needs an issue`);
    return {
      id: `${name}#F${i + 1}`,
      severity: f?.severity as Severity,
      file: String(f?.file ?? ''),
      line: Number.isInteger(f?.line) ? (f.line as number) : null,
      issue: String(f?.issue ?? ''),
      fix: String(f?.fix ?? ''),
    };
  });
  if (errors.length) return { ok: false, errors };
  // The verdict is recomputed from the content: a reviewer cannot PASS with blocking items.
  const blocking = cs.some((c) => c.status === 'NOT_MET') || fs.some((f) => f.severity === 'HIGH');
  return { ok: true, value: { reviewer: name, verdict: blocking ? 'CHANGES_REQUIRED' : (o.verdict as ReviewerResult['verdict']), criteria: cs, findings: fs } };
}

export function latestRound(runDir: string): number {
  const dir = join(runDir, 'reviews');
  if (!existsSync(dir)) return 0;
  const rounds = readdirSync(dir).map((d) => /^round-(\d+)$/.exec(d)?.[1]).filter(Boolean).map(Number);
  return rounds.length ? Math.max(...rounds) : 0;
}

export function readExceptions(runDir: string): Exception[] {
  const p = join(runDir, 'exceptions.json');
  if (!existsSync(p)) return [];
  const v = JSON.parse(readFileSync(p, 'utf8'));
  return Array.isArray(v) ? v.filter((e) => typeof e?.id === 'string' && typeof e?.reason === 'string' && e.reason.trim()) : [];
}

export function summarizeReviews(runDir: string): ReviewSummary {
  const round = latestRound(runDir);
  if (round === 0) return { round, reviewers: [], blocking: [], excepted: [], passed: false, errors: ['no review found in reviews/round-N/'] };
  const dir = join(runDir, 'reviews', `round-${round}`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.txt') || f.endsWith('.json'));
  const errors: string[] = [];
  const reviewers: ReviewerResult[] = [];
  for (const f of files) {
    const r = parseReviewer(basename(f).replace(/\.(txt|json)$/, ''), readFileSync(join(dir, f), 'utf8'));
    if (r.ok) reviewers.push(r.value);
    else errors.push(...r.errors);
  }
  if (!reviewers.length && !errors.length) errors.push(`reviews/round-${round}/ is empty`);
  const exceptions = new Set(readExceptions(runDir).map((e) => e.id));
  const blockingAll = reviewers.flatMap((r) => [
    ...r.criteria.filter((c) => c.status === 'NOT_MET').map((c) => c.id),
    ...r.findings.filter((f) => f.severity === 'HIGH').map((f) => f.id),
  ]);
  const excepted = blockingAll.filter((id) => exceptions.has(id));
  const blocking = blockingAll.filter((id) => !exceptions.has(id));
  return { round, reviewers, blocking, excepted, passed: errors.length === 0 && blocking.length === 0, errors };
}
