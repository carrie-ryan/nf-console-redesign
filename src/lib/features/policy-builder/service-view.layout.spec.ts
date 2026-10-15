/**
 * Proves service-view.layout.ts on an inline test world, the MockDataService seed
 * world, and the trifecta oracle — including CONSERVATION against the trifecta
 * resolver: per lane, the union of group members is exactly the authorized set.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/service-view.layout.spec.ts`
 */

import { entityMatchesRoles } from '../authorization/authorization-resolver';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { applyDraft } from './draft/policy-draft';
import { enumerateForService, type TrifectaWorld } from '../authorization/trifecta-resolver';
import {
  TRIFECTA_EDGE_ROUTERS,
  TRIFECTA_EDGE_ROUTER_POLICIES,
  TRIFECTA_IDENTITIES,
  TRIFECTA_SERVICES,
  TRIFECTA_SERVICE_EDGE_ROUTER_POLICIES,
  TRIFECTA_SERVICE_POLICIES,
} from '../authorization/trifecta.fixtures';
import type { Identity, Policy, Service } from '../../shared/services/mock-data.service';
import {
  describeCoverage,
  describeGroup,
  labelGroup,
  layoutServiceView,
  type Group,
  type ServiceViewLayout,
} from './service-view.layout';

const T = '2026-10-01T00:00:00Z';

const ident = (id: string, attributes: string[]): Identity => ({
  id, name: id, createdAt: T, status: 'online', type: 'device', attributes,
});

/** The Mark43 shape — mixed AllOf Bind policy: @host-x unioned, #a AND #b required of everyone else. */
const mark43World: TrifectaWorld = {
  identities: [ident('host-x', []), ident('both', ['#a', '#b']), ident('only-a', ['#a'])],
  services: [
    { id: 'svc-t', name: 'svc-t', createdAt: T, status: 'online', protocol: 'tcp',
      interceptAddress: 't:1', hostAddress: '10.0.0.1:1', attributes: ['#t'] } satisfies Service,
  ],
  edgeRouters: [],
  policies: [
    { id: 'bind-t', name: 'bind-t', createdAt: T, status: 'active', type: 'bind', semantic: 'AllOf',
      identityRoles: ['@host-x', '#a', '#b'], serviceRoles: ['#t'], postureCheckRoles: [] },
  ],
  edgeRouterPolicies: [],
  serviceEdgeRouterPolicies: [],
};

const seed = buildSeedWorld();
const oracle: TrifectaWorld = {
  identities: TRIFECTA_IDENTITIES,
  services: TRIFECTA_SERVICES,
  edgeRouters: TRIFECTA_EDGE_ROUTERS,
  policies: TRIFECTA_SERVICE_POLICIES,
  edgeRouterPolicies: TRIFECTA_EDGE_ROUTER_POLICIES,
  serviceEdgeRouterPolicies: TRIFECTA_SERVICE_EDGE_ROUTER_POLICIES,
};

const svcId = (world: TrifectaWorld, name: string) => world.services.find((s) => s.name === name)!.id;
const group = (groups: Group[], policyId: string, kind: Group['kind']) =>
  groups.find((g) => g.policyId === policyId && g.kind === kind);

describe('service view layout — split @refs from # rules', () => {
  const layout = layoutServiceView('svc-t', mark43World);
  console.log('TEST CASE layout\n' + JSON.stringify(layout, null, 2));

  it('splits the mixed policy into a named group and an AllOf rule group', () => {
    const groups = layout.bind.groups;
    expect(groups.map((g) => g.kind)).toEqual(['named', 'rule']);
    expect(groups[0].named).toEqual([{ id: 'host-x', name: 'host-x' }]);
    expect(groups[1].rule).toEqual({ semantic: 'AllOf', terms: ['#a', '#b'] });
    expect(groups[1].memberIds).toEqual(['both']);
    expect(layout.dial.groups).toEqual([]);
  });

  it('host-x is a member without carrying #a / #b', () => {
    expect(layout.bind.groups[0].memberIds).toEqual(['host-x']);
  });

  it('summary is plain language', () => {
    expect(layout.bind.summary).toBe('Hosts: host-x, OR any identity matching all of #a, #b');
    expect(layout.dial.summary).toBe('Can dial: no one');
  });
});

