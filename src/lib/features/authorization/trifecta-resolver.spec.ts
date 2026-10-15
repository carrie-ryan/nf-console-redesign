/**
 * Proves trifecta-resolver.ts against the hand-authored oracle (TRIFECTA_EXPECTED
 * in trifecta.fixtures.ts):
 *   (a) every one of the 20 pairs resolves to its expected status
 *   (b) AUTHORIZED_NO_ROUTER sub-cases match the oracle's noRouterCase
 *   (c) invariants — authorized ⇔ viaPolicies non-empty (dial + bind); common is
 *       the exact intersection; the Bind trap never leaks into Dial; identity-axis
 *       and service-axis enumeration agree for every pair (status and bindStatus)
 *   (d) bindStatus matches TRIFECTA_EXPECTED_BIND for every pair (incl. sub-cases)
 *
 * Run `npx ng test --watch=false --include src/lib/features/authorization/trifecta-resolver.spec.ts`
 * — the per-pair resolved vs expected table is dumped to the console.
 */

import {
  TRIFECTA_EDGE_ROUTERS,
  TRIFECTA_EDGE_ROUTER_POLICIES,
  TRIFECTA_EXPECTED,
  TRIFECTA_EXPECTED_BIND,
  TRIFECTA_IDENTITIES,
  TRIFECTA_SERVICES,
  TRIFECTA_SERVICE_EDGE_ROUTER_POLICIES,
  TRIFECTA_SERVICE_POLICIES,
  trifectaPairKey,
} from './trifecta.fixtures';
import {
  enumerateForIdentity,
  enumerateForService,
  resolve,
  type ResolvedPair,
  type TrifectaWorld,
} from './trifecta-resolver';

const world: TrifectaWorld = {
  identities: TRIFECTA_IDENTITIES,
  services: TRIFECTA_SERVICES,
  edgeRouters: TRIFECTA_EDGE_ROUTERS,
  policies: TRIFECTA_SERVICE_POLICIES,
  edgeRouterPolicies: TRIFECTA_EDGE_ROUTER_POLICIES,
  serviceEdgeRouterPolicies: TRIFECTA_SERVICE_EDGE_ROUTER_POLICIES,
};

const allPairs: ResolvedPair[] = TRIFECTA_IDENTITIES.flatMap((i) =>
  TRIFECTA_SERVICES.map((s) => resolve(i.id, s.id, world)),
);

describe('trifecta resolver — vs oracle', () => {
  it('dumps resolved vs expected', () => {
    console.table(
      allPairs.map((p) => {
        const exp = TRIFECTA_EXPECTED[trifectaPairKey(p.identityId, p.serviceId)];
        return {
          pair: trifectaPairKey(p.identityId, p.serviceId),
          resolved: p.status,
          expected: exp.state,
          bindResolved: p.bindStatus,
          bindExpected: TRIFECTA_EXPECTED_BIND[trifectaPairKey(p.identityId, p.serviceId)].state,
          noRouterCase: exp.noRouterCase ?? '',
          dial: p.dial.viaPolicies.join(','),
          bind: p.bind.viaPolicies.join(','),
          common: p.routers.common.join(','),
        };
      }),
    );
    expect(allPairs.length).toBe(20);
  });

  // (a)
  for (const p of allPairs) {
    const key = trifectaPairKey(p.identityId, p.serviceId);
    it(`${key} → ${TRIFECTA_EXPECTED[key].state}`, () => {
      expect(p.status).toBe(TRIFECTA_EXPECTED[key].state);
    });
  }

  // (b)
  it('no-router sub-cases match the oracle (disjoint vs no-SERP)', () => {
    for (const p of allPairs) {
      const exp = TRIFECTA_EXPECTED[trifectaPairKey(p.identityId, p.serviceId)];
      if (exp.noRouterCase === 'disjoint') {
        expect(p.routers.serviceRouters.length).toBeGreaterThan(0);
        expect(p.routers.common).toEqual([]);
      } else if (exp.noRouterCase === 'no-serp') {
        expect(p.routers.serviceRouters).toEqual([]);
      }
    }
  });
});

