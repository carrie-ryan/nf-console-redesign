/**
 * Per-identity TRAFFIC rollup — the destination-side projection of one identity's
 * observed flows.
 *
 * Extracted verbatim from `RawTrafficComponent.destinationRows()`, which remains
 * its only caller today; the point of the extraction is that the projection is
 * now callable without a component instance, a signal read, or an `IdentityGroup`
 * wrapper. Pure in the same sense as `observed-sankey.adapter.ts` and
 * `grouped-roster.adapter.ts`: flows in, rows out, no Angular, no service
 * reach-in, no geometry, no enrollment determination (that stays with the shared
 * `enrolledSourceIds` helper at the call site, where the identity — not its
 * destinations — is the subject).
 *
 * SCOPE — this rolls up the flows it is HANDED. It does not select them: the
 * caller decides what "one identity's flows" means. `RawTrafficComponent` keys
 * its groups by `dialingIdentityId ?? ingressIp`, so an unenrolled source (whose
 * `dialingIdentityId` is null) is grouped by its address; that grouping rule is
 * deliberately left at the call site rather than baked in here.
 */

import type { DiscoveredFlow, ObservedSource } from './discovery.models';
import type { SelectedDestination } from './construct-policy-modal.component';

/**
 * One destination sub-row under an expanded identity — the destination-side
 * detail carried by the raw flows, aggregated per distinct `destinationHostPort`.
 */
export interface IdentityDestinationRow {
  hostPort: string;
  egressEntityName: string;
  /** App-level protocol (HTTPS/RDP/SSH/…), uppercased for display. */
  appProtocol: string;
  /** Host-side (egress) IP — unanimous per destination in the data. */
  egressIp: string;
  egressPort: number;
  circuits: number;
}

/**
 * Roll one identity's flows up to one row per distinct destination, circuits
 * summed, highest volume first.
 *
 * Two behaviours preserved EXACTLY from the component method this replaces,
 * because the Raw Traffic table renders them today:
 *
 *   • FIRST FLOW WINS for the egress-side columns (`egressEntityName`,
 *     `appProtocol`, `egressIp`, `egressPort`). Only `circuits` accumulates.
 *     These are unanimous per destination in the current fixtures, so the rule is
 *     unobservable there — but it is the rule, and a fixture that disagreed would
 *     show its first-seen flow's values, not a conflict marker.
 *   • APP PROTOCOL is READ, not derived: `appProtocol ?? protocol ?? ''`, then
 *     uppercased. `DiscoveredFlow.appProtocol` is the observed L7 protocol baked
 *     into the capture (`DEST_APP_PROTOCOL`, keyed by the whole `host:port`);
 *     nothing here infers a protocol from the port number. When BOTH the L7 and
 *     the transport protocol are absent the cell stays empty — unknown is
 *     rendered as unknown, never guessed.
 *
 * Ties in `circuits` keep first-seen order (Array.prototype.sort is stable), so
 * the row order is deterministic for a given flow order.
 */
export function rollUpIdentityDestinations(
  flows: readonly DiscoveredFlow[],
): IdentityDestinationRow[] {
  const byDest = new Map<string, IdentityDestinationRow>();
  for (const f of flows) {
    let r = byDest.get(f.destinationHostPort);
    if (!r) {
      r = {
        hostPort: f.destinationHostPort,
        egressEntityName: f.egressEntityName,
        appProtocol: (f.appProtocol ?? f.protocol ?? '').toUpperCase(),
        egressIp: f.egressIp,
        egressPort: f.egressPort,
        circuits: 0,
      };
      byDest.set(f.destinationHostPort, r);
    }
    r.circuits += f.circuitCount;
  }
  return [...byDest.values()].sort((a, b) => b.circuits - a.circuits);
}

/** The transport protocol a `SelectedDestination` carries — restated from the
 *  modal's own field rather than re-declared, so widening it there widens it here. */
type TransportProtocol = NonNullable<SelectedDestination['protocol']>;

/**
 * Shape ONE identity's flows into the per-destination seed the construct-policy
 * modal takes — the identity-side entry to the same carve-out Raw Traffic and the
 * flow-detail drawer already perform.
 *
 * THE TRANSPOSE. The three callers differ only in which axis is held fixed:
 *
 *   • flow-detail  — one destination, every dialer of it  → 1 card, N sources.
 *   • raw-traffic  — the (identity → destination) pairings the user ticked, and
 *     pointedly NOT every dialer of those destinations    → N cards, M sources.
 *   • here         — one identity, every destination it dialed → N cards, 1 source.
 *
 * So this is raw-traffic's selection with every pair for a single identity ticked.
 * `SelectedDestination[]` was always plural; flow-detail just passes one element.
 *
 * GRANT SCOPE — the seed carries the `@`-ref for this identity ALONE, never its
 * `#role` attributes. The seed asserts only what was OBSERVED; the modal's grant
 * list already merges `@`-refs with `#`-roles drawn from a live `rolePool`, so
 * broadening to a role is one click there and is the user's deliberate act rather
 * than an inference we made on their behalf.
 *
 * Every source is `{kind: 'identity'}` — this is called with a roster-resolved
 * `Identity`, so it is enrolled by construction and the `{kind: 'address'}` arm is
 * unreachable from this path. (Both other callers must classify per flow, because
 * they group by destination and can catch an unenrolled dialer.)
 *
 * Card ORDER is the rollup's order — circuits descending — because the cards are
 * built by mapping over `rollUpIdentityDestinations` rather than by re-sorting.
 * The modal therefore lists destinations exactly as the drawer's Traffic tab does.
 *
 * `protocol` is the TRANSPORT protocol (tcp/udp/http/https) and is taken from the
 * raw flows, unanimous-or-null, matching both other callers. It deliberately does
 * NOT come from `IdentityDestinationRow.appProtocol`, which is the uppercased L7
 * protocol ('HTTPS', 'MODBUS') and would not satisfy the field's union.
 */
export function buildIdentityPolicySeed(
  identity: { id: string; name: string },
  flows: readonly DiscoveredFlow[],
): SelectedDestination[] {
  const protocolsByDest = new Map<string, Set<TransportProtocol>>();
  for (const f of flows) {
    let seen = protocolsByDest.get(f.destinationHostPort);
    if (!seen) {
      seen = new Set<TransportProtocol>();
      protocolsByDest.set(f.destinationHostPort, seen);
    }
    if (f.protocol) seen.add(f.protocol);
  }

  return rollUpIdentityDestinations(flows).map((row) => {
    const seen = protocolsByDest.get(row.hostPort);
    // A fresh source object per card: the modal seeds mutable card state from it,
    // so cards must not alias one another.
    const source: ObservedSource = { kind: 'identity', id: identity.id, name: identity.name };
    return {
      hostPort: row.hostPort,
      protocol: seen?.size === 1 ? [...seen][0] : null,
      identities: [source],
    };
  });
}