describe('service view layout — seed world', () => {
  it('git-repo: Dial #users (16) + #admins (3), routers online', () => {
    const layout = layoutServiceView(svcId(seed, 'git-repo'), seed);
    console.log('GIT-REPO layout\n' + JSON.stringify(layout, null, 2));
    const users = group(layout.dial.groups, 'pol-002', 'rule')!;
    const admins = group(layout.dial.groups, 'pol-001', 'rule')!;
    expect(users.rule!.terms).toEqual(['#users']);
    expect(users.memberCount).toBe(16);
    expect(admins.rule!.terms).toEqual(['#admins']);
    expect(admins.memberCount).toBe(3);
    expect(layout.dial.groups.length).toBe(2);
    expect(layout.routers.onlineCount).toBeGreaterThan(0);
    expect(layout.dial.summary).toBe('Can dial: any identity with #admins, OR any identity with #users');
  });

  it('api-prod: Bind #servers (31)', () => {
    const layout = layoutServiceView(svcId(seed, 'api-prod'), seed);
    const servers = group(layout.bind.groups, 'pol-003', 'rule')!;
    expect(layout.bind.groups.length).toBe(1);
    expect(servers.rule!.terms).toEqual(['#servers']);
    expect(servers.memberCount).toBe(31);
    // Single term reads "with", even under AllOf.
    expect(layout.bind.summary).toBe('Hosts: any identity with #servers');
  });

  it('offline-svc: eligible routers, none online', () => {
    const { routers } = layoutServiceView(svcId(seed, 'offline-svc'), seed);
    expect(routers.eligible.length).toBeGreaterThan(0);
    expect(routers.onlineCount).toBe(0);
  });

  it('no-serp-svc: no eligible routers', () => {
    const { routers } = layoutServiceView(svcId(seed, 'no-serp-svc'), seed);
    expect(routers.eligible.length).toBe(0);
    expect(routers.onlineCount).toBe(0);
  });
});

describe('service view layout — oracle world', () => {
  it('web Dial lane has a named group containing root', () => {
    const layout = layoutServiceView('tri-svc-web', oracle);
    const named = layout.dial.groups.filter((g) => g.kind === 'named');
    expect(named.length).toBe(1);
    expect(named[0].memberIds).toEqual(['tri-root']);
    expect(named[0].named).toEqual([{ id: 'tri-root', name: 'break-glass-root' }]);
  });
});

const worlds: [string, TrifectaWorld][] = [['seed', seed], ['oracle', oracle], ['mark43', mark43World]];
const allLayouts = (): [string, ServiceViewLayout][] =>
  worlds.flatMap(([w, world]) =>
    world.services.map((s): [string, ServiceViewLayout] => [`${w}/${s.name}`, layoutServiceView(s.id, world)]),
  );

describe('service view layout — conservation vs trifecta resolver', () => {
  for (const [w, world] of worlds) {
    it(`${w}: per lane, union of group members === resolver-authorized identities`, () => {
      for (const s of world.services) {
        const layout = layoutServiceView(s.id, world);
        const pairs = enumerateForService(s.id, world);
        const union = (groups: Group[]) => [...new Set(groups.flatMap((g) => g.memberIds))].sort();
        const authorized = (lane: 'dial' | 'bind') =>
          pairs.filter((p) => p[lane].authorized).map((p) => p.identityId).sort();
        expect(union(layout.dial.groups), `${w}/${s.name} dial`).toEqual(authorized('dial'));
        expect(union(layout.bind.groups), `${w}/${s.name} bind`).toEqual(authorized('bind'));
      }
    });
  }
});

describe('service view layout — lanes', () => {
  it('bind groups at x=0, dial groups at x=2, service at x=1; no group mixes @refs and # terms', () => {
    for (const [k, layout] of allLayouts()) {
      expect(layout.service.x, k).toBe(1);
      for (const g of layout.bind.groups) expect(g.x, `${k} ${g.id}`).toBe(0);
      for (const g of layout.dial.groups) expect(g.x, `${k} ${g.id}`).toBe(2);
      for (const g of [...layout.bind.groups, ...layout.dial.groups]) {
        if (g.kind === 'named') {
          expect(g.rule, `${k} ${g.id}`).toBeUndefined();
          expect(g.named!.length, `${k} ${g.id}`).toBeGreaterThan(0);
        } else {
          expect(g.named, `${k} ${g.id}`).toBeUndefined();
          expect(g.rule!.terms.every((t) => t.startsWith('#')), `${k} ${g.id}`).toBe(true);
        }
      }
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(allLayouts())).toBe(JSON.stringify(allLayouts()));
  });
});

