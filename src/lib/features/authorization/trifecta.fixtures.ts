/**
 * TRIFECTA ORACLE — hand-authored ground truth for the forthcoming trifecta
 * resolver (service policy × edge router policy × service edge router policy).
 *
 * No resolver consumes this yet. The world is small and FULLY ENUMERATED: every
 * (identity, service) pair in the cross-product has an explicit expected terminal
 * state in TRIFECTA_EXPECTED, and trifecta.fixtures.spec.ts proves each state's
 * structural preconditions actually hold in the data below.
 *
 * Expected states are for the DIAL axis. Bind is represented (one trap policy)
 * so the resolver can track it later, but it never contributes to a Dial state.
 *
 * Ziti semantics assumed (verified against OpenZiti source): every policy type
 * carries a `semantic` applied to all of its role lists; ERP / SERP default to
 * AllOf. Role tokens: '#all' wildcard, '@<id|name>' direct ref, '#attr' membership.
 * Posture and terminator presence are DEFERRED — AUTHORIZED_REACHABLE means
 * "working, minus posture/terminator".
 *
 * Router reachability per pair:
 *   ER(identity) = routers granted by any ERP matching the identity
 *   ER(service)  = routers granted by any SERP matching the service
 *   common       = ER(identity) ∩ ER(service)
 *
 * The matrix (identity ↓ / service →):
 *
 *              svc-web          svc-db             svc-lab         svc-orphan       svc-ops
 *   alice      REACHABLE        NOT_AUTHORIZED     NO_ROUTER (i)   NO_ROUTER (ii)   REACHABLE
 *   bob        NOT_AUTHORIZED   ROUTERS_OFFLINE    NOT_AUTHORIZED  NOT_AUTHORIZED   NO_ROUTER (i)
 *   carol      NOT_AUTHORIZED   NOT_AUTHORIZED     NOT_AUTHORIZED  NOT_AUTHORIZED   NOT_AUTHORIZED
 *   root       REACHABLE        NO_ROUTER (i)      NO_ROUTER (i)   NO_ROUTER (ii)   REACHABLE
 *
 * svc-ops is the MIXED AllOf case (the Mark43 incident): its Dial policy is
 * AllOf [@alice, #dba, #prod-access]. Ziti unions @refs OUTSIDE the semantic, so
 * alice is authorized by name despite lacking both terms; bob (both terms) is
 * authorized; carol (#dba only) is not.
 *
 * The BIND matrix (TRIFECTA_EXPECTED_BIND) — same router rule, bind grants:
 *
 *              svc-web          svc-db             svc-lab         svc-orphan       svc-ops
 *   alice      REACHABLE        NOT_AUTHORIZED     NOT_AUTHORIZED  NOT_AUTHORIZED   NOT_AUTHORIZED
 *   bob        NOT_AUTHORIZED   ROUTERS_OFFLINE    NOT_AUTHORIZED  NOT_AUTHORIZED   NOT_AUTHORIZED
 *   carol      NOT_AUTHORIZED   ROUTERS_OFFLINE    NOT_AUTHORIZED  NOT_AUTHORIZED   NOT_AUTHORIZED
 *   root       NOT_AUTHORIZED   NOT_AUTHORIZED     NO_ROUTER (i)   NO_ROUTER (ii)   NOT_AUTHORIZED
 */

import type {
  EdgeRouter,
  EdgeRouterPolicy,
  Identity,
  Policy,
  Service,
  ServiceEdgeRouterPolicy,
} from '../../shared/services/mock-data.service';

const T = '2026-10-01T00:00:00Z';

// ─── terminal states + per-pair oracle shape ──────────────────────────────────

export type TrifectaState =
  | 'NOT_AUTHORIZED'
  | 'AUTHORIZED_NO_ROUTER'
  | 'BLOCKED_ROUTERS_OFFLINE'
  | 'AUTHORIZED_REACHABLE';

/** AUTHORIZED_NO_ROUTER sub-cases:
 *   'disjoint' — (i) both sides have routers, but no ERP gives the identity one the service shares;
 *   'no-serp'  — (ii) no SERP matches the service at all, so ER(service) = ∅. */
export type NoRouterCase = 'disjoint' | 'no-serp';

