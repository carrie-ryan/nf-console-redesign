/**
 * Consistency + completeness checks for the TRIFECTA ORACLE (trifecta.fixtures.ts).
 *
 * This spec does NOT call a resolver. It re-derives each pair's structural
 * preconditions with a deliberately tiny, independent role matcher (NOT imported
 * from authorization-resolver.ts, so the oracle never inherits the code it will
 * later judge) and asserts:
 *   (a) the oracle covers the full identity × service cross-product, nothing extra
 *   (b) every declared state's preconditions actually hold in the data
 *   (c) all four terminal states + both NO_ROUTER sub-cases are represented
 *   (d) every declared matcher-coverage tag genuinely holds, and all four appear
 *   (e) Bind is represented, and the Bind trap never stands in for Dial
 *   (f) the Bind oracle (TRIFECTA_EXPECTED_BIND): same completeness, per-pair
 *       preconditions (on Bind grants) and four-state coverage as Dial
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
  type MatcherCoverage,
  type TrifectaExpectation,
  type TrifectaState,
} from './trifecta.fixtures';
import type { EdgeRouter, Policy } from '../../shared/services/mock-data.service';

// ─── independent oracle-side matcher (Ziti role semantics) ────────────────────

interface Matchable {
  id: string;
  name: string;
  attributes?: readonly string[];
}

function roleOk(role: string, e: Matchable): boolean {
  if (role === '#all') return true;
  if (role.startsWith('@')) return role.slice(1) === e.id || role.slice(1) === e.name;
  return (e.attributes ?? []).includes(role);
}

/** (@refs naming e) ∪ (# terms under the semantic). No # terms → the # part is empty. */
function matches(roles: readonly string[], semantic: Policy['semantic'], e: Matchable): boolean {
  const refs = roles.filter((r) => r.startsWith('@'));
  const terms = roles.filter((r) => !r.startsWith('@'));
  if (refs.some((r) => roleOk(r, e))) return true;
  if (terms.length === 0) return false;
  return semantic === 'AllOf' ? terms.every((r) => roleOk(r, e)) : terms.some((r) => roleOk(r, e));
}

const identityById = new Map(TRIFECTA_IDENTITIES.map((i) => [i.id, i]));
const serviceById = new Map(TRIFECTA_SERVICES.map((s) => [s.id, s]));

const routersFor = (edgeRouterRoles: readonly string[], semantic: Policy['semantic']) =>
  TRIFECTA_EDGE_ROUTERS.filter((r) => matches(edgeRouterRoles, semantic, r));

function erOfIdentity(identityId: string): Set<string> {
  const i = identityById.get(identityId)!;
  const ids = new Set<string>();
  for (const p of TRIFECTA_EDGE_ROUTER_POLICIES) {
    if (!matches(p.identityRoles, p.semantic, i)) continue;
    for (const r of routersFor(p.edgeRouterRoles, p.semantic)) ids.add(r.id);
  }
  return ids;
}

const matchingSerps = (serviceId: string) =>
  TRIFECTA_SERVICE_EDGE_ROUTER_POLICIES.filter((p) =>
    matches(p.serviceRoles, p.semantic, serviceById.get(serviceId)!),
  );

function erOfService(serviceId: string): Set<string> {
  const ids = new Set<string>();
  for (const p of matchingSerps(serviceId)) {
    for (const r of routersFor(p.edgeRouterRoles, p.semantic)) ids.add(r.id);
  }
  return ids;
}

const policiesMatching = (type: Policy['type'], identityId: string, serviceId: string) =>
  TRIFECTA_SERVICE_POLICIES.filter(
    (p) =>
      p.type === type &&
      matches(p.identityRoles, p.semantic, identityById.get(identityId)!) &&
      matches(p.serviceRoles, p.semantic, serviceById.get(serviceId)!),
  );

const routerById = new Map<string, EdgeRouter>(TRIFECTA_EDGE_ROUTERS.map((r) => [r.id, r]));

function commonRouters(identityId: string, serviceId: string): EdgeRouter[] {
  const svcEr = erOfService(serviceId);
  return [...erOfIdentity(identityId)].filter((id) => svcEr.has(id)).map((id) => routerById.get(id)!);
}

const splitKey = (key: string) => {
  const [identityId, serviceId] = key.split('|');
  return { identityId, serviceId };
};

const entries = Object.entries(TRIFECTA_EXPECTED);

// ─── (a) completeness ─────────────────────────────────────────────────────────

describe('trifecta oracle — completeness', () => {
  it('entity ids are unique per collection', () => {
    for (const list of [TRIFECTA_IDENTITIES, TRIFECTA_SERVICES, TRIFECTA_EDGE_ROUTERS]) {
      expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
    }
  });

  it('covers EXACTLY the identity × service cross-product', () => {
    const expectedKeys = TRIFECTA_IDENTITIES.flatMap((i) =>
      TRIFECTA_SERVICES.map((s) => trifectaPairKey(i.id, s.id)),
    ).sort();
    expect(Object.keys(TRIFECTA_EXPECTED).sort()).toEqual(expectedKeys);
  });

  it('every pair key resolves to a real identity and service', () => {
    for (const [key] of entries) {
      const { identityId, serviceId } = splitKey(key);
      expect(identityById.has(identityId), key).toBe(true);
      expect(serviceById.has(serviceId), key).toBe(true);
    }
  });
});

