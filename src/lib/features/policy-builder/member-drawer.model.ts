/**
 * MEMBER DRAWER — every member of ONE group, with its status on each service on the
 * canvas the group reaches. Pure and headless; the drawer component filters and
 * virtualises the rows.
 *
 * A member's status on a service, on the group's lane (Dial: status, Bind:
 * bindStatus), the first that applies:
 *   no shared router / routers offline / not authorized — from resolve();
 *   blocked by posture — an online route, but its posture on that lane fails;
 *   serving / standby — Bind only: a serving host, active or below the top precedence;
 *   reachable — an online route, nothing else to say.
 * These are the canvas's own buckets (group status, posture counts, host markers).
 */

import { resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import { indexFor } from '../authorization/world-index';
import { hostingFor } from './hosting';
import { postureFor } from './posture';
import { describeGroup, layoutServiceView, type Group, type Lane } from './service-view.layout';

export type MemberStatus = 'serving' | 'standby' | 'blocked' | 'noSharedRouter' | 'routersOffline' | 'reachable' | 'notAuthorized';

/** The statuses the drawer filters by, in chip order. */
export const MEMBER_FILTERS = ['serving', 'standby', 'blocked', 'noSharedRouter', 'routersOffline'] as const;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];

export const STATUS_TEXT: Record<MemberStatus, string> = {
  serving: 'serving',
  standby: 'standby',
  blocked: 'blocked by posture',
  noSharedRouter: 'no shared router',
  routersOffline: 'routers offline',
  reachable: 'reachable',
  notAuthorized: 'not authorized',
};

export interface MemberRow {
  id: string;
  name: string;
  attributes: readonly string[];
  /** A router identity: shown with the router icon. */
  router: boolean;
  /** One per drawer service, in `services` order. */
  statuses: MemberStatus[];
  /** Lower-case name and attributes — what the search box matches. */
  hay: string;
}

export interface MemberDrawer {
  /** null: every identity (the tagging list), not one group's members. */
  group: Group | null;
  /** "any identity with #team-03". */
  summary: string;
  /** The canvas services the group reaches, in canvas order. */
  services: { id: string; name: string }[];
  rows: MemberRow[];
}

export function memberDrawer(world: TrifectaWorld, groupId: string, canvasIds: readonly string[]): MemberDrawer | null {
  const views = canvasIds.map((id) => layoutServiceView(id, world));
  const on = views
    .map((v) => ({ v, g: [...v.bind.groups, ...v.dial.groups].find((x) => x.id === groupId) }))
    .filter((x): x is { v: (typeof views)[number]; g: Group } => !!x.g);
  if (!on.length) return null;
  const group = on[0].g;
  const lane: Lane = group.lane;
  const ix = indexFor(world);

  const hosting = new Map(
    lane === 'bind'
      ? on.map(({ v }) => {
          const h = hostingFor(v.service.id, world);
          const active = new Set(h.activeHostIds);
          const serving = new Set(h.servingHosts.map((s) => s.identityId));
          return [v.service.id, { active, serving }] as const;
        })
      : [],
  );

  const statusOf = (identityId: string, serviceId: string): MemberStatus => {
    const pair = resolve(identityId, serviceId, world);
    const route = lane === 'dial' ? pair.status : pair.bindStatus;
    if (route === 'AUTHORIZED_NO_ROUTER') return 'noSharedRouter';
    if (route === 'BLOCKED_ROUTERS_OFFLINE') return 'routersOffline';
    if (route !== 'AUTHORIZED_REACHABLE') return 'notAuthorized';
    if (!postureFor(identityId, serviceId, lane, world).satisfied) return 'blocked';
    const h = hosting.get(serviceId);
    if (h?.active.has(identityId)) return 'serving';
    if (h?.serving.has(identityId)) return 'standby';
    return 'reachable';
  };

  const services = on.map(({ v }) => ({ id: v.service.id, name: v.service.name }));
  const rows = group.memberIds.map((id, i): MemberRow => {
    const identity = ix.identity(id);
    const attributes = identity?.attributes ?? [];
    const name = group.memberNames[i];
    return {
      id,
      name,
      attributes,
      router: !!identity?.routerId,
      statuses: services.map((s) => statusOf(id, s.id)),
      hay: [name, ...attributes].join('\n').toLowerCase(),
    };
  });
  return { group, summary: describeGroup(group), services, rows };
}

/** Every identity, for tagging: no group, no services, no statuses. */
export function allIdentitiesDrawer(world: TrifectaWorld): MemberDrawer {
  const rows = world.identities.map(
    (i): MemberRow => ({
      id: i.id,
      name: i.name,
      attributes: i.attributes ?? [],
      router: !!i.routerId,
      statuses: [],
      hay: [i.name, ...(i.attributes ?? [])].join('\n').toLowerCase(),
    }),
  );
  return { group: null, summary: 'All identities', services: [], rows };
}

/** Rows matching the search (name or attribute, any case) and, with chips on, any of
 *  the chosen statuses on any service. */
export function filterMembers(rows: readonly MemberRow[], query: string, chips: ReadonlySet<MemberFilter>): MemberRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) => (!q || r.hay.includes(q)) && (!chips.size || r.statuses.some((s) => chips.has(s as MemberFilter))),
  );
}

/** Per chip: how many of `rows` have that status on some service. */
export function filterCounts(rows: readonly MemberRow[]): Record<MemberFilter, number> {
  const out = Object.fromEntries(MEMBER_FILTERS.map((f) => [f, 0])) as Record<MemberFilter, number>;
  for (const r of rows) for (const f of MEMBER_FILTERS) if (r.statuses.includes(f)) out[f]++;
  return out;
}
