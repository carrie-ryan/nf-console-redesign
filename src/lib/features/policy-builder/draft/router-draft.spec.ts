/**
 * Router-policy drafts (edge router policies + service edge router policies) on the
 * MockDataService seed world: apply, validate, diff, describe, commit.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/router-draft.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { resolve } from '../../authorization/trifecta-resolver';
import {
  MockDataService,
  type EdgeRouterPolicy,
  type Policy,
  type ServiceEdgeRouterPolicy,
} from '../../../shared/services/mock-data.service';
import { layoutServiceView } from '../service-view.layout';
import { diffWorlds } from './draft-diff';
import { describeOps } from './draft-summary';
import { applyDraft, type DraftOp } from './policy-draft';
import { PolicyDraftStore } from './policy-draft.store';

const T = '2026-10-06T00:00:00Z';

const kioskDial: Policy = {
  id: 'pol-draft-1',
  name: 'new-dial-rule-1',
  createdAt: T,
  status: 'active',
  type: 'dial',
  semantic: 'AnyOf',
  identityRoles: ['#kiosks'],
  serviceRoles: ['@svc-004'],
  postureCheckRoles: [],
};

const kioskErp: EdgeRouterPolicy = {
  id: 'rp-draft-1',
  name: 'kiosks-public-routers',
  createdAt: T,
  status: 'active',
  semantic: 'AllOf',
  identityRoles: ['#kiosks'],
  edgeRouterRoles: ['#public'],
};

const noSerpSerp: ServiceEdgeRouterPolicy = {
  id: 'serp-draft-1',
  name: 'no-serp-svc-public-routers',
  semantic: 'AllOf',
  serviceRoles: ['@svc-007'],
  edgeRouterRoles: ['#public'],
};

const KIOSKS_REACHABLE: DraftOp[] = [
  { kind: 'create', policy: kioskDial },
  { kind: 'create', target: 'edgeRouterPolicy', policy: kioskErp },
];

/** Router-only: every kind of op on both router collections. */
const ROUTER_ONLY: DraftOp[] = [
  { kind: 'create', target: 'edgeRouterPolicy', policy: kioskErp },
  { kind: 'update', target: 'edgeRouterPolicy', policyId: 'rp-001', patch: { edgeRouterRoles: ['@er-002'] } },
  { kind: 'delete', target: 'edgeRouterPolicy', policyId: 'rp-004' },
  { kind: 'create', target: 'serviceEdgeRouterPolicy', policy: noSerpSerp },
  { kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: 'serp-005', patch: { edgeRouterRoles: ['#public'] } },
  { kind: 'delete', target: 'serviceEdgeRouterPolicy', policyId: 'serp-003' },
];

