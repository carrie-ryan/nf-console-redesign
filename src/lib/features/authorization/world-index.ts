/**
 * WORLD INDEX — lookups and memos over ONE TrifectaWorld, so the resolver and the
 * layouts never scan arrays in their hot paths. Pure: everything is derived from the
 * world with the same primitives as before (entityMatchesRoles, under each policy's
 * own semantic), and every list keeps world order — results are identical, only faster.
 *
 * indexFor(world) is cached in a WeakMap keyed by the world object. Worlds are
 * immutable snapshots here (applyDraft and buildSeedWorld build new ones), so an
 * index never goes stale; as a guard, a world whose collections were swapped for
 * other arrays gets a fresh index.
 *
 * Everything is built lazily, on first use. Role matches, router sets and posture
 * lookups are shared with every other world holding the same collections (see
 * `shared`), so a draft reuses live's work for whatever it didn't touch:
 *   • maps by id (first occurrence wins, as .find did) for identities, services,
 *     routers, policies, posture checks;
 *   • role matches, memoised by (roles, semantic): the identity / service / router
 *     ids a role list selects — so a policy's identity and service sets, an ERP's
 *     identities and routers, a SERP's services and routers;
 *   • per identity and per service: their router ids (edgeRouters order);
 *   • posture: required checks per policy, passed checks per identity;
 *   • memos of resolve results by pair, and of posture by (pair, track);
 *   • a keyed memo for other per-world results (the draft diff's live side).
 */

import type {
  EdgeRouter,
  Identity,
  Policy,
  PostureCheck,
  Service,
} from '../../shared/services/mock-data.service';
import { entityMatchesRoles } from './authorization-resolver';
import type { ResolvedPair, TrifectaWorld } from './trifecta-resolver';

type Matchable = { id: string; name: string; attributes?: readonly string[] };

const firstById = <T extends { id: string }>(xs: readonly T[]): Map<string, T> => {
  const m = new Map<string, T>();
  for (const x of xs) if (!m.has(x.id)) m.set(x.id, x);
  return m;
};

const lazy = <T>(make: () => T): (() => T) => {
  let v: T | undefined;
  let done = false;
  return () => {
    if (!done) {
      v = make();
      done = true;
    }
    return v as T;
  };
};

const roleKey = (roles: readonly string[], semantic: Policy['semantic']) => `${semantic}\u0001${roles.join('\u0000')}`;

/**
 * Memos SHARED between worlds, keyed by the collections they derive from. A draft
 * world keeps every collection its ops didn't touch (by reference), so its index
 * reuses live's role matches, router sets and posture lookups for those — only what
 * the draft actually changed is recomputed.
 */
type MemoTree = WeakMap<object, MemoTree | Map<string, unknown>>;
const sharedRoot: MemoTree = new WeakMap();
const ABSENT = {};
function shared<T>(deps: readonly (object | undefined)[]): Map<string, T> {
  let node: MemoTree = sharedRoot;
  for (const [i, dep] of deps.entries()) {
    const key = dep ?? ABSENT;
    let next = node.get(key);
    if (!next) {
      next = i === deps.length - 1 ? new Map<string, unknown>() : (new WeakMap() as MemoTree);
      node.set(key, next);
    }
    node = next as MemoTree;
  }
  return node as unknown as Map<string, T>;
}

export class WorldIndex {
  constructor(readonly world: TrifectaWorld) {}

  // ─── by id ────────────────────────────────────────────────────────────────
  private readonly identityMap = lazy(() => firstById(this.world.identities));
  private readonly serviceMap = lazy(() => firstById(this.world.services));
  private readonly routerMap = lazy(() => firstById(this.world.edgeRouters));
  private readonly policyMap = lazy(() => firstById(this.world.policies));
  private readonly checkMap = lazy(() => firstById(this.world.postureChecks ?? []));