/** How the Dial authorization was matched — orthogonal to the terminal state. */
export type MatcherCoverage = 'at-id' | 'allof-multi' | 'anyof' | 'all-wildcard';

export interface TrifectaExpectation {
  state: TrifectaState;
  /** Set only for AUTHORIZED_NO_ROUTER. */
  noRouterCase?: NoRouterCase;
  /** Matcher paths this pair's Dial authorization exercises (authorized pairs only). */
  coverage?: MatcherCoverage[];
  note: string;
}

export const trifectaPairKey = (identityId: string, serviceId: string) =>
  `${identityId}|${serviceId}`;

// ─── edge routers ─────────────────────────────────────────────────────────────

export const TRIFECTA_EDGE_ROUTERS: EdgeRouter[] = [
  // #east pair, one ONLINE — the common router that makes web REACHABLE.
  { id: 'er-east-1', name: 'edge-east-1', attributes: ['#east'], isOnline: true },
  // #east pair, OFFLINE — proves one offline router in the common set doesn't block
  // when a sibling is online.
  { id: 'er-east-2', name: 'edge-east-2', attributes: ['#east'], isOnline: false },
  // The ONLY #dmz router, OFFLINE — every common router for bob→db is down.
  { id: 'er-dmz', name: 'edge-dmz', attributes: ['#dmz'], isOnline: false },
  // ONLINE but no ERP grants it to anyone — svc-lab's router, unreachable by
  // construction (NO_ROUTER sub-case (i), disjoint).
  { id: 'er-lab', name: 'edge-lab', attributes: ['#lab'], isOnline: true },
];

// ─── identities ───────────────────────────────────────────────────────────────

export const TRIFECTA_IDENTITIES: Identity[] = [
  // AnyOf dialer (#eng) with #east routers. Hits REACHABLE, NO_ROUTER (i) and (ii),
  // and NOT_AUTHORIZED (db is outside its AnyOf service list).
  { id: 'tri-alice', name: 'alice', createdAt: T, status: 'online', type: 'user', attributes: ['#eng'] },
  // Multi-attribute AllOf dialer — carries BOTH #dba and #prod-access. Only #dmz
  // routers, all offline → ROUTERS_OFFLINE on db.
  { id: 'tri-bob', name: 'bob', createdAt: T, status: 'online', type: 'user', attributes: ['#dba', '#prod-access'] },
  // AllOf near-miss — #dba only, lacks #prod-access, so the AllOf dial fails.
  // Also the BIND trap: a Bind policy matches carol→db; it must NOT authorize Dial.
  { id: 'tri-carol', name: 'carol', createdAt: T, status: 'online', type: 'user', attributes: ['#dba'] },
  // NO attributes — reachable only by '@tri-root' refs. Dials every service via '#all'.
  { id: 'tri-root', name: 'break-glass-root', createdAt: T, status: 'online', type: 'user', attributes: [] },
];

// ─── services ─────────────────────────────────────────────────────────────────

const svc = (id: string, name: string, attributes: string[]): Service => ({
  id,
  name,
  createdAt: T,
  status: 'online',
  protocol: 'tcp',
  interceptAddress: `${name}.tri:443`,
  hostAddress: `10.9.0.1:443`,
  attributes,
});

export const TRIFECTA_SERVICES: Service[] = [
  // SERP → #east (one online, one offline). The REACHABLE target.
  svc('tri-svc-web', 'web', ['#web']),
  // Multi-attribute (#db + #prod) for the AllOf dial. SERP → #dmz only (offline).
  svc('tri-svc-db', 'db', ['#db', '#prod']),
  // SERP → #lab, which no identity is granted — NO_ROUTER (i), disjoint.
  svc('tri-svc-lab', 'lab', ['#lab-svc']),
  // NO SERP matches it at all → ER(service) = ∅ — NO_ROUTER (ii).
  svc('tri-svc-orphan', 'orphan', ['#orphan']),
  // Target of the MIXED AllOf Dial policy. SERP → #east.
  svc('tri-svc-ops', 'ops', ['#ops']),
];

// ─── service policies (Dial + Bind) ───────────────────────────────────────────

const pol = (p: Omit<Policy, 'createdAt' | 'status' | 'postureCheckRoles'>): Policy => ({
  ...p,
  createdAt: T,
  status: 'active',
  postureCheckRoles: [],
});

