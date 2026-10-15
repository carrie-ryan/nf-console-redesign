/**
 * Runs the trifecta resolver over the full MockDataService SEED world.
 *
 * Per-pair correctness is already proven on the hand-built oracle
 * (trifecta-resolver.spec.ts); this spec does NOT assume the seed world is
 * reachable. It asserts internal-consistency INVARIANTS at seed scale, and logs a
 * trifecta HEALTH REPORT — gaps in the report are expected output, not failures.
 *
 * Run `npx ng test --watch=false --include src/lib/features/authorization/trifecta-seed.spec.ts`
 * and read the console for the report.
 */

import { entityMatchesRoles } from './authorization-resolver';
import { DISCOVERY_IDENTITIES } from '../discovery/discovered-flows.mock';
import { buildSeedWorld } from './trifecta-world.adapter';
import {
  enumerateForIdentity,
  enumerateForService,
  resolve,
  type ResolvedPair,
  type TrifectaStatus,
} from './trifecta-resolver';

const world = buildSeedWorld();

/**
 * Hand-derived expectations for the seed world — LOGGED next to the actual values
 * in the health report, never asserted (a reseed shows up as "← DRIFT", not a
 * failure). Derivation:
 *   pairs = 84 identities × 8 services = 672.
 *   Dial: pol-001 lets 3 #admins dial the 4 #git/#apis services (12 pairs); pol-002
 *   lets the 16 #users dial the 3 #git services — 15 of them not already #admins
 *   (45 pairs). 57 Dial pairs; all of those identities get #public routers
 *   (rp-001/003/004). svc-001..003 and reports-svc have no Dial policy at all.
 *     REACHABLE  = admins × git-repo, api-prod (6) + non-admin users × git-repo (15) = 21
 *     OFFLINE    = (3 + 15) × offline-svc (er-002 only, offline)                    = 18
 *     NO_ROUTER  = (3 + 15) × no-serp-svc (no SERP)                                 = 18
 *     NOT_AUTH   = 672 − 57                                                          = 615
 *   Bind: pol-003 binds the 31 #servers identities to api-prod (#apis)          = 31
 *         pol-004 binds git-repo (@svc-004), mixed AllOf: @server-build-01 by name
 *         (lacks #prod) + the 7 #servers ∧ #prod identities                     =  8
 *       · pol-005 binds every #git service (git-repo, offline-svc, no-serp-svc) to
 *         @server-stage-01, which no other Bind policy gives git-repo         =  3
 *                                                                          total = 42
 *   Bind status: every #servers host gets the #public routers (rp-003). api-prod
 *   (serp-004) and git-repo (serp-003) are served by #public, which has er-001/er-003
 *   online → their 40 Bind pairs are REACHABLE. offline-svc is served only by the
 *   offline er-002 → server-stage-01 there is ROUTERS_OFFLINE; no-serp-svc has no
 *   routers → NO_ROUTER. NOT_AUTH = 672 − 42 = 630.
 *   (reports-svc has no Bind policy at all.)
 */
const SEED_EXPECTED = {
  pairs: 672,
  buckets: {
    NOT_AUTHORIZED: 615,
    AUTHORIZED_NO_ROUTER: 18,
    BLOCKED_ROUTERS_OFFLINE: 18,
    AUTHORIZED_REACHABLE: 21,
  } satisfies Record<TrifectaStatus, number>,
  bindPairs: 42,
  bindBuckets: {
    NOT_AUTHORIZED: 630,
    AUTHORIZED_NO_ROUTER: 1,
    BLOCKED_ROUTERS_OFFLINE: 1,
    AUTHORIZED_REACHABLE: 40,
  } satisfies Record<TrifectaStatus, number>,
};

const pairs: ResolvedPair[] = world.identities.flatMap((i) =>
  world.services.map((s) => resolve(i.id, s.id, world)),
);

const key = (identityId: string, serviceId: string) => `${identityId}|${serviceId}`;

// ─── invariants ───────────────────────────────────────────────────────────────

