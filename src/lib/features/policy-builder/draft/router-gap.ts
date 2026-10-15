/**
 * ROUTER GAP — why some of a group's members have no online route to a service,
 * and draft ops that would give them one. Pure; reads the (draft) world it's given.
 *
 * A gap is one group's members in ONE bucket of its lane's track:
 *   noSharedRouter  — AUTHORIZED_NO_ROUTER: their routers and the service's don't meet.
 *   routersOffline  — BLOCKED_ROUTERS_OFFLINE: they meet, but only on offline routers.
 *
 * Fixes (draft ops; gapFixPreview maps a fix's diff to its preview — the panel runs
 * that diff lazily, so routerGap itself never diffs):
 *   a. ERP — the group's own identity rule (terms + semantic; named members as
 *      @refs) → the service's ONLINE eligible routers.
 *   b. SERP — @<service> → the members' ONLINE routers.
 *   c. Both (TWO ops) — offered only when neither side has any router at all, so
 *      (a) and (b) have nothing to point at: an ERP for the group's rule and a SERP
 *      for @<service>, both → every online router.
 * Router roles are one shared attribute when one exists that matches nothing
 * outside the intended set (the service's eligible routers for (a), the members'
 * routers for (b), the online routers for (c)); otherwise @refs. Either way the router side is one term or
 * @refs only, so the ERP's copied semantic can't narrow it. For routersOffline
 * both are workarounds: the policies are fine, a router is down.
 *
 * EXTEND before CREATE. If an existing policy already reaches exactly the router
 * set those roles would, the fix is an update to it instead, and the create form
 * becomes its `alternative`:
 *   (b) any SERP not yet matching the service: add @<service> to its serviceRoles.
 *       @refs are unioned whatever the semantic, so no other service's routers move.
 *       Preferred: @refs-only service side (a list, which one more @ref fits), then
 *       fewest services, then world order.
 *   (a) an AnyOf ERP only: add the group's roles to its identityRoles. Never an
 *       AllOf ERP — added attributes would be ANDed with its own and narrow it —
 *       and never an all-of rule of 2+ terms, which an AnyOf ERP would OR apart.
 *
 * Matching goes through entityMatchesRoles, statuses through resolve(), counts
 * through layoutServiceView() and a draft diff — nothing re-derived here.
 */

import type { EdgeRouter, Identity, Policy } from '../../../shared/services/mock-data.service';
import { entityMatchesRoles } from '../../authorization/authorization-resolver';
import { resolve, type TrifectaStatus, type TrifectaWorld } from '../../authorization/trifecta-resolver';
import { layoutServiceView, type Group, type RouterGapKind } from '../service-view.layout';
import type { DraftDiff } from './draft-diff';
import { indexFor } from '../../authorization/world-index';
import { describeOps, noHostNote, trackCount } from './draft-summary';
import type { DraftOp } from './policy-draft';

export interface RouterRef {
  id: string;
  name: string;
  isOnline: boolean;
  /** Names of the ERPs (identity side) or SERPs (service side) granting it. */
  via: string[];
  /** Their ids, in `via` order — to open one in the editor. */
  viaIds: string[];
  /** In `via` order: a system policy (created by Ziti, read-only). */
  viaSystem: boolean[];
}

/** Gap members that share one identity router set. */
export interface GapRow {
  memberIds: string[];
  memberNames: string[];
  routers: RouterRef[];
}

export interface FixPreview {
  /** Gap members with an online route once the fix is applied … */
  gained: number;
  /** … out of this many. */
  of: number;
  /** Everyone on this lane's track who gains an online route to the service. */
  totalGained: number;
  canConnectBefore: number;
  canConnectAfter: number;
  /** Other services whose pairs or verdicts the fix also changes. */
  otherServices: number;
  /** "Online route for 16 of 16 in this group · 18 dialers in total · still no host,
   *  so no one can connect" — worded like the review panel's route line. */
  text: string;
}

