// Effective configuration (H5, H6): shipped defaults <- user config <- project config, validated.
//   user:    $CLAUDE_CONFIG_DIR/agentship/config.json   (trusted: the developer's own machine)
//   project: <project>/agentship.config.json           (untrusted repo content)
// A project config may only make the policy stricter, never weaker, and it is the only place that can
// declare test/lint/typecheck commands (which still need a one-time developer approval to run).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import defaultModels from '../../config/default-models.json' with { type: 'json' };
import defaultPacks from '../../config/domain-packs.json' with { type: 'json' };
import defaultPolicy from '../../config/default-policies.json' with { type: 'json' };
import defaultSettings from '../../config/default-settings.json' with { type: 'json' };
import type { DomainPack, Packs } from '../agents/matcher.ts';
import { LEVELS, RATINGS, type Level, type Rating } from '../routing/classification.ts';
import type { Policy } from '../routing/policy.ts';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const RUNTIMES = ['claude', 'codex'] as const;
export const COMMAND_NAMES = ['test', 'lint', 'typecheck'] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export interface Tier {
  runtime: (typeof RUNTIMES)[number];
  model: string;
  effort: (typeof EFFORTS)[number];
}

export interface ResolvedRole extends Tier {
  tier: string;
}

export interface Settings {
  retries: { tests_per_wave: number; review_rounds: number; llm_output: number };
  codex: { enabled: 'auto' | boolean; timeout_seconds: number; model: string | null };
  independent_review: { required_at_risk: Rating; offered_on_routes: Level[] };
  commands: { timeout_seconds: number } & Partial<Record<CommandName, string>>;
}

export interface Config {
  profile: string;
  tiers: Record<string, Tier>;
  profiles: Record<string, Record<string, string>>;
  roles: Record<string, ResolvedRole>;
  escalation: Record<string, { after_failures: number; to: string }>;
  policy: Policy;
  settings: Settings;
  packs: Packs;
  sources: string[];
  errors: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const strip = (o: Obj) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));

export const userConfigPath = (userClaudeDir: string) => join(userClaudeDir, 'agentship', 'config.json');
export const projectConfigPath = (projectDir: string) => join(projectDir, 'agentship.config.json');

function readJson(path: string, errors: string[]): Obj | null {
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObj(v)) throw new Error('must be a JSON object');
    return v;
  } catch (e) {
    errors.push(`${path}: ${(e as Error).message}`);
    return null;
  }
}

const KNOWN = ['version', 'model_profile', 'tiers', 'profiles', 'policies', 'retries', 'codex', 'commands', 'domains', 'max_specialists_per_phase'];

