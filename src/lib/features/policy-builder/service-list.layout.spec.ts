/**
 * Proves service-list.layout.ts (the policy builder's entry list) and the
 * service view's "applies to all services" mark (coversOnlyViaAll).
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/service-list.layout.spec.ts`
 */

import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import type { Policy } from '../../shared/services/mock-data.service';
import { applyDraft } from './draft/policy-draft';
import { filterServiceList, layoutServiceList, policyCountText } from './service-list.layout';
import { coversOnlyViaAll, layoutServiceView } from './service-view.layout';

const seed = buildSeedWorld();
const rowOf = (name: string, world = seed) => layoutServiceList(world).find((r) => r.name === name)!;

const policy = (over: Partial<Policy>): Policy => ({
  id: 'pol-x', name: 'x', createdAt: '2026-10-07T00:00:00Z', status: 'active', type: 'dial',
  semantic: 'AnyOf', identityRoles: ['#admins'], serviceRoles: ['#all'], postureCheckRoles: [], ...over,
});

describe('layoutServiceList', () => {
  it('lists every service, in world order, with its verdict', () => {
    const rows = layoutServiceList(seed);
    expect(rows.map((r) => r.id)).toEqual(seed.services.map((s) => s.id));
    for (const r of rows) expect(r.verdict).toEqual(layoutServiceView(r.id, seed).serviceVerdict);
  });

  it('reports-svc: no policies at all, no host', () => {
    const r = rowOf('reports-svc');
    expect([r.bind, r.dial, r.viaAll]).toEqual([0, 0, 0]);
    expect(policyCountText(r)).toBe('No policies yet');
    expect(r.verdict.text).toBe('No one can connect · no host');
  });

  it('git-repo: its own Bind and Dial policies (admins-dev-access names #git, so it counts)', () => {
    const r = rowOf('git-repo');
    expect([r.bind, r.dial, r.viaAll]).toEqual([2, 2, 0]);
    expect(policyCountText(r)).toBe('2 Bind · 2 Dial');
  });

  it('a policy reaching a service only via #all is counted apart', () => {
    const world = applyDraft(seed, [{ kind: 'create', policy: policy({ id: 'pol-all' }) }]);
    const reports = rowOf('reports-svc', world);
    expect([reports.bind, reports.dial, reports.viaAll]).toEqual([0, 0, 1]);
    expect(policyCountText(reports)).toBe('No policies yet');
    expect([rowOf('git-repo', world).dial, rowOf('git-repo', world).viaAll]).toEqual([2, 1]);
  });

  it('counts follow the draft', () => {
    const svc = seed.services.find((s) => s.name === 'reports-svc')!.id;
    const world = applyDraft(seed, [
      { kind: 'create', policy: policy({ id: 'pol-d1', type: 'bind', identityRoles: [], serviceRoles: [`@${svc}`] }) },
    ]);
    expect(policyCountText(rowOf('reports-svc', world))).toBe('1 Bind · 0 Dial');
  });

  it('search matches name, attribute and intercept address, case-insensitively', () => {
    const rows = layoutServiceList(seed);
    expect(filterServiceList(rows, 'REPORTS').map((r) => r.name)).toEqual(['reports-svc']);
    expect(filterServiceList(rows, '#apis').map((r) => r.name)).toEqual(['api-prod']);
    expect(filterServiceList(rows, 'db.corp').map((r) => r.name)).toEqual(['postgres-db']);
    expect(filterServiceList(rows, '  ')).toHaveLength(rows.length);
    expect(filterServiceList(rows, 'nope')).toEqual([]);
  });
});

describe('coversOnlyViaAll / Group.appliesToAll', () => {
  const svc = { id: 'svc-x', name: 'svc-x', attributes: ['#reports'] };

  it('#all alone covers only via #all; naming or matching the service makes it its own', () => {
    expect(coversOnlyViaAll(policy({ serviceRoles: ['#all'] }), svc)).toBe(true);
    expect(coversOnlyViaAll(policy({ serviceRoles: ['#all', '@svc-x'] }), svc)).toBe(false);
    expect(coversOnlyViaAll(policy({ serviceRoles: ['#all', '#reports'] }), svc)).toBe(false);
    expect(coversOnlyViaAll(policy({ serviceRoles: ['#all', '#reports'], semantic: 'AllOf' }), svc)).toBe(false);
    expect(coversOnlyViaAll(policy({ serviceRoles: ['#reports'] }), svc)).toBe(false);
    // Doesn't cover it at all.
    expect(coversOnlyViaAll(policy({ serviceRoles: ['#all', '#git'], semantic: 'AllOf' }), svc)).toBe(false);
  });

  // Inline world: the seed plus one '#all' Dial policy (the seed itself has none).
  const withAll = applyDraft(seed, [
    { kind: 'create', policy: policy({ id: 'pol-all', name: 'everyone-everywhere', identityRoles: ['#admins'] }) },
  ]);

  it('the seed marks nothing', () => {
    for (const s of seed.services) {
      const l = layoutServiceView(s.id, seed);
      expect([...l.bind.groups, ...l.dial.groups].filter((g) => g.appliesToAll), s.name).toEqual([]);
    }
  });

  it('reports-svc with an #all policy: an empty Bind lane and the #all group marked', () => {
    const l = layoutServiceView('svc-008', withAll);
    expect(l.bind.groups).toEqual([]);
    expect(l.dial.groups.map((g) => [g.policyName, g.appliesToAll])).toEqual([['everyone-everywhere', true]]);
  });

  it('git-repo with an #all policy: only that policy is marked', () => {
    const l = layoutServiceView('svc-004', withAll);
    expect([...l.bind.groups, ...l.dial.groups].map((g) => [g.policyName, g.appliesToAll])).toEqual([
      ['git-repo-hosts', false],
      ['git-repo-hosts', false],
      ['git-servers-host', false],
      ['admins-dev-access', false],
      ['everyone-everywhere', true],
      ['users-gitlab', false],
    ]);
  });
});