describe('service view layout — group connection status (Dial: status, Bind: bindStatus)', () => {
  for (const [w, world] of [['seed', seed], ['oracle', oracle]] as const) {
    it(`${w}: every group's status counts sum to memberCount, on both lanes`, () => {
      for (const s of world.services) {
        const layout = layoutServiceView(s.id, world);
        for (const g of [...layout.bind.groups, ...layout.dial.groups]) {
          const k = `${w}/${s.name} ${g.id}`;
          const c = g.status;
          expect(c.reachable + c.routersOffline + c.noSharedRouter + c.notAuthorized, k).toBe(g.memberCount);
          // Conservation already guarantees every member is authorized on its lane.
          expect(c.notAuthorized, k).toBe(0);
        }
      }
    });
  }

  it('Bind status reads bindStatus: oracle db hosts are blocked by offline routers', () => {
    const dba = group(layoutServiceView('tri-svc-db', oracle).bind.groups, 'tri-bind-db', 'rule')!;
    expect(dba.status).toEqual({ reachable: 0, routersOffline: 2, noSharedRouter: 0, notAuthorized: 0 });
  });

  it('every member online → "N authorized · all with an online route"', () => {
    const admins = group(layoutServiceView(svcId(seed, 'git-repo'), seed).dial.groups, 'pol-001', 'rule')!;
    // Then posture: carol fails require-mfa; bob skips it through users-gitlab.
    expect(admins.label.counts.map((c) => c.text)).toEqual(
      ['3 authorized', 'all with an online route', '1 blocked by posture', '1 bypassed'],
    );
    const hosts = group(layoutServiceView(svcId(seed, 'git-repo'), seed).bind.groups, 'pol-004', 'rule')!;
    expect(hosts.label.counts.map((c) => c.text)).toEqual(['7 authorized', 'all with an online route']);
  });
});

describe('service view layout — lane totals', () => {
  it('total is the size of the union of the lane\'s group memberIds', () => {
    for (const [k, layout] of allLayouts()) {
      for (const lane of ['bind', 'dial'] as const) {
        const union = new Set(layout[lane].groups.flatMap((g) => g.memberIds));
        expect(layout[lane].total, `${k} ${lane}`).toBe(union.size);
      }
    }
  });

  it('git-repo: 9 can host (8 via git-repo-hosts + server-stage-01 via git-servers-host), 18 can dial (bob@corp.com is in both #admins and #users)', () => {
    const l = layoutServiceView(svcId(seed, 'git-repo'), seed);
    expect(l.bind.total).toBe(9);
    expect(l.dial.total).toBe(18);
  });
});

describe('service view layout — labels', () => {
  it('label.text is summary + counts, direction-prefixed per lane', () => {
    for (const [k, layout] of allLayouts()) {
      for (const [lane, prefix] of [['bind', 'Hosts: '], ['dial', 'Can dial: ']] as const) {
        for (const g of layout[lane].groups) {
          expect(g.label.summary.startsWith(prefix), `${k} ${g.id}`).toBe(true);
          expect(g.label.text, `${k} ${g.id}`).toBe([g.label.summary, ...g.label.counts.map((c) => c.text)].join(' · '));
        }
      }
    }
  });

  it('#admins label is identical on git-repo and offline-svc apart from its counts', () => {
    const admins = (name: string) =>
      group(layoutServiceView(svcId(seed, name), seed).dial.groups, 'pol-001', 'rule')!.label;
    const git = admins('git-repo');
    const off = admins('offline-svc');
    console.log('#admins labels\n  git-repo:    ' + git.text + '\n  offline-svc: ' + off.text);
    expect(git.summary).toBe('Can dial: any identity with #admins');
    expect(off.summary).toBe(git.summary);
    // Strip the counts and the labels match exactly …
    expect(git.text.slice(0, git.summary.length)).toBe(off.text.slice(0, off.summary.length));
    // … and the counts are what differ.
    // No one has an online route, so no one is blocked by posture — but bob's bypass is policy, not route.
    expect(off.counts.map((c) => c.text)).toEqual(['3 authorized', '0 with an online route', '3 with routers offline', '1 bypassed']);
    expect(off.counts).not.toEqual(git.counts);
  });

  it('labelGroup(g, false) is the same label without the direction prefix', () => {
    for (const [k, layout] of allLayouts()) {
      for (const g of [...layout.bind.groups, ...layout.dial.groups]) {
        const visible = labelGroup(g, false);
        expect(visible.summary, `${k} ${g.id}`).toBe(describeGroup(g));
        expect(g.label.summary, `${k} ${g.id}`).toBe(`${g.lane === 'bind' ? 'Hosts' : 'Can dial'}: ${visible.summary}`);
        expect(visible.counts, `${k} ${g.id}`).toEqual(g.label.counts);
      }
    }
  });
});

