/**
 * Proves PolicyDraftStore against a fresh MockDataService seed per test.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/policy-draft.store.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { MockDataService, type Policy } from '../../../shared/services/mock-data.service';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { PolicyDraftStore } from './policy-draft.store';
import type { DraftOp } from './policy-draft';

const kioskDial: Policy = {
  id: 'pol-draft-kiosk',
  name: 'kiosk-git-repo',
  createdAt: '2026-10-06T00:00:00Z',
  status: 'active',
  type: 'dial',
  semantic: 'AnyOf',
  identityRoles: ['@kiosk-lobby'],
  serviceRoles: ['@svc-004'],
  postureCheckRoles: [],
};

const OPS: DraftOp[] = [
  { kind: 'delete', policyId: 'pol-004' },
  { kind: 'update', policyId: 'pol-002', patch: { identityRoles: ['#users', '#kiosks'] } },
  { kind: 'create', policy: kioskDial },
];

describe('PolicyDraftStore', () => {
  let store: PolicyDraftStore;
  let data: MockDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(PolicyDraftStore);
    data = TestBed.inject(MockDataService);
  });

  const addAll = () => OPS.forEach((op) => store.addOp(op));

  it('with no ops, draftWorld equals live and the diff is empty', () => {
    expect(store.draftWorld()).toEqual(buildSeedWorld(data));
    expect(store.diff()).toEqual({ pairChanges: [], services: [], affectedServiceIds: [], configChanges: [], loosenings: [] });
    expect(store.error()).toBeNull();
  });

  it('ops flow through to draftWorld and diff', () => {
    addAll();
    expect(store.ops()).toEqual(OPS);
    expect(store.draftWorld().policies.map((p) => p.id)).toEqual(['pol-001', 'pol-002', 'pol-003', 'pol-005', 'pol-006', kioskDial.id]);
    expect(store.diff().affectedServiceIds).toEqual(['svc-004', 'svc-006', 'svc-007']);
  });

  it('commit makes live equal the old draftWorld, and clears the ops', () => {
    addAll();
    const oldDraft = store.draftWorld();
    store.commit();
    expect(buildSeedWorld(data)).toEqual(oldDraft);
    expect(store.live()).toEqual(oldDraft);
    expect(store.ops()).toEqual([]);
    expect(store.diff().pairChanges).toEqual([]);
  });

  it('discard leaves live unchanged and clears the ops', () => {
    const before = structuredClone(buildSeedWorld(data));
    addAll();
    store.discard();
    expect(buildSeedWorld(data)).toEqual(before);
    expect(store.ops()).toEqual([]);
    expect(store.draftWorld()).toEqual(store.live());
  });

  it('a failed commit leaves live and ops unchanged', () => {
    addAll();
    // Live moves underneath the draft: pol-004 disappears, so the delete op no longer applies.
    data.policies.update((ps) => ps.filter((p) => p.id !== 'pol-004'));
    const live = structuredClone(buildSeedWorld(data));
    const ops = store.ops();

    expect(store.error()).toMatch(/no policy with id 'pol-004'/);
    expect(store.draftWorld()).toEqual(store.live()); // falls back; the view still renders
    // The deleted policy is a touched entity changed in live: a conflict, checked first.
    expect(() => store.commit()).toThrow(/changed in live since you started editing/);
    expect(buildSeedWorld(data)).toEqual(live);
    expect(store.ops()).toBe(ops);
  });

  it('addOp rejects an op that would not apply, and adds nothing', () => {
    store.addOp(OPS[0]);
    expect(() => store.addOp({ kind: 'delete', policyId: 'pol-004' })).toThrow(/no policy with id 'pol-004'/);
    expect(store.ops()).toEqual([OPS[0]]);
  });

  it('removeOp removes by index; out of range throws', () => {
    addAll();
    store.removeOp(1);
    expect(store.ops()).toEqual([OPS[0], OPS[2]]);
    expect(() => store.removeOp(5)).toThrow(/no op at index 5/);
    expect(store.ops()).toEqual([OPS[0], OPS[2]]);
  });

  describe('upsertUpdate', () => {
    it('keeps one update op per policy, merging patches in place', () => {
      store.addOp(OPS[0]);
      store.upsertUpdate('pol-002', { name: 'renamed' });
      store.upsertUpdate('pol-002', { identityRoles: ['#users', '#laptops'] });
      store.upsertUpdate('pol-002', { semantic: 'AllOf' });
      expect(store.ops()).toEqual([
        OPS[0],
        { kind: 'update', policyId: 'pol-002', patch: { name: 'renamed', identityRoles: ['#users', '#laptops'], semantic: 'AllOf' } },
      ]);
      expect(store.marks().get('pol-002')).toBe('edited');
    });

    it('replaces update ops added another way, at the first one\'s position', () => {
      store.addOp({ kind: 'update', policyId: 'pol-002', patch: { name: 'a' } });
      store.addOp(OPS[0]);
      store.addOp({ kind: 'update', policyId: 'pol-002', patch: { semantic: 'AllOf' } });
      store.upsertUpdate('pol-002', { name: 'b' });
      expect(store.ops()).toEqual([
        { kind: 'update', policyId: 'pol-002', patch: { name: 'b', semantic: 'AllOf' } },
        OPS[0],
      ]);
    });

    it('drops the op once the policy is back to live', () => {
      store.upsertUpdate('pol-004', { identityRoles: ['#servers', '#prod'] });
      expect(store.ops()).toHaveLength(1);
      store.upsertUpdate('pol-004', { identityRoles: ['@server-build-01', '#servers', '#prod'] });
      expect(store.ops()).toEqual([]);
      expect(store.marks().size).toBe(0);
    });

    it('folds edits of a draft-created policy into its create op', () => {
      const id = store.createForService('dial', 'svc-004');
      store.upsertUpdate(id, { identityRoles: ['#kiosks'] });
      expect(store.ops()).toHaveLength(1);
      const op = store.ops()[0] as Extract<DraftOp, { kind: 'create' }>;
      expect(op.policy).toMatchObject({ id, type: 'dial', identityRoles: ['#kiosks'], serviceRoles: ['@svc-004'] });
      expect(store.marks().get(id)).toBe('new');
    });

    it('is validated like addOp: an invalid patch throws and changes nothing', () => {
      store.upsertUpdate('pol-002', { name: 'renamed' });
      const before = store.ops();
      expect(() => store.upsertUpdate('pol-002', { semantic: 'OneOf' as Policy['semantic'] })).toThrow(/invalid semantic/);
      expect(() => store.upsertUpdate('nope', { name: 'x' })).toThrow(/no policy with id 'nope'/);
      expect(store.ops()).toBe(before);
    });
  });

  describe('deletePolicy', () => {
    it('replaces the policy\'s pending update with a delete', () => {
      store.upsertUpdate('pol-002', { name: 'renamed' });
      store.deletePolicy('pol-002');
      expect(store.ops()).toEqual([{ kind: 'delete', policyId: 'pol-002' }]);
    });

    it('a draft-created policy just loses its create op', () => {
      const id = store.createForService('bind', 'svc-004');
      store.deletePolicy(id);
      expect(store.ops()).toEqual([]);
    });
  });

  it('createForService picks an unused id and an empty rule on that one service', () => {
    const a = store.createForService('bind', 'svc-006');
    const b = store.createForService('dial', 'svc-006');
    expect(a).not.toBe(b);
    const created = store.draftWorld().policies.find((p) => p.id === a)!;
    expect(created).toMatchObject({ type: 'bind', semantic: 'AnyOf', identityRoles: [], serviceRoles: ['@svc-006'] });
  });

  describe('router policies (upsertUpdate / deletePolicy with a target)', () => {
    it('folds edits into one update, tagged with its target; dropped once equal to live', () => {
      store.upsertUpdate('serp-003', { name: 'renamed' }, 'serviceEdgeRouterPolicy');
      store.upsertUpdate('serp-003', { serviceRoles: ['@svc-004', '@svc-007'] }, 'serviceEdgeRouterPolicy');
      expect(store.ops()).toEqual([{
        kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: 'serp-003',
        patch: { name: 'renamed', serviceRoles: ['@svc-004', '@svc-007'] },
      }]);
      expect(store.routerMark('serviceEdgeRouterPolicy', 'serp-003')).toBe('edited');
      store.upsertUpdate('serp-003', { name: 'git-repo-public-routers', serviceRoles: ['@svc-004'] }, 'serviceEdgeRouterPolicy');
      expect(store.ops()).toEqual([]);
    });

    it('a service policy and a router policy with the same id stay separate', () => {
      store.upsertUpdate('rp-001', { name: 'erp' }, 'edgeRouterPolicy');
      store.deletePolicy('pol-001');
      expect(store.ops()).toEqual([
        { kind: 'update', target: 'edgeRouterPolicy', policyId: 'rp-001', patch: { name: 'erp' } },
        { kind: 'delete', policyId: 'pol-001' },
      ]);
    });

    it('edits to a draft-created router policy fold into its create; deleting it removes the create', () => {
      store.addOp({ kind: 'create', target: 'edgeRouterPolicy', policy: {
        id: 'rp-draft-1', name: 'kiosks-public-routers', createdAt: '2026-10-08T00:00:00Z', status: 'active',
        semantic: 'AnyOf', identityRoles: ['#kiosks'], edgeRouterRoles: ['#public'] } });
      store.upsertUpdate('rp-draft-1', { name: 'kiosk-routers' }, 'edgeRouterPolicy');
      expect(store.ops()).toHaveLength(1);
      expect(store.draftWorld().edgeRouterPolicies.find((p) => p.id === 'rp-draft-1')!.name).toBe('kiosk-routers');
      expect(store.routerMark('edgeRouterPolicy', 'rp-draft-1')).toBe('new');
      store.deletePolicy('rp-draft-1', 'edgeRouterPolicy');
      expect(store.ops()).toEqual([]);
    });

    it('deleting a live router policy adds a delete with its target', () => {
      store.deletePolicy('serp-005', 'serviceEdgeRouterPolicy');
      expect(store.ops()).toEqual([{ kind: 'delete', target: 'serviceEdgeRouterPolicy', policyId: 'serp-005' }]);
      expect(store.draftWorld().serviceEdgeRouterPolicies.some((p) => p.id === 'serp-005')).toBe(false);
    });
  });
});