describe('applyDraft: router-policy targets', () => {
  const live = buildSeedWorld();

  it('applies each op to its own collection; the others keep their reference', () => {
    const erpOnly = applyDraft(live, [{ kind: 'create', target: 'edgeRouterPolicy', policy: kioskErp }]);
    expect(erpOnly.edgeRouterPolicies.at(-1)).toEqual(kioskErp);
    expect(erpOnly.policies).toBe(live.policies);
    expect(erpOnly.serviceEdgeRouterPolicies).toBe(live.serviceEdgeRouterPolicies);

    const draft = applyDraft(live, ROUTER_ONLY);
    expect(draft.policies).toBe(live.policies);
    expect(draft.edgeRouterPolicies.map((p) => p.id)).toEqual(['rp-001', 'rp-002', 'rp-003', 'rp-sys-er-001', 'rp-sys-er-003', 'rp-draft-1']);
    expect(draft.edgeRouterPolicies[0].edgeRouterRoles).toEqual(['@er-002']);
    expect(draft.serviceEdgeRouterPolicies.map((p) => p.id)).toEqual([
      'serp-001', 'serp-002', 'serp-004', 'serp-005', 'serp-006', 'serp-draft-1',
    ]);
  });

  it('a missing target means servicePolicy', () => {
    const a = applyDraft(live, [{ kind: 'delete', policyId: 'pol-004' }]);
    const b = applyDraft(live, [{ kind: 'delete', target: 'servicePolicy', policyId: 'pol-004' }]);
    expect(a).toEqual(b);
    expect(a.policies.some((p) => p.id === 'pol-004')).toBe(false);
  });

  it('ids are looked up in the targeted collection only', () => {
    expect(() => applyDraft(live, [{ kind: 'delete', target: 'edgeRouterPolicy', policyId: 'pol-001' }])).toThrow(
      /no edge router policy with id 'pol-001'/,
    );
    expect(() => applyDraft(live, [{ kind: 'delete', policyId: 'rp-001' }])).toThrow(/no policy with id 'rp-001'/);
    const dup = { ...noSerpSerp, id: 'serp-001' };
    expect(() => applyDraft(live, [{ kind: 'create', target: 'serviceEdgeRouterPolicy', policy: dup }])).toThrow(
      /duplicate service edge router policy id 'serp-001'/,
    );
  });

  it('is pure across every collection', () => {
    const snapshot = structuredClone(live);
    applyDraft(live, [{ kind: 'create', policy: kioskDial }, ...ROUTER_ONLY]);
    expect(live).toEqual(snapshot);
  });

  describe('validation per type', () => {
    const bad = (op: unknown) => () => applyDraft(live, [op as DraftOp]);
    const noRoles = <T extends object>(p: T, key: keyof T) => {
      const copy = { ...p };
      delete copy[key];
      return copy;
    };

    it('an ERP needs identityRoles and edgeRouterRoles', () => {
      expect(bad({ kind: 'create', target: 'edgeRouterPolicy', policy: noRoles(kioskErp, 'identityRoles') })).toThrow(
        /edge router policy 'rp-draft-1' needs identityRoles/,
      );
      expect(bad({ kind: 'create', target: 'edgeRouterPolicy', policy: noRoles(kioskErp, 'edgeRouterRoles') })).toThrow(
        /needs edgeRouterRoles/,
      );
      expect(bad({ kind: 'update', target: 'edgeRouterPolicy', policyId: 'rp-001', patch: { identityRoles: '#users' } })).toThrow(
        /needs identityRoles/,
      );
    });

    it('a SERP needs serviceRoles and edgeRouterRoles', () => {
      expect(bad({ kind: 'create', target: 'serviceEdgeRouterPolicy', policy: noRoles(noSerpSerp, 'serviceRoles') })).toThrow(
        /service edge router policy 'serp-draft-1' needs serviceRoles/,
      );
      expect(bad({ kind: 'create', target: 'serviceEdgeRouterPolicy', policy: noRoles(noSerpSerp, 'edgeRouterRoles') })).toThrow(
        /needs edgeRouterRoles/,
      );
    });

    it('both need a valid semantic', () => {
      expect(bad({ kind: 'create', target: 'edgeRouterPolicy', policy: { ...kioskErp, semantic: 'OneOf' } })).toThrow(
        /edge router policy 'rp-draft-1' has invalid semantic 'OneOf'/,
      );
      expect(bad({ kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: 'serp-001', patch: { semantic: 'x' } })).toThrow(
        /service edge router policy 'serp-001' has invalid semantic 'x'/,
      );
    });

    it('an unknown target is rejected', () => {
      expect(bad({ kind: 'delete', target: 'router', policyId: 'rp-001' })).toThrow(/invalid target 'router'/);
    });
  });
});

describe('diffWorlds: router-policy drafts', () => {
  const live = buildSeedWorld();

  it('kiosks dial rule + ERP #kiosks → #public: git-repo canConnect 17 → 23 (carol blocked by posture)', () => {
    const diff = diffWorlds(live, applyDraft(live, KIOSKS_REACHABLE));
    const git = diff.services.find((s) => s.serviceId === 'svc-004')!;
    expect(git.verdictBefore).toMatchObject({ canConnect: 17, dialTotal: 18 });
    expect(git.verdictAfter).toMatchObject({ canConnect: 23, dialTotal: 24 });
    expect(git.changed).toBe(true);
  });

  it('a router-only draft never changes authorization: pairs only move among the authorized statuses', () => {
    const draft = applyDraft(live, ROUTER_ONLY);
    const diff = diffWorlds(live, draft);
    expect(diff.pairChanges.length).toBeGreaterThan(0);
    const authorized = ['AUTHORIZED_NO_ROUTER', 'BLOCKED_ROUTERS_OFFLINE', 'AUTHORIZED_REACHABLE'];
    for (const c of diff.pairChanges) {
      expect(authorized, `${c.identityId}/${c.serviceId}/${c.track} before`).toContain(c.before);
      expect(authorized, `${c.identityId}/${c.serviceId}/${c.track} after`).toContain(c.after);
    }
    // Every pair, not only the changed ones: the same policies grant it.
    for (const s of live.services) {
      for (const i of live.identities) {
        const a = resolve(i.id, s.id, live);
        const b = resolve(i.id, s.id, draft);
        expect(b.dial).toEqual(a.dial);
        expect(b.bind).toEqual(a.bind);
      }
    }
  });

  it('SERP @svc-007 → #public: no-serp-svc gains eligible routers; every changed verdict is in diff.services', () => {
    const draft = applyDraft(live, [{ kind: 'create', target: 'serviceEdgeRouterPolicy', policy: noSerpSerp }]);
    expect(layoutServiceView('svc-007', live).routers.eligible).toEqual([]);
    expect(layoutServiceView('svc-007', draft).routers.eligible.map((r) => r.id)).toEqual(['er-001', 'er-002', 'er-003']);

    const diff = diffWorlds(live, draft);
    const changed = live.services
      .map((s) => s.id)
      .filter((id) => {
        const [a, b] = [layoutServiceView(id, live).serviceVerdict, layoutServiceView(id, draft).serviceVerdict];
        return a.canConnect !== b.canConnect || a.dialTotal !== b.dialTotal ||
          a.hostsReachable !== b.hostsReachable || a.hostsServing !== b.hostsServing || a.reason !== b.reason;
      });
    expect(diff.services.filter((s) => s.changed).map((s) => s.serviceId)).toEqual(changed);
    // no-serp-svc's host (server-stage-01, git-servers-host) and dialers all gain a
    // route over #public, so its verdict changes — to the runtime reason: the host
    // has no terminator on no-serp-svc.
    const noSerp = diff.services.find((s) => s.serviceId === 'svc-007')!;
    expect(noSerp.changed).toBe(true);
    expect(layoutServiceView('svc-007', draft).serviceVerdict.text).toBe('No one can connect · no host serving yet');
    expect(diff.pairChanges.filter((c) => c.serviceId === 'svc-007').every((c) => c.before === 'AUTHORIZED_NO_ROUTER')).toBe(true);
    expect(diff.affectedServiceIds).toEqual(['svc-007']);
  });
});