describe('service view layout — service verdict', () => {
  const verdict = (world: TrifectaWorld, serviceId: string) => {
    const { canConnect, dialTotal, hostsReachable, reason, text } = layoutServiceView(serviceId, world).serviceVerdict;
    return { canConnect, dialTotal, hostsReachable, reason, text };
  };

  it('seed: git-repo, offline-svc, no-serp-svc, api-prod', () => {
    expect(verdict(seed, svcId(seed, 'git-repo'))).toEqual({
      // carol's only grant is admins-dev-access, and she fails require-mfa.
      canConnect: 17, dialTotal: 18, hostsReachable: 9, reason: null,
      text: '17 of 18 can connect · 1 blocked by posture · 2 of 9 hosts serving',
    });
    // git-servers-host gives both a host — server-stage-01 — with no online route.
    expect(verdict(seed, svcId(seed, 'offline-svc'))).toEqual({
      canConnect: 0, dialTotal: 18, hostsReachable: 0, reason: 'no host with an online route',
      text: 'No one can connect · no host with an online route',
    });
    expect(verdict(seed, svcId(seed, 'no-serp-svc'))).toEqual({
      canConnect: 0, dialTotal: 18, hostsReachable: 0, reason: 'no host with an online route',
      text: 'No one can connect · no host with an online route',
    });
    expect(verdict(seed, svcId(seed, 'api-prod'))).toEqual({
      // Only alice passes require-mfa.
      canConnect: 1, dialTotal: 3, hostsReachable: 31, reason: null,
      text: '1 of 3 can connect · 2 blocked by posture · 3 of 31 hosts serving',
    });
  });

  it('oracle: every service', () => {
    // web: alice hosts (reachable); alice + root dial (both reachable) — but the
    // oracle has no terminators, so no one is serving yet.
    expect(verdict(oracle, 'tri-svc-web')).toMatchObject({ canConnect: 0, dialTotal: 2, hostsReachable: 1,
      reason: 'no host serving yet', text: 'No one can connect · no host serving yet' });
    // Once alice registers a terminator on a router she shares with web, both connect.
    const [host] = layoutServiceView('tri-svc-web', oracle).bind.groups.flatMap((g) => g.memberIds);
    const routerId = enumerateForService('tri-svc-web', oracle).find((p) => p.identityId === host)!.routers.common[0];
    const serving: TrifectaWorld = { ...oracle, terminators: [{ id: 't', serviceId: 'tri-svc-web', identityId: host,
      routerId, precedence: 'default', cost: 0 }] };
    expect(verdict(serving, 'tri-svc-web')).toMatchObject({ canConnect: 2, dialTotal: 2, hostsReachable: 1, reason: null,
      text: '2 of 2 can connect · 1 of 1 host serving' });
    // db: bob + carol host, but the only #dmz router is offline.
    expect(verdict(oracle, 'tri-svc-db')).toMatchObject({ canConnect: 0, hostsReachable: 0,
      reason: 'no host with an online route' });
    // lab / orphan: root hosts, but shares no router with them.
    expect(verdict(oracle, 'tri-svc-lab')).toMatchObject({ canConnect: 0, hostsReachable: 0,
      reason: 'no host with an online route' });
    expect(verdict(oracle, 'tri-svc-orphan')).toMatchObject({ canConnect: 0, hostsReachable: 0,
      reason: 'no host with an online route' });
    // ops: Dial only — no Bind policy.
    expect(verdict(oracle, 'tri-svc-ops')).toMatchObject({ canConnect: 0, hostsReachable: 0, reason: 'no host',
      text: 'No one can connect · no host' });
  });

  // Neither seed nor oracle has a reachable host with unreachable / absent dialers.
  const hostOnlyWorld = (withDialPolicy: boolean): TrifectaWorld => ({
    identities: [ident('h', ['#h']), ident('d', ['#d'])],
    services: [{ id: 'svc-v', name: 'svc-v', createdAt: T, status: 'online', protocol: 'tcp',
      interceptAddress: 'v:1', hostAddress: '10.0.0.2:1', attributes: ['#s'] }],
    edgeRouters: [{ id: 'r-on', name: 'r-on', attributes: ['#a'], isOnline: true }],
    policies: [
      { id: 'b', name: 'b', createdAt: T, status: 'active', type: 'bind', semantic: 'AnyOf',
        identityRoles: ['#h'], serviceRoles: ['#s'], postureCheckRoles: [] },
      ...(withDialPolicy
        ? [{ id: 'd', name: 'd', createdAt: T, status: 'active' as const, type: 'dial' as const, semantic: 'AnyOf' as const,
            identityRoles: ['#d'], serviceRoles: ['#s'], postureCheckRoles: [] }]
        : []),
    ],
    // Only the host gets a router; the dialer has none.
    edgeRouterPolicies: [{ id: 'erp', name: 'erp', createdAt: T, status: 'active', semantic: 'AllOf',
      identityRoles: ['#h'], edgeRouterRoles: ['#a'] }],
    serviceEdgeRouterPolicies: [{ id: 'serp', name: 'serp', semantic: 'AllOf', serviceRoles: ['#s'], edgeRouterRoles: ['#a'] }],
  });

  it('reachable host, dialer without a route → "no dialer with an online route"', () => {
    expect(verdict(hostOnlyWorld(true), 'svc-v')).toEqual({ canConnect: 0, dialTotal: 1, hostsReachable: 1,
      reason: 'no dialer with an online route', text: 'No one can connect · no dialer with an online route' });
  });

  // The same world, with the dialer routed too: only the runtime state is left.
  const routedWorld = (terminatorRouter: string | null): TrifectaWorld => {
    const w = hostOnlyWorld(true);
    return {
      ...w,
      edgeRouters: [...w.edgeRouters, { id: 'r-off', name: 'r-off', attributes: ['#a'], isOnline: false }],
      edgeRouterPolicies: [{ ...w.edgeRouterPolicies[0], identityRoles: ['#h', '#d'], semantic: 'AnyOf' }],
      terminators: terminatorRouter
        ? [{ id: 't', serviceId: 'svc-v', identityId: 'h', routerId: terminatorRouter, precedence: 'default', cost: 0 }]
        : [],
    };
  };

  it('routes fine but no terminator → "no host serving yet", amber; checked after every route reason', () => {
    const v = layoutServiceView('svc-v', routedWorld(null)).serviceVerdict;
    expect(v).toMatchObject({ canConnect: 0, hostsReachable: 1, hostsServing: 0, reason: 'no host serving yet',
      tone: 'warn', text: 'No one can connect · no host serving yet' });
    // A route reason wins over it: hostOnlyWorld has no terminators either.
    expect(layoutServiceView('svc-v', hostOnlyWorld(true)).serviceVerdict).toMatchObject({
      reason: 'no dialer with an online route', tone: 'bad' });
  });

  it('a terminator only on an offline router serves no one; on an online one, everyone connects', () => {
    expect(layoutServiceView('svc-v', routedWorld('r-off')).serviceVerdict).toMatchObject({
      canConnect: 0, hostsServing: 0, reason: 'no host serving yet' });
    expect(layoutServiceView('svc-v', routedWorld('r-on')).serviceVerdict).toMatchObject({
      canConnect: 1, hostsAuthorized: 1, hostsServing: 1, reason: null, tone: 'ok',
      text: '1 of 1 can connect · 1 of 1 host serving' });
  });

  // routedWorld with one posture check on the Bind and/or Dial policy, which no one passes.
  const postureWorld = (on: readonly ('b' | 'd')[]): TrifectaWorld => {
    const w = routedWorld('r-on');
    return {
      ...w,
      policies: w.policies.map((p) => (on.includes(p.id as 'b' | 'd') ? { ...p, postureCheckRoles: ['#chk'] } : p)),
      postureChecks: [{ id: 'chk', name: 'chk', createdAt: T, status: 'active', type: 'OS', attributes: ['#chk'] }],
      postureResults: [],
    };
  };

  it('every host fails Bind posture → "no host passes posture", before "no host serving yet"', () => {
    expect(layoutServiceView('svc-v', postureWorld(['b'])).serviceVerdict).toMatchObject({
      canConnect: 0, hostsServing: 1, reason: 'no host passes posture', tone: 'bad' });
    // Without the terminator too, posture still comes first.
    const unserved = { ...postureWorld(['b']), terminators: [] };
    expect(layoutServiceView('svc-v', unserved).serviceVerdict.reason).toBe('no host passes posture');
  });

  it('every dialer fails Dial posture → "no dialer passes posture"; a partial block is counted', () => {
    expect(layoutServiceView('svc-v', postureWorld(['d'])).serviceVerdict).toMatchObject({
      canConnect: 0, blockedByPosture: 1, reason: 'no dialer passes posture',
      text: 'No one can connect · no dialer passes posture' });
    // Passing it: no one blocked, no posture text.
    const passing = { ...postureWorld(['d']), postureResults: [{ identityId: 'd', passedCheckIds: ['chk'] }] };
    expect(layoutServiceView('svc-v', passing).serviceVerdict).toMatchObject({
      canConnect: 1, blockedByPosture: 0, text: '1 of 1 can connect · 1 of 1 host serving' });
  });

  it('reachable host, no Dial policy → "no dialers"', () => {
    expect(verdict(hostOnlyWorld(false), 'svc-v')).toEqual({ canConnect: 0, dialTotal: 0, hostsReachable: 1,
      reason: 'no dialers', text: 'No one can connect · no dialers' });
  });

  it('canConnect ≤ the Dial lane total, everywhere; reason set iff canConnect is 0', () => {
    for (const [k, layout] of allLayouts()) {
      const v = layout.serviceVerdict;
      expect(v.canConnect, k).toBeLessThanOrEqual(layout.dial.total);
      expect(v.dialTotal, k).toBe(layout.dial.total);
      expect(v.reason === null, k).toBe(v.canConnect > 0);
    }
  });
});