export interface GapFix {
  /** erp = (a), serp = (b), both = (c). */
  kind: 'erp' | 'serp' | 'both';
  /** extend = update an existing policy; create = a new one. */
  form: 'extend' | 'create';
  /** What the fix achieves: "Route the service through a router these identities have". */
  purpose: string;
  /** What it does: "Add no-serp-svc to git-repo-public-routers" / "Create a new … policy". */
  title: string;
  /** Routers offline: a fix works around an outage rather than closing a gap. */
  workaround: boolean;
  /** One op for (a) / (b); an ERP then a SERP for (c). Applied together. */
  ops: DraftOp[];
  /** The ops as the review panel would describe them. */
  lines: string[];
  /** On an extend fix: the create form, offered behind "Create a new policy instead". */
  alternative: GapFix | null;
}

export interface RouterGap {
  kind: RouterGapKind;
  serviceId: string;
  serviceName: string;
  groupId: string;
  policyId: string;
  policyName: string;
  lane: Group['lane'];
  memberIds: string[];
  rows: GapRow[];
  /** The service's eligible routers (via SERPs). */
  serviceRouters: RouterRef[];
  /** routersOffline: "Router <name> is offline; this is an outage, not a policy gap." */
  offlineNotes: string[];
  fixes: GapFix[];
  /** Why a fix isn't offered, in plain language. */
  unavailable: string[];
}

const GAP_STATUS: Record<RouterGapKind, TrifectaStatus> = {
  noSharedRouter: 'AUTHORIZED_NO_ROUTER',
  routersOffline: 'BLOCKED_ROUTERS_OFFLINE',
};

type Matchable = { id: string; name: string; attributes?: readonly string[] };
const matches = (roles: readonly string[], semantic: Policy['semantic'], e: Matchable) =>
  entityMatchesRoles(roles, semantic, e.attributes ?? [], e.name, e.id);

/** Routers granted to `entity` by the policies whose entity side matches it, with
 *  the granting policies' names. In world.edgeRouters order. */
export function routersFor<
  P extends { id: string; name: string; semantic: Policy['semantic']; edgeRouterRoles: string[]; isSystem?: boolean },
>(
  entity: Matchable,
  policies: readonly P[],
  entityRoles: (p: P) => readonly string[],
  edgeRouters: readonly EdgeRouter[],
): RouterRef[] {
  const granting = policies.filter((p) => matches(entityRoles(p), p.semantic, entity));
  return edgeRouters
    .map((r) => {
      const via = granting.filter((p) => matches(p.edgeRouterRoles, p.semantic, r));
      return {
        id: r.id,
        name: r.name,
        isOnline: r.isOnline,
        via: via.map((p) => p.name),
        viaIds: via.map((p) => p.id),
        viaSystem: via.map((p) => !!p.isSystem),
      };
    })
    .filter((r) => r.via.length > 0);
}

/**
 * Roles naming `targets`: the attribute every target has whose routers all lie in
 * `allowed` (fewest routers first, then alphabetical) — otherwise @refs.
 */
export function routerRoles(targets: readonly EdgeRouter[], allowed: ReadonlySet<string>, all: readonly EdgeRouter[]): string[] {
  const shared = targets[0].attributes.filter((a) => targets.every((t) => t.attributes.includes(a)));
  const reach = (a: string) => all.filter((r) => r.attributes.includes(a));
  const fits = shared
    .filter((a) => reach(a).every((r) => allowed.has(r.id)))
    .sort((a, b) => reach(a).length - reach(b).length || a.localeCompare(b));
  return fits.length ? [fits[0]] : targets.map((t) => `@${t.id}`);
}

