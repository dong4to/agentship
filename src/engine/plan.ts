// Native phase engine (H2.8): validation of the planner's output. The planner is an LLM; the waves it
// returns are only executed after they pass here (and, for LARGE, after the human gate).

export interface Wave {
  id: number;
  title: string;
  tasks: string[];
  files: string[];
  depends_on: number[];
  verify: string;
}

export interface Plan {
  goal: string;
  acceptance_criteria: string[];
  decisions: string[];
  risks: string[];
  waves: Wave[];
}

export type ParsedPlan = { ok: true; value: Plan } | { ok: false; errors: string[] };

const isStrings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string');

export function parsePlan(text: string, opts: { maxWaves?: number } = {}): ParsedPlan {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, errors: ['no JSON object found'] };
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${(e as Error).message}`] };
  }

  const errors: string[] = [];
  if (typeof o.goal !== 'string' || !o.goal.trim()) errors.push('goal must be a non-empty string');
  for (const k of ['acceptance_criteria', 'decisions', 'risks']) if (!isStrings(o[k])) errors.push(`${k} must be an array of strings`);
  if (isStrings(o.acceptance_criteria) && (o.acceptance_criteria as string[]).length === 0) {
    errors.push('acceptance_criteria must not be empty');
  }

  const waves = o.waves;
  if (!Array.isArray(waves) || waves.length === 0) {
    errors.push('waves must be a non-empty array');
  } else {
    if (opts.maxWaves && waves.length > opts.maxWaves) errors.push(`at most ${opts.maxWaves} wave(s) allowed for this route, got ${waves.length}`);
    waves.forEach((w: Record<string, unknown>, i: number) => {
      const at = `wave ${i + 1}`;
      if (w?.id !== i + 1) errors.push(`${at}: id must be ${i + 1}`);
      if (typeof w?.title !== 'string' || !w.title.trim()) errors.push(`${at}: title must be a non-empty string`);
      if (typeof w?.verify !== 'string' || !w.verify.trim()) errors.push(`${at}: verify must say how the wave is checked`);
      for (const k of ['tasks', 'files']) {
        if (!isStrings(w?.[k]) || (w[k] as string[]).length === 0) errors.push(`${at}: ${k} must be a non-empty array of strings`);
      }
      const deps = w?.depends_on;
      if (!Array.isArray(deps) || !deps.every((d) => Number.isInteger(d) && d >= 1 && d < i + 1)) {
        errors.push(`${at}: depends_on must list earlier wave ids only`);
      }
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: o as unknown as Plan };
}