// (d)
describe('trifecta resolver — Bind status vs Bind oracle', () => {
  for (const p of allPairs) {
    const key = trifectaPairKey(p.identityId, p.serviceId);
    it(`${key} → bind ${TRIFECTA_EXPECTED_BIND[key].state}`, () => {
      expect(p.bindStatus).toBe(TRIFECTA_EXPECTED_BIND[key].state);
    });
  }

  it('Bind no-router sub-cases match the oracle (disjoint vs no-SERP)', () => {
    for (const p of allPairs) {
      const exp = TRIFECTA_EXPECTED_BIND[trifectaPairKey(p.identityId, p.serviceId)];
      if (exp.noRouterCase === 'disjoint') {
        expect(p.routers.serviceRouters.length).toBeGreaterThan(0);
        expect(p.routers.common).toEqual([]);
      } else if (exp.noRouterCase === 'no-serp') {
        expect(p.routers.serviceRouters).toEqual([]);
      }
    }
  });

  it('bindStatus is NOT_AUTHORIZED exactly when bind is not authorized', () => {
    for (const p of allPairs) expect(p.bindStatus === 'NOT_AUTHORIZED').toBe(!p.bind.authorized);
  });
});

// (c)
describe('trifecta resolver — invariants', () => {
  it('authorized ⇔ viaPolicies non-empty, for dial and bind', () => {
    for (const p of allPairs) {
      expect(p.dial.authorized).toBe(p.dial.viaPolicies.length > 0);
      expect(p.bind.authorized).toBe(p.bind.viaPolicies.length > 0);
    }
  });

  it('common is the exact intersection of identityRouters and serviceRouters', () => {
    for (const p of allPairs) {
      const { identityRouters, serviceRouters, common } = p.routers;
      const iSet = new Set(identityRouters);
      const sSet = new Set(serviceRouters);
      const cSet = new Set(common);
      // ⊆ both sides …
      for (const r of common) {
        expect(iSet.has(r)).toBe(true);
        expect(sSet.has(r)).toBe(true);
      }
      // … and nothing in both sides is missing from common.
      for (const r of identityRouters) if (sSet.has(r)) expect(cSet.has(r)).toBe(true);
      for (const r of serviceRouters) if (iSet.has(r)) expect(cSet.has(r)).toBe(true);
      expect(cSet.size).toBe(common.length);
    }
  });

  it('Bind trap: carol→db is Bind-authorized but NOT Dial-authorized', () => {
    const p = resolve('tri-carol', 'tri-svc-db', world);
    expect(p.bind.authorized).toBe(true);
    expect(p.dial.authorized).toBe(false);
    expect(p.status).toBe('NOT_AUTHORIZED');
  });

  it('mixed AllOf: @ref unioned, # terms AllOf (alice ✓ by name, bob ✓ by terms, carol ✗)', () => {
    const viaOps = (id: string) => resolve(id, 'tri-svc-ops', world).dial.viaPolicies.includes('tri-dial-ops');
    expect(viaOps('tri-alice')).toBe(true);
    expect(viaOps('tri-bob')).toBe(true);
    expect(viaOps('tri-carol')).toBe(false);
  });

  it('axis symmetry: identity-axis and service-axis enumeration agree for every pair', () => {
    for (const i of TRIFECTA_IDENTITIES) {
      for (const s of TRIFECTA_SERVICES) {
        const fromIdentity = enumerateForIdentity(i.id, world).filter((p) => p.serviceId === s.id);
        const fromService = enumerateForService(s.id, world).filter((p) => p.identityId === i.id);
        expect(fromIdentity.length).toBe(1);
        expect(fromService.length).toBe(1);
        expect(fromIdentity[0].status).toBe(fromService[0].status);
        expect(fromIdentity[0].bindStatus).toBe(fromService[0].bindStatus);
        expect([...fromIdentity[0].routers.common].sort()).toEqual([...fromService[0].routers.common].sort());
      }
    }
  });
});
