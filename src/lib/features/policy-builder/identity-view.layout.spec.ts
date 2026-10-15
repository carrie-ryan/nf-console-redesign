/**
 * Proves identity-view.layout.ts: the identity lens's three lists (seed, oracle,
 * and a draft) and explainDenied().
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/identity-view.layout.spec.ts`
 */

import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { enumerateForIdentity, type TrifectaWorld } from '../authorization/trifecta-resolver';
import {
  TRIFECTA_EDGE_ROUTERS,
  TRIFECTA_EDGE_ROUTER_POLICIES,
  TRIFECTA_IDENTITIES,
  TRIFECTA_SERVICES,
  TRIFECTA_SERVICE_EDGE_ROUTER_POLICIES,
  TRIFECTA_SERVICE_POLICIES,
} from '../authorization/trifecta.fixtures';
import type { Policy } from '../../shared/services/mock-data.service';
import { applyDraft, type DraftOp } from './draft/policy-draft';
import { explainDenied, groupByReason, layoutIdentityView } from './identity-view.layout';

const oracle: TrifectaWorld = {
  identities: TRIFECTA_IDENTITIES,
  services: TRIFECTA_SERVICES,
  edgeRouters: TRIFECTA_EDGE_ROUTERS,
  policies: TRIFECTA_SERVICE_POLICIES,
  edgeRouterPolicies: TRIFECTA_EDGE_ROUTER_POLICIES,
  serviceEdgeRouterPolicies: TRIFECTA_SERVICE_EDGE_ROUTER_POLICIES,
};

const kioskRule: Policy = {
  id: 'pol-draft-1',
  name: 'new-dial-rule-1',
  createdAt: '2026-10-06T00:00:00Z',
  status: 'active',
  type: 'dial',
  semantic: 'AnyOf',
  identityRoles: ['#kiosks'],
  serviceRoles: ['@svc-004'],
  postureCheckRoles: [],
};
const KIOSKS: DraftOp[] = [{ kind: 'create', policy: kioskRule }];
const KIOSKS_FIXED: DraftOp[] = [
  ...KIOSKS,
  {
    kind: 'create',
    target: 'edgeRouterPolicy',
    policy: {
      id: 'rp-draft-1', name: 'kiosks-git-repo-routers', createdAt: '2026-10-06T00:00:00Z', status: 'active',
      semantic: 'AnyOf', identityRoles: ['#kiosks'], edgeRouterRoles: ['#public'],
    },
  },
];

const ids = (rows: { serviceId: string }[]) => rows.map((r) => r.serviceId);
const idOf = (world: TrifectaWorld, name: string) => world.identities.find((i) => i.name === name)!.id;

