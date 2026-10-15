import { describe, expect, it } from 'vitest';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import { applyDraft } from './draft/policy-draft';
import { activeHostPolicyIds, hostingChanges, hostingFor, validateTerminators } from './hosting';
import type { Terminator } from '../../shared/services/mock-data.service';

const seed = buildSeedWorld();
const nameOf = (w: TrifectaWorld, id: string) => w.identities.find((i) => i.id === id)!.name;
const names = (w: TrifectaWorld, ids: readonly string[]) => ids.map((id) => nameOf(w, id)).sort();
const withTerminators = (w: TrifectaWorld, ts: Terminator[]): TrifectaWorld => ({ ...w, terminators: ts });
const term = (t: Partial<Terminator>): Terminator => ({
  id: 'term-x', serviceId: 'svc-004', identityId: 'id-014', routerId: 'er-001', precedence: 'default', cost: 0, ...t,
});

describe('validateTerminators', () => {
  it('seed: every terminator is Bind-authorized and on a router its host and service share', () => {
    expect(seed.terminators!.length).toBeGreaterThan(0);
    expect(validateTerminators(seed)).toEqual([]);
    // The same claim, spelled out against the resolver.
    for (const t of seed.terminators!) {
      const pair = resolve(t.identityId, t.serviceId, seed);
      expect(pair.bind.authorized, t.id).toBe(true);
      expect(pair.routers.common, t.id).toContain(t.routerId);
    }
  });

  it('flags impossible terminators: unknown refs, unauthorized host, router not shared', () => {
    const w = withTerminators(seed, [
      term({ id: 'a', serviceId: 'svc-nope' }),
      term({ id: 'b', identityId: 'id-nope' }),
      term({ id: 'c', routerId: 'er-nope' }),
      // alice@corp.com may dial git-repo but not host it.
      term({ id: 'd', identityId: seed.identities.find((i) => i.name === 'alice@corp.com')!.id }),
      // er-004 (#hq) is no route for git-repo (#public only).
      term({ id: 'e', routerId: 'er-004' }),
      term({ id: 'ok' }),
    ]);
    expect(validateTerminators(w)).toEqual([
      { terminatorId: 'a', problem: 'unknownService' },
      { terminatorId: 'b', problem: 'unknownIdentity' },
      { terminatorId: 'c', problem: 'unknownRouter' },
      { terminatorId: 'd', problem: 'orphaned' },
      { terminatorId: 'e', problem: 'routerNotShared' },
    ]);
  });

  it('a draft deleting the policy that authorizes a serving host orphans its terminators', () => {
    // pol-004 is server-build-01's only Bind on git-repo; server-stage-01 keeps pol-005.
    const after = applyDraft(seed, [{ kind: 'delete', policyId: 'pol-004' }]);
    expect(validateTerminators(after)).toEqual([
      { terminatorId: 'term-001', problem: 'orphaned' },
      { terminatorId: 'term-002', problem: 'orphaned' },
    ]);
    const h = hostingFor('svc-004', after);
    expect(names(after, h.servingHosts.map((s) => s.identityId))).toEqual(['server-stage-01']);
    expect(h.authorizedHostIds).not.toContain('id-014');
  });
});