// ─── (b) per-pair structural preconditions ────────────────────────────────────

/** One track's per-pair preconditions — the grant comes from that track's policies. */
function describePreconditions(track: Policy['type'], expected: Record<string, TrifectaExpectation>) {
  for (const [key, exp] of Object.entries(expected)) {
    it(`${key} → ${exp.state}${exp.noRouterCase ? ` (${exp.noRouterCase})` : ''}`, () => {
      const { identityId, serviceId } = splitKey(key);
      const grants = policiesMatching(track, identityId, serviceId);
      const common = commonRouters(identityId, serviceId);

      if (exp.state === 'NOT_AUTHORIZED') {
        expect(grants, `no ${track} policy may match`).toEqual([]);
        expect(exp.coverage, 'unauthorized pairs carry no coverage').toBeUndefined();
        expect(exp.noRouterCase).toBeUndefined();
        return;
      }

      expect(grants.length, `some ${track} policy must match`).toBeGreaterThan(0);

      switch (exp.state) {
        case 'AUTHORIZED_NO_ROUTER':
          expect(common, 'ER(identity) ∩ ER(service) must be ∅').toEqual([]);
          if (exp.noRouterCase === 'no-serp') {
            expect(matchingSerps(serviceId), 'service must match NO SERP').toEqual([]);
            expect(erOfService(serviceId).size).toBe(0);
          } else if (exp.noRouterCase === 'disjoint') {
            // Both sides genuinely have routers — the gap is the missing overlap.
            expect(erOfIdentity(identityId).size, 'identity has routers').toBeGreaterThan(0);
            expect(erOfService(serviceId).size, 'service has routers').toBeGreaterThan(0);
          } else {
            throw new Error(`${key}: AUTHORIZED_NO_ROUTER must declare noRouterCase`);
          }
          break;

        case 'BLOCKED_ROUTERS_OFFLINE':
          expect(exp.noRouterCase).toBeUndefined();
          expect(common.length, 'common routers must exist').toBeGreaterThan(0);
          expect(common.every((r) => !r.isOnline), 'ALL common routers offline').toBe(true);
          break;

        case 'AUTHORIZED_REACHABLE':
          expect(exp.noRouterCase).toBeUndefined();
          expect(common.some((r) => r.isOnline), 'an online common router').toBe(true);
          break;
      }
    });
  }
}

describe('trifecta oracle — every declared state holds in the data', () => {
  describePreconditions('dial', TRIFECTA_EXPECTED);
});

// ─── (c) terminal-state coverage ──────────────────────────────────────────────

describe('trifecta oracle — terminal-state coverage', () => {
  const states = new Set(entries.map(([, e]) => e.state));
  const allStates: TrifectaState[] = [
    'NOT_AUTHORIZED',
    'AUTHORIZED_NO_ROUTER',
    'BLOCKED_ROUTERS_OFFLINE',
    'AUTHORIZED_REACHABLE',
  ];

  it('all four terminal states are represented', () => {
    for (const s of allStates) expect(states.has(s), s).toBe(true);
  });

  it('both AUTHORIZED_NO_ROUTER sub-cases are represented', () => {
    const cases = new Set(entries.map(([, e]) => e.noRouterCase).filter(Boolean));
    expect(cases.has('disjoint')).toBe(true);
    expect(cases.has('no-serp')).toBe(true);
  });

  it('a REACHABLE pair has an offline router in its common set (one online suffices)', () => {
    const mixed = entries.some(([key, e]) => {
      if (e.state !== 'AUTHORIZED_REACHABLE') return false;
      const { identityId, serviceId } = splitKey(key);
      return commonRouters(identityId, serviceId).some((r) => !r.isOnline);
    });
    expect(mixed).toBe(true);
  });
});

// ─── (d) matcher coverage ─────────────────────────────────────────────────────

