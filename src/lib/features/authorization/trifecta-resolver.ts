/**
 * Ziti TRIFECTA resolver — pure, headless, static. No Angular, no signals, no UI.
 *
 * For one (identity, service) pair, resolves all three legs of Ziti authorization:
 *   1. service policies         — may the identity Dial (and, separately, Bind) it?
 *   2. edge router policies     — ER(identity): routers the identity may use
 *   3. service edge router pols — ER(service):  routers the service is reachable on
 * and folds them into a Dial-side TrifectaStatus (`status`) and, by the same function
 * on the bind track, a Bind-side one (`bindStatus`).
 *
 * Role matching is NOT reimplemented: every relation goes through the existing
 * entityMatchesRoles from authorization-resolver.ts, under that policy's own
 * semantic — via the world's index (world-index.ts), which memoises those matches. Besides the four entity sides (service-policy identity + service,
 * ERP identity, SERP service), ERP / SERP edgeRouterRoles are matched against
 * routers with the same primitive.
 *
 * Config-derived only, with ONE exception: EdgeRouter.isOnline is read solely to
 * split BLOCKED_ROUTERS_OFFLINE from AUTHORIZED_REACHABLE. No entity status,
 * posture, or terminator is consulted — those states are deferred.
 */

import { indexFor } from './world-index';
import type {
  EdgeRouter,
  EdgeRouterPolicy,
  Identity,
  Policy,
  Service,
  ServiceEdgeRouterPolicy,
  AccessTest,
  PostureCheck,
  PostureResult,
  Terminator,
} from '../../shared/services/mock-data.service';

export interface TrifectaWorld {
  identities: readonly Identity[];
  services: readonly Service[];
  edgeRouters: readonly EdgeRouter[];
  /** Service policies, Dial and Bind. */
  policies: readonly Policy[];
  edgeRouterPolicies: readonly EdgeRouterPolicy[];
  serviceEdgeRouterPolicies: readonly ServiceEdgeRouterPolicy[];
  /** Runtime hosting state — read only by policy-builder/hosting.ts, never by resolve(). */
  terminators?: readonly Terminator[];
  /** Posture checks and each identity's results — read only by policy-builder/posture.ts. */
  postureChecks?: readonly PostureCheck[];
  postureResults?: readonly PostureResult[];
  /** Access tests — read only by policy-builder/access-tests.ts. */
  accessTests?: readonly AccessTest[];
}

/** Dial-side terminal state, precedence-ordered. */
export type TrifectaStatus =
  | 'NOT_AUTHORIZED'
  | 'AUTHORIZED_NO_ROUTER'
  | 'BLOCKED_ROUTERS_OFFLINE'
  | 'AUTHORIZED_REACHABLE';

export interface PolicyGrant {
  authorized: boolean;
  /** Ids of the service policies (of this type) matching BOTH sides. */
  viaPolicies: string[];
}

export interface ResolvedPair {
  identityId: string;
  serviceId: string;
  dial: PolicyGrant;
  /** Tracked SEPARATELY — never folded into dial or status. */
  bind: PolicyGrant;
  routers: {
    /** ER(identity) via edge router policies. */
    identityRouters: string[];
    /** ER(service) via service edge router policies. */
    serviceRouters: string[];
    /** Exact intersection of the two — static, ignores isOnline. */
    common: string[];
  };
  status: TrifectaStatus;
  /** Bind-side status: trifectaStatus on the bind track (same common routers, same
   *  isOnline rule). Independent of `status`, which stays Dial-only. */
  bindStatus: TrifectaStatus;
}

// ─── status ───────────────────────────────────────────────────────────────────

/**
 * Pure, precedence-ordered status for one track (Dial or Bind — pass that track's
 * grant). `isOnline` is the only runtime input,
 * and only distinguishes the last two states.
 */
export function trifectaStatus(
  dial: PolicyGrant,
  common: readonly string[],
  isOnline: (routerId: string) => boolean,
): TrifectaStatus {
  if (!dial.authorized) return 'NOT_AUTHORIZED';
  if (common.length === 0) return 'AUTHORIZED_NO_ROUTER';
  return common.some(isOnline) ? 'AUTHORIZED_REACHABLE' : 'BLOCKED_ROUTERS_OFFLINE';
}

// ─── core primitive ───────────────────────────────────────────────────────────

export function resolve(identityId: string, serviceId: string, world: TrifectaWorld): ResolvedPair {
  // Lookups and role matches come from the world's index; the result is memoised
  // per pair (worlds are immutable snapshots, and no caller mutates a pair).
  const ix = indexFor(world);
  const key = `${identityId}\u0000${serviceId}`;
  const memo = ix.pairs.get(key);
  if (memo) return memo;

  const identity = ix.identity(identityId);
  if (!identity) throw new Error(`trifecta resolve: unknown identity '${identityId}'`);
  const service = ix.service(serviceId);
  if (!service) throw new Error(`trifecta resolve: unknown service '${serviceId}'`);

  // Leg 1: the service's own policies, of each type, whose identity side selects it.
  const forService = ix.policiesForService(serviceId);
  const grantOf = (type: Policy['type']): PolicyGrant => {
    const viaPolicies = forService
      .filter((p) => p.type === type && ix.identityIdsMatching(p.identityRoles, p.semantic).has(identityId))
      .map((p) => p.id);
    return { authorized: viaPolicies.length > 0, viaPolicies };
  };
  const dial = grantOf('dial');
  const bind = grantOf('bind');

  // Legs 2 + 3: router sets (fresh arrays — the index keeps its own).
  const identityRouters = [...ix.identityRouters(identityId)];
  const serviceRouters = [...ix.serviceRouters(serviceId)];
  const serviceSet = new Set(serviceRouters);
  const common = identityRouters.filter((id) => serviceSet.has(id));

  const isOnline = (id: string) => ix.isOnline(id);
  const status = trifectaStatus(dial, common, isOnline);
  const bindStatus = trifectaStatus(bind, common, isOnline);

  const pair: ResolvedPair = {
    identityId,
    serviceId,
    dial,
    bind,
    routers: { identityRouters, serviceRouters, common },
    status,
    bindStatus,
  };
  ix.pairs.set(key, pair);
  return pair;
}

// ─── thin wrappers ────────────────────────────────────────────────────────────

/** One identity against every service, in world.services order. */
export function enumerateForIdentity(identityId: string, world: TrifectaWorld): ResolvedPair[] {
  return world.services.map((s) => resolve(identityId, s.id, world));
}

/** Every identity against one service, in world.identities order. */
export function enumerateForService(serviceId: string, world: TrifectaWorld): ResolvedPair[] {
  return world.identities.map((i) => resolve(i.id, serviceId, world));
}
