/**
 * IDENTITY VIEW — what one identity can reach, and why. Pure; reads the (draft)
 * world it's given.
 *
 * Built from enumerateForIdentity(identityId, world): one ResolvedPair per service.
 *   canConnect  — Dial status AUTHORIZED_REACHABLE, and the service has a reachable
 *                 host (its verdict's hostsReachable > 0).
 *   cantConnect — every other Dial-authorized service, with the reason.
 *   canHost     — every Bind-authorized service, with its bindStatus.
 * Every Dial- or Bind-authorized service lands in exactly the lists its grants put
 * it in; nothing else appears.
 *
 * explainDenied answers "why can't it reach …?" for a service the identity is NOT
 * Dial-authorized for: each Dial policy covering the service, and which part of
 * its identity side the identity fails.
 *
 * Matching goes through entityMatchesRoles, statuses through resolve(), verdicts
 * through verdictFor() (index counts, cached per world) — nothing re-derived here.
 * A reachable row needs its service's verdict to know which list it belongs in, so
 * those verdicts are computed for every such row, not only the visible ones.
 */

import type { Identity, Policy } from '../../shared/services/mock-data.service';
import { entityMatchesRoles } from '../authorization/authorization-resolver';
import {
  enumerateForIdentity,
  type ResolvedPair,
  type TrifectaStatus,
  type TrifectaWorld,
} from '../authorization/trifecta-resolver';
import { routersFor, type RouterRef } from './draft/router-gap';
import { postureFor } from './posture';
import { verdictFor, type VerdictReason } from './service-view.layout';
import { indexFor } from '../authorization/world-index';

export type GrantBy = 'name' | 'rule';

export interface Grant {
  policyId: string;
  policyName: string;
  /** 'name' when one of the policy's @refs names the identity; otherwise its # rule matched. */
  by: GrantBy;
}

/** Why a Dial-authorized identity can't connect. The three host reasons are the
 *  service verdict's own (no host at all / none with an online route / none serving). */
export type CantConnectReason =
  | 'no shared router'
  | 'routers offline'
  | Extract<VerdictReason, 'no host' | 'no host with an online route' | 'no host passes posture' | 'no host serving yet'>
  /** The identity's own Dial posture isn't satisfied. */
  | 'blocked by posture';

export interface IdentityServiceRow {
  serviceId: string;
  serviceName: string;
  /** Dial status for canConnect / cantConnect rows, bindStatus for canHost rows. */
  status: TrifectaStatus;
  grants: Grant[];
  /** cantConnect rows only. */
  reason: CantConnectReason | null;
  /** The service's eligible routers, via SERPs — for comparing with the identity's. */
  serviceRouters: RouterRef[];
}

export interface IdentityViewLayout {
  /** routerName: set for a router identity — the router it belongs to. */
  identity: { id: string; name: string; attributes: readonly string[]; routerName: string | null };
  /** The identity's routers, via ERPs, by name. */
  routers: RouterRef[];
  canConnect: IdentityServiceRow[];
  cantConnect: IdentityServiceRow[];
  canHost: IdentityServiceRow[];
  /** Services it is NOT Dial-authorized for — the "Why can't it reach…?" picker. */
  notDialAuthorized: { id: string; name: string }[];
}

type Matchable = { id: string; name: string; attributes?: readonly string[] };
const matches = (roles: readonly string[], semantic: Policy['semantic'], e: Matchable) =>
  entityMatchesRoles(roles, semantic, e.attributes ?? [], e.name, e.id);

function identityOf(world: TrifectaWorld, identityId: string): Identity {
  const identity = indexFor(world).identity(identityId);
  if (!identity) throw new Error(`identity view: unknown identity '${identityId}'`);
  return identity;
}

function grants(policyIds: readonly string[], identity: Identity, world: TrifectaWorld): Grant[] {
  return policyIds.map((id) => {
    const p = indexFor(world).policy(id)!;
    const named = p.identityRoles.some((r) => r.startsWith('@') && matches([r], 'AnyOf', identity));
    return { policyId: p.id, policyName: p.name, by: named ? 'name' : 'rule' };
  });
}

const CANT: Partial<Record<TrifectaStatus, CantConnectReason>> = {
  AUTHORIZED_NO_ROUTER: 'no shared router',
  BLOCKED_ROUTERS_OFFLINE: 'routers offline',
};

/**
 * Why a Dial-authorized pair can't connect — null when it can. Its own route first
 * (no shared router / routers offline), then the service's hosts, then its own Dial
 * posture. The identity lens and the access report both use it.
 */
export function dialReason(pair: ResolvedPair, world: TrifectaWorld): CantConnectReason | null {
  const routeReason = CANT[pair.status];
  if (routeReason) return routeReason;
  // AUTHORIZED_REACHABLE: the identity's own route is fine — is there a serving host
  // that passes posture, and does this identity pass its own Dial posture?
  const verdict = verdictFor(pair.serviceId, world);
  const hostReason = verdict.reason === 'no dialer passes posture' ? null : verdict.reason;
  if (hostReason) return hostReason as CantConnectReason;
  return postureFor(pair.identityId, pair.serviceId, 'dial', world).satisfied ? null : 'blocked by posture';
}

/** Why a Bind-authorized pair can't take traffic — null when it can: its route to the
 *  service's routers, then its own Bind posture. */
