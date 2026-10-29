// Deterministic routing policy (plan §5, H2.3). No LLM runs here.
import defaultPolicy from '../../config/default-policies.json' with { type: 'json' };
import { LEVELS, type Classification, type Level, type Rating } from './classification.ts';

export type Action = 'proceed' | 'discovery' | 'clarify' | 'confirm_downgrade' | 'error';

export interface Overrides {
  route?: Level;
  riskHigh?: boolean;
  confirmDowngrade?: boolean;
  afterDiscovery?: boolean;
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
}

// ponytail: shipped defaults only; validate a policy file once per-repo overrides exist (H6)
export const DEFAULT_POLICY = defaultPolicy as Policy;

const rank = (l: Level) => LEVELS.indexOf(l);
const max = (...ls: Level[]) => ls.reduce((a, b) => (rank(b) > rank(a) ? b : a));

export function decide(
  c: Classification | null,
  overrides: Overrides = {},
  policy: Policy = DEFAULT_POLICY,
): Decision {
  // No valid classification: never fall through to SMALL.
  if (!c) {
    return { action: 'error', route: null, risk: null, reasons: ['classification missing or invalid; no route chosen'] };
  }

  const risk: Rating = overrides.riskHigh ? 'HIGH' : c.risk;
  const reasons: string[] = [];
  if (overrides.riskHigh && c.risk !== 'HIGH') reasons.push('risk raised to HIGH by user override');

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

  return { action: 'proceed', route, risk, reasons };
}
