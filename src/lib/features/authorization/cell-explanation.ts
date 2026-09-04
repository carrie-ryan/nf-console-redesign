/**
 * Headless CELL-MEMBERSHIP EXPLANATION — pure, deterministic, no Angular/UI.
 *
 * For one matrix cell (identitySegment → serviceSegment) it explains, per member:
 *   • which identities in the from-segment are AUTHORIZED into the to-segment
 *     (and which services they reach), and WHY the excluded ones are excluded;
 *   • which services in the to-segment are REACHED (and by whom), and WHY the
 *     unreached ones are not.
 *
 * STATUS is read straight off the resolver's authorized `pairs` (ground truth) —
 * a member is authorized iff it appears in a pair that lands in this cell. The
 * REASON for an excluded member is computed with the RESOLVER'S OWN match
 * primitives (roleSatisfied / entityMatchesRoles), so an explanation can never
 * drift from the authorization it explains. Status and reason are kept
 * consistent: an authorized member never carries a reason.
 *
 * This module adds NO authorization logic — it aggregates existing resolver
 * output and re-uses the shared matcher. The resolver itself is untouched.
 */

import type { Identity, Policy, Service } from '../../shared/services/mock-data.service';
import {
  roleSatisfied,
  entityMatchesRoles,
  type AuthorizedPair,
  type SegmentNode,
} from './authorization-resolver';

/**
 * Why an excluded identity / unreached service has no authorized edge in this
 * cell. Only present on excluded/unreached members (never on authorized ones):
 *   • 'failed-allof'       — the member matched SOME of a dial policy's roles but
 *                            not ALL, under AllOf. `missingRoles` lists the
 *                            specific roles it lacks; `nearestPolicyId`/`Name`
 *                            name the AllOf policy it fell short of.
 *   • 'no-matching-policy' — no dial policy connecting this cell references the
 *                            member at all (it matched zero roles of every
 *                            relevant policy). No `missingRoles`.
 */
export type ExclusionKind = 'no-matching-policy' | 'failed-allof';

export interface ExclusionReason {
  kind: ExclusionKind;
  /** The AllOf policy the member fell short of (failed-allof only). Real policy id. */
  nearestPolicyId?: string;
  /** Human name of that policy (failed-allof only) — for eyeballing. */
  nearestPolicyName?: string;
  /** The specific required roles the member lacks (failed-allof only). */
  missingRoles?: string[];
}

export interface CellIdentityExplanation {
  id: string;
  name: string;
  status: 'authorized' | 'excluded';
  /** Services in the to-segment this identity reaches (authorized only). */
  authorizedServiceIds?: string[];
  /** Why excluded (excluded only). */
  reason?: ExclusionReason;
}

export interface CellServiceExplanation {
  id: string;
  name: string;
  status: 'reached' | 'unreached';
  /** Identities in the from-segment that reach this service (reached only). */
  reachedByIdentityIds?: string[];
  /** Why unreached (unreached only). */
  reason?: ExclusionReason;
}

export interface CellExplanation {
  fromSegment: string;
  toSegment: string;
  identities: CellIdentityExplanation[];
  services: CellServiceExplanation[];
}

/** Everything explainCell needs — the resolver's inputs + its authorized pairs
 *  + the segment nodes (for memberIds). All produced by resolveDialAuthorizationGraph. */
export interface ExplainCellContext {
  identities: readonly Identity[];
  services: readonly Service[];
  policies: readonly Policy[];
  pairs: readonly AuthorizedPair[];
  segmentNodes: readonly SegmentNode[];
}

/** A member to reason about, reduced to what the shared matcher needs. */
interface Matchable {
  attributes: readonly string[];
  name: string;
  id: string;
}

/**
 * Reason an EXCLUDED member has no edge, evaluated against the dial policies that
 * connect this cell (`cellPolicies` — the OTHER side of the cell is already
 * satisfiable for these). `rolesOf` picks the side (identityRoles / serviceRoles).
 *
 * Because the member is excluded, it cannot fully match any cell policy on this
 * side (a full AnyOf/AllOf match would have produced a pair). So the only way it
 * can have matched ANY role is a partial AllOf — which is exactly 'failed-allof'.
 * If it matched no role of any cell policy → 'no-matching-policy'.
 */