  identity(id: string): Identity | undefined {
    return this.identityMap().get(id);
  }
  service(id: string): Service | undefined {
    return this.serviceMap().get(id);
  }
  router(id: string): EdgeRouter | undefined {
    return this.routerMap().get(id);
  }
  policy(id: string): Policy | undefined {
    return this.policyMap().get(id);
  }
  check(id: string): PostureCheck | undefined {
    return this.checkMap().get(id);
  }

  // ─── role matches ─────────────────────────────────────────────────────────
  private match<T extends Matchable>(kind: string, xs: readonly T[], roles: readonly string[], semantic: Policy['semantic']) {
    // Shared by every world with this same collection.
    const memo = shared<{ list: readonly Matchable[]; ids: ReadonlySet<string> }>([xs]);
    const key = `${kind}\u0002${roleKey(roles, semantic)}`;
    let hit = memo.get(key);
    if (!hit) {
      const list = xs.filter((e) => entityMatchesRoles(roles, semantic, e.attributes ?? [], e.name, e.id));
      hit = { list, ids: new Set(list.map((e) => e.id)) };
      memo.set(key, hit);
    }
    return hit as { list: readonly T[]; ids: ReadonlySet<string> };
  }

  /** The identities `roles` select under `semantic`, world order. */
  identitiesMatching(roles: readonly string[], semantic: Policy['semantic']): readonly Identity[] {
    return this.match('i', this.world.identities, roles, semantic).list;
  }
  identityIdsMatching(roles: readonly string[], semantic: Policy['semantic']): ReadonlySet<string> {
    return this.match('i', this.world.identities, roles, semantic).ids;
  }
  servicesMatching(roles: readonly string[], semantic: Policy['semantic']): readonly Service[] {
    return this.match('s', this.world.services, roles, semantic).list;
  }
  serviceIdsMatching(roles: readonly string[], semantic: Policy['semantic']): ReadonlySet<string> {
    return this.match('s', this.world.services, roles, semantic).ids;
  }
  routerIdsMatching(roles: readonly string[], semantic: Policy['semantic']): ReadonlySet<string> {
    return this.match('r', this.world.edgeRouters, roles, semantic).ids;
  }

  // ─── service policies ─────────────────────────────────────────────────────
  private readonly servicePolicyMemo = lazy(() => shared<readonly Policy[]>([this.world.policies, this.world.services]));

  /** Service policies (both types) whose service side selects the service, world order. */
  policiesForService(serviceId: string): readonly Policy[] {
    let hit = this.servicePolicyMemo().get(serviceId);
    if (!hit) {
      hit = this.world.policies.filter((p) => this.serviceIdsMatching(p.serviceRoles, p.semantic).has(serviceId));
      this.servicePolicyMemo().set(serviceId, hit);
    }
    return hit;
  }

  // ─── routers ──────────────────────────────────────────────────────────────
  private readonly identityRouterMemo = lazy(() =>
    shared<string[]>([this.world.edgeRouterPolicies, this.world.identities, this.world.edgeRouters]),
  );
  private readonly serviceRouterMemo = lazy(() =>
    shared<string[]>([this.world.serviceEdgeRouterPolicies, this.world.services, this.world.edgeRouters]),
  );
  private readonly onlineMap = lazy(() => new Map(this.world.edgeRouters.map((r) => [r.id, r.isOnline])));

  /** ER(identity): routers granted by every ERP whose identity side selects it, edgeRouters order. */
  identityRouters(identityId: string): string[] {
    let hit = this.identityRouterMemo().get(identityId);
    if (!hit) {
      const granting = this.world.edgeRouterPolicies.filter((p) => this.identityIdsMatching(p.identityRoles, p.semantic).has(identityId));
      hit = this.routersOf(granting);
      this.identityRouterMemo().set(identityId, hit);
    }
    return hit;
  }