describe('describeOps: router-policy lines', () => {
  const live = buildSeedWorld();

  it('create / update / delete for both router collections', () => {
    expect(describeOps(live, ROUTER_ONLY)).toEqual([
      'Created router access: #kiosks → #public',
      'Updated users-public-routers (router access): removed router #public; added router @edge-public-us-east-2',
      'Deleted admins-public-routers (router access)',
      'Created service routing: @no-serp-svc → #public',
      'Updated offline-svc-east-2 (service routing): removed router @edge-public-us-east-2; added router #public',
      'Deleted git-repo-public-routers (service routing)',
    ]);
  });

  it('service-policy lines are unchanged alongside them', () => {
    expect(describeOps(live, KIOSKS_REACHABLE)).toEqual([
      'Created dial rule for git-repo: #kiosks',
      'Created router access: #kiosks → #public',
    ]);
  });
});

describe('PolicyDraftStore.commit: mixed draft', () => {
  it('writes policies, edgeRouterPolicies and serviceEdgeRouterPolicies', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(PolicyDraftStore);
    const data = TestBed.inject(MockDataService);

    for (const op of [...KIOSKS_REACHABLE, { kind: 'create', target: 'serviceEdgeRouterPolicy', policy: noSerpSerp } as DraftOp]) {
      store.addOp(op);
    }
    const draft = store.draftWorld();
    store.commit();

    expect(data.policies().at(-1)).toEqual(kioskDial);
    expect(data.edgeRouterPolicies().at(-1)).toEqual(kioskErp);
    expect(data.serviceEdgeRouterPolicies().at(-1)).toEqual(noSerpSerp);
    expect(buildSeedWorld(data)).toEqual(draft);
    expect(store.ops()).toEqual([]);
    expect(layoutServiceView('svc-004', store.live()).serviceVerdict.canConnect).toBe(23);
  });

  it('only the collections a draft touches are written', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(PolicyDraftStore);
    const data = TestBed.inject(MockDataService);
    const [policies, serps] = [data.policies(), data.serviceEdgeRouterPolicies()];

    store.addOp({ kind: 'create', target: 'edgeRouterPolicy', policy: kioskErp });
    store.commit();
    expect(data.policies()).toBe(policies);
    expect(data.serviceEdgeRouterPolicies()).toBe(serps);
    expect(data.edgeRouterPolicies().at(-1)).toEqual(kioskErp);
  });

  it('editor ops ignore router-policy ops with the same id', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(PolicyDraftStore);
    store.addOp({ kind: 'create', target: 'edgeRouterPolicy', policy: { ...kioskErp, id: 'pol-002' } });
    store.upsertUpdate('pol-002', { name: 'renamed' });
    expect(store.ops()).toHaveLength(2);
    expect(store.marks().get('pol-002')).toBe('edited');
    store.deletePolicy('pol-002');
    expect(store.ops().map((op) => [op.kind, op.target ?? 'servicePolicy'])).toEqual([
      ['create', 'edgeRouterPolicy'],
      ['delete', 'servicePolicy'],
    ]);
  });
});