export function bindReason(pair: ResolvedPair, world: TrifectaWorld): CantConnectReason | null {
  const routeReason = CANT[pair.bindStatus];
  if (routeReason) return routeReason;
  return postureFor(pair.identityId, pair.serviceId, 'bind', world).satisfied ? null : 'blocked by posture';
}

export function layoutIdentityView(identityId: string, world: TrifectaWorld): IdentityViewLayout {
  const identity = identityOf(world, identityId);
  const pairs = enumerateForIdentity(identityId, world);
  const ix = indexFor(world);
  const serviceName = (id: string) => ix.service(id)!.name;
  // Per service, once per world: every identity's lens shows the same lists.
  const serviceRouters = (serviceId: string) =>
    ix.memo(`lens:serviceRouters:${serviceId}`, () =>
      routersFor(ix.service(serviceId)!, world.serviceEdgeRouterPolicies, (p) => p.serviceRoles, world.edgeRouters),
    );

  const row = (pair: ResolvedPair, track: 'dial' | 'bind', reason: CantConnectReason | null): IdentityServiceRow => ({
    serviceId: pair.serviceId,
    serviceName: serviceName(pair.serviceId),
    status: track === 'dial' ? pair.status : pair.bindStatus,
    grants: grants(pair[track].viaPolicies, identity, world),
    reason,
    serviceRouters: serviceRouters(pair.serviceId),
  });

  const canConnect: IdentityServiceRow[] = [];
  const cantConnect: IdentityServiceRow[] = [];
  for (const pair of pairs.filter((p) => p.dial.authorized)) {
    const reason = dialReason(pair, world);
    if (reason) cantConnect.push(row(pair, 'dial', reason));
    else canConnect.push(row(pair, 'dial', null));
  }

  return {
    identity: {
      id: identity.id,
      name: identity.name,
      attributes: identity.attributes ?? [],
      routerName: identity.routerId ? (world.edgeRouters.find((r) => r.id === identity.routerId)?.name ?? identity.routerId) : null,
    },
    routers: routersFor(identity, world.edgeRouterPolicies, (p) => p.identityRoles, world.edgeRouters),
    canConnect,
    cantConnect,
    canHost: pairs.filter((p) => p.bind.authorized).map((p) => row(p, 'bind', null)),
    notDialAuthorized: pairs
      .filter((p) => !p.dial.authorized)
      .map((p) => ({ id: p.serviceId, name: serviceName(p.serviceId) })),
  };
}

/** Can't-connect rows sharing one reason. */
export interface ReasonGroup {
  reason: CantConnectReason;
  rows: IdentityServiceRow[];
}

/** cantConnect grouped by reason: largest group first, ties in first-seen order; rows keep their order. */
export function groupByReason(rows: readonly IdentityServiceRow[]): ReasonGroup[] {
  const groups = new Map<CantConnectReason, IdentityServiceRow[]>();
  for (const r of rows) groups.set(r.reason!, [...(groups.get(r.reason!) ?? []), r]);
  return [...groups].map(([reason, rs]) => ({ reason, rows: rs })).sort((a, b) => b.rows.length - a.rows.length);
}

// ─── why not ──────────────────────────────────────────────────────────────────

export interface DeniedPolicy {
  policyId: string;
  policyName: string;
  semantic: Policy['semantic'];
  /** "not named, and lacks #prod" / "has none of #a, #b" / "lacks #a" / "not named". */
  why: string;
}

export interface DeniedExplanation {
  identityName: string;
  serviceName: string;
  /** Dial policies covering the service, each with why the identity misses it. */
  policies: DeniedPolicy[];
  /** "No dial policy covers this service." — or, if it IS authorized, who grants it. */
  message: string | null;
}

/** Which part of a policy's identity side `identity` fails. Only meaningful for a
 *  policy it does NOT match. */
function whyNot(p: Policy, identity: Identity): string {
  const refs = p.identityRoles.filter((r) => r.startsWith('@'));
  const terms = p.identityRoles.filter((r) => !r.startsWith('@'));
  const parts: string[] = [];
  if (refs.length) parts.push('not named');
  if (terms.length) {
    if (p.semantic === 'AllOf') {
      const missing = terms.filter((t) => !matches([t], 'AnyOf', identity));
      parts.push(`lacks ${missing.join(', ')}`);
    } else {
      parts.push(terms.length === 1 ? `lacks ${terms[0]}` : `has none of ${terms.join(', ')}`);
    }
  }
  return parts.length ? parts.join(', and ') : 'names no identities';
}

export function explainDenied(identityId: string, serviceId: string, world: TrifectaWorld): DeniedExplanation {
  const identity = identityOf(world, identityId);
  const service = world.services.find((s) => s.id === serviceId);
  if (!service) throw new Error(`explainDenied: unknown service '${serviceId}'`);

  const covering = world.policies.filter((p) => p.type === 'dial' && matches(p.serviceRoles, p.semantic, service));
  const granting = covering.filter((p) => matches(p.identityRoles, p.semantic, identity));
  const base = { identityName: identity.name, serviceName: service.name };

  if (granting.length) {
    return {
      ...base,
      policies: [],
      message: `${identity.name} is authorized to dial ${service.name} by ${granting.map((p) => p.name).join(', ')}.`,
    };
  }
  return {
    ...base,
    policies: covering.map((p) => ({ policyId: p.id, policyName: p.name, semantic: p.semantic, why: whyNot(p, identity) })),
    message: covering.length ? null : 'No dial policy covers this service.',
  };
}
