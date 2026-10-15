/**
 * The non-policy draft targets — posture checks, a service's terminator strategy, an
 * identity's hosting defaults: nothing reaches MockDataService until commit, change
 * lines, diff reach, and validation (observed state is never a target).
 */

import { TestBed } from '@angular/core/testing';
import { MockDataService, type PostureCheck } from '../../../shared/services/mock-data.service';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { checkUsage } from './config-effects';
import { describeOps, effectRows } from './draft-summary';
import { applyDraft, type DraftOp } from './policy-draft';
import { PolicyDraftStore } from './policy-draft.store';

const newCheck: PostureCheck = {
  id: 'pc-draft-1', name: 'corp-domain', createdAt: '2026-10-08T00:00:00Z', status: 'active',
  type: 'Domain', attributes: ['#corp-domain'], domains: ['corp.example'],
};

describe('config draft targets: nothing reaches MockDataService until commit', () => {
  let store: PolicyDraftStore;
  let data: MockDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(PolicyDraftStore);
    data = TestBed.inject(MockDataService);
  });

  it('postureCheck create', () => {
    const before = data.postureChecks();
    store.addOp({ kind: 'create', target: 'postureCheck', policy: newCheck });
    expect(data.postureChecks()).toBe(before);
    expect(store.draftWorld().postureChecks!.map((c) => c.id)).toContain('pc-draft-1');
    store.commit();
    expect(data.postureChecks().find((c) => c.id === 'pc-draft-1')).toEqual(newCheck);
    expect(store.ops()).toEqual([]);
  });

  it('postureCheck update', () => {
    const before = data.postureChecks();
    store.upsertUpdate('pc-001', { timeoutSeconds: 900 }, 'postureCheck');
    expect(data.postureChecks()).toBe(before);
    store.commit();
    expect(data.postureChecks().find((c) => c.id === 'pc-001')!.timeoutSeconds).toBe(900);
  });

  it('postureCheck delete', () => {
    store.deletePolicy('pc-002', 'postureCheck');
    expect(data.postureChecks().some((c) => c.id === 'pc-002')).toBe(true);
    store.commit();
    expect(data.postureChecks().some((c) => c.id === 'pc-002')).toBe(false);
  });

  it('service: terminatorStrategy', () => {
    const before = data.services();
    store.upsertUpdate('svc-004', { terminatorStrategy: 'weighted' }, 'service');
    expect(data.services()).toBe(before);
    expect(store.draftWorld().services.find((s) => s.id === 'svc-004')!.terminatorStrategy).toBe('weighted');
    store.commit();
    expect(data.services().find((s) => s.id === 'svc-004')!.terminatorStrategy).toBe('weighted');
  });

  it('identity: default hosting precedence and cost', () => {
    const before = data.identities();
    store.upsertUpdate('id-014', { hostingPrecedence: 'required', hostingCost: 10 }, 'identity');
    expect(data.identities()).toBe(before);
    store.commit();
    expect(data.identities().find((i) => i.id === 'id-014')).toMatchObject({ hostingPrecedence: 'required', hostingCost: 10 });
  });

  it('terminators and posture results are untouched by any commit', () => {
    const terminators = data.terminators();
    const results = data.postureResults();
    store.upsertUpdate('svc-004', { terminatorStrategy: 'random' }, 'service');
    store.upsertUpdate('id-014', { hostingPrecedence: 'failed' }, 'identity');
    store.deletePolicy('pc-001', 'postureCheck');
    store.commit();
    expect(data.terminators()).toBe(terminators);
    expect(data.postureResults()).toBe(results);
  });

  it('setting a value back to live drops the op', () => {
    store.upsertUpdate('svc-004', { terminatorStrategy: 'weighted' }, 'service');
    store.upsertUpdate('svc-004', { terminatorStrategy: 'smartrouting' }, 'service');
    expect(store.ops()).toEqual([]);
  });
});

