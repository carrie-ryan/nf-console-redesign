/**
 * SCALE WORLD — a large, deterministic TrifectaWorld for benchmarking the engine
 * (resolve, layouts, draft diff, tests) at realistic size. Same seed + sizes → the
 * same world, every time (seeded RNG, no Date.now / Math.random).
 *
 * Shape (defaults):
 *   • 3,000 identities, 1–4 attributes each from a pool of 60, Zipf-skewed so a few
 *     attributes are common and most are rare;
 *   • 200 services, 1–2 attributes each from a pool of 25 (same skew);
 *   • 30 routers (3 offline), 20 edge router policies, 20 service edge router policies;
 *   • 150 service policies (≈65% Dial): ≈60% any-of rules (1–3 terms), ≈25% all-of
 *     rules with 2 terms, ≈15% named lists (1–10 identities); a few use #all;
 *   • terminators for every other service (hosts that really may bind it, on a router
 *     they share with it — so validateTerminators stays quiet);
 *   • 5 posture checks, required by ≈30% of policies; ≈80% of identities pass all;
 *   • 10 access tests, picked from the built world so every one passes on live.
 *
 * Never touches the hand-written seed. In the app it is reachable only through the
 * dev flag `?world=scale` (see applyScaleWorld).
 */

import type {
  AccessTest,
  EdgeRouter,
  EdgeRouterPolicy,
  Identity,
  MockDataService,
  Policy,
  PostureCheck,
  PostureResult,
  Service,
  ServiceEdgeRouterPolicy,
  Terminator,
} from '../../shared/services/mock-data.service';
import { entityMatchesRoles } from './authorization-resolver';
import { resolve, type TrifectaWorld } from './trifecta-resolver';
import { describeWho, evaluateTest } from '../policy-builder/access-tests';

export interface ScaleSizes {
  identities: number;
  identityAttributePool: number;
  services: number;
  serviceAttributePool: number;
  routers: number;
  offlineRouters: number;
  edgeRouterPolicies: number;
  serviceEdgeRouterPolicies: number;
  policies: number;
  postureChecks: number;
  accessTests: number;
}

export const DEFAULT_SCALE_SIZES: ScaleSizes = {
  identities: 3000,
  identityAttributePool: 60,
  services: 200,
  serviceAttributePool: 25,
  routers: 30,
  offlineRouters: 3,
  edgeRouterPolicies: 20,
  serviceEdgeRouterPolicies: 20,
  policies: 150,
  postureChecks: 5,
  accessTests: 10,
};

const CREATED = '2026-01-01T00:00:00Z';
const REGIONS = 5;

