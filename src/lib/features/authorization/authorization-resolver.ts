/**
 * Network-wide DIAL authorization resolver — pure, headless, deterministic.
 *
 * No Angular, no signals, no UI. Cross-joins ALL dial policies × ALL identities ×
 * ALL services and emits the ground-truth authorization set: every (identity,
 * service) pair some dial policy permits. A separate roll-up folds those pairs
 * into segment-to-segment edges (full / partial / none) for a chosen pair of
 * grouping attributes.
 *
 * This EXTENDS the per-policy role match in create-policy.component.ts
 * (associatedServices / associatedIdentities) with three things that view does
 * not do:
 *   1. it iterates EVERY dial policy, not one draft, to build the whole graph;
 *   2. it honours `semantic` — AnyOf (some role) vs AllOf (every role);
 *   3. it resolves `@`-prefixed direct identity refs (name/id), not just `#attrs`.
 *
 * Bind policies are deliberately ignored: this layer is the dial/overlay edge set
 * only.
 */

import type { Identity, Policy, Service } from '../../shared/services/mock-data.service';

// ─── stage 1: role matching ───────────────────────────────────────────────────

/**
 * Does a single role token authorise this entity?
 *   • '#all'        → matches everything (the wildcard from create-policy).
 *   • '@'-prefixed  → a DIRECT reference to one entity, by name or id (passthrough
 *                     for manual-card @refs; not present in seed data). '@laptop-x'
 *                     matches the entity whose name OR id === 'laptop-x'.
 *   • otherwise     → a '#attribute' the entity must carry (flat string membership).
 */
export function roleSatisfied(
  role: string,
  entityAttributes: readonly string[],
  entityName: string,
  entityId: string,
): boolean {
  if (role === '#all') return true;
  if (role.startsWith('@')) {
    const ref = role.slice(1);
    return entityName === ref || entityId === ref;
  }
  return entityAttributes.includes(role);
}

/**
 * Does an entity satisfy a policy's role list under the given semantic?
 *   • AnyOf → at least one role is satisfied (the `.some()` create-policy uses).
 *   • AllOf → EVERY role is satisfied (strictly narrower — the piece create-policy
 *             never implements).
 * An empty role list authorises NO entity (matches create-policy returning []).
 */
export function entityMatchesRoles(
  roles: readonly string[],
  semantic: Policy['semantic'],
  entityAttributes: readonly string[],
  entityName: string,
  entityId: string,
): boolean {
  if (roles.length === 0) return false;
  const test = (r: string) => roleSatisfied(r, entityAttributes, entityName, entityId);
  return semantic === 'AllOf' ? roles.every(test) : roles.some(test);
}

// ─── stage 2: the authorization set (ground truth) ────────────────────────────

/**
 * One authorized identity→service edge. `authorizedBy` lists EVERY dial policy
 * that grants it (a pair can be authorized by more than one). Pairs are unique —
 * this is the deduped ground-truth set, so segment roll-up counts each cell once.
 */
export interface AuthorizedPair {
  identityId: string;
  identityName: string;
  serviceId: string;
  serviceName: string;
  authorizedBy: string[];
}

/**
 * Cross-join ALL dial policies × identities × services → the authorized pairs.
 * Only pairs authorized by at least one dial policy are emitted. Bind policies
 * are filtered out up front.
 */
export function resolveDialAuthorizations(
  identities: readonly Identity[],
  services: readonly Service[],
  policies: readonly Policy[],
): AuthorizedPair[] {
  const dialPolicies = policies.filter((p) => p.type === 'dial');
  const byPair = new Map<string, AuthorizedPair>();

  for (const p of dialPolicies) {
    const matchedIdentities = identities.filter((i) =>
      entityMatchesRoles(p.identityRoles, p.semantic, i.attributes, i.name, i.id),
    );
    const matchedServices = services.filter((s) =>
      entityMatchesRoles(p.serviceRoles, p.semantic, s.attributes ?? [], s.name, s.id),
    );

    for (const i of matchedIdentities) {
      for (const s of matchedServices) {
        const key = `${i.id} ${s.id}`;
        let entry = byPair.get(key);
        if (!entry) {
          entry = {
            identityId: i.id,
            identityName: i.name,
            serviceId: s.id,
            serviceName: s.name,
            authorizedBy: [],
          };
          byPair.set(key, entry);
        }
        if (!entry.authorizedBy.includes(p.id)) entry.authorizedBy.push(p.id);
      }
    }
  }

  // Deterministic order: by identity id, then service id.
  return [...byPair.values()].sort(
    (a, b) => a.identityId.localeCompare(b.identityId) || a.serviceId.localeCompare(b.serviceId),
  );
}

