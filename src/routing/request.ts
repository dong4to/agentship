// Parses `/agentship:dev [flags] <task>`.
//   --route small|medium|large   raise (or, with confirmation for HIGH risk, lower) the route
//   --risk high                  raise risk to HIGH
//   --confirm-downgrade          confirm lowering a HIGH-risk route (never below MEDIUM)
//   --proposals | --no-proposals force or skip the proposals phase
//   --resume <run_id> --proposal <n>   continue a run that stopped at the proposals phase
// Flags are only read from the start; everything after the first non-flag token is task text.
import { LEVELS, type Level } from './classification.ts';
import type { Overrides } from './policy.ts';

export interface Resume {
  runId: string;
  proposal: number | null;
}

export interface Request {
  task: string;
  overrides: Overrides;
  resume: Resume | null;
  errors: string[];
}

// Run ids are what `start` generates: an ISO timestamp with ':' and '.' replaced by '-'.
export const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export function parseRequest(text: string): Request {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const overrides: Overrides = {};
  const errors: string[] = [];
  let resumeId: string | null = null;
  let proposal: number | null = null;
  let i = 0;

  for (; i < tokens.length && tokens[i].startsWith('--'); i++) {
    const flag = tokens[i];
    if (flag === '--confirm-downgrade') {
      overrides.confirmDowngrade = true;
    } else if (flag === '--proposals' || flag === '--no-proposals') {
      const v = flag === '--proposals' ? 'force' : 'off';
      if (overrides.proposals && overrides.proposals !== v) errors.push('--proposals and --no-proposals are mutually exclusive');
      overrides.proposals = v;
    } else if (flag === '--route') {
      const v = tokens[++i]?.toUpperCase();
      if (LEVELS.includes(v as Level)) overrides.route = v as Level;
      else errors.push(`--route expects small|medium|large, got ${JSON.stringify(tokens[i] ?? '')}`);
    } else if (flag === '--risk') {
      const v = tokens[++i]?.toLowerCase();
      if (v === 'high') overrides.riskHigh = true;
      else errors.push(`--risk only accepts "high" (risk can be raised, never lowered), got ${JSON.stringify(tokens[i] ?? '')}`);
    } else if (flag === '--resume') {
      const v = tokens[++i] ?? '';
      if (RUN_ID.test(v)) resumeId = v;
      else errors.push(`--resume expects a run id like 2026-11-12T10-00-00-000Z, got ${JSON.stringify(v)}`);
    } else if (flag === '--proposal') {
      const v = tokens[++i] ?? '';
      if (/^[1-3]$/.test(v)) proposal = Number(v);
      else errors.push(`--proposal expects 1, 2 or 3, got ${JSON.stringify(v)}`);
    } else {
      errors.push(`unknown flag ${flag}`);
    }
  }

  const task = tokens.slice(i).join(' ');
  if (proposal !== null && resumeId === null) errors.push('--proposal only works together with --resume <run_id>');
  if (resumeId !== null) {
    if (proposal === null) errors.push('--resume needs --proposal <n> to say which proposal to run');
    if (task) errors.push('--resume takes no task text: the task is read from the resumed run');
  } else if (!task) {
    errors.push('task description is empty');
  }
  return { task, overrides, resume: resumeId ? { runId: resumeId, proposal } : null, errors };
}
