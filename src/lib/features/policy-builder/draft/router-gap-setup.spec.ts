/**
 * Proves router-gap fix (c), "Set up routing for both": offered when neither the
 * group nor the service has any router. Built on an inline world — the seed's
 * identities, services and edge routers with NO policies of any kind.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/router-gap-setup.spec.ts`
 */

import type { Policy } from '../../../shared/services/mock-data.service';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { resolve } from '../../authorization/trifecta-resolver';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { layoutServiceView } from '../service-view.layout';
import { applyDraft, type DraftOp } from './policy-draft';
import { gapFixPreview, routerGap, type GapFix, type RouterGap } from './router-gap';
import { diffWorlds } from './draft-diff';

/** A fix's preview, as the panel computes it (lazily): from the diff of its ops. */
const previewOf = (world: TrifectaWorld, gap: RouterGap, fix: GapFix) => {
  const after = applyDraft(world, fix.ops);
  return gapFixPreview(world, gap, after, diffWorlds(world, after));
};

const REPORTS = 'svc-008';

const empty = (): TrifectaWorld => ({
  ...buildSeedWorld(),
  policies: [],
  edgeRouterPolicies: [],
  serviceEdgeRouterPolicies: [],
});

const rule = (id: string, type: Policy['type'], identityRoles: string[]): DraftOp => ({
  kind: 'create',
  policy: {
    id, name: `new-${type}-rule`, createdAt: '2026-10-07T00:00:00Z', status: 'active', type,
    semantic: 'AnyOf', identityRoles, serviceRoles: [`@${REPORTS}`], postureCheckRoles: [],
  },
});
const HOST = rule('pol-host', 'bind', ['@server-build-01']);
const DIAL = rule('pol-dial', 'dial', ['#users']);

describe('router gap fix (c): set up routing for both', () => {
  it('the policy-free world: every verdict is "No one can connect · no host"', () => {
    const world = empty();
    for (const s of world.services) {
      expect(layoutServiceView(s.id, world).serviceVerdict.text, s.name).toBe('No one can connect · no host');
    }
  });

  it('reports-svc from nothing: named host, #users dial rule, router fixes, a terminator → N of N can connect', () => {
    let world = applyDraft(empty(), [HOST, DIAL]);
    const verdict = () => layoutServiceView(REPORTS, world).serviceVerdict;
    expect(verdict().text).toBe('No one can connect · no host with an online route');

    // Host group: neither it nor reports-svc has a router → (c) is the only fix.
    const hostGap = routerGap(world, REPORTS, 'bind:pol-host:named', 'noSharedRouter')!;
    expect(hostGap.fixes.map((f) => f.kind)).toEqual(['both']);
    expect(hostGap.unavailable).toEqual([]);
    const c = hostGap.fixes[0];
    expect(c.ops).toMatchObject([
      { kind: 'create', target: 'edgeRouterPolicy', policy: { semantic: 'AnyOf', identityRoles: ['@server-build-01'] } },
      { kind: 'create', target: 'serviceEdgeRouterPolicy', policy: { serviceRoles: [`@${REPORTS}`] } },
    ]);
    // The online routers (er-001, er-003, er-004) share no attribute → @refs, the same on both sides.
    const [erp, serp] = c.ops.map((op) => (op as { policy: { edgeRouterRoles: string[] } }).policy.edgeRouterRoles);
    expect(erp).toEqual(['@er-001', '@er-003', '@er-004']);
    expect(serp).toEqual(erp);
    expect(c.lines).toHaveLength(2);
    expect(previewOf(world, hostGap, c).text).toBe('Online route for 1 of 1 in this group · 1 host in total');
    world = applyDraft(world, c.ops);
    expect(verdict().hostsReachable).toBe(1);

    // Dial group: also no routers — but now reports-svc has some, so (c) isn't offered.
    const dialGap = routerGap(world, REPORTS, 'dial:pol-dial:rule', 'noSharedRouter')!;
    expect(dialGap.fixes.map((f) => f.kind)).not.toContain('both');
    const a = dialGap.fixes.find((f) => f.kind === 'erp')!;
    // Policies and routes are now complete; no one connects until the host serves.
    expect(previewOf(world, dialGap, a).canConnectAfter).toBe(0);
    world = applyDraft(world, a.ops);
    expect(verdict().text).toBe('No one can connect · no host serving yet');

    const host = world.identities.find((i) => i.name === 'server-build-01')!.id;
    const [routerId] = resolve(host, REPORTS, world).routers.common;
    world = { ...world, terminators: [{ id: 't', serviceId: REPORTS, identityId: host, routerId, precedence: 'default', cost: 0 }] };
    expect(verdict().text).toBe('16 of 16 can connect · 1 of 1 host serving');
  });

  it('fix (c) on the dial group alone also gives its members a route', () => {
    const world = applyDraft(empty(), [DIAL]);
    const gap = routerGap(world, REPORTS, 'dial:pol-dial:rule', 'noSharedRouter')!;
    const c = gap.fixes.find((f) => f.kind === 'both')!;
    expect(c.ops[0]).toMatchObject({ policy: { identityRoles: ['#users'], semantic: 'AnyOf' } });
    expect(previewOf(world, gap, c).text).toBe(
      'Online route for 16 of 16 in this group · 16 dialers in total · still no host, so no one can connect',
    );
  });

  it('no online router → (c) is unavailable, with the reason', () => {
    const offline = empty();
    const world = applyDraft(
      { ...offline, edgeRouters: offline.edgeRouters.map((r) => ({ ...r, isOnline: false })) },
      [DIAL],
    );
    const gap = routerGap(world, REPORTS, 'dial:pol-dial:rule', 'noSharedRouter')!;
    expect(gap.fixes).toEqual([]);
    expect(gap.unavailable).toEqual(['No router is online, so there is none to set up routing through.']);
  });

  it('not offered when the group already has routers (seed: server-build-01 gets #public via rp-003)', () => {
    const world = applyDraft(buildSeedWorld(), [HOST]);
    const gap = routerGap(world, REPORTS, 'bind:pol-host:named', 'noSharedRouter')!;
    expect(gap.fixes.map((f) => f.kind)).toEqual(['serp']);
  });
});