describe('layoutIdentityView: the three lists account for every authorized service', () => {
  const worlds: Record<string, TrifectaWorld> = {
    seed: buildSeedWorld(),
    oracle,
    'seed + kiosks draft': applyDraft(buildSeedWorld(), KIOSKS),
  };
  for (const [w, world] of Object.entries(worlds)) {
    it(`${w}: every identity`, () => {
      for (const identity of world.identities) {
        const pairs = enumerateForIdentity(identity.id, world);
        const dial = pairs.filter((p) => p.dial.authorized).map((p) => p.serviceId);
        const bind = pairs.filter((p) => p.bind.authorized).map((p) => p.serviceId);
        const l = layoutIdentityView(identity.id, world);
        const label = `${w}/${identity.name}`;

        expect([...ids(l.canConnect), ...ids(l.cantConnect)].sort(), label).toEqual([...dial].sort());
        expect(ids(l.canConnect).filter((id) => ids(l.cantConnect).includes(id)), label).toEqual([]);
        expect(ids(l.canHost), label).toEqual(bind);
        expect(l.notDialAuthorized.map((s) => s.id), label).toEqual(
          world.services.map((s) => s.id).filter((id) => !dial.includes(id)),
        );
        for (const r of l.cantConnect) expect(r.reason, `${label}/${r.serviceName}`).not.toBeNull();
        for (const r of [...l.canConnect, ...l.canHost]) expect(r.reason).toBeNull();
        for (const r of [...l.canConnect, ...l.cantConnect, ...l.canHost]) expect(r.grants.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('layoutIdentityView: seed identities', () => {
  const seed = buildSeedWorld();

  it('laptop-alice: git-repo connects; offline-svc / no-serp-svc are authorized but blocked', () => {
    const l = layoutIdentityView(idOf(seed, 'laptop-alice'), seed);
    expect(l.canConnect.map((r) => [r.serviceName, r.grants.map((g) => `${g.policyName}:${g.by}`)])).toEqual([
      ['git-repo', ['users-gitlab:rule']],
    ]);
    expect(l.cantConnect.map((r) => [r.serviceName, r.reason])).toEqual([
      ['offline-svc', 'routers offline'],
      ['no-serp-svc', 'no shared router'],
    ]);
    expect(l.canHost).toEqual([]);
    expect(l.routers.map((r) => [r.name, r.via])).toEqual([
      ['edge-public-us-east-1', ['users-public-routers']],
      ['edge-public-us-east-2', ['users-public-routers']],
      ['edge-eu-west-1', ['users-public-routers']],
    ]);
  });

  it('server-build-01 hosts git-repo by name (and api-prod by its #servers rule)', () => {
    const l = layoutIdentityView(idOf(seed, 'server-build-01'), seed);
    expect(l.canHost.map((r) => [r.serviceName, r.status, r.grants])).toEqual([
      ['git-repo', 'AUTHORIZED_REACHABLE', [{ policyId: 'pol-004', policyName: 'git-repo-hosts', by: 'name' }]],
      ['api-prod', 'AUTHORIZED_REACHABLE', [{ policyId: 'pol-003', policyName: 'servers-bind-api', by: 'rule' }]],
    ]);
  });

  it('kiosk-lobby: nothing in the seed; the kiosks rule makes git-repo authorized-but-unreachable; the ERP fix connects it', () => {
    const lobby = idOf(seed, 'kiosk-lobby');
    const before = layoutIdentityView(lobby, seed);
    expect([before.canConnect, before.cantConnect, before.canHost]).toEqual([[], [], []]);

    const drafted = layoutIdentityView(lobby, applyDraft(seed, KIOSKS));
    expect(drafted.cantConnect.map((r) => [r.serviceName, r.reason])).toEqual([['git-repo', 'no shared router']]);
    expect(drafted.routers).toEqual([]);

    const fixed = layoutIdentityView(lobby, applyDraft(seed, KIOSKS_FIXED));
    expect(fixed.canConnect.map((r) => r.serviceName)).toEqual(['git-repo']);
    expect(fixed.cantConnect).toEqual([]);
  });

  it('a reachable dialer with no host is "can\'t connect · no host"', () => {
    // Admins dial api-prod and offline-svc; offline-svc's routers are offline.
    // Deleting git-repo's two Bind policies (pol-004, pol-005) leaves it no host.
    const l = layoutIdentityView(idOf(seed, 'alice@corp.com'), seed);
    expect(l.cantConnect.find((r) => r.serviceName === 'offline-svc')?.reason).toBe('routers offline');
    const noHost = applyDraft(seed, [
      { kind: 'delete', policyId: 'pol-004' },
      { kind: 'delete', policyId: 'pol-005' },
    ]);
    const after = layoutIdentityView(idOf(seed, 'alice@corp.com'), noHost);
    expect(after.cantConnect.find((r) => r.serviceName === 'git-repo')?.reason).toBe('no host');
  });
});

describe('explainDenied', () => {
  it('carol → ops: the mixed all-of policy names alice and needs #prod-access too', () => {
    const e = explainDenied('tri-carol', 'tri-svc-ops', oracle);
    expect(e.message).toBeNull();
    const why = Object.fromEntries(e.policies.map((p) => [p.policyName, p.why]));
    expect(why).toEqual({
      'ops-dial-mixed-allof': 'not named, and lacks #prod-access',
      'break-glass-dial': 'not named',
    });
  });

  it('bob → web: the any-of policy wants #eng or #contractor', () => {
    const e = explainDenied('tri-bob', 'tri-svc-web', oracle);
    const why = Object.fromEntries(e.policies.map((p) => [p.policyName, p.why]));
    expect(why).toEqual({
      'eng-dial-anyof': 'has none of #eng, #contractor',
      'break-glass-dial': 'not named',
    });
  });

  it('a service no Dial policy covers', () => {
    // reports-svc has no policies at all in the seed.
    const e = explainDenied('id-001', 'svc-008', buildSeedWorld());
    expect(e.policies).toEqual([]);
    expect(e.message).toBe('No dial policy covers this service.');
  });

  it('single any-of term reads "lacks"; an authorized identity gets who grants it', () => {
    const seed = buildSeedWorld();
    const lobby = idOf(seed, 'kiosk-lobby');
    const e = explainDenied(lobby, 'svc-004', seed);
    expect(Object.fromEntries(e.policies.map((p) => [p.policyName, p.why]))).toEqual({
      'admins-dev-access': 'lacks #admins',
      'users-gitlab': 'lacks #users',
    });
    expect(explainDenied(idOf(seed, 'laptop-alice'), 'svc-004', seed).message).toBe(
      'laptop-alice is authorized to dial git-repo by users-gitlab.',
    );
  });
});

describe('layoutIdentityView: posture', () => {
  const seed = buildSeedWorld();

  it('carol fails require-mfa: git-repo and api-prod are "blocked by posture"; alice connects to both', () => {
    const carol = layoutIdentityView(idOf(seed, 'carol@corp.com'), seed);
    expect(carol.canConnect).toEqual([]);
    expect(carol.cantConnect.map((r) => [r.serviceName, r.reason])).toEqual(
      expect.arrayContaining([['git-repo', 'blocked by posture'], ['api-prod', 'blocked by posture']]),
    );
    const alice = layoutIdentityView(idOf(seed, 'alice@corp.com'), seed);
    expect(alice.canConnect.map((r) => r.serviceName)).toEqual(expect.arrayContaining(['git-repo', 'api-prod']));
  });
});

describe('groupByReason: the lens\'s can\'t-connect services by reason', () => {
  it('laptop-alice: one group per reason, rows in order', () => {
    const seed = buildSeedWorld();
    const l = layoutIdentityView(idOf(seed, 'laptop-alice'), seed);
    expect(groupByReason(l.cantConnect).map((g) => [g.reason, g.rows.map((r) => r.serviceName)])).toEqual([
      ['routers offline', ['offline-svc']],
      ['no shared router', ['no-serp-svc']],
    ]);
  });

  it('every row lands in its reason\'s group; largest group first', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id, i) => ({
      serviceId: id, serviceName: id, status: 'AUTHORIZED_NO_ROUTER' as const, grants: [], serviceRouters: [],
      reason: (i === 0 ? 'no host' : 'no shared router') as 'no host' | 'no shared router',
    }));
    expect(groupByReason(rows).map((g) => [g.reason, g.rows.map((r) => r.serviceId)])).toEqual([
      ['no shared router', ['b', 'c', 'd']],
      ['no host', ['a']],
    ]);
  });
});
