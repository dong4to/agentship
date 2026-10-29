// Parses `/agentship:dev [--route small|medium|large] [--risk high] [--confirm-downgrade] <task>`.
// Flags are only read from the start; everything after the first non-flag token is task text.
import { LEVELS, type Level } from './classification.ts';
import type { Overrides } from './policy.ts';

export interface Request {
  task: string;
  overrides: Overrides;
  errors: string[];
}

export function parseRequest(text: string): Request {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const overrides: Overrides = {};
  const errors: string[] = [];
  let i = 0;

  for (; i < tokens.length && tokens[i].startsWith('--'); i++) {
    const flag = tokens[i];
    if (flag === '--confirm-downgrade') {
      overrides.confirmDowngrade = true;
    } else if (flag === '--route') {
      const v = tokens[++i]?.toUpperCase();
      if (LEVELS.includes(v as Level)) overrides.route = v as Level;
      else errors.push(`--route expects small|medium|large, got ${JSON.stringify(tokens[i] ?? '')}`);
    } else if (flag === '--risk') {
      const v = tokens[++i]?.toLowerCase();
      if (v === 'high') overrides.riskHigh = true;
      else errors.push(`--risk only accepts "high" (risk can be raised, never lowered), got ${JSON.stringify(tokens[i] ?? '')}`);
    } else {
      errors.push(`unknown flag ${flag}`);
    }
  }

  const task = tokens.slice(i).join(' ');
  if (!task) errors.push('task description is empty');
  return { task, overrides, errors };
}