// ─── stage 3: segment roll-up ─────────────────────────────────────────────────

export type SegmentState = 'full' | 'partial' | 'none';

/**
 * One ordered segment→segment edge. `totalCount` = |identities in from| ×
 * |services in to| (every possible pair); `authorizedCount` = how many of those
 * the resolver authorized. `state` is 'none' (isolation — asserted, never omitted),
 * 'partial' (some), or 'full' (all).
 */
export interface SegmentEdge {
  fromSegment: string;
  toSegment: string;
  state: SegmentState;
  authorizedCount: number;
  totalCount: number;
}

/**
 * Why a segment has ZERO authorized edges. Only meaningful for zero-edge segments
 * (null otherwise). The distinction keys on whether the segment's entities are
 * even MATCHABLE by a dial policy's role list — not on whether they carry attrs:
 *   • 'isolated'     — at least one member IS matched by some dial policy's role
 *                      list (it was "seen" by policy machinery), yet no policy
 *                      grants a complete identity→service edge. Reads as an
 *                      intentional posture.
 *   • 'unresolvable' — NO dial policy's role list matches ANY member (no
 *                      attribute, no '@'-ref, no '#all' reaches them). Nothing
 *                      could ever authorize them — reads as a tagging/config gap.
 */
export type ZeroEdgeReason = 'isolated' | 'unresolvable';

/** Catch-all segment label for entities that match no segment prefix. Both axes
 *  use it; the `side` field / column position disambiguates identity vs service. */
export const UNGROUPED_SEGMENT = '#ungrouped';

/**
 * A segment (a matrix row or column). Carries the catch-all flag and — for
 * zero-edge segments only — WHY it is isolated. `isUngrouped` segments are a bag
 * of leftovers, NOT a cohesive group: no intra-segment cohesion is computed for
 * them (it would be meaningless).
 */
export interface SegmentNode {
  segment: string;
  side: 'identity' | 'service';
  isUngrouped: boolean;
  memberIds: string[];
  memberCount: number;
  /** # of authorized pairs touching this segment. 0 → zero-edge. */
  authorizedEdgeCount: number;
  /** Set only when authorizedEdgeCount === 0; null otherwise. */
  zeroEdgeReason: ZeroEdgeReason | null;
}

export interface SegmentRollUp {
  edges: SegmentEdge[];
  nodes: SegmentNode[];
}

interface SegmentGroup {
  ids: string[];
  isUngrouped: boolean;
}

/**
 * Bucket entities by every segment attribute they carry under `prefix`. An entity
 * matching NO prefix falls into the single UNGROUPED_SEGMENT catch-all, so the
 * buckets COVER every entity — no authorized pair can later be dropped. (In real
 * post-discovery data each identity carries one #discovered-group-N and each
 * service one #discovered-svc-*, so the buckets also PARTITION — which is what
 * makes the conservation invariant hold.)
 */
function groupWithUngrouped<T extends { id: string; attributes?: readonly string[] }>(
  entities: readonly T[],
  prefix: string,
): Map<string, SegmentGroup> {
  const groups = new Map<string, SegmentGroup>();
  const push = (label: string, id: string, isUngrouped: boolean) => {
    const g = groups.get(label);
    if (g) g.ids.push(id);
    else groups.set(label, { ids: [id], isUngrouped });
  };
  for (const e of entities) {
    const segs = (e.attributes ?? []).filter((a) => a.startsWith(prefix));
    if (segs.length === 0) push(UNGROUPED_SEGMENT, e.id, true);
    else for (const seg of segs) push(seg, e.id, false);
  }
  return groups;
}

/** Real segments sorted alphabetically, with the ungrouped catch-all pinned last. */
function orderedLabels(groups: Map<string, SegmentGroup>): string[] {
  const labels = [...groups.keys()].filter((k) => k !== UNGROUPED_SEGMENT).sort();
  if (groups.has(UNGROUPED_SEGMENT)) labels.push(UNGROUPED_SEGMENT);
  return labels;
}

/** Would ANY dial policy's role list (for this side) match this entity? Accounts
 *  for '#attr' membership, '@'-ref, '#all', and the AnyOf/AllOf semantic. */
function matchableBySomePolicy(
  entity: { id: string; name: string; attributes?: readonly string[] },
  side: 'identity' | 'service',
  policies: readonly Policy[],
): boolean {
  return policies.some((p) => {
    if (p.type !== 'dial') return false;
    const roles = side === 'identity' ? p.identityRoles : p.serviceRoles;
    return entityMatchesRoles(roles, p.semantic, entity.attributes ?? [], entity.name, entity.id);
  });
}

