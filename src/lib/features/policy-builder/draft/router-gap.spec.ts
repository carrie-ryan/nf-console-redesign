/**
 * Proves router-gap.ts (gap rows, offline notes, suggested fixes + previews) and
 * the review panel's route lines, on the MockDataService seed world.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/router-gap.spec.ts`
 */

import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import type { EdgeRouterPolicy, Policy } from '../../../shared/services/mock-data.service';
import { layoutServiceView } from '../service-view.layout';
import { diffWorlds } from './draft-diff';
import { effectRows } from './draft-summary';
import { applyDraft, type DraftOp } from './policy-draft';
import { gapFixPreview, routerGap, routerRoles, type GapFix, type RouterGap } from './router-gap';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';

/** A fix's preview, as the panel computes it (lazily): from the diff of its ops. */
const previewOf = (world: TrifectaWorld, gap: RouterGap, fix: GapFix) => {
  const after = applyDraft(world, fix.ops);
  return gapFixPreview(world, gap, after, diffWorlds(world, after));
};

const kioskRule = (semantic: Policy['semantic']): Policy => ({
  id: 'pol-draft-1',
  name: 'new-dial-rule-1',
  createdAt: '2026-10-06T00:00:00Z',
  status: 'active',
  type: 'dial',
  semantic,
  identityRoles: ['#kiosks'],
  serviceRoles: ['@svc-004'],
  postureCheckRoles: [],
});

const withKiosks = (semantic: Policy['semantic'] = 'AnyOf') =>
  applyDraft(buildSeedWorld(), [{ kind: 'create', policy: kioskRule(semantic) }]);

describe('routerGap: no shared router (kiosks dial rule on git-repo)', () => {
  it('lists the 6 kiosks in one row with no routers, beside git-repo\'s routers and their SERPs', () => {
    const gap = routerGap(withKiosks(), 'svc-004', 'dial:pol-draft-1:rule', 'noSharedRouter')!;
    expect(gap.memberIds).toHaveLength(6);
    expect(gap.rows).toHaveLength(1);
    expect(gap.rows[0].routers).toEqual([]);
    expect(gap.serviceRouters.map((r) => [r.name, r.isOnline, r.via])).toEqual([
      ['edge-public-us-east-1', true, ['git-repo-public-routers']],
      ['edge-public-us-east-2', false, ['git-repo-public-routers']],
      ['edge-eu-west-1', true, ['git-repo-public-routers']],
    ]);
    expect(gap.offlineNotes).toEqual([]);
  });

  it('the suggested ERP copies the group\'s rule terms AND semantic', () => {
    for (const semantic of ['AnyOf', 'AllOf'] as const) {
      const gap = routerGap(withKiosks(semantic), 'svc-004', 'dial:pol-draft-1:rule', 'noSharedRouter')!;
      const erp = gap.fixes.find((f) => f.kind === 'erp')!;
      expect(erp.ops[0]).toMatchObject({
        kind: 'create',
        target: 'edgeRouterPolicy',
        policy: { semantic, identityRoles: ['#kiosks'], edgeRouterRoles: ['#public'] },
      });
      expect(erp.workaround).toBe(false);
    }
  });

  it('fix (a) previews and, applied, makes git-repo canConnect 23 (carol blocked by posture)', () => {
    const world = withKiosks();
    const gap = routerGap(world, 'svc-004', 'dial:pol-draft-1:rule', 'noSharedRouter')!;
    const erp = gap.fixes.find((f) => f.kind === 'erp')!;
    expect(erp.lines).toEqual(['Created router access: #kiosks → #public']);
    expect(previewOf(world, gap, erp)).toEqual({
      gained: 6,
      of: 6,
      totalGained: 6,
      canConnectBefore: 17,
      canConnectAfter: 23,
      otherServices: 0,
      text: 'Online route for 6 of 6 in this group · 6 dialers in total · git-repo: 17 → 23 can connect',
    });

    const fixed = applyDraft(world, [erp.ops[0]]);
    expect(layoutServiceView('svc-004', fixed).serviceVerdict.canConnect).toBe(23);
    expect(layoutServiceView('svc-004', fixed).serviceVerdict.text).toBe('23 of 24 can connect · 1 blocked by posture · 2 of 9 hosts serving');
    // The gap it explained is gone.
    expect(routerGap(fixed, 'svc-004', 'dial:pol-draft-1:rule', 'noSharedRouter')!.memberIds).toEqual([]);
  });

  it('kiosks have no routers at all, so fix (b) is not offered — and says why', () => {
    const gap = routerGap(withKiosks(), 'svc-004', 'dial:pol-draft-1:rule', 'noSharedRouter')!;
    expect(gap.fixes.map((f) => f.kind)).toEqual(['erp']);
    expect(gap.unavailable).toEqual(['These identities have no online router to route git-repo through.']);
  });
});