describe('config draft targets: change lines and diff', () => {
  const seed = buildSeedWorld();
  const run = (ops: DraftOp[]) => {
    const store = TestBed.inject(PolicyDraftStore);
    ops.forEach((op) => store.addOp(op));
    return store;
  };
  beforeEach(() => TestBed.configureTestingModule({}));

  it('editing require-mfa: used by admins-dev-access; the diff reaches git-repo and api-prod', () => {
    expect(checkUsage(seed, 'pc-001').map((p) => p.name)).toEqual(['admins-dev-access']);
    const ops: DraftOp[] = [{ kind: 'update', target: 'postureCheck', policyId: 'pc-001', patch: { timeoutSeconds: 900 } }];
    expect(describeOps(seed, ops)).toEqual(['Updated posture check require-mfa: timeout 1800 s → 900 s · used by 1 policy']);
    const diff = run(ops).diff();
    const reached = diff.configChanges.map((c) => c.serviceId);
    expect(reached).toEqual(expect.arrayContaining(['svc-004', 'svc-005']));
    // A definition change moves no count, but every reached service still gets a row.
    expect(diff.affectedServiceIds).toEqual(reached);
    expect(diff.services.every((s) => !s.changed)).toBe(true);
    const git = diff.configChanges.find((c) => c.serviceId === 'svc-004')!;
    expect(git.lines).toEqual(['Posture check require-mfa redefined (timeout 1800 s → 900 s) · required here by admins-dev-access']);
  });

  it('deleting require-mfa unblocks carol: the counts move and the line says so', () => {
    const ops: DraftOp[] = [{ kind: 'delete', target: 'postureCheck', policyId: 'pc-001' }];
    expect(describeOps(seed, ops)).toEqual(['Deleted posture check require-mfa · was used by 1 policy']);
    const store = run(ops);
    const [row] = effectRows(store.diff(), seed, 'svc-004');
    expect(row).toMatchObject({ serviceName: 'git-repo', canConnect: { before: 17, after: 18 }, postureLine: '−1 blocked by posture' });
    expect(row.configLines).toEqual(['Posture check require-mfa deleted · admins-dev-access no longer requires it']);
  });

  it('a new check no policy uses reaches no service', () => {
    const ops: DraftOp[] = [{ kind: 'create', target: 'postureCheck', policy: newCheck }];
    expect(describeOps(seed, ops)).toEqual(['Created posture check corp-domain (Domain): #corp-domain · not used by any policy']);
    expect(run(ops).diff().configChanges).toEqual([]);
  });

  it('terminator strategy: one line, on that service only', () => {
    const ops: DraftOp[] = [{ kind: 'update', target: 'service', policyId: 'svc-004', patch: { terminatorStrategy: 'weighted' } }];
    expect(describeOps(seed, ops)).toEqual(["Set git-repo's terminator strategy: smartrouting → weighted"]);
    expect(run(ops).diff().configChanges).toEqual([{ serviceId: 'svc-004', lines: ['Terminator strategy: smartrouting → weighted'] }]);
  });

  it('hosting defaults: on every service the identity may host', () => {
    const ops: DraftOp[] = [{ kind: 'update', target: 'identity', policyId: 'id-013', patch: { hostingPrecedence: 'required', hostingCost: 10 } }];
    expect(describeOps(seed, ops)).toEqual(["Set server-stage-01's hosting defaults: precedence default → required; cost 0 → 10"]);
    // server-stage-01 hosts every #git service (git-servers-host) and is #servers (api-prod).
    expect(run(ops).diff().configChanges.map((c) => c.serviceId)).toEqual(['svc-004', 'svc-005', 'svc-006', 'svc-007']);
  });
});

describe('config draft targets: validation', () => {
  const seed = buildSeedWorld();
  const fails = (op: DraftOp | Record<string, unknown>, msg: RegExp) =>
    expect(() => applyDraft(seed, [op as DraftOp])).toThrow(msg);

  it('services and identities are update-only, and only in their config fields', () => {
    fails({ kind: 'delete', target: 'service', policyId: 'svc-004' }, /can only update a service/);
    fails({ kind: 'update', target: 'service', policyId: 'svc-004', patch: { name: 'x' } }, /can't change a service's name/);
    fails({ kind: 'update', target: 'identity', policyId: 'id-014', patch: { attributes: [] } }, /can't change an identity's attributes/);
    fails({ kind: 'update', target: 'service', policyId: 'svc-004', patch: { terminatorStrategy: 'fastest' } }, /invalid terminator strategy/);
    fails({ kind: 'update', target: 'identity', policyId: 'id-014', patch: { hostingCost: 70000 } }, /invalid hosting cost/);
    fails({ kind: 'update', target: 'identity', policyId: 'id-014', patch: { hostingPrecedence: 'top' } }, /invalid hosting precedence/);
  });

  it('a posture check needs a name and a known type', () => {
    fails({ kind: 'create', target: 'postureCheck', policy: { ...newCheck, name: ' ' } }, /needs a name/);
    fails({ kind: 'update', target: 'postureCheck', policyId: 'pc-001', patch: { type: 'Retina' } }, /invalid type 'Retina'/);
  });

  it('observed state is not a target: terminators and posture results can\'t be drafted', () => {
    fails({ kind: 'delete', target: 'terminator', policyId: 'term-001' }, /invalid target 'terminator'/);
    fails({ kind: 'update', target: 'postureResult', policyId: 'id-004', patch: {} }, /invalid target 'postureResult'/);
  });
});