describe('trifecta seed world — invariants', () => {
  it('the seed world is non-empty on both axes', () => {
    expect(world.identities.length).toBeGreaterThan(0);
    expect(world.services.length).toBeGreaterThan(0);
    expect(pairs.length).toBe(world.identities.length * world.services.length);
  });

  it('authorized ⇔ viaPolicies non-empty, for dial and bind, on every pair', () => {
    for (const p of pairs) {
      const k = key(p.identityId, p.serviceId);
      expect(p.dial.authorized, `${k} dial`).toBe(p.dial.viaPolicies.length > 0);
      expect(p.bind.authorized, `${k} bind`).toBe(p.bind.viaPolicies.length > 0);
    }
  });

  it('common is the exact intersection of identityRouters and serviceRouters, no dupes', () => {
    for (const p of pairs) {
      const k = key(p.identityId, p.serviceId);
      const { identityRouters, serviceRouters, common } = p.routers;
      const iSet = new Set(identityRouters);
      const sSet = new Set(serviceRouters);
      const cSet = new Set(common);
      expect(cSet.size, `${k} common has dupes`).toBe(common.length);
      for (const r of common) {
        expect(iSet.has(r) && sSet.has(r), `${k}: ${r} in common but not both sides`).toBe(true);
      }
      for (const r of identityRouters) {
        if (sSet.has(r)) expect(cSet.has(r), `${k}: ${r} shared but missing from common`).toBe(true);
      }
      for (const r of serviceRouters) {
        if (iSet.has(r)) expect(cSet.has(r), `${k}: ${r} shared but missing from common`).toBe(true);
      }
    }
  });

  it('axis symmetry: identity-axis and service-axis enumeration agree on every pair', () => {
    const byService = new Map(world.services.map((s) => [s.id, enumerateForService(s.id, world)]));
    for (const i of world.identities) {
      for (const fromIdentity of enumerateForIdentity(i.id, world)) {
        const k = key(i.id, fromIdentity.serviceId);
        const fromService = byService.get(fromIdentity.serviceId)!.filter((p) => p.identityId === i.id);
        expect(fromService.length, k).toBe(1);
        expect(fromService[0].status, k).toBe(fromIdentity.status);
        expect([...fromService[0].routers.common].sort(), k).toEqual([...fromIdentity.routers.common].sort());
      }
    }
  });

  it('CONSERVATION: resolver Dial set === policy-centric double-loop Dial set', () => {
    // (a) resolver, pair-centric
    const viaResolver = new Set(pairs.filter((p) => p.dial.authorized).map((p) => key(p.identityId, p.serviceId)));

    // (b) policy-centric: per Dial policy, cross its matched identities × services, union.
    const viaPolicies = new Set<string>();
    for (const p of world.policies) {
      if (p.type !== 'dial') continue;
      const ids = world.identities.filter((i) =>
        entityMatchesRoles(p.identityRoles, p.semantic, i.attributes, i.name, i.id),
      );
      const svcs = world.services.filter((s) =>
        entityMatchesRoles(p.serviceRoles, p.semantic, s.attributes ?? [], s.name, s.id),
      );
      for (const i of ids) for (const s of svcs) viaPolicies.add(key(i.id, s.id));
    }

    const onlyResolver = [...viaResolver].filter((k) => !viaPolicies.has(k));
    const onlyPolicies = [...viaPolicies].filter((k) => !viaResolver.has(k));
    if (onlyResolver.length || onlyPolicies.length) {
      console.log('CONSERVATION symmetric difference', { onlyResolver, onlyPolicies });
    }
    expect(onlyResolver).toEqual([]);
    expect(onlyPolicies).toEqual([]);
  });
});

// ─── health report (logs only — asserts nothing) ──────────────────────────────

