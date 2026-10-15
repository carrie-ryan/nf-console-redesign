/**
 * MULTI-SERVICE VIEW layout — pure, headless, deterministic. No Angular, no UI.
 *
 * Up to four services side by side in one service column, sharing their Bind and
 * Dial lanes: a policy that covers several of them is ONE group per (policy, kind)
 * with an edge to each service it covers. Built entirely from layoutServiceView —
 * one call per service — so matching, membership and status are exactly the
 * single-service view's; what varies per service (how it's matched, the members'
 * status) lives on the edge, not the group.
 *
 * Within each lane, a policy's groups are always adjacent (named before rule), and
 * whole POLICIES are ordered by the barycenter of the services their groups connect
 * to (the mean of those services' positions in the column), which keeps edges from
 * crossing where it can; ties keep the single-service order (policy name, then id).
 */

import {
  layoutServiceView,
  type Group,
  type Lane,
  type ServiceMatch,
  type ServiceVerdict,
  type StatusCounts,
} from './service-view.layout';

export const MAX_SERVICES = 4;

export interface MultiService {
  id: string;
  name: string;
  /** The service the view was opened for; first in the column. */
  focused: boolean;
  verdict: ServiceVerdict;
  attributes: string[];
}

/** A group's service-independent fields — the same values on every service it covers. */
export type MultiGroup = Pick<
  Group,
  'id' | 'policyId' | 'policyName' | 'kind' | 'lane' | 'named' | 'rule' | 'memberIds' | 'memberNames' | 'memberCount'
>;

export interface MultiEdge {
  groupId: string;
  serviceId: string;
  /** How the group's policy covers this service (Group.serviceMatch on its view). */
  serviceMatch: ServiceMatch;
  /** The group's members by status on this service (Group.status on its view). */
  statusCounts: StatusCounts;
}

export interface MultiServiceLayout {
  /** Focus first, then the others in the order given. */
  services: MultiService[];
  /** Bind groups, then Dial groups, each lane in `order`. */
  groups: MultiGroup[];
  /** Service order, then group order within it. */
  edges: MultiEdge[];
  /** Group ids per lane, top to bottom. */
  order: Record<Lane, string[]>;
}

export function layoutMultiServiceView(
  focusId: string,
  otherIds: readonly string[],
  world: Parameters<typeof layoutServiceView>[1],
): MultiServiceLayout {
  const ids = [...new Set([focusId, ...otherIds])];
  if (ids.length > MAX_SERVICES) {
    throw new Error(`layoutMultiServiceView: at most ${MAX_SERVICES} services, got ${ids.length}`);
  }
  const views = ids.map((id) => layoutServiceView(id, world));

  const services: MultiService[] = views.map((v) => ({
    id: v.service.id,
    name: v.service.name,
    focused: v.service.id === focusId,
    verdict: v.serviceVerdict,
    attributes: v.service.attributes,
  }));

  // One group per (policy, kind): Group.id is `${lane}:${policyId}:${kind}` on every view.
  const groups = new Map<string, { group: MultiGroup; positions: number[] }>();
  const edges: MultiEdge[] = [];
  views.forEach((v, position) => {
    for (const g of [...v.bind.groups, ...v.dial.groups]) {
      const entry = groups.get(g.id) ?? { group: sharedFields(g), positions: [] };
      entry.positions.push(position);
      groups.set(g.id, entry);
      edges.push({ groupId: g.id, serviceId: v.service.id, serviceMatch: g.serviceMatch, statusCounts: g.status });
    }
  });

  const laneOrder = (lane: Lane): MultiGroup[] => {
    const byPolicy = new Map<string, { groups: MultiGroup[]; positions: number[] }>();
    for (const e of groups.values()) {
      if (e.group.lane !== lane) continue;
      const p = byPolicy.get(e.group.policyId) ?? { groups: [], positions: [] };
      p.groups.push(e.group);
      p.positions.push(...e.positions);
      byPolicy.set(e.group.policyId, p);
    }
    const kind = (g: MultiGroup) => (g.kind === 'named' ? 0 : 1);
    return [...byPolicy.values()]
      .map((p) => ({ ...p, bary: p.positions.reduce((a, b) => a + b, 0) / p.positions.length }))
      .sort((a, b) => a.bary - b.bary || tieBreak(a.groups[0], b.groups[0]))
      .flatMap((p) => p.groups.sort((a, b) => kind(a) - kind(b)));
  };
  const bind = laneOrder('bind');
  const dial = laneOrder('dial');
  const rank = new Map([...bind, ...dial].map((g, i) => [g.id, i]));

  return {
    services,
    groups: [...bind, ...dial],
    edges: edges.sort((a, b) => ids.indexOf(a.serviceId) - ids.indexOf(b.serviceId) || rank.get(a.groupId)! - rank.get(b.groupId)!),
    order: { bind: bind.map((g) => g.id), dial: dial.map((g) => g.id) },
  };
}

function sharedFields(g: Group): MultiGroup {
  const { id, policyId, policyName, kind, lane, named, rule, memberIds, memberNames, memberCount } = g;
  return { id, policyId, policyName, kind, lane, named, rule, memberIds, memberNames, memberCount };
}

/** The single-service policy order: policy name, then id. */
function tieBreak(a: MultiGroup, b: MultiGroup): number {
  return a.policyName.localeCompare(b.policyName) || a.policyId.localeCompare(b.policyId);
}

/** How an edge is drawn: the worst status among the group's members on that service
 *  — no shared router (bad) over routers offline (warn) over all reachable (ok);
 *  'none' when it has no members. */
export type EdgeTone = 'ok' | 'warn' | 'bad' | 'none';

export function edgeTone(s: StatusCounts): EdgeTone {
  if (s.noSharedRouter) return 'bad';
  if (s.routersOffline) return 'warn';
  return s.reachable ? 'ok' : 'none';
}