describe('routerGap: no shared router (no-serp-svc)', () => {
  const world = buildSeedWorld();
  const gap = routerGap(world, 'svc-007', 'dial:pol-002:rule', 'noSharedRouter')!;

  it('the service has no routers, so only fix (b) — extending the SERP that already routes to #public', () => {
    expect(gap.serviceRouters).toEqual([]);
    expect(gap.fixes.map((f) => [f.kind, f.form])).toEqual([['serp', 'extend']]);
    expect(gap.unavailable).toEqual(['no-serp-svc has no online router to give them.']);
    const serp = gap.fixes[0];
    // serp-001/003/004 all reach #public; serp-003 wins: @refs-only, and the fewest services.
    expect(serp.title).toBe('Add no-serp-svc to git-repo-public-routers');
    expect(serp.ops[0]).toEqual({
      kind: 'update',
      target: 'serviceEdgeRouterPolicy',
      policyId: 'serp-003',
      patch: { serviceRoles: ['@svc-004', '@svc-007'] },
    });
    expect(serp.lines).toEqual(['Updated git-repo-public-routers (service routing): added service @no-serp-svc']);
    // Every dialer gains a route, and so does its one host (server-stage-01, via
    // git-servers-host) — but that host has no terminator on no-serp-svc, so no one
    // can connect yet.
    expect(previewOf(world, gap, serp)).toMatchObject({ gained: 16, of: 16, totalGained: 18, canConnectBefore: 0, canConnectAfter: 0, otherServices: 0 });
    expect(previewOf(world, gap, serp).text).toBe(
      'Online route for 16 of 16 in this group · 18 dialers in total · no host serving yet, so no one can connect',
    );
  });

  it('the create form sits behind it, and both have the same preview and result', () => {
    const extend = gap.fixes[0];
    const create = extend.alternative!;
    expect(create.form).toBe('create');
    expect(create.alternative).toBeNull();
    expect(create.ops[0]).toMatchObject({
      kind: 'create',
      target: 'serviceEdgeRouterPolicy',
      policy: { semantic: 'AllOf', serviceRoles: ['@svc-007'], edgeRouterRoles: ['#public'] },
    });
    expect(create.lines).toEqual(['Created service routing: @no-serp-svc → #public']);
    expect(previewOf(world, gap, extend)).toEqual(previewOf(world, gap, create));

    const viaExtend = applyDraft(world, [extend.ops[0]]);
    const viaCreate = applyDraft(world, [create.ops[0]]);
    expect(diffWorlds(world, viaExtend)).toEqual(diffWorlds(world, viaCreate));
    for (const svc of world.services) {
      const [a, b] = [layoutServiceView(svc.id, viaExtend), layoutServiceView(svc.id, viaCreate)];
      expect(a.routers, svc.id).toEqual(b.routers);
      expect(a.serviceVerdict, svc.id).toEqual(b.serviceVerdict);
    }
  });

  it('extending a SERP changes no other service\'s eligible routers', () => {
    const after = applyDraft(world, [gap.fixes[0].ops[0]]);
    for (const svc of world.services.filter((x) => x.id !== 'svc-007')) {
      expect(layoutServiceView(svc.id, after).routers, svc.id).toEqual(layoutServiceView(svc.id, world).routers);
    }
    expect(layoutServiceView('svc-007', after).routers.eligible.map((r) => r.id)).toEqual(['er-001', 'er-002', 'er-003']);
  });

  it('applied, the review row gets a route line for its dialers and its host', () => {
    const after = applyDraft(world, [gap.fixes[0].ops[0]]);
    const [row] = effectRows(diffWorlds(world, after), world, 'svc-007');
    expect(row.serviceName).toBe('no-serp-svc');
    expect(row.routeLines).toEqual([
      '18 dialers gained an online route · no host serving yet, so no one can connect',
      '1 host gained an online route',
    ]);
    expect(row.newDialers).toBeNull();
  });

  it('without its host (git-servers-host deleted), the route line says "still no host"', () => {
    const noHost = applyDraft(world, [{ kind: 'delete', policyId: 'pol-005' }]);
    const after = applyDraft(noHost, [gap.fixes[0].ops[0]]);
    const [row] = effectRows(diffWorlds(noHost, after), noHost, 'svc-007');
    expect(row.routeLines).toEqual(['18 dialers gained an online route · still no host, so no one can connect']);
  });
});