// Applies one layer onto cfg. `strict` = project layer: policy can only get stricter, commands allowed.
function applyLayer(cfg: Config, layer: Obj, where: string, strict: boolean) {
  const err = (m: string) => cfg.errors.push(`${where}: ${m}`);
  for (const k of Object.keys(layer)) if (!KNOWN.includes(k) && !k.startsWith('_')) err(`unknown key "${k}"`);

  if (isObj(layer.tiers)) {
    for (const [name, t] of Object.entries(layer.tiers)) {
      if (!isObj(t)) { err(`tiers.${name} must be an object`); continue; }
      const merged = { ...(cfg.tiers[name] ?? {}), ...t } as Tier;
      if (!RUNTIMES.includes(merged.runtime)) err(`tiers.${name}.runtime must be claude|codex`);
      else if (typeof merged.model !== 'string' || !merged.model) err(`tiers.${name}.model must be a model alias`);
      else if (!EFFORTS.includes(merged.effort)) err(`tiers.${name}.effort must be one of ${EFFORTS.join('|')}`);
      else cfg.tiers[name] = merged;
    }
  }
  if (isObj(layer.profiles)) {
    for (const [name, p] of Object.entries(layer.profiles)) {
      if (!isObj(p) || !Object.values(p).every((v) => typeof v === 'string')) { err(`profiles.${name} must map roles to tier names`); continue; }
      cfg.profiles[name] = { ...(cfg.profiles[name] ?? cfg.profiles[cfg.profile] ?? {}), ...(p as Record<string, string>) };
    }
  }
  if (layer.model_profile !== undefined) {
    if (typeof layer.model_profile === 'string' && cfg.profiles[layer.model_profile]) cfg.profile = layer.model_profile;
    else err(`model_profile ${JSON.stringify(layer.model_profile)} is not a known profile (${Object.keys(cfg.profiles).join(', ')})`);
  }

  if (isObj(layer.policies)) applyPolicy(cfg, layer.policies, where, strict);

  if (isObj(layer.retries)) {
    for (const [k, v] of Object.entries(strip(layer.retries))) {
      if (!(k in cfg.settings.retries)) err(`retries.${k} is unknown`);
      else if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 5) err(`retries.${k} must be an integer 0-5`);
      else (cfg.settings.retries as Record<string, number>)[k] = v as number;
    }
  }
  if (isObj(layer.codex)) {
    const c = layer.codex;
    if (c.enabled !== undefined) {
      if (c.enabled === 'auto' || typeof c.enabled === 'boolean') cfg.settings.codex.enabled = c.enabled;
      else err('codex.enabled must be "auto", true or false');
    }
    if (c.timeout_seconds !== undefined) {
      if (Number.isInteger(c.timeout_seconds) && (c.timeout_seconds as number) >= 30 && (c.timeout_seconds as number) <= 3600) cfg.settings.codex.timeout_seconds = c.timeout_seconds as number;
      else err('codex.timeout_seconds must be an integer 30-3600');
    }
    if (c.model !== undefined) {
      if (c.model === null || (typeof c.model === 'string' && /^[\w.:-]+$/.test(c.model))) cfg.settings.codex.model = c.model as string | null;
      else err('codex.model must be a model name or null');
    }
  }
  if (isObj(layer.commands)) {
    if (!strict) err('commands can only be set in the project config (agentship.config.json)');
    else {
      for (const [k, v] of Object.entries(strip(layer.commands))) {
        if (k === 'timeout_seconds') {
          if (Number.isInteger(v) && (v as number) >= 10 && (v as number) <= 7200) cfg.settings.commands.timeout_seconds = v as number;
          else err('commands.timeout_seconds must be an integer 10-7200');
        } else if (!COMMAND_NAMES.includes(k as CommandName)) err(`commands.${k} is unknown (test|lint|typecheck)`);
        else if (typeof v !== 'string' || !v.trim() || /[\r\n]/.test(v)) err(`commands.${k} must be a single-line command`);
        else cfg.settings.commands[k as CommandName] = v.trim();
      }
    }
  }
  if (isObj(layer.domains)) {
    for (const [name, pack] of Object.entries(layer.domains)) {
      const p = pack as DomainPack;
      const ok = isObj(pack) && typeof p.description === 'string' && isObj(p.agents) && Array.isArray(p.checklist) && p.checklist.every((s) => typeof s === 'string');
      if (!ok) err(`domains.${name} must have description, agents {research, review} and checklist`);
      else cfg.packs.domains[name.toLowerCase()] = p;
    }
  }
  if (layer.max_specialists_per_phase !== undefined) {
    const v = layer.max_specialists_per_phase;
    if (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 5) cfg.packs.max_specialists_per_phase = v as number;
    else err('max_specialists_per_phase must be an integer 0-5');
  }
}

const lrank = (l: Level) => LEVELS.indexOf(l);
const rrank = (r: Rating) => RATINGS.indexOf(r);