/** mulberry32 — small, fast, good enough for fixtures. Returns [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, width = 4) => String(n).padStart(width, '0');

export function buildScaleWorld(seed = 1, sizes: Partial<ScaleSizes> = {}): TrifectaWorld {
  const z = { ...DEFAULT_SCALE_SIZES, ...sizes };
  const rand = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

  // Zipf-ish weights: attribute i is drawn ∝ 1 / (i + 1).
  const skewed = (pool: readonly string[]) => {
    const weights = pool.map((_, i) => 1 / (i + 1));
    const total = weights.reduce((s, w) => s + w, 0);
    return () => {
      let r = rand() * total;
      for (let i = 0; i < pool.length; i++) if ((r -= weights[i]) <= 0) return pool[i];
      return pool[pool.length - 1];
    };
  };
  const distinct = (draw: () => string, n: number) => {
    const out = new Set<string>();
    for (let guard = 0; out.size < n && guard < n * 20; guard++) out.add(draw());
    return [...out];
  };

  const identityAttrs = Array.from({ length: z.identityAttributePool }, (_, i) => `#team-${pad(i, 2)}`);
  const serviceAttrs = Array.from({ length: z.serviceAttributePool }, (_, i) => `#app-${pad(i, 2)}`);
  const drawIdentityAttr = skewed(identityAttrs);
  const drawServiceAttr = skewed(serviceAttrs);
  const regions = Array.from({ length: REGIONS }, (_, i) => `#region-${i}`);

  // ─── entities ─────────────────────────────────────────────────────────────
  const identities: Identity[] = Array.from({ length: z.identities }, (_, i) => ({
    id: `sid-${pad(i)}`,
    name: `ident-${pad(i)}`,
    createdAt: CREATED,
    status: rand() < 0.9 ? 'online' : 'offline',
    type: pick(['device', 'user', 'service'] as const),
    attributes: distinct(drawIdentityAttr, int(1, 4)),
  }));

  const services: Service[] = Array.from({ length: z.services }, (_, i) => ({
    id: `ssvc-${pad(i)}`,
    name: `service-${pad(i)}`,
    createdAt: CREATED,
    status: 'active',
    protocol: 'tcp',
    interceptAddress: `service-${pad(i)}.ziti`,
    hostAddress: `10.${Math.floor(i / 250)}.${i % 250}.10`,
    attributes: distinct(drawServiceAttr, int(1, 2)),
    terminatorStrategy: pick(['smartrouting', 'smartrouting', 'weighted', 'random'] as const),
  }));

  // Routers: each in one region; two thirds also #public. The last few are offline.
  const edgeRouters: EdgeRouter[] = Array.from({ length: z.routers }, (_, i) => ({
    id: `ser-${pad(i, 3)}`,
    name: `edge-${pad(i, 3)}`,
    attributes: [regions[i % REGIONS], ...(i % 3 !== 2 ? ['#public'] : [])],
    isOnline: i < z.routers - z.offlineRouters,
  }));
  const routerRole = () => (rand() < 0.4 ? '#public' : pick(regions));

  // ERPs: one #all → #public baseline, the rest one common identity attribute → a region/public.
  const edgeRouterPolicies: EdgeRouterPolicy[] = Array.from({ length: z.edgeRouterPolicies }, (_, i) => ({
    id: `serp-i-${pad(i, 3)}`,
    name: `routers-${i}`,
    createdAt: CREATED,
    status: 'active',
    semantic: 'AnyOf',
    identityRoles: i === 0 ? ['#all'] : [drawIdentityAttr()],
    edgeRouterRoles: i === 0 ? [pick(regions)] : [routerRole()],
  }));

  // SERPs: one #all baseline, the rest one service attribute.
  const serviceEdgeRouterPolicies: ServiceEdgeRouterPolicy[] = Array.from({ length: z.serviceEdgeRouterPolicies }, (_, i) => ({
    id: `serp-s-${pad(i, 3)}`,
    name: `service-routers-${i}`,
    semantic: 'AnyOf',
    serviceRoles: i === 0 ? ['#all'] : [drawServiceAttr()],
    edgeRouterRoles: i === 0 ? [pick(regions)] : [routerRole()],
  }));

  // ─── posture ──────────────────────────────────────────────────────────────
  const checkTypes = ['MFA', 'OS', 'Process', 'Domain', 'MAC'] as const;
  const postureChecks: PostureCheck[] = Array.from({ length: z.postureChecks }, (_, i) => ({
    id: `spc-${pad(i, 2)}`,
    name: `check-${i}`,
    createdAt: CREATED,
    status: 'active',
    type: checkTypes[i % checkTypes.length],
    attributes: [`#posture-${i}`],
  }));
  const allChecks = postureChecks.map((c) => c.id);
  const postureResults: PostureResult[] = identities.map((ident) => {
    if (rand() < 0.8) return { identityId: ident.id, passedCheckIds: [...allChecks] };
    const failing = new Set(distinct(() => pick(allChecks), int(1, 2)));
    return { identityId: ident.id, passedCheckIds: allChecks.filter((c) => !failing.has(c)) };
  });

  // ─── service policies ─────────────────────────────────────────────────────
  // A few #all policies at fixed slots; otherwise 60 / 25 / 15 any-of / all-of / named.
  const allIdentitySlots = new Set([7, 71]);
  const allServiceSlots = new Set([33, 111]);
  const policies: Policy[] = Array.from({ length: z.policies }, (_, i) => {
    const type: Policy['type'] = rand() < 0.65 ? 'dial' : 'bind';
    const shape = rand();
    let semantic: Policy['semantic'] = 'AnyOf';
    let identityRoles: string[];
    let serviceRoles: string[];
    if (shape < 0.6) {
      identityRoles = distinct(drawIdentityAttr, int(1, 3));
      serviceRoles = distinct(drawServiceAttr, int(1, 2));
    } else if (shape < 0.85) {
      semantic = 'AllOf';
      identityRoles = distinct(drawIdentityAttr, 2);
      // AllOf applies to the service side too: one term, or a named service.
      serviceRoles = rand() < 0.7 ? [drawServiceAttr()] : [`@${pick(services).id}`];
    } else {
      identityRoles = distinct(() => `@${pick(identities).id}`, int(1, 10));
      serviceRoles = rand() < 0.5 ? [drawServiceAttr()] : [`@${pick(services).id}`];
    }
    if (allIdentitySlots.has(i)) identityRoles = ['#all'];
    if (allServiceSlots.has(i)) serviceRoles = ['#all'];
    const postureCheckRoles = rand() < 0.3 ? [pick(postureChecks).attributes[0]] : [];
    return {
      id: `spol-${pad(i, 3)}`,
      name: `${type}-policy-${pad(i, 3)}`,
      createdAt: CREATED,
      status: 'active',
      type,
      semantic,
      identityRoles,
      serviceRoles,
      postureCheckRoles,
    };
  });

  const world: TrifectaWorld = {
    identities,
    services,
    edgeRouters,
    policies,
    edgeRouterPolicies,
    serviceEdgeRouterPolicies,
    terminators: [],
    postureChecks,
    postureResults,
    accessTests: [],
  };

  // ─── terminators: every other service, up to 2 real hosts on a shared router ─
  const terminators: Terminator[] = [];
  for (const [si, service] of services.entries()) {
    if (si % 2) continue;
    const binds = policies.filter(
      (p) => p.type === 'bind' && entityMatchesRoles(p.serviceRoles, p.semantic, service.attributes ?? [], service.name, service.id),
    );
    if (!binds.length) continue;
    let hosts = 0;
    for (const ident of identities) {
      if (hosts === 2) break;
      if (!binds.some((p) => entityMatchesRoles(p.identityRoles, p.semantic, ident.attributes, ident.name, ident.id))) continue;
      const common = resolve(ident.id, service.id, world).routers.common;
      if (!common.length) continue;
      terminators.push({
        id: `sterm-${pad(terminators.length)}`,
        serviceId: service.id,
        identityId: ident.id,
        routerId: pick(common),
        precedence: 'default',
        cost: int(0, 3) * 10,
      });
      hosts++;
    }
  }

  // ─── access tests: chosen from the built world so all pass on live ─────────
  // mustNotDial / mustNotHost: an attribute (or, failing that, one identity) with no
  // authorization for the service on that track; mustConnect: one identity that can
  // connect end to end. Each candidate is checked with evaluateTest itself.
  const built: TrifectaWorld = { ...world, terminators };
  const kinds: AccessTest['kind'][] = ['mustNotDial', 'mustNotDial', 'mustNotDial', 'mustNotDial', 'mustNotHost', 'mustNotHost', 'mustNotHost', 'mustConnect', 'mustConnect', 'mustConnect'];
  const hosted = [...new Set(terminators.map((t) => t.serviceId))];
  const passes = (t: AccessTest) => evaluateTest(t, built).pass;
  const accessTests: AccessTest[] = [];
  for (let i = 0; i < z.accessTests; i++) {
    const kind = kinds[i % kinds.length];
    const id = `sat-${pad(i, 2)}`;
    let test: AccessTest | null = null;
    for (let tries = 0; !test && tries < 200; tries++) {
      const candidate: AccessTest =
        kind === 'mustConnect'
          ? { id, kind, who: { names: [pick(identities).name] }, serviceId: pick(hosted.length ? hosted : services.map((s) => s.id)), note: '' }
          : { id, kind, who: tries < 150 ? { attributes: [pick(identityAttrs)] } : { names: [pick(identities).name] }, serviceId: pick(services).id, note: '' };
      if (kind === 'mustConnect') {
        // Most random identities can't reach a given service: start from one a Dial
        // policy of it grants, so the search is short.
        const svc = services.find((s) => s.id === candidate.serviceId)!;
        const dialers = policies.filter(
          (p) => p.type === 'dial' && entityMatchesRoles(p.serviceRoles, p.semantic, svc.attributes ?? [], svc.name, svc.id),
        );
        const grantees = identities.filter((ident) =>
          dialers.some((p) => entityMatchesRoles(p.identityRoles, p.semantic, ident.attributes, ident.name, ident.id)),
        );
        if (grantees.length) candidate.who = { names: [pick(grantees).name] };
      }
      if (passes(candidate)) test = candidate;
    }
    if (!test) continue; // none found within the budget (doesn't happen with the defaults)
    const what = describeWho(test.who);
    test.note = kind === 'mustConnect' ? `${what} needs this service` : `${what} has no business here`;
    accessTests.push(test);
  }

  return { ...world, terminators, accessTests };
}

/**
 * Dev flag: with `?world=scale` on the URL at startup, replace MockDataService's
 * world collections with the scale world for the session. The seed is untouched
 * otherwise; nothing else reads the flag.
 */
export function applyScaleWorld(data: MockDataService, search: string): boolean {
  if (new URLSearchParams(search).get('world') !== 'scale') return false;
  const w = buildScaleWorld();
  data.identities.set([...w.identities]);
  data.services.set([...w.services]);
  data.edgeRouters.set([...w.edgeRouters]);
  data.policies.set([...w.policies]);
  data.edgeRouterPolicies.set([...w.edgeRouterPolicies]);
  data.serviceEdgeRouterPolicies.set([...w.serviceEdgeRouterPolicies]);
  data.terminators.set([...(w.terminators ?? [])]);
  data.postureChecks.set([...(w.postureChecks ?? [])]);
  data.postureResults.set([...(w.postureResults ?? [])]);
  data.accessTests.set([...(w.accessTests ?? [])]);
  return true;
}