export function freshId(prefix: string, taken: readonly { id: string }[]): string {
  const ids = new Set(taken.map((x) => x.id));
  let n = 1;
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const slug = (roles: readonly string[]) => roles.map((r) => r.replace(/^[#@]/, '')).join('-');

/** Suggested names for a created fix: "kiosks-public-routers", "no-serp-svc-routing". */
const erpName = (identityRoles: readonly string[], edgeRouterRoles: readonly string[]) =>
  `${slug(identityRoles)}-${slug(edgeRouterRoles)}-routers`;
const serpName = (service: { name: string }) => `${service.name}-routing`;

function findGroup(world: TrifectaWorld, serviceId: string, groupId: string): Group | undefined {
  const layout = layoutServiceView(serviceId, world);
  return [...layout.bind.groups, ...layout.dial.groups].find((g) => g.id === groupId);
}

const trackStatus = (lane: Group['lane']) => (identityId: string, serviceId: string, world: TrifectaWorld) => {
  const pair = resolve(identityId, serviceId, world);
  return lane === 'dial' ? pair.status : pair.bindStatus;
};

/**
 * A fix's preview, from its diff against `world` (`after` = world with its ops):
 * how many gap members gain an online route, how many on the track in all, the
 * service's can-connect before → after, and how many other services it touches.
 */
export function gapFixPreview(world: TrifectaWorld, gap: Pick<RouterGap, 'serviceId' | 'serviceName' | 'memberIds' | 'lane'>, after: TrifectaWorld, diff: DraftDiff): FixPreview {
  const service = { id: gap.serviceId, name: gap.serviceName };
  const { memberIds, lane } = gap;
  const status = trackStatus(lane);
  const [vBefore, vAfter] = [layoutServiceView(service.id, world), layoutServiceView(service.id, after)].map(
    (l) => l.serviceVerdict,
  );
  const gained = memberIds.filter((id) => status(id, service.id, after) === 'AUTHORIZED_REACHABLE').length;
  const totalGained = diff.pairChanges.filter(
    (c) => c.serviceId === service.id && c.track === lane && c.after === 'AUTHORIZED_REACHABLE' && c.before !== c.after,
  ).length;
  const otherServices = diff.affectedServiceIds.filter((id) => id !== service.id).length;

  const parts = [`Online route for ${gained} of ${memberIds.length} in this group`, `${trackCount(totalGained, lane)} in total`];
  if (vAfter.canConnect !== vBefore.canConnect) {
    parts.push(`${service.name}: ${vBefore.canConnect} → ${vAfter.canConnect} can connect`);
  } else if (lane === 'dial' && gained) {
    const note = noHostNote(vBefore, vAfter);
    if (note) parts.push(note);
  }
  if (otherServices) parts.push(`also affects ${otherServices} other ${otherServices === 1 ? 'service' : 'services'}`);

  return {
    gained,
    of: memberIds.length,
    totalGained,
    canConnectBefore: vBefore.canConnect,
    canConnectAfter: vAfter.canConnect,
    otherServices,
    text: parts.join(' · '),
  };
}

/** The ERP's identity side: the group's own rule, or its named members as @refs. */
function groupIdentityRoles(g: Group, policy: Policy): { roles: string[]; semantic: Policy['semantic'] } {
  if (g.kind === 'rule') return { roles: [...g.rule!.terms], semantic: g.rule!.semantic };
  return { roles: g.named!.map((n) => `@${n.name}`), semantic: policy.semantic };
}

export function routerGap(world: TrifectaWorld, serviceId: string, groupId: string, kind: RouterGapKind): RouterGap | null {
  const ix = indexFor(world);
  const service = ix.service(serviceId);
  const group = findGroup(world, serviceId, groupId);
  if (!service || !group) return null;
  const policy = ix.policy(group.policyId)!;

  const status = trackStatus(group.lane);
  const memberIds = group.memberIds.filter((id) => status(id, serviceId, world) === GAP_STATUS[kind]);
  const identities = memberIds.map((id) => ix.identity(id)!) as Identity[];

  // Each member's routers, once (the fixes below ask again per router).
  const routersOf = new Map<string, RouterRef[]>();
  const identityRouters = (i: Identity) => {
    let r = routersOf.get(i.id);
    if (!r) routersOf.set(i.id, (r = routersFor(i, world.edgeRouterPolicies, (p) => p.identityRoles, world.edgeRouters)));
    return r;
  };
  const serviceRouters = routersFor(service, world.serviceEdgeRouterPolicies, (p) => p.serviceRoles, world.edgeRouters);

  // Rows: members grouped by the exact set of routers they have.
  const rows = new Map<string, GapRow>();
  for (const i of identities) {
    const routers = identityRouters(i);
    const key = routers.map((r) => r.id).join(',');
    const row = rows.get(key) ?? { memberIds: [], memberNames: [], routers };
    row.memberIds.push(i.id);
    row.memberNames.push(i.name);
    rows.set(key, row);
  }

  const offlineNotes =
    kind === 'routersOffline'
      ? [...new Set(memberIds.flatMap((id) => resolve(id, serviceId, world).routers.common))]
          .map((id) => ix.router(id)!)
          .filter((r) => !r.isOnline)
          .map((r) => `Router ${r.name} is offline; this is an outage, not a policy gap.`)
      : [];

  const workaround = kind === 'routersOffline';
  const fixes: GapFix[] = [];
  const unavailable: string[] = [];
  const who = group.lane === 'dial' ? 'identities' : 'hosts';
  type FixCore = Omit<GapFix, 'lines' | 'alternative'>;
  const make = (fix: FixCore, alternative: GapFix | null = null): GapFix => ({
    ...fix,
    lines: describeOps(world, fix.ops),
    alternative,
  });
  /** The extend form first, with the create form behind it; or just the create form. */
  const offer = (create: GapFix, extend: FixCore | null) =>
    fixes.push(extend ? make(extend, create) : create);

  const routerSet = (roles: readonly string[], semantic: Policy['semantic']) =>
    world.edgeRouters.filter((r) => matches(roles, semantic, r)).map((r) => r.id);
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

  const noRoutersAnywhere =
    kind === 'noSharedRouter' && serviceRouters.length === 0 && identities.every((i) => identityRouters(i).length === 0);

  if (memberIds.length && noRoutersAnywhere) {
    // (c) Neither side has a router: give both the online routers.
    const online = world.edgeRouters.filter((r) => r.isOnline);
    if (online.length) {
      const { roles, semantic } = groupIdentityRoles(group, policy);
      const edgeRouterRoles = routerRoles(online, new Set(online.map((r) => r.id)), world.edgeRouters);
      fixes.push(
        make({
          kind: 'both',
          form: 'create',
          purpose: `Set up routing for both: give these ${who} and ${service.name} the same online routers`,
          title: 'Create an edge router policy and a service edge router policy',
          workaround,
          ops: [
            {
              kind: 'create',
              target: 'edgeRouterPolicy',
              policy: {
                id: freshId('rp-draft-', world.edgeRouterPolicies),
                name: erpName(roles, edgeRouterRoles),
                createdAt: new Date().toISOString(),
                status: 'active',
                semantic,
                identityRoles: roles,
                edgeRouterRoles,
              },
            },
            {
              kind: 'create',
              target: 'serviceEdgeRouterPolicy',
              policy: {
                id: freshId('serp-draft-', world.serviceEdgeRouterPolicies),
                name: serpName(service),
                semantic: 'AllOf',
                serviceRoles: [`@${service.id}`],
                edgeRouterRoles: [...edgeRouterRoles],
              },
            },
          ],
        }),
      );
    } else {
      unavailable.push('No router is online, so there is none to set up routing through.');
    }
  } else if (memberIds.length) {
    // (a) ERP: the group's rule → the service's online routers.
    const purposeA = workaround
      ? `Give these ${who} a different, online router the service uses`
      : `Give these ${who} a router the service uses`;
    const eligible = world.edgeRouters.filter((r) => serviceRouters.some((s) => s.id === r.id));
    const svcOnline = eligible.filter((r) => r.isOnline);
    if (svcOnline.length) {
      const { roles, semantic } = groupIdentityRoles(group, policy);
      const edgeRouterRoles = routerRoles(svcOnline, new Set(eligible.map((r) => r.id)), world.edgeRouters);
      const create = make({
        kind: 'erp',
        form: 'create',
        purpose: purposeA,
        title: 'Create a new edge router policy',
        workaround,
        ops: [{
          kind: 'create',
          target: 'edgeRouterPolicy',
          policy: {
            id: freshId('rp-draft-', world.edgeRouterPolicies),
            name: erpName(roles, edgeRouterRoles),
            createdAt: new Date().toISOString(),
            status: 'active',
            semantic,
            identityRoles: roles,
            edgeRouterRoles,
          },
        }],
      });

      // OR-ing the roles into an AnyOf ERP keeps their meaning only for @refs, one
      // term, or an any-of rule.
      const terms = roles.filter((r) => r.startsWith('#'));
      const orSafe = terms.length <= 1 || semantic === 'AnyOf';
      const target = routerSet(edgeRouterRoles, semantic);
      const erp = orSafe
        ? world.edgeRouterPolicies.find(
            // A system ERP (a router identity's own) is Ziti's: never extended.
            (p) => !p.isSystem && p.semantic === 'AnyOf' && sameSet(routerSet(p.edgeRouterRoles, p.semantic), target),
          )
        : undefined;
      offer(
        create,
        erp
          ? {
              kind: 'erp',
              form: 'extend',
              purpose: purposeA,
              title: `Add ${roles.join(', ')} to ${erp.name}`,
              workaround,
              ops: [{
                kind: 'update',
                target: 'edgeRouterPolicy',
                policyId: erp.id,
                patch: { identityRoles: [...erp.identityRoles, ...roles.filter((r) => !erp.identityRoles.includes(r))] },
              }],
            }
          : null,
      );
    } else {
      unavailable.push(`${service.name} has no online router to give them.`);
    }

    // (b) SERP: @service → the members' online routers.
    const purposeB = `Route the service through a router these ${who} have`;
    const theirIds = new Set(identities.flatMap((i) => identityRouters(i).map((x) => x.id)));
    const theirs = world.edgeRouters.filter((r) => theirIds.has(r.id));
    const theirsOnline = theirs.filter((r) => r.isOnline);
    if (theirsOnline.length) {
      const edgeRouterRoles = routerRoles(theirsOnline, new Set(theirs.map((r) => r.id)), world.edgeRouters);
      const create = make({
        kind: 'serp',
        form: 'create',
        purpose: purposeB,
        title: 'Create a new service edge router policy',
        workaround,
        ops: [{
          kind: 'create',
          target: 'serviceEdgeRouterPolicy',
          policy: {
            id: freshId('serp-draft-', world.serviceEdgeRouterPolicies),
            name: serpName(service),
            semantic: 'AllOf',
            serviceRoles: [`@${service.id}`],
            edgeRouterRoles,
          },
        }],
      });

      const target = routerSet(edgeRouterRoles, 'AllOf');
      const servicesOf = (p: { serviceRoles: string[]; semantic: Policy['semantic'] }) =>
        world.services.filter((x) => matches(p.serviceRoles, p.semantic, x)).length;
      const refsOnly = (p: { serviceRoles: string[] }) => p.serviceRoles.every((r) => r.startsWith('@'));
      const serp = world.serviceEdgeRouterPolicies
        .filter((p) => !matches(p.serviceRoles, p.semantic, service))
        .filter((p) => sameSet(routerSet(p.edgeRouterRoles, p.semantic), target))
        .map((p, order) => ({ p, order }))
        .sort(
          (a, b) =>
            Number(refsOnly(b.p)) - Number(refsOnly(a.p)) || servicesOf(a.p) - servicesOf(b.p) || a.order - b.order,
        )[0]?.p;
      offer(
        create,
        serp
          ? {
              kind: 'serp',
              form: 'extend',
              purpose: purposeB,
              title: `Add ${service.name} to ${serp.name}`,
              workaround,
              ops: [{
                kind: 'update',
                target: 'serviceEdgeRouterPolicy',
                policyId: serp.id,
                patch: { serviceRoles: [...serp.serviceRoles, `@${service.id}`] },
              }],
            }
          : null,
      );
    } else {
      unavailable.push(`These ${who} have no online router to route ${service.name} through.`);
    }
  }

  return {
    kind,
    serviceId,
    serviceName: service.name,
    groupId,
    policyId: group.policyId,
    policyName: group.policyName,
    lane: group.lane,
    memberIds,
    rows: [...rows.values()],
    serviceRouters,
    offlineNotes,
    fixes,
    unavailable,
  };
}
