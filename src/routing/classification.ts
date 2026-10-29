// Classifier output contract (plan §5.3) and its deterministic validation.
// The classifier is an LLM; nothing it returns is trusted until it passes here.

export const LEVELS = ['SMALL', 'MEDIUM', 'LARGE'] as const;
export const RATINGS = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type Level = (typeof LEVELS)[number];
export type Rating = (typeof RATINGS)[number];

export interface Classification {
  complexity: Level;
  risk: Rating;
  confidence: Rating;
  reasons: string[];
  affected_modules: string[];
  unresolved_questions: string[];
  recommended_workflow: Level;
}

export type Parsed =
  | { ok: true; value: Classification }
  | { ok: false; errors: string[] };

// Accepts the classifier's raw reply: bare JSON, or JSON wrapped in prose / a ```json fence.
export function parseClassification(text: string): Parsed {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, errors: ['no JSON object found'] };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${(e as Error).message}`] };
  }
  return validateClassification(raw);
}

export function validateClassification(raw: unknown): Parsed {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['classification must be a JSON object'] };
  }
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];

  const oneOf = (key: string, allowed: readonly string[]) => {
    if (!allowed.includes(o[key] as string)) {
      errors.push(`${key} must be one of ${allowed.join('|')}, got ${JSON.stringify(o[key])}`);
    }
  };
  const strings = (key: string) => {
    const v = o[key];
    if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
      errors.push(`${key} must be an array of strings`);
    }
  };

  oneOf('complexity', LEVELS);
  oneOf('risk', RATINGS);
  oneOf('confidence', RATINGS);
  oneOf('recommended_workflow', LEVELS);
  strings('reasons');
  strings('affected_modules');
  strings('unresolved_questions');
  if (errors.length === 0 && (o.reasons as string[]).length === 0) {
    errors.push('reasons must not be empty');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: o as unknown as Classification };
}