describe('trifecta oracle — matcher coverage', () => {
  const holds: Record<MatcherCoverage, (identityId: string, dial: Policy[]) => boolean> = {
    // Matched by a direct @ref, and the identity carries no attribute any matching
    // Dial policy names on the identity axis (no attribute match, no #all).
    'at-id': (identityId, dial) => {
      const i = identityById.get(identityId)!;
      const viaRef = dial.some((p) =>
        p.identityRoles.some((r) => r.startsWith('@') && roleOk(r, i)),
      );
      const viaAttr = dial.some((p) =>
        p.identityRoles.some((r) => r === '#all' || (!r.startsWith('@') && i.attributes.includes(r))),
      );
      return viaRef && !viaAttr;
    },
    // An AllOf Dial policy needing 2+ distinct '#attr' roles on the identity axis.
    'allof-multi': (_id, dial) =>
      dial.some(
        (p) =>
          p.semantic === 'AllOf' &&
          p.identityRoles.filter((r) => r.startsWith('#') && r !== '#all').length >= 2,
      ),
    'anyof': (_id, dial) => dial.some((p) => p.semantic === 'AnyOf'),
    'all-wildcard': (_id, dial) =>
      dial.some((p) => p.identityRoles.includes('#all') || p.serviceRoles.includes('#all')),
  };

  it('every declared coverage tag genuinely holds for its pair', () => {
    for (const [key, e] of entries) {
      const { identityId, serviceId } = splitKey(key);
      const dial = policiesMatching('dial', identityId, serviceId);
      for (const tag of e.coverage ?? []) {
        expect(holds[tag](identityId, dial), `${key}: ${tag}`).toBe(true);
      }
    }
  });

  it('all four matcher-coverage cases are represented', () => {
    const tags = new Set(entries.flatMap(([, e]) => e.coverage ?? []));
    for (const t of Object.keys(holds) as MatcherCoverage[]) expect(tags.has(t), t).toBe(true);
  });

  it('AllOf is genuinely stricter: the one-attribute near-miss is NOT matched', () => {
    const allOf = TRIFECTA_SERVICE_POLICIES.find((p) => p.id === 'tri-dial-dba')!;
    expect(matches(allOf.identityRoles, 'AllOf', identityById.get('tri-carol')!)).toBe(false);
    expect(matches(allOf.identityRoles, 'AnyOf', identityById.get('tri-carol')!)).toBe(true);
  });

  it('mixed AllOf: @ref unioned outside the semantic; # terms still AllOf', () => {
    const mixed = TRIFECTA_SERVICE_POLICIES.find((p) => p.id === 'tri-dial-ops')!;
    expect(mixed.semantic).toBe('AllOf');
    expect(mixed.identityRoles.some((r) => r.startsWith('@'))).toBe(true);
    expect(mixed.identityRoles.filter((r) => r.startsWith('#')).length).toBeGreaterThanOrEqual(2);
    const dialsOps = (id: string) => policiesMatching('dial', id, 'tri-svc-ops').some((p) => p.id === mixed.id);
    // named, lacks every # term → authorized
    expect(identityById.get('tri-alice')!.attributes.some((a) => mixed.identityRoles.includes(a))).toBe(false);
    expect(dialsOps('tri-alice')).toBe(true);
    // carries every # term → authorized
    expect(dialsOps('tri-bob')).toBe(true);
    // one # term only, not named → not authorized
    expect(dialsOps('tri-carol')).toBe(false);
    expect(TRIFECTA_EXPECTED[trifectaPairKey('tri-carol', 'tri-svc-ops')].state).toBe('NOT_AUTHORIZED');
  });
});

// ─── (e) Bind ─────────────────────────────────────────────────────────────────

describe('trifecta oracle — Bind', () => {
  it('at least one Bind policy is present', () => {
    expect(TRIFECTA_SERVICE_POLICIES.some((p) => p.type === 'bind')).toBe(true);
  });

  it('the Bind trap matches carol→db, yet the Dial oracle says NOT_AUTHORIZED', () => {
    expect(policiesMatching('bind', 'tri-carol', 'tri-svc-db').length).toBeGreaterThan(0);
    expect(TRIFECTA_EXPECTED[trifectaPairKey('tri-carol', 'tri-svc-db')].state).toBe('NOT_AUTHORIZED');
  });
});

// ─── (f) Bind oracle ──────────────────────────────────────────────────────────

describe('trifecta Bind oracle — completeness', () => {
  it('covers EXACTLY the same pairs as the Dial oracle', () => {
    expect(Object.keys(TRIFECTA_EXPECTED_BIND).sort()).toEqual(Object.keys(TRIFECTA_EXPECTED).sort());
  });

  it('carries no matcher coverage tags', () => {
    for (const [key, e] of Object.entries(TRIFECTA_EXPECTED_BIND)) expect(e.coverage, key).toBeUndefined();
  });
});

describe('trifecta Bind oracle — every declared state holds in the data', () => {
  describePreconditions('bind', TRIFECTA_EXPECTED_BIND);
});

describe('trifecta Bind oracle — terminal-state coverage', () => {
  const bindEntries = Object.values(TRIFECTA_EXPECTED_BIND);

  it('all four terminal states are represented', () => {
    const states = new Set(bindEntries.map((e) => e.state));
    for (const s of ['NOT_AUTHORIZED', 'AUTHORIZED_NO_ROUTER', 'BLOCKED_ROUTERS_OFFLINE', 'AUTHORIZED_REACHABLE'] as const) {
      expect(states.has(s), s).toBe(true);
    }
  });

  it('both AUTHORIZED_NO_ROUTER sub-cases are represented', () => {
    const cases = new Set(bindEntries.map((e) => e.noRouterCase).filter(Boolean));
    expect(cases.has('disjoint')).toBe(true);
    expect(cases.has('no-serp')).toBe(true);
  });
});