describe('hostingFor — seed', () => {
  it('git-repo: 9 authorized, 2 serving, 2 active, 7 idle', () => {
    const h = hostingFor('svc-004', seed);
    expect(h.strategy).toBe('smartrouting');
    expect(h.authorizedHostIds).toHaveLength(9);
    expect(names(seed, h.servingHosts.map((s) => s.identityId))).toEqual(['server-build-01', 'server-stage-01']);
    for (const s of h.servingHosts) {
      expect(s.terminatorIds).toHaveLength(2);
      expect(s.precedence).toBe('default');
    }
    expect(names(seed, h.activeHostIds)).toEqual(['server-build-01', 'server-stage-01']);
    expect(h.idleAuthorizedHostIds).toHaveLength(7);
    expect(h.idleAuthorizedHostIds.some((id) => h.activeHostIds.includes(id))).toBe(false);
  });

  it('api-prod: 31 authorized, 3 serving, 2 active (the failed one excluded)', () => {
    const h = hostingFor('svc-005', seed);
    expect(h.authorizedHostIds).toHaveLength(31);
    expect(h.servingHosts).toHaveLength(3);
    expect(h.servingHosts.find((s) => s.precedence === 'failed')?.identityId).toBe('id-012');
    expect(names(seed, h.activeHostIds)).toEqual(['server-prod-01', 'server-prod-02']);
    expect(h.idleAuthorizedHostIds).toHaveLength(28);
  });

  it('every other service has no serving hosts', () => {
    for (const s of seed.services.filter((s) => s.id !== 'svc-004' && s.id !== 'svc-005')) {
      const h = hostingFor(s.id, seed);
      expect(h.servingHosts, s.name).toEqual([]);
      expect(h.activeHostIds, s.name).toEqual([]);
      expect(h.idleAuthorizedHostIds, s.name).toEqual(h.authorizedHostIds);
    }
  });

  it('a host is as good as its best terminator; only the top precedence present is active', () => {
    const w = withTerminators(seed, [
      term({ id: 't1', identityId: 'id-014', precedence: 'failed' }),
      term({ id: 't2', identityId: 'id-014', routerId: 'er-003', precedence: 'required' }),
      term({ id: 't3', identityId: 'id-013', precedence: 'default' }),
    ]);
    const h = hostingFor('svc-004', w);
    expect(h.servingHosts.find((s) => s.identityId === 'id-014')).toEqual({
      identityId: 'id-014', terminatorIds: ['t1', 't2'], precedence: 'required',
    });
    expect(h.activeHostIds).toEqual(['id-014']);
  });

  it('terminators on offline routers don\'t count; the validator still accepts them', () => {
    // er-002 is offline but in git-repo's common set with server-build-01.
    const w = withTerminators(seed, [
      term({ id: 'down', identityId: 'id-014', routerId: 'er-002' }),
      term({ id: 'down2', identityId: 'id-013', routerId: 'er-002' }),
      term({ id: 'up', identityId: 'id-013', routerId: 'er-001' }),
    ]);
    expect(validateTerminators(w)).toEqual([]);
    const h = hostingFor('svc-004', w);
    expect(h.servingHosts).toEqual([{ identityId: 'id-013', terminatorIds: ['up'], precedence: 'default' }]);
    expect(h.activeHostIds).toEqual(['id-013']);
    expect(h.idleAuthorizedHostIds).toContain('id-014');
  });

  it('a service with no strategy set defaults to smartrouting', () => {
    const w = { ...seed, services: seed.services.map((s) => ({ ...s, terminatorStrategy: undefined })) };
    expect(hostingFor('svc-004', w).strategy).toBe('smartrouting');
  });
});

describe('activeHostPolicyIds', () => {
  it('git-repo: its two active hosts come from two policies; api-prod: one', () => {
    expect(activeHostPolicyIds('svc-004', seed)).toEqual(['pol-004', 'pol-005']);
    expect(activeHostPolicyIds('svc-005', seed)).toEqual(['pol-003']);
  });
});

describe('hostingChanges', () => {
  it('no draft → nothing', () => {
    expect(hostingChanges(seed, seed)).toEqual([]);
  });

  it('delete pol-004 stops server-build-01; traffic moves to server-stage-01', () => {
    const after = applyDraft(seed, [{ kind: 'delete', policyId: 'pol-004' }]);
    expect(hostingChanges(seed, after)).toEqual([{
      serviceId: 'svc-004', serviceName: 'git-repo',
      stoppedHostNames: ['server-build-01'], remainingHostNames: ['server-stage-01'],
      text: 'server-build-01 is serving git-repo now; this change stops it. Traffic moves to server-stage-01.',
    }]);
  });

  it('deleting both git-repo Bind policies leaves no host serving', () => {
    const after = applyDraft(seed, [{ kind: 'delete', policyId: 'pol-004' }, { kind: 'delete', policyId: 'pol-005' }]);
    expect(hostingChanges(seed, after).map((c) => c.text)).toEqual([
      'server-stage-01 and server-build-01 are serving git-repo now; this change stops them. No host would be left serving git-repo.',
    ]);
  });

  it('a router change that takes a terminator\'s router out of the common set also stops the host', () => {
    // serp-003 → #public minus er-001 and er-003: git-repo keeps only the offline er-002.
    const after = applyDraft(seed, [{ kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: 'serp-003',
      patch: { edgeRouterRoles: ['@er-002'] } }]);
    expect(hostingChanges(seed, after)[0]).toMatchObject({
      serviceId: 'svc-004', stoppedHostNames: ['server-stage-01', 'server-build-01'], remainingHostNames: [] });
  });
});
