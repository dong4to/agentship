// Working-tree baseline and checks (H4 §11.3): detect external changes before continuing a run, and never
// overwrite modifications the developer had before AgentShip started.
import { execFileSync } from 'node:child_process';

export interface Baseline {
  git: boolean;
  head: string | null;
  branch: string | null;
  dirty: string[]; // paths modified/untracked before the run started (excluding .agentship/)
}

function git(projectDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 });
  } catch {
    return null;
  }
}

export function dirtyFiles(projectDir: string): string[] {
  const out = git(projectDir, ['status', '--porcelain', '-uall']);
  if (out === null) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()!.replace(/\\/g, '/'))
    .filter((p) => !p.startsWith('.agentship/'));
}

export function takeBaseline(projectDir: string): Baseline {
  const inside = git(projectDir, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
  if (!inside) return { git: false, head: null, branch: null, dirty: [] };
  return {
    git: true,
    head: git(projectDir, ['rev-parse', 'HEAD'])?.trim() || null,
    branch: git(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() || null,
    dirty: dirtyFiles(projectDir),
  };
}

export interface TreeCheck {
  ok: boolean;
  head_changed: boolean;
  branch_changed: boolean;
  overlapping_user_changes: string[]; // files the plan will touch that the developer had modified before the run
  errors: string[];
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

export function checkTree(projectDir: string, baseline: Baseline, plannedFiles: string[] = []): TreeCheck {
  if (!baseline.git) return { ok: true, head_changed: false, branch_changed: false, overlapping_user_changes: [], errors: [] };
  const now = takeBaseline(projectDir);
  const head_changed = now.head !== baseline.head;
  const branch_changed = now.branch !== baseline.branch;
  const planned = new Set(plannedFiles.map(norm));
  const overlapping = baseline.dirty.filter((f) => planned.has(norm(f)));
  const errors = [
    ...(head_changed ? [`HEAD moved since the run started (${baseline.head?.slice(0, 8)} -> ${now.head?.slice(0, 8)}): someone committed, reset or switched branches`] : []),
    ...(branch_changed ? [`branch changed from ${baseline.branch} to ${now.branch}`] : []),
    ...(overlapping.length ? [`the plan touches files you had already modified before the run: ${overlapping.join(', ')}`] : []),
  ];
  return { ok: errors.length === 0, head_changed, branch_changed, overlapping_user_changes: overlapping, errors };
}

// Diff of the run's changes against the baseline HEAD, plus untracked files (for reviews).
export function runDiff(projectDir: string, baseline: Baseline): { diff: string; untracked: string[] } {
  if (!baseline.git) return { diff: '', untracked: [] };
  const diff = git(projectDir, ['diff', '--no-color', baseline.head ?? 'HEAD', '--', '.', ':(exclude).agentship']) ?? '';
  const untracked = (git(projectDir, ['ls-files', '--others', '--exclude-standard']) ?? '')
    .split('\n')
    .filter((f) => f && !f.startsWith('.agentship/'));
  return { diff, untracked };
}
