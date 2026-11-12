// Deterministic routing policy (plan §5, H2.3, H2.7, H2.9). No LLM runs here.
import defaultPolicy from '../../config/default-policies.json' with { type: 'json' };
import { LEVELS, RATINGS, type Classification, type Level, type Rating } from './classification.ts';

export type Action = 'proceed' | 'propose' | 'discovery' | 'clarify' | 'confirm_downgrade' | 'error';

export interface Overrides {
  route?: Level;
  riskHigh?: boolean;
  confirmDowngrade?: boolean;
  afterDiscovery?: boolean;
  proposals?: 'force' | 'off';
  // Set when deciding on the proposal the developer chose: never propose again.
  fromProposal?: boolean;
}

export interface Decision {
  action: Action;
  route: Level | null;
  risk: Rating | null;
  reasons: string[];
}

export interface Policy {
  risk_floor: Record<Rating, Level>;
  high_risk_confirmed_downgrade_floor: Level;
  domain_min_risk: Record<string, Rating>;
  proposals: {
    max: number;
    trigger_min_route: Level;
    trigger_confidence_below: Rating;
    trigger_on_multiple_approaches: boolean;
  };
}

// ponytail: shipped defaults only; validate a policy file once per-repo overrides exist (H6)
export const DEFAULT_POLICY = defaultPolicy as Policy;

const rank = (l: Level) => LEVELS.indexOf(l);
const max = (...ls: Level[]) => ls.reduce((a, b) => (rank(b) > rank(a) ? b : a));
const rrank = (r: Rating) => RATINGS.indexOf(r);
export const maxRisk = (...rs: Rating[]) => rs.reduce((a, b) => (rrank(b) > rrank(a) ? b : a));

export function decide(
  c: Classification | null,
  overrides: Overrides = {},
  policy: Policy = DEFAULT_POLICY,
): Decision {
  // No valid classification: never fall through to SMALL.
  if (!c) {
    return { action: 'error', route: null, risk: null, reasons: ['classification missing or invalid; no route chosen'] };
  }

  const reasons: string[] = [];
  let risk: Rating = c.risk;
  for (const d of c.domains ?? []) {
    const floor = policy.domain_min_risk[d];
    if (floor && rrank(floor) > rrank(risk)) {
      reasons.push(`risk raised to ${floor}: domain "${d}" has a minimum risk of ${floor}`);
      risk = floor;
    }
  }
  if (overrides.riskHigh && risk !== 'HIGH') {
    reasons.push('risk raised to HIGH by user override');
    risk = 'HIGH';
  }

  // Route never goes below complexity, the classifier's recommendation, or the risk floor.
  let route = max(c.complexity, c.recommended_workflow, policy.risk_floor[risk]);
  reasons.push(`computed ${route} from complexity=${c.complexity}, recommended=${c.recommended_workflow}, risk=${risk}`);

  if (c.confidence === 'LOW') {
    const action: Action = overrides.afterDiscovery ? 'clarify' : 'discovery';
    reasons.push(
      action === 'discovery'
        ? 'low confidence: run limited discovery and classify again'
        : 'still low confidence after discovery: ask the user to clarify',
    );
    return { action, route, risk, reasons };
  }

  if (overrides.route && overrides.route !== route) {
    if (rank(overrides.route) > rank(route)) {
      route = overrides.route;
      reasons.push(`raised to ${route} by user override`);
    } else if (risk !== 'HIGH') {
      route = overrides.route;
      reasons.push(`lowered to ${route} by user override (risk ${risk})`);
    } else if (!overrides.confirmDowngrade) {
      reasons.push(`downgrade to ${overrides.route} on a HIGH-risk task needs explicit confirmation`);
      return { action: 'confirm_downgrade', route, risk, reasons };
    } else {
      // Confirmed downgrade still has a floor: HIGH risk never runs SMALL.
      const floored = max(overrides.route, policy.high_risk_confirmed_downgrade_floor);
      reasons.push(
        floored === overrides.route
          ? `lowered to ${floored} by confirmed user override`
          : `confirmed downgrade to ${overrides.route} clamped to ${floored}: HIGH risk never runs SMALL`,
      );
      route = floored;
    }
  }

  const why = proposalTriggers(c, route, overrides, policy);
  if (why.length) {
    reasons.push(`proposals phase: ${why.join('; ')}`);
    return { action: 'propose', route, risk, reasons };
  }
  return { action: 'proceed', route, risk, reasons };
}

function proposalTriggers(c: Classification, route: Level, o: Overrides, policy: Policy): string[] {
  if (o.fromProposal || o.proposals === 'off') return [];
  if (o.proposals === 'force') return ['requested with --proposals'];
  const p = policy.proposals;
  const why: string[] = [];
  if (rank(route) >= rank(p.trigger_min_route)) why.push(`route ${route} >= ${p.trigger_min_route}`);
  if (rrank(c.confidence) < rrank(p.trigger_confidence_below)) why.push(`confidence ${c.confidence}`);
  if (p.trigger_on_multiple_approaches && c.multiple_approaches) why.push('more than one valid approach');
  return why;
}