describe('routerGap: routers offline (offline-svc)', () => {
  const gap = routerGap(buildSeedWorld(), 'svc-006', 'dial:pol-002:rule', 'routersOffline')!;

  it('explains the outage per offline router', () => {
    expect(gap.memberIds).toHaveLength(16);
    expect(gap.offlineNotes).toEqual(['Router edge-public-us-east-2 is offline; this is an outage, not a policy gap.']);
  });

  it('offers only workarounds; (a) needs an online router the service uses, and it has none', () => {
    expect(gap.fixes.map((f) => [f.kind, f.form, f.workaround])).toEqual([['serp', 'extend', true]]);
    expect(gap.fixes[0].ops[0]).toMatchObject({ kind: 'update', policyId: 'serp-003', patch: { serviceRoles: ['@svc-004', '@svc-006'] } });
    expect(gap.fixes[0].alternative!.ops[0]).toMatchObject({ policy: { serviceRoles: ['@svc-006'], edgeRouterRoles: ['#public'] } });
    expect(gap.unavailable).toEqual(['offline-svc has no online router to give them.']);
  });
});

describe('routerGap: extending an edge router policy', () => {
  /** An AnyOf ERP reaching #public — the only kind fix (a) may extend. */
  const anyOfErp: EdgeRouterPolicy = {
    id: 'rp-any',
    name: 'misc-public-routers',
    createdAt: '2026-10-06T00:00:00Z',
    status: 'active',
    semantic: 'AnyOf',
    identityRoles: ['#contractors'],
    edgeRouterRoles: ['#public'],
  };

  it('AllOf ERPs are never chosen: the seed\'s #public ERPs are all AllOf, so the kiosks fix creates', () => {
    const world = withKiosks();
    expect(world.edgeRouterPolicies.filter((p) => p.edgeRouterRoles.includes('#public')).map((p) => p.semantic))
      .toEqual(['AllOf', 'AllOf', 'AllOf']);
    const [erp] = routerGap(world, 'svc-004', 'dial:pol-draft-1:rule', 'noSharedRouter')!.fixes;
    expect([erp.kind, erp.form, erp.alternative]).toEqual(['erp', 'create', null]);
  });

  it('an AnyOf ERP with the same routers is extended with the group\'s terms', () => {
    const world = applyDraft(withKiosks(), [{ kind: 'create', target: 'edgeRouterPolicy', policy: anyOfErp }]);
    const gap = routerGap(world, 'svc-004', 'dial:pol-draft-1:rule', 'noSharedRouter')!;
    const [erp] = gap.fixes;
    expect(erp.form).toBe('extend');
    expect(erp.title).toBe('Add #kiosks to misc-public-routers');
    expect(erp.ops[0]).toEqual({
      kind: 'update',
      target: 'edgeRouterPolicy',
      policyId: 'rp-any',
      patch: { identityRoles: ['#contractors', '#kiosks'] },
    });
    expect(erp.alternative!.form).toBe('create');
    expect(previewOf(world, gap, erp)).toEqual(previewOf(world, gap, erp.alternative!));
    expect(layoutServiceView('svc-004', applyDraft(world, [erp.ops[0]])).serviceVerdict.canConnect).toBe(23);
  });

  it('an all-of rule of 2+ terms is not OR-ed into an AnyOf ERP', () => {
    const rule = { ...kioskRule('AllOf'), identityRoles: ['#kiosks', '#lobby'] };
    const drafted = applyDraft(buildSeedWorld(), [
      { kind: 'create', policy: rule },
      { kind: 'create', target: 'edgeRouterPolicy', policy: anyOfErp },
    ]);
    // Give kiosk-lobby #lobby so the all-of rule has a member.
    const world = {
      ...drafted,
      identities: drafted.identities.map((i) => (i.name === 'kiosk-lobby' ? { ...i, attributes: [...i.attributes, '#lobby'] } : i)),
    };
    const gap = routerGap(world, 'svc-004', 'dial:pol-draft-1:rule', 'noSharedRouter')!;
    expect(gap.memberIds).toEqual(['id-005']);
    const [erp] = gap.fixes;
    expect(erp.form).toBe('create');
    expect(erp.ops[0]).toMatchObject({ policy: { semantic: 'AllOf', identityRoles: ['#kiosks', '#lobby'] } });
  });
});

