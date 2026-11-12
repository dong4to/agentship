// Domain matcher (H2.9): (domain x phase) -> specialist agent + the model/effort of the phase's role.
// Deterministic: exact name (or '*' wildcard) match against the domain pack, best source first.
import type { AgentInfo } from './registry.ts';
import { SOURCE_PRIORITY } from './registry.ts';

export type Phase = 'research' | 'review';

export interface DomainPack {
  description: string;
  agents: Partial<Record<Phase, string[]>>;
  checklist: string[];
}

export interface Packs {
  max_specialists_per_phase: number;
  domains: Record<string, DomainPack>;
}

export interface Role {
  model: string;
  effort: string;
}

export interface Assignment {
  domain: string;
  agent: string | null; // subagent_type to use; null = no specialist installed, use the generic role agent
  source: string | null;
  pattern: string | null;
  model: string;
  effort: string;
}

export interface AgentPlan {
  domains: string[];
  unknown_domains: string[];
  phases: Record<Phase, Assignment[]>;
  checklist: { domain: string; items: string[] }[];
}

const toRegex = (pattern: string) =>
  new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');

export function findSpecialist(agents: AgentInfo[], patterns: string[], exclude: Set<string> = new Set()) {
  for (const source of SOURCE_PRIORITY) {
    for (const pattern of patterns) {
      const re = toRegex(pattern);
      const hit = agents.find((a) => a.source === source && re.test(a.name) && !exclude.has(a.invoke));
      if (hit) return { agent: hit, pattern };
    }
  }
  return null;
}

export function planAgents(domains: string[], agents: AgentInfo[], packs: Packs, roles: Record<Phase, Role>): AgentPlan {
  const known = [...new Set(domains)].filter((d) => packs.domains[d]);
  const unknown = [...new Set(domains)].filter((d) => !packs.domains[d]);
  const phases = { research: [], review: [] } as Record<Phase, Assignment[]>;

  for (const phase of ['research', 'review'] as Phase[]) {
    const used = new Set<string>();
    for (const domain of known) {
      if (phases[phase].length >= packs.max_specialists_per_phase) break;
      const hit = findSpecialist(agents, packs.domains[domain].agents[phase] ?? [], used);
      if (hit) used.add(hit.agent.invoke);
      phases[phase].push({
        domain,
        agent: hit?.agent.invoke ?? null,
        source: hit?.agent.source ?? null,
        pattern: hit?.pattern ?? null,
        model: roles[phase].model,
        effort: roles[phase].effort,
      });
    }
  }

  return {
    domains: known,
    unknown_domains: unknown,
    phases,
    checklist: known.map((d) => ({ domain: d, items: packs.domains[d].checklist })),
  };
}