export const TRIFECTA_SERVICE_POLICIES: Policy[] = [
  // AnyOf on both axes — #eng OR #contractor may dial web OR lab OR orphan.
  pol({ id: 'tri-dial-eng', name: 'eng-dial-anyof', type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#eng', '#contractor'], serviceRoles: ['#web', '#lab-svc', '#orphan'] }),
  // Multi-attribute AllOf — identity needs #dba AND #prod-access; service needs #db AND #prod.
  pol({ id: 'tri-dial-dba', name: 'dba-dial-allof', type: 'dial', semantic: 'AllOf',
    identityRoles: ['#dba', '#prod-access'], serviceRoles: ['#db', '#prod'] }),
  // '@' direct ref on the identity axis, '#all' wildcard on the service axis.
  pol({ id: 'tri-dial-root', name: 'break-glass-dial', type: 'dial', semantic: 'AnyOf',
    identityRoles: ['@tri-root'], serviceRoles: ['#all'] }),
  // BIND trap — matches carol (and bob) → db. Must never turn carol→db authorized on Dial.
  pol({ id: 'tri-bind-db', name: 'dba-bind-db', type: 'bind', semantic: 'AnyOf',
    identityRoles: ['#dba'], serviceRoles: ['#db'] }),
  // Bind → REACHABLE: alice (#eng, ER {east}) hosts web (ER {east}, east-1 online).
  pol({ id: 'tri-bind-web', name: 'eng-bind-web', type: 'bind', semantic: 'AnyOf',
    identityRoles: ['#eng'], serviceRoles: ['#web'] }),
  // Bind → NO_ROUTER both ways: root hosts lab (ER {lab} vs {east} — disjoint) and
  // orphan (no SERP at all).
  pol({ id: 'tri-bind-root', name: 'root-bind-lab-orphan', type: 'bind', semantic: 'AnyOf',
    identityRoles: ['@tri-root'], serviceRoles: ['#lab-svc', '#orphan'] }),
  // MIXED AllOf — @tri-alice is unioned in by name; AllOf binds only #dba AND #prod-access.
  pol({ id: 'tri-dial-ops', name: 'ops-dial-mixed-allof', type: 'dial', semantic: 'AllOf',
    identityRoles: ['@tri-alice', '#dba', '#prod-access'], serviceRoles: ['#ops'] }),
];

// ─── edge router policies (identity → routers) ────────────────────────────────

const erp = (p: Omit<EdgeRouterPolicy, 'createdAt' | 'status'>): EdgeRouterPolicy => ({
  ...p,
  createdAt: T,
  status: 'active',
});

export const TRIFECTA_EDGE_ROUTER_POLICIES: EdgeRouterPolicy[] = [
  // #eng → #east routers (alice).
  erp({ id: 'tri-erp-eng', name: 'eng-east', semantic: 'AllOf', identityRoles: ['#eng'], edgeRouterRoles: ['#east'] }),
  // #dba → #dmz router (bob, carol) — the only #dmz router is offline.
  erp({ id: 'tri-erp-dba', name: 'dba-dmz', semantic: 'AllOf', identityRoles: ['#dba'], edgeRouterRoles: ['#dmz'] }),
  // @tri-root → #east routers (root has no attributes; direct ref only).
  erp({ id: 'tri-erp-root', name: 'root-east', semantic: 'AllOf', identityRoles: ['@tri-root'], edgeRouterRoles: ['#east'] }),
  // Deliberately NO ERP grants #lab.
];

// ─── service edge router policies (service → routers) ─────────────────────────

export const TRIFECTA_SERVICE_EDGE_ROUTER_POLICIES: ServiceEdgeRouterPolicy[] = [
  { id: 'tri-serp-web', name: 'web-east', semantic: 'AllOf', serviceRoles: ['#web'], edgeRouterRoles: ['#east'] },
  { id: 'tri-serp-db', name: 'db-dmz', semantic: 'AllOf', serviceRoles: ['#db'], edgeRouterRoles: ['#dmz'] },
  { id: 'tri-serp-lab', name: 'lab-lab', semantic: 'AllOf', serviceRoles: ['#lab-svc'], edgeRouterRoles: ['#lab'] },
  { id: 'tri-serp-ops', name: 'ops-east', semantic: 'AllOf', serviceRoles: ['#ops'], edgeRouterRoles: ['#east'] },
  // Deliberately NO SERP matches #orphan.
];

// ─── the oracle: every (identity, service) pair ───────────────────────────────

const k = trifectaPairKey;

export const TRIFECTA_EXPECTED: Record<string, TrifectaExpectation> = {
  // alice (#eng, routers {east-1, east-2})
  [k('tri-alice', 'tri-svc-web')]: { state: 'AUTHORIZED_REACHABLE', coverage: ['anyof'],
    note: 'AnyOf dial; common {east-1 (on), east-2 (off)} — one online suffices' },
  [k('tri-alice', 'tri-svc-db')]: { state: 'NOT_AUTHORIZED',
    note: 'db is outside the eng AnyOf service list' },
  [k('tri-alice', 'tri-svc-lab')]: { state: 'AUTHORIZED_NO_ROUTER', noRouterCase: 'disjoint', coverage: ['anyof'],
    note: 'AnyOf dial; ER(alice)={east}, ER(lab)={lab} — disjoint' },
  [k('tri-alice', 'tri-svc-orphan')]: { state: 'AUTHORIZED_NO_ROUTER', noRouterCase: 'no-serp', coverage: ['anyof'],
    note: 'AnyOf dial; no SERP matches orphan → ER(orphan)=∅' },

  // bob (#dba + #prod-access, routers {dmz})
  [k('tri-bob', 'tri-svc-web')]: { state: 'NOT_AUTHORIZED', note: 'no dial policy matches bob for web' },
  [k('tri-bob', 'tri-svc-db')]: { state: 'BLOCKED_ROUTERS_OFFLINE', coverage: ['allof-multi'],
    note: 'multi-attr AllOf dial; common {dmz} — all offline' },
  [k('tri-bob', 'tri-svc-lab')]: { state: 'NOT_AUTHORIZED', note: 'no dial policy matches bob for lab' },
  [k('tri-bob', 'tri-svc-orphan')]: { state: 'NOT_AUTHORIZED', note: 'no dial policy matches bob for orphan' },

  // carol (#dba only, routers {dmz})
  [k('tri-carol', 'tri-svc-web')]: { state: 'NOT_AUTHORIZED', note: 'no dial policy matches carol' },
  [k('tri-carol', 'tri-svc-db')]: { state: 'NOT_AUTHORIZED',
    note: 'AllOf near-miss (lacks #prod-access); Bind trap tri-bind-db matches but is not Dial' },
  [k('tri-carol', 'tri-svc-lab')]: { state: 'NOT_AUTHORIZED', note: 'no dial policy matches carol' },
  [k('tri-carol', 'tri-svc-orphan')]: { state: 'NOT_AUTHORIZED', note: 'no dial policy matches carol' },

  // root (no attributes, routers {east-1, east-2} via @ref ERP)
  [k('tri-root', 'tri-svc-web')]: { state: 'AUTHORIZED_REACHABLE', coverage: ['at-id', 'all-wildcard'],
    note: '@tri-root + #all dial; common {east-1 (on), east-2 (off)}' },
  [k('tri-root', 'tri-svc-db')]: { state: 'AUTHORIZED_NO_ROUTER', noRouterCase: 'disjoint', coverage: ['at-id', 'all-wildcard'],
    note: '@tri-root + #all dial; ER(root)={east}, ER(db)={dmz} — disjoint' },
  [k('tri-root', 'tri-svc-lab')]: { state: 'AUTHORIZED_NO_ROUTER', noRouterCase: 'disjoint', coverage: ['at-id', 'all-wildcard'],
    note: '@tri-root + #all dial; ER(root)={east}, ER(lab)={lab} — disjoint' },
  [k('tri-root', 'tri-svc-orphan')]: { state: 'AUTHORIZED_NO_ROUTER', noRouterCase: 'no-serp', coverage: ['at-id', 'all-wildcard'],
    note: '@tri-root + #all dial; no SERP matches orphan → ER(orphan)=∅' },

  // svc-ops — MIXED AllOf [@tri-alice, #dba, #prod-access] (routers {east-1, east-2})
  [k('tri-alice', 'tri-svc-ops')]: { state: 'AUTHORIZED_REACHABLE', coverage: ['at-id'],
    note: 'named by @tri-alice — unioned outside AllOf, despite lacking #dba and #prod-access' },
  [k('tri-bob', 'tri-svc-ops')]: { state: 'AUTHORIZED_NO_ROUTER', noRouterCase: 'disjoint', coverage: ['allof-multi'],
    note: 'carries #dba + #prod-access → AllOf terms match; ER(bob)={dmz}, ER(ops)={east} — disjoint' },
  [k('tri-carol', 'tri-svc-ops')]: { state: 'NOT_AUTHORIZED',
    note: 'mixed AllOf near-miss: #dba only, not named by any @ref' },
  [k('tri-root', 'tri-svc-ops')]: { state: 'AUTHORIZED_REACHABLE', coverage: ['at-id', 'all-wildcard'],
    note: '@tri-root + #all dial (not the mixed policy); common {east-1 (on), east-2 (off)}' },
};

// ─── the Bind oracle: every (identity, service) pair ──────────────────────────
// Same terminal states and router rule as Dial, driven by Bind grants. Bind pairs
// carry no matcher coverage tags.

const notBound = (note: string): TrifectaExpectation => ({ state: 'NOT_AUTHORIZED', note });

export const TRIFECTA_EXPECTED_BIND: Record<string, TrifectaExpectation> = {
  // alice (#eng, routers {east-1, east-2})
  [k('tri-alice', 'tri-svc-web')]: { state: 'AUTHORIZED_REACHABLE',
    note: 'tri-bind-web (#eng → #web); common {east-1 (on), east-2 (off)}' },
  [k('tri-alice', 'tri-svc-db')]: notBound('no bind policy matches alice for db'),
  [k('tri-alice', 'tri-svc-lab')]: notBound('no bind policy matches alice for lab'),
  [k('tri-alice', 'tri-svc-orphan')]: notBound('no bind policy matches alice for orphan'),
  [k('tri-alice', 'tri-svc-ops')]: notBound('ops has Dial only — no bind policy'),

  // bob (#dba + #prod-access, routers {dmz})
  [k('tri-bob', 'tri-svc-web')]: notBound('no bind policy matches bob for web'),
  [k('tri-bob', 'tri-svc-db')]: { state: 'BLOCKED_ROUTERS_OFFLINE',
    note: 'tri-bind-db (#dba → #db); common {dmz} — all offline' },
  [k('tri-bob', 'tri-svc-lab')]: notBound('no bind policy matches bob for lab'),
  [k('tri-bob', 'tri-svc-orphan')]: notBound('no bind policy matches bob for orphan'),
  [k('tri-bob', 'tri-svc-ops')]: notBound('ops has Dial only — no bind policy'),

  // carol (#dba only, routers {dmz}) — the Dial "Bind trap" is a real Bind grant here
  [k('tri-carol', 'tri-svc-web')]: notBound('no bind policy matches carol for web'),
  [k('tri-carol', 'tri-svc-db')]: { state: 'BLOCKED_ROUTERS_OFFLINE',
    note: 'tri-bind-db (#dba → #db); common {dmz} — all offline' },
  [k('tri-carol', 'tri-svc-lab')]: notBound('no bind policy matches carol for lab'),
  [k('tri-carol', 'tri-svc-orphan')]: notBound('no bind policy matches carol for orphan'),
  [k('tri-carol', 'tri-svc-ops')]: notBound('ops has Dial only — no bind policy'),

  // root (no attributes, routers {east-1, east-2} via @ref ERP)
  [k('tri-root', 'tri-svc-web')]: notBound('root dials web via #all, but no bind policy matches'),
  [k('tri-root', 'tri-svc-db')]: notBound('no bind policy matches root for db'),
  [k('tri-root', 'tri-svc-lab')]: { state: 'AUTHORIZED_NO_ROUTER', noRouterCase: 'disjoint',
    note: 'tri-bind-root (@tri-root); ER(root)={east}, ER(lab)={lab} — disjoint' },
  [k('tri-root', 'tri-svc-orphan')]: { state: 'AUTHORIZED_NO_ROUTER', noRouterCase: 'no-serp',
    note: 'tri-bind-root (@tri-root); no SERP matches orphan → ER(orphan)=∅' },
  [k('tri-root', 'tri-svc-ops')]: notBound('ops has Dial only — no bind policy'),
};