describe('routerRoles', () => {
  const routers = buildSeedWorld().edgeRouters;
  const pick = (...ids: string[]) => routers.filter((r) => ids.includes(r.id));

  it('a shared attribute that reaches only allowed routers', () => {
    expect(routerRoles(pick('er-001', 'er-003'), new Set(['er-001', 'er-002', 'er-003']), routers)).toEqual(['#public']);
    // #us-east (2 routers) beats #public (3) when both fit.
    expect(routerRoles(pick('er-001'), new Set(['er-001', 'er-002', 'er-003']), routers)).toEqual(['#us-east']);
  });

  it('@refs when no attribute fits', () => {
    expect(routerRoles(pick('er-001', 'er-003'), new Set(['er-001', 'er-003']), routers)).toEqual(['@er-001', '@er-003']);
  });
});

describe('effectRows: route lines', () => {
  it('routers removed: dialers and hosts lose their online route', () => {
    const live = buildSeedWorld();
    const ops: DraftOp[] = [{ kind: 'delete', target: 'serviceEdgeRouterPolicy', policyId: 'serp-003' }];
    const [row] = effectRows(diffWorlds(live, applyDraft(live, ops)), live, 'svc-004');
    expect(row.routeLines).toEqual(['18 dialers lost their online route', '9 hosts lost their online route']);
  });

  it('newly authorized dialers are not route changes', () => {
    const live = buildSeedWorld();
    const [row] = effectRows(diffWorlds(live, withKiosks()), live, 'svc-004');
    expect(row.routeLines).toEqual([]);
  });
});

describe('routerGap: suggested names and via ids', () => {
  it('create fixes are named for what they connect: kiosks-public-routers, no-serp-svc-routing', () => {
    const kiosks = routerGap(withKiosks(), 'svc-004', 'dial:pol-draft-1:rule', 'noSharedRouter')!;
    const erp = kiosks.fixes.find((f) => f.kind === 'erp')!;
    const create = erp.form === 'create' ? erp : erp.alternative!;
    expect(create.ops[0]).toMatchObject({ kind: 'create', policy: { name: 'kiosks-public-routers' } });

    const noSerp = routerGap(buildSeedWorld(), 'svc-007', 'dial:pol-002:rule', 'noSharedRouter')!;
    expect(noSerp.fixes[0].alternative!.ops[0]).toMatchObject({ kind: 'create', policy: { name: 'no-serp-svc-routing' } });
  });

  it('each router names its granting policies with matching ids', () => {
    const gap = routerGap(buildSeedWorld(), 'svc-006', 'dial:pol-002:rule', 'routersOffline')!;
    expect(gap.serviceRouters.map((r) => [r.via, r.viaIds])).toEqual([[['offline-svc-east-2'], ['serp-005']]]);
    expect(gap.rows[0].routers.map((r) => r.viaIds)).toEqual([['rp-001'], ['rp-001'], ['rp-001']]);
  });
});