function applyPolicy(cfg: Config, p: Obj, where: string, strict: boolean) {
  const err = (m: string) => cfg.errors.push(`${where}: policies.${m}`);
  const weaker = (m: string) => err(`${m}: a project config can only make the policy stricter`);
  const pol = cfg.policy;

  if (isObj(p.risk_floor)) {
    for (const [r, l] of Object.entries(p.risk_floor)) {
      if (!RATINGS.includes(r as Rating) || !LEVELS.includes(l as Level)) err(`risk_floor.${r} must map LOW|MEDIUM|HIGH to SMALL|MEDIUM|LARGE`);
      else if (strict && lrank(l as Level) < lrank(pol.risk_floor[r as Rating])) weaker(`risk_floor.${r}`);
      else pol.risk_floor[r as Rating] = l as Level;
    }
  }
  if (p.high_risk_confirmed_downgrade_floor !== undefined) {
    const l = p.high_risk_confirmed_downgrade_floor as Level;
    if (!LEVELS.includes(l) || l === 'SMALL') err('high_risk_confirmed_downgrade_floor must be MEDIUM or LARGE');
    else if (strict && lrank(l) < lrank(pol.high_risk_confirmed_downgrade_floor)) weaker('high_risk_confirmed_downgrade_floor');
    else pol.high_risk_confirmed_downgrade_floor = l;
  }
  if (isObj(p.domain_min_risk)) {
    for (const [d, r] of Object.entries(p.domain_min_risk)) {
      if (!RATINGS.includes(r as Rating)) err(`domain_min_risk.${d} must be LOW|MEDIUM|HIGH`);
      else if (strict && pol.domain_min_risk[d] && rrank(r as Rating) < rrank(pol.domain_min_risk[d])) weaker(`domain_min_risk.${d}`);
      else pol.domain_min_risk[d.toLowerCase()] = r as Rating;
    }
  }
  if (isObj(p.proposals)) {
    const q = p.proposals;
    if (q.max !== undefined) {
      if (Number.isInteger(q.max) && (q.max as number) >= 1 && (q.max as number) <= 3) pol.proposals.max = q.max as number;
      else err('proposals.max must be 1-3');
    }
    if (q.trigger_min_route !== undefined) {
      if (LEVELS.includes(q.trigger_min_route as Level)) pol.proposals.trigger_min_route = q.trigger_min_route as Level;
      else err('proposals.trigger_min_route must be SMALL|MEDIUM|LARGE');
    }
    if (q.trigger_confidence_below !== undefined) {
      if (RATINGS.includes(q.trigger_confidence_below as Rating)) pol.proposals.trigger_confidence_below = q.trigger_confidence_below as Rating;
      else err('proposals.trigger_confidence_below must be LOW|MEDIUM|HIGH');
    }
    if (q.trigger_on_multiple_approaches !== undefined) {
      if (typeof q.trigger_on_multiple_approaches === 'boolean') pol.proposals.trigger_on_multiple_approaches = q.trigger_on_multiple_approaches;
      else err('proposals.trigger_on_multiple_approaches must be a boolean');
    }
  }
  if (isObj(p.independent_review)) {
    const ir = p.independent_review;
    const s = cfg.settings.independent_review;
    if (ir.required_at_risk !== undefined) {
      const r = ir.required_at_risk as Rating;
      if (!RATINGS.includes(r)) err('independent_review.required_at_risk must be LOW|MEDIUM|HIGH');
      else if (strict && rrank(r) > rrank(s.required_at_risk)) weaker('independent_review.required_at_risk');
      else s.required_at_risk = r;
    }
    if (ir.offered_on_routes !== undefined) {
      const routes = ir.offered_on_routes as Level[];
      if (!Array.isArray(routes) || !routes.every((l) => LEVELS.includes(l))) err('independent_review.offered_on_routes must list routes');
      else s.offered_on_routes = routes;
    }
  }
}

export function resolveRoles(cfg: Pick<Config, 'tiers' | 'profiles' | 'profile'>, errors: string[] = []): Record<string, ResolvedRole> {
  const roles: Record<string, ResolvedRole> = {};
  for (const [role, tier] of Object.entries(cfg.profiles[cfg.profile] ?? {})) {
    const t = cfg.tiers[tier];
    if (!t) errors.push(`profile ${cfg.profile}: role ${role} uses unknown tier "${tier}"`);
    else roles[role] = { tier, ...t };
  }
  return roles;
}

export function loadConfig(opts: { projectDir: string; userClaudeDir: string; profile?: string }): Config {
  const models = clone(defaultModels);
  const cfg: Config = {
    profile: models.default_profile,
    tiers: models.tiers as Record<string, Tier>,
    profiles: models.profiles,
    roles: {},
    escalation: Object.fromEntries(Object.entries(models.escalation).filter(([k]) => !k.startsWith('_'))) as Config['escalation'],
    policy: clone(defaultPolicy) as unknown as Policy,
    settings: clone(defaultSettings) as unknown as Settings,
    packs: clone(defaultPacks) as unknown as Packs,
    sources: ['defaults'],
    errors: [],
  };
  delete (cfg.settings.commands as Obj)._note;

  const user = readJson(userConfigPath(opts.userClaudeDir), cfg.errors);
  if (user) {
    applyLayer(cfg, user, 'user config', false);
    cfg.sources.push(userConfigPath(opts.userClaudeDir));
  }
  const project = readJson(projectConfigPath(opts.projectDir), cfg.errors);
  if (project) {
    applyLayer(cfg, project, 'project config', true);
    cfg.sources.push(projectConfigPath(opts.projectDir));
  }
  if (opts.profile !== undefined) {
    if (cfg.profiles[opts.profile]) cfg.profile = opts.profile;
    else cfg.errors.push(`--profile ${opts.profile} is not a known profile (${Object.keys(cfg.profiles).join(', ')})`);
  }
  cfg.roles = resolveRoles(cfg, cfg.errors);
  return cfg;
}

// Escalation (H5): after N failures on a step the role moves to a stronger tier.
export function roleForAttempt(cfg: Config, role: string, failures: number): ResolvedRole {
  const rule = cfg.escalation[role];
  if (rule && failures >= rule.after_failures && cfg.tiers[rule.to]) return { tier: rule.to, ...cfg.tiers[rule.to] };
  return cfg.roles[role];
}