describe('seed: pol-001 is admins-dev-access (#git, #apis), not #all', () => {
  const view = (id: string) => {
    const l = layoutServiceView(id, seed);
    return { verdict: l.serviceVerdict.text, bind: l.bind.total, dial: l.dial.total };
  };

  it('git-repo, api-prod, offline-svc and no-serp-svc keep their verdicts and lane totals', () => {
    expect({
      'git-repo': view('svc-004'),
      'api-prod': view('svc-005'),
      'offline-svc': view('svc-006'),
      'no-serp-svc': view('svc-007'),
    }).toEqual({
      'git-repo': { verdict: '17 of 18 can connect · 1 blocked by posture · 2 of 9 hosts serving', bind: 9, dial: 18 },
      'api-prod': { verdict: '1 of 3 can connect · 2 blocked by posture · 3 of 31 hosts serving', bind: 31, dial: 3 },
      'offline-svc': { verdict: 'No one can connect · no host with an online route', bind: 1, dial: 18 },
      'no-serp-svc': { verdict: 'No one can connect · no host with an online route', bind: 1, dial: 18 },
    });
  });

  it('reports-svc has zero policies of all three types', () => {
    const reports = seed.services.find((s) => s.id === 'svc-008')!;
    const covers = (roles: readonly string[], semantic: 'AllOf' | 'AnyOf') =>
      entityMatchesRoles(roles, semantic, reports.attributes ?? [], reports.name, reports.id);
    expect(seed.policies.filter((p) => covers(p.serviceRoles, p.semantic))).toEqual([]);
    expect(seed.serviceEdgeRouterPolicies.filter((p) => covers(p.serviceRoles, p.semantic))).toEqual([]);
    // (ERPs have no service side.) Empty lanes, empty router band.
    const l = layoutServiceView('svc-008', seed);
    expect([l.bind.total, l.dial.total, l.routers.eligible.length]).toEqual([0, 0, 0]);
  });
});

