/**
 * Roster → grouped-by-attribute-tag projection (DATA ONLY, no rendering).
 *
 * The headless model behind the planned "grouped" Traffic-Analysis view: one node
 * per distinct identity attribute-tag, identities filed under EVERY tag they
 * carry, plus a two-armed catch-all for what no tag can hold.
 *
 *   tag nodes   → one per distinct `attributes[]` token across the roster.
 *                 An identity with N tags appears in N nodes (multi-membership is
 *                 the point, not a bug).
 *   catch-all   → 'no-tag'    : MANAGED identities with `attributes.length === 0`.
 *                 'unmanaged' : observed source HOSTS from the flows that resolve
 *                               to no Identity at all.
 *
 * The two catch-all arms are deliberately DIFFERENT SHAPES and are never merged:
 * a no-tag member is an identity ref ({id, name} — a principal we manage but
 * haven't grouped), an unmanaged member is a host ref ({ingressIp, display} — an
 * observed ADDRESS with no Identity record behind it). Coercing a host into an
 * identity ref is exactly the mistake `source-enrollment.ts` and the
 * `DiscoveredFlow.dialingIdentityId: string | null` contract exist to prevent, so
 * the type system keeps them apart here too.
 *
 * PURE, mirroring `buildObservedSankeyData` (observed-sankey.adapter.ts): the
 * caller passes the roster and the flows in; this file reaches into no service,
 * reads no signal, imports no Angular and no d3, and computes NO layout — there
 * is not an x, y, width, or pixel anywhere below. A view layer decides how to draw
 * this; the projection only says what the groups ARE.
 *
 * ENROLLMENT is the shared derived determination, not a string-shape guess: a flow's
 * source is managed iff its `dialingIdentityId` is non-null AND present in
 * `enrolledSourceIds(identities)`. Same contract the raw-traffic table, the
 * suggested-roles evidence, and the observed-traffic flow map already use.
 */

import type { Identity } from '../../shared/services/mock-data.service';
import type { DiscoveredFlow } from './discovery.models';
import { enrolledSourceIds } from './source-enrollment';

// ─── member refs (two shapes, never interchangeable) ──────────────────────────

/** A MANAGED identity — backed by a real record in `MockDataService.identities()`.
 *  Populates tag nodes and the 'no-tag' catch-all arm. */
export interface RosterIdentityRef {
  id: string;
  name: string;
  /**
   * The identity's FULL distinct tag set, carried on every ref regardless of which
   * node the ref sits in — so a row under `#users` can show that the same identity
   * also carries `#laptops`. Without this a consumer would have to re-join against
   * the roster to see why one identity occupies two circles, which is the single
   * fact multi-membership exists to make visible. Empty for a no-tag member.
   *
   * Recomputed from the input identities in the same pass that files them; no new
   * lookup, no second source of truth.
   */
  attributes: readonly string[];
}

/** An UNMANAGED observed host — an address seen dialing in the flows with no
 *  Identity behind it. It has no id and no name: `ingressIp` is its whole
 *  identity (and the dedupe key), `display` is the honest ingress display string. */
export interface RosterHostRef {
  ingressIp: string;
  /**
   * What to show for this host. The flow's `ingressEntityName` when the source is
   * address-only (`dialingIdentityId === null`), where the mock guarantees that
   * string IS the IP; the bare `ingressIp` otherwise — a flow naming a source whose
   * id does not resolve carries a name no Identity backs, and an unmanaged host
   * must never be displayed under a principal's name.
   */
  display: string;
}

// ─── nodes + catch-all arms ───────────────────────────────────────────────────

/** One attribute-tag node. `members` are every identity carrying `attribute`. */
export interface RosterTagNode {
  kind: 'tag';
  /** The raw attribute token as authored on the identity, e.g. '#users'. */
  attribute: string;
  members: readonly RosterIdentityRef[];
  memberCount: number;
}

/** Catch-all arm 1 — managed, but carrying no tag to group under. */
export interface RosterNoTagArm {
  kind: 'no-tag';
  members: readonly RosterIdentityRef[];
  memberCount: number;
}

/** Catch-all arm 2 — observed hosts that are not identities at all. */
export interface RosterUnmanagedArm {
  kind: 'unmanaged';
  members: readonly RosterHostRef[];
  memberCount: number;
}

/**
 * Tallies the conservation invariants are checked against. Derived here so a
 * consumer (or a spec) never has to re-walk the projection to prove it balances.
 *
 *   tagPlacements === Σ over identities of attributes.length   (multi-membership)
 *   noTagCount    === # identities with attributes.length === 0
 *   noTagCount + (# identities with ≥1 tag) === identityCount  (the roster splits)
 */
export interface GroupedRosterTotals {
  /** Size of the input roster. */
  identityCount: number;
  /** Number of distinct tag nodes. */
  tagNodeCount: number;
  /** Σ of every tag node's memberCount — PLACEMENTS, not distinct identities. */
  tagPlacements: number;
  /** Distinct identities appearing in at least one tag node. */
  taggedIdentityCount: number;
  noTagCount: number;
  unmanagedCount: number;
}