  /** ER(service): routers granted by every SERP whose service side selects it, edgeRouters order. */
  serviceRouters(serviceId: string): string[] {
    let hit = this.serviceRouterMemo().get(serviceId);
    if (!hit) {
      const granting = this.world.serviceEdgeRouterPolicies.filter((p) => this.serviceIdsMatching(p.serviceRoles, p.semantic).has(serviceId));
      hit = this.routersOf(granting);
      this.serviceRouterMemo().set(serviceId, hit);
    }
    return hit;
  }

  private routersOf(granting: readonly { semantic: Policy['semantic']; edgeRouterRoles: string[] }[]): string[] {
    const sets = granting.map((p) => this.routerIdsMatching(p.edgeRouterRoles, p.semantic));
    return this.world.edgeRouters.filter((r) => sets.some((s) => s.has(r.id))).map((r) => r.id);
  }

  isOnline(routerId: string): boolean {
    return this.onlineMap().get(routerId) === true;
  }

  // ─── posture ──────────────────────────────────────────────────────────────
  private readonly checksMemo = lazy(() => shared<PostureCheck[]>([this.world.postureChecks]));
  private readonly passedMap = lazy(() => {
    const memo = shared<Map<string, ReadonlySet<string>>>([this.world.postureResults]);
    let m = memo.get('passed');
    if (!m) {
      m = new Map<string, ReadonlySet<string>>();
      for (const r of this.world.postureResults ?? []) if (!m.has(r.identityId)) m.set(r.identityId, new Set(r.passedCheckIds));
      memo.set('passed', m);
    }
    return m;
  });
  private static readonly NONE: ReadonlySet<string> = new Set();

  /** The checks a policy's postureCheckRoles select, world.postureChecks order. */
  requiredChecks(policy: Policy): PostureCheck[] {
    const key = `${policy.id}\u0002${roleKey(policy.postureCheckRoles, policy.semantic)}`;
    let hit = this.checksMemo().get(key);
    if (!hit) {
      hit = (this.world.postureChecks ?? []).filter((c) =>
        entityMatchesRoles(policy.postureCheckRoles, policy.semantic, c.attributes, c.name, c.id),
      );
      this.checksMemo().set(key, hit);
    }
    return hit;
  }

  /** The checks an identity's device passes (its first posture result; none without one). */
  passedChecks(identityId: string): ReadonlySet<string> {
    return this.passedMap().get(identityId) ?? WorldIndex.NONE;
  }

  // ─── memos for resolve / postureFor ───────────────────────────────────────
  readonly pairs = new Map<string, ResolvedPair>();
  readonly postures = new Map<string, unknown>();

  // ─── anything else derived from this world (e.g. the diff's live side) ────
  private readonly memos = new Map<string, unknown>();

  /** `make()` once per key for this world. Keys are namespaced by the caller ("diff:…"). */
  memo<T>(key: string, make: () => T): T {
    if (!this.memos.has(key)) this.memos.set(key, make());
    return this.memos.get(key) as T;
  }

  /** Whether `memo(key, …)` has run for this world. */
  hasMemo(key: string): boolean {
    return this.memos.has(key);
  }
}

const cache = new WeakMap<TrifectaWorld, WorldIndex>();

const COLLECTIONS = [
  'identities',
  'services',
  'edgeRouters',
  'policies',
  'edgeRouterPolicies',
  'serviceEdgeRouterPolicies',
  'terminators',
  'postureChecks',
  'postureResults',
  'accessTests',
] as const satisfies readonly (keyof TrifectaWorld)[];

/** The index for `world` — built once per world object. */
export function indexFor(world: TrifectaWorld): WorldIndex {
  const hit = cache.get(world);
  if (hit && COLLECTIONS.every((k) => hit.world[k] === world[k])) return hit;
  // First sight — or a world object whose collections were reassigned: re-index a
  // frozen view of what it holds now.
  const ix = new WorldIndex({ ...world });
  cache.set(world, ix);
  return ix;
}