function reasonForExcluded(
  member: Matchable,
  cellPolicies: readonly Policy[],
  rolesOf: (p: Policy) => readonly string[],
): ExclusionReason {
  let best: { policy: Policy; missing: string[] } | null = null;

  for (const p of cellPolicies) {
    const roles = rolesOf(p);
    if (roles.length === 0) continue;
    const missing = roles.filter(
      (r) => !roleSatisfied(r, member.attributes, member.name, member.id),
    );
    const matchedSome = missing.length < roles.length;
    // Strict, non-empty subset under AllOf → the member "nearly" qualified.
    if (p.semantic === 'AllOf' && matchedSome && missing.length > 0) {
      if (!best || missing.length < best.missing.length) best = { policy: p, missing };
    }
  }

  if (best) {
    return {
      kind: 'failed-allof',
      nearestPolicyId: best.policy.id,
      nearestPolicyName: best.policy.name,
      missingRoles: best.missing,
    };
  }
  return { kind: 'no-matching-policy' };
}

/**
 * Explain one cell: who is authorized fromSegment → toSegment and why the rest
 * are not. Pure aggregation over resolver output + the shared match primitive.
 */
export function explainCell(
  fromSegmentId: string,
  toSegmentId: string,
  ctx: ExplainCellContext,
): CellExplanation {
  const { identities, services, policies, pairs, segmentNodes } = ctx;

  const fromNode = segmentNodes.find((n) => n.side === 'identity' && n.segment === fromSegmentId);
  const toNode = segmentNodes.find((n) => n.side === 'service' && n.segment === toSegmentId);
  const fromIds = fromNode?.memberIds ?? [];
  const toIds = toNode?.memberIds ?? [];
  const fromSet = new Set(fromIds);
  const toSet = new Set(toIds);

  const identityById = new Map(identities.map((i) => [i.id, i]));
  const serviceById = new Map(services.map((s) => [s.id, s]));

  const dialPolicies = policies.filter((p) => p.type === 'dial');

  // Pairs landing inside this cell (both endpoints in-segment) — the ground truth.
  const cellPairs = pairs.filter((p) => fromSet.has(p.identityId) && toSet.has(p.serviceId));
  const servicesByIdentity = new Map<string, string[]>();
  const identitiesByService = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const arr = map.get(key);
    if (arr) arr.push(value);
    else map.set(key, [value]);
  };
  for (const p of cellPairs) {
    push(servicesByIdentity, p.identityId, p.serviceId);
    push(identitiesByService, p.serviceId, p.identityId);
  }

  const toServices = toIds.map((id) => serviceById.get(id)).filter((s): s is Service => s != null);
  const fromIdentities = fromIds.map((id) => identityById.get(id)).filter((i): i is Identity => i != null);

  // Policies that could grant an edge INTO the to-segment (service side satisfiable),
  // used to reason about identities.
  const policiesReachingToSegment = dialPolicies.filter((p) =>
    toServices.some((s) => entityMatchesRoles(p.serviceRoles, p.semantic, s.attributes ?? [], s.name, s.id)),
  );

  // Policies that could grant an edge OUT of the from-segment (identity side
  // satisfiable), used to reason about services.
  const policiesFromFromSegment = dialPolicies.filter((p) =>
    fromIdentities.some((i) => entityMatchesRoles(p.identityRoles, p.semantic, i.attributes, i.name, i.id)),
  );

  // ── identity side ──
  const identityExplanations: CellIdentityExplanation[] = fromIdentities.map((i) => {
    const reached = servicesByIdentity.get(i.id);
    if (reached && reached.length > 0) {
      return { id: i.id, name: i.name, status: 'authorized', authorizedServiceIds: reached };
    }
    const reason = reasonForExcluded(
      { attributes: i.attributes, name: i.name, id: i.id },
      policiesReachingToSegment,
      (p) => p.identityRoles,
    );
    return { id: i.id, name: i.name, status: 'excluded', reason };
  });

  // ── service side ──
  const serviceExplanations: CellServiceExplanation[] = toServices.map((s) => {
    const reachedBy = identitiesByService.get(s.id);
    if (reachedBy && reachedBy.length > 0) {
      return { id: s.id, name: s.name, status: 'reached', reachedByIdentityIds: reachedBy };
    }
    const reason = reasonForExcluded(
      { attributes: s.attributes ?? [], name: s.name, id: s.id },
      policiesFromFromSegment,
      (p) => p.serviceRoles,
    );
    return { id: s.id, name: s.name, status: 'unreached', reason };
  });

  return {
    fromSegment: fromSegmentId,
    toSegment: toSegmentId,
    identities: identityExplanations,
    services: serviceExplanations,
  };
}
