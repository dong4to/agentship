// Proposals phase (H2.7): the proposer agent offers 1-3 ways to approach the task, each classified on
// its own. Its output is validated here; the developer picks one; policy.decide() routes the pick.
import { validateClassification, type Classification } from '../routing/classification.ts';
import { maxRisk } from '../routing/policy.ts';

export interface Proposal {
  id: number;
  title: string;
  summary: string;
  approach: string;
  scope_in: string[];
  scope_out: string[];
  tradeoffs: string[];
  recommended: boolean;
  classification: Classification;
}

export type ParsedProposals = { ok: true; value: Proposal[] } | { ok: false; errors: string[] };

export function parseProposals(text: string, maxCount = 3): ParsedProposals {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, errors: ['no JSON object found'] };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${(e as Error).message}`] };
  }
  const list = (raw as { proposals?: unknown })?.proposals;
  if (!Array.isArray(list)) return { ok: false, errors: ['"proposals" must be an array'] };

  const errors: string[] = [];
  if (list.length < 1 || list.length > maxCount) errors.push(`expected 1 to ${maxCount} proposals, got ${list.length}`);

  const value: Proposal[] = [];
  list.forEach((p: Record<string, unknown>, i: number) => {
    const at = `proposal ${i + 1}`;
    if (typeof p !== 'object' || p === null) return errors.push(`${at}: must be an object`);
    if (p.id !== i + 1) errors.push(`${at}: id must be ${i + 1}`);
    for (const k of ['title', 'summary', 'approach']) {
      if (typeof p[k] !== 'string' || !(p[k] as string).trim()) errors.push(`${at}: ${k} must be a non-empty string`);
    }
    for (const k of ['scope_in', 'scope_out', 'tradeoffs']) {
      const v = p[k];
      if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) errors.push(`${at}: ${k} must be an array of strings`);
    }
    if (typeof p.recommended !== 'boolean') errors.push(`${at}: recommended must be a boolean`);
    const c = validateClassification(p.classification);
    if (!c.ok) errors.push(...c.errors.map((e) => `${at}: classification: ${e}`));
    else value.push({ ...(p as unknown as Proposal), classification: c.value });
  });

  if (!errors.length) {
    if (value.filter((p) => p.recommended).length !== 1) errors.push('exactly one proposal must have recommended: true');
    const titles = value.map((p) => p.title.trim().toLowerCase());
    if (new Set(titles).size !== titles.length) errors.push('proposal titles must be distinct');
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

// Choosing a narrower proposal can reduce scope and complexity, never the risk found by the analysis:
// the chosen proposal's risk is at least the analysis risk, and the domains are merged.
export function chosenClassification(analysis: Classification, p: Proposal): Classification {
  return {
    ...p.classification,
    risk: maxRisk(analysis.risk, p.classification.risk),
    domains: [...new Set([...analysis.domains, ...p.classification.domains])],
    multiple_approaches: false,
    reasons: [`chosen proposal ${p.id}: ${p.title}`, ...p.classification.reasons],
  };
}