describe('trifecta seed world — health report', () => {
  it('logs the report', () => {
    const statuses: TrifectaStatus[] = [
      'NOT_AUTHORIZED',
      'AUTHORIZED_NO_ROUTER',
      'BLOCKED_ROUTERS_OFFLINE',
      'AUTHORIZED_REACHABLE',
    ];
    const buckets = Object.fromEntries(
      statuses.map((s) => [s, pairs.filter((p) => p.status === s).length]),
    );
    const bindBuckets = Object.fromEntries(
      statuses.map((s) => [s, pairs.filter((p) => p.bindStatus === s).length]),
    );

    const servicesNoRouters = world.services
      .filter((s) => enumerateForService(s.id, world)[0]?.routers.serviceRouters.length === 0)
      .map((s) => s.id);
    const identitiesNoRouters = world.identities
      .filter((i) => enumerateForIdentity(i.id, world)[0]?.routers.identityRouters.length === 0)
      .map((i) => i.id);

    const routerMatched = (roles: readonly string[], semantic: 'AllOf' | 'AnyOf', r: (typeof world.edgeRouters)[number]) =>
      entityMatchesRoles(roles, semantic, r.attributes, r.name, r.id);
    const deadRouters = world.edgeRouters
      .filter(
        (r) =>
          !world.edgeRouterPolicies.some((p) => routerMatched(p.edgeRouterRoles, p.semantic, r)) &&
          !world.serviceEdgeRouterPolicies.some((p) => routerMatched(p.edgeRouterRoles, p.semantic, r)),
      )
      .map((r) => r.id);

    const dial = world.policies.filter((p) => p.type === 'dial');
    const bind = world.policies.filter((p) => p.type === 'bind');
    const deadPolicies = (list: typeof dial) => list
      .map((p) => ({
        id: p.id,
        identities: world.identities.filter((i) =>
          entityMatchesRoles(p.identityRoles, p.semantic, i.attributes, i.name, i.id),
        ).length,
        services: world.services.filter((s) =>
          entityMatchesRoles(p.serviceRoles, p.semantic, s.attributes ?? [], s.name, s.id),
        ).length,
      }))
      .filter((d) => d.identities === 0 || d.services === 0);
    const deadDial = deadPolicies(dial);
    const deadBind = deadPolicies(bind);
    const deadList = (dead: typeof deadDial) =>
      dead.map((d) => `${d.id} (ids=${d.identities}, svcs=${d.services})`).join(', ') || '—';

    const badSemantic = world.policies
      .filter((p) => p.semantic !== 'AllOf' && p.semantic !== 'AnyOf')
      .map((p) => p.id);

    const bindPairs = pairs.filter((p) => p.bind.authorized).length;
    const exp = SEED_EXPECTED;
    const vs = (actual: number, expected: number) =>
      `${actual} (expected ${expected}${actual === expected ? '' : ' ← DRIFT'})`;

    const report = [
      '══════ TRIFECTA SEED HEALTH REPORT ══════',
      `Totals: identities=${world.identities.length} services=${world.services.length} ` +
        `routers=${world.edgeRouters.length} dial=${dial.length} bind=${bind.length} ` +
        `ERP=${world.edgeRouterPolicies.length} SERP=${world.serviceEdgeRouterPolicies.length} ` +
        `pairs=${vs(pairs.length, exp.pairs)}`,
      'Dial-side status buckets:',
      ...statuses.map((s) => `  ${s.padEnd(24)} ${vs(buckets[s], exp.buckets[s])}`),
      `Bind-authorized pairs: ${vs(bindPairs, exp.bindPairs)}`,
      'Bind-side status buckets:',
      ...statuses.map((s) => `  ${s.padEnd(24)} ${vs(bindBuckets[s], exp.bindBuckets[s])}`),
      `Services with no routers (no matching SERP) [${servicesNoRouters.length}]: ${servicesNoRouters.join(', ') || '—'}`,
      `Identities with no routers (no matching ERP) [${identitiesNoRouters.length}]: ${identitiesNoRouters.join(', ') || '—'}`,
      `Dead routers (no ERP and no SERP match) [${deadRouters.length}]: ${deadRouters.join(', ') || '—'}`,
      `Dead Dial policies (0 identities or 0 services) [${deadDial.length}]: ${deadList(deadDial)}`,
      `Dead Bind policies (0 identities or 0 services) [${deadBind.length}]: ${deadList(deadBind)}`,
      `Policies with missing/invalid semantic [${badSemantic.length}]: ${badSemantic.join(', ') || '—'}`,
      '═════════════════════════════════════════',
    ].join('\n');
    console.log(report);

    // Spot check: the four trifecta-coverage services across one identity per role.
    const spotIdentities = ['id-001', 'id-002', 'id-004', DISCOVERY_IDENTITIES[0].id];
    const spotServices = ['svc-004', 'svc-005', 'svc-006', 'svc-007'];
    console.table(
      spotIdentities.flatMap((iId) =>
        spotServices.map((sId) => {
          const p = resolve(iId, sId, world);
          const i = world.identities.find((x) => x.id === iId)!;
          const s = world.services.find((x) => x.id === sId)!;
          return {
            identity: `${i.name} [${i.attributes.join(' ') || '—'}]`,
            service: s.name,
            status: p.status,
            dial: p.dial.viaPolicies.join(',') || '—',
            bind: p.bind.viaPolicies.join(',') || '—',
            common: p.routers.common.join(',') || '—',
          };
        }),
      ),
    );
  });
});