describe('service view layout — how each group covers the service', () => {
  const pol = (id: string, serviceRoles: string[], semantic: Policy['semantic'] = 'AnyOf'): Policy =>
    ({ id, name: id, createdAt: T, status: 'active', type: 'dial', semantic,
       identityRoles: ['#a'], serviceRoles, postureCheckRoles: [] });
  const svc = (id: string, attributes: string[]): Service => ({
    id, name: id, createdAt: T, status: 'online', protocol: 'tcp', interceptAddress: `${id}:1`,
    hostAddress: '10.0.0.1:1', attributes,
  });
  const world: TrifectaWorld = {
    identities: [ident('a1', ['#a'])],
    services: [svc('s1', ['#x', '#y']), svc('s2', ['#x'])],
    edgeRouters: [],
    policies: [pol('by-name', ['@s1', '#z']), pol('all', ['#all']), pol('xy', ['#x', '#y'], 'AllOf')],
    edgeRouterPolicies: [],
    serviceEdgeRouterPolicies: [],
  };
  const groups = layoutServiceView('s1', world).dial.groups;
  const byPolicy = (id: string) => groups.find((g) => g.policyId === id)!;

  it('offline-svc: both groups match via #git', () => {
    const l = layoutServiceView('svc-006', seed);
    expect(l.service.attributes).toEqual(['#git']);
    expect(l.dial.groups.map((g) => [g.policyName, g.serviceMatch])).toEqual([
      ['admins-dev-access', { via: 'attributes', terms: ['#git'] }],
      ['users-gitlab', { via: 'attributes', terms: ['#git'] }],
    ]);
  });

  it("users-gitlab's otherServiceIds are git-repo and no-serp-svc", () => {
    const g = layoutServiceView('svc-006', seed).dial.groups.find((x) => x.policyName === 'users-gitlab')!;
    expect(g.otherServiceIds.map((id) => seed.services.find((s) => s.id === id)!.name)).toEqual(['git-repo', 'no-serp-svc']);
    const names = new Map(seed.services.map((s) => [s.id, s.name]));
    expect(describeCoverage(g, 'offline-svc', names)).toBe('Covers offline-svc via #git; also covers git-repo, no-serp-svc.');
  });

  it('an @ref names the service: via named, by name', () => {
    const g = byPolicy('by-name');
    expect(g.serviceMatch).toEqual({ via: 'named', terms: ['@s1'] });
    expect(g.otherServiceIds).toEqual([]);
    expect(describeCoverage(g, 's1', new Map())).toBe('Covers s1 by name.');
  });

  it('#all alone: via all, covering every other service', () => {
    const g = byPolicy('all');
    expect(g.serviceMatch).toEqual({ via: 'all', terms: ['#all'] });
    expect(g.otherServiceIds).toEqual(['s2']);
    expect(describeCoverage(g, 's1', new Map([['s2', 's2']]))).toBe('Covers s1 via #all; also covers s2.');
  });

  it('all-of terms: via attributes with every term; a service lacking one is not covered', () => {
    expect(byPolicy('xy').serviceMatch).toEqual({ via: 'attributes', terms: ['#x', '#y'] });
    expect(byPolicy('xy').otherServiceIds).toEqual([]);
  });

  it('git-repo-hosts names git-repo (@svc-004)', () => {
    const g = layoutServiceView('svc-004', seed).bind.groups.find((x) => x.policyName === 'git-repo-hosts')!;
    expect(g.serviceMatch).toEqual({ via: 'named', terms: ['@svc-004'] });
  });
});

describe('service view layout — a blank service is "not set up", not failing', () => {
  it('app-api-prod has no Bind and no Dial members: notSetUp', () => {
    const v = layoutServiceView('svc-002', seed).serviceVerdict;
    expect([v.notSetUp, v.reason]).toEqual([true, 'no host']);
  });

  it('dialers without a host: not notSetUp, "no host" stays', () => {
    const world = applyDraft(seed, [{ kind: 'create', policy: {
      id: 'pol-t', name: 'users-dial-api', createdAt: T, status: 'active', type: 'dial', semantic: 'AnyOf',
      identityRoles: ['#users'], serviceRoles: ['@svc-002'], postureCheckRoles: [] } }]);
    const v = layoutServiceView('svc-002', world).serviceVerdict;
    expect([v.notSetUp, v.text]).toEqual([false, 'No one can connect · no host']);
  });

  it('every seed service with a member on either lane is not notSetUp', () => {
    for (const s of seed.services) {
      const l = layoutServiceView(s.id, seed);
      expect(l.serviceVerdict.notSetUp, s.name).toBe(l.bind.total === 0 && l.dial.total === 0);
    }
  });
});