/**
 * Roll authorized pairs up to segment→segment edges + per-segment nodes for the
 * chosen grouping attributes (prefixes — e.g. '#discovered-group-' for identities
 * and '#discovered-svc-' for services). Emits EVERY ordered (identitySegment,
 * serviceSegment) combination including 'none' (isolation is a fact, not a gap),
 * routes prefix-less entities into an UNGROUPED_SEGMENT catch-all on each side so
 * no authorized pair is dropped, and tags each zero-edge segment with WHY.
 */
export function rollUpSegments(
  identities: readonly Identity[],
  services: readonly Service[],
  policies: readonly Policy[],
  pairs: readonly AuthorizedPair[],
  identityAttr: string,
  serviceAttr: string,
): SegmentRollUp {
  const identityGroups = groupWithUngrouped(identities, identityAttr);
  const serviceGroups = groupWithUngrouped(services, serviceAttr);
  const identityById = new Map(identities.map((i) => [i.id, i]));
  const serviceById = new Map(services.map((s) => [s.id, s]));

  const authorizedKeys = new Set(pairs.map((p) => `${p.identityId} ${p.serviceId}`));

  const fromSegs = orderedLabels(identityGroups);
  const toSegs = orderedLabels(serviceGroups);

  // ─ edges (every ordered cell, including 'none') ─
  const edges: SegmentEdge[] = [];
  for (const fromSegment of fromSegs) {
    const fromIds = identityGroups.get(fromSegment)!.ids;
    for (const toSegment of toSegs) {
      const toIds = serviceGroups.get(toSegment)!.ids;
      const totalCount = fromIds.length * toIds.length;

      let authorizedCount = 0;
      for (const iId of fromIds) {
        for (const sId of toIds) {
          if (authorizedKeys.has(`${iId} ${sId}`)) authorizedCount += 1;
        }
      }

      const state: SegmentState =
        authorizedCount === 0 ? 'none' : authorizedCount === totalCount ? 'full' : 'partial';

      edges.push({ fromSegment, toSegment, state, authorizedCount, totalCount });
    }
  }

  // ─ nodes (catch-all flag + zero-edge reason) ─
  const buildNode = (
    segment: string,
    side: 'identity' | 'service',
    group: SegmentGroup,
  ): SegmentNode => {
    const memberSet = new Set(group.ids);
    const keyOf = (p: AuthorizedPair) => (side === 'identity' ? p.identityId : p.serviceId);
    const authorizedEdgeCount = pairs.reduce((n, p) => n + (memberSet.has(keyOf(p)) ? 1 : 0), 0);

    let zeroEdgeReason: ZeroEdgeReason | null = null;
    if (authorizedEdgeCount === 0) {
      const byId = side === 'identity' ? identityById : serviceById;
      const anyMatchable = group.ids.some((id) => {
        const entity = byId.get(id);
        return entity ? matchableBySomePolicy(entity, side, policies) : false;
      });
      zeroEdgeReason = anyMatchable ? 'isolated' : 'unresolvable';
    }

    return {
      segment,
      side,
      isUngrouped: group.isUngrouped,
      memberIds: group.ids,
      memberCount: group.ids.length,
      authorizedEdgeCount,
      zeroEdgeReason,
    };
  };

  const nodes: SegmentNode[] = [];
  for (const seg of fromSegs) nodes.push(buildNode(seg, 'identity', identityGroups.get(seg)!));
  for (const seg of toSegs) nodes.push(buildNode(seg, 'service', serviceGroups.get(seg)!));

  return { edges, nodes };
}

// ─── convenience: run both stages ─────────────────────────────────────────────

export interface DialAuthorizationResult {
  pairs: AuthorizedPair[];
  segmentEdges: SegmentEdge[];
  segmentNodes: SegmentNode[];
}

/**
 * Resolve the whole authorization graph and its segment roll-up in one call.
 * `identityAttr` / `serviceAttr` are the segmenting prefixes.
 */
export function resolveDialAuthorizationGraph(
  identities: readonly Identity[],
  services: readonly Service[],
  policies: readonly Policy[],
  identityAttr: string,
  serviceAttr: string,
): DialAuthorizationResult {
  const pairs = resolveDialAuthorizations(identities, services, policies);
  const { edges, nodes } = rollUpSegments(
    identities,
    services,
    policies,
    pairs,
    identityAttr,
    serviceAttr,
  );
  return { pairs, segmentEdges: edges, segmentNodes: nodes };
}