/** The whole immutable projection. Frozen on the way out. */
export interface GroupedRoster {
  /** Alphabetical by `attribute` — a stable order with no layout meaning. */
  tagNodes: readonly RosterTagNode[];
  catchAll: {
    noTag: RosterNoTagArm;
    unmanaged: RosterUnmanagedArm;
  };
  totals: GroupedRosterTotals;
}

/**
 * Build the grouped-roster projection from a roster and the observed flows.
 *
 * Member order within a node follows ROSTER order (and, for unmanaged hosts,
 * first-appearance order in `flows`) so the output is deterministic without
 * imposing a sort the view might disagree with. Tag nodes themselves sort
 * alphabetically, mirroring `orderedLabels` in the authorization resolver.
 *
 * A blank attribute token or a flow missing `ingressIp` is a step-zero data bug,
 * so this THROWS rather than inventing an 'unknown' bucket — same stance
 * `buildObservedSankeyData` takes on its required fields.
 */
export function buildGroupedRoster(
  identities: readonly Identity[],
  flows: readonly DiscoveredFlow[],
): GroupedRoster {
  // ── tag nodes + the no-tag arm (roster side) ──
  const tagMembers = new Map<string, RosterIdentityRef[]>();
  const noTag: RosterIdentityRef[] = [];
  const taggedIds = new Set<string>();

  for (const identity of identities) {
    if (identity.attributes.length === 0) {
      noTag.push(Object.freeze({ id: identity.id, name: identity.name, attributes: Object.freeze([]) }));
      continue;
    }

    // `addAttr` (proposed-policy-store) already dedupes on write, so a repeated
    // token would be a corrupted record; filing the identity once per DISTINCT
    // tag keeps a node's member list a true set either way.
    const seen = new Set<string>();
    for (const raw of identity.attributes) {
      const attribute = raw.trim();
      if (!attribute) {
        throw new Error(`Identity ${identity.id}: blank attribute token in attributes[].`);
      }
      seen.add(attribute);
    }

    // ONE ref per identity, shared by every node it is filed under, so each row
    // carries the identity's whole tag set no matter which circle you opened.
    const ref: RosterIdentityRef = Object.freeze({
      id: identity.id,
      name: identity.name,
      attributes: Object.freeze([...seen]),
    });

    for (const attribute of seen) {
      const bucket = tagMembers.get(attribute);
      if (bucket) bucket.push(ref);
      else tagMembers.set(attribute, [ref]);
    }
    // An identity with only blank-trimmed tags cannot occur — we threw above.
    taggedIds.add(identity.id);
  }

  const tagNodes: RosterTagNode[] = [...tagMembers.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([attribute, members]) =>
      Object.freeze({
        kind: 'tag' as const,
        attribute,
        members: Object.freeze(members),
        memberCount: members.length,
      }),
    );

  // ── the unmanaged arm (flow side) ──
  // Enrollment via the SHARED derived set — never the shape of the id string.
  const enrolled = enrolledSourceIds(identities);
  const unmanagedByIp = new Map<string, RosterHostRef>();

  for (const flow of flows) {
    const ingressIp = flow.ingressIp?.trim() || '';
    if (!ingressIp) {
      throw new Error(`Flow ${flow.id}: missing ingressIp (cannot key an observed host).`);
    }

    const managed = flow.dialingIdentityId !== null && enrolled.has(flow.dialingIdentityId);
    if (managed) continue;

    // Dedupe by ingress host: many flows, one host node.
    if (unmanagedByIp.has(ingressIp)) continue;

    const display =
      flow.dialingIdentityId === null ? flow.ingressEntityName?.trim() || ingressIp : ingressIp;

    unmanagedByIp.set(ingressIp, Object.freeze({ ingressIp, display }));
  }

  const unmanagedMembers = [...unmanagedByIp.values()];

  // ── assemble (frozen: this is a projection, not a working set) ──
  const tagPlacements = tagNodes.reduce((sum, n) => sum + n.memberCount, 0);

  return Object.freeze({
    tagNodes: Object.freeze(tagNodes),
    catchAll: Object.freeze({
      noTag: Object.freeze({
        kind: 'no-tag' as const,
        members: Object.freeze(noTag),
        memberCount: noTag.length,
      }),
      unmanaged: Object.freeze({
        kind: 'unmanaged' as const,
        members: Object.freeze(unmanagedMembers),
        memberCount: unmanagedMembers.length,
      }),
    }),
    totals: Object.freeze({
      identityCount: identities.length,
      tagNodeCount: tagNodes.length,
      tagPlacements,
      taggedIdentityCount: taggedIds.size,
      noTagCount: noTag.length,
      unmanagedCount: unmanagedMembers.length,
    }),
  });
}
