/**
 * Proves multi-service.layout.ts on the seed world: per service it is exactly
 * layoutServiceView, shared policies are one group with an edge per service, and
 * lanes are ordered to keep edges from crossing.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/multi-service.layout.spec.ts`
 */

import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { edgeTone, layoutMultiServiceView } from './multi-service.layout';
import { layoutServiceView } from './service-view.layout';

const seed = buildSeedWorld();
const GIT_REPO = 'svc-004';
const API_PROD = 'svc-005';
const OFFLINE = 'svc-006';
const NO_SERP = 'svc-007';

const groupOf = (l: ReturnType<typeof layoutMultiServiceView>, policyName: string) =>
  l.groups.filter((g) => g.policyName === policyName);

describe('multi-service layout — seed world', () => {
  const canvases = [
    [GIT_REPO, [OFFLINE]],
    [OFFLINE, [GIT_REPO, API_PROD, NO_SERP]],
    [API_PROD, []],
  ] as const;

  for (const [focus, others] of canvases) {
    it(`${[focus, ...others].join(' + ')}: each service's edges and groups equal layoutServiceView`, () => {
      const multi = layoutMultiServiceView(focus, others, seed);
      for (const s of multi.services) {
        const single = layoutServiceView(s.id, seed);
        const singleGroups = [...single.bind.groups, ...single.dial.groups];
        const edges = multi.edges.filter((e) => e.serviceId === s.id);

        expect(new Set(edges.map((e) => e.groupId))).toEqual(new Set(singleGroups.map((g) => g.id)));
        for (const g of singleGroups) {
          const e = edges.find((x) => x.groupId === g.id)!;
          expect([e.serviceMatch, e.statusCounts]).toEqual([g.serviceMatch, g.status]);
          const mg = multi.groups.find((x) => x.id === g.id)!;
          expect(mg).toEqual({
            id: g.id, policyId: g.policyId, policyName: g.policyName, kind: g.kind, lane: g.lane,
            named: g.named, rule: g.rule, memberIds: g.memberIds, memberNames: g.memberNames, memberCount: g.memberCount,
          });
        }
        expect([s.verdict, s.attributes, s.name]).toEqual([single.serviceVerdict, single.service.attributes, single.service.name]);
      }
      expect(multi.services.map((s) => [s.id, s.focused])).toEqual([focus, ...others].map((id) => [id, id === focus]));
      expect(multi.groups.map((g) => g.id)).toEqual([...multi.order.bind, ...multi.order.dial]);
    });
  }

  it('git-repo + offline-svc: users-gitlab is one group with two edges (reachable / routers offline)', () => {
    const l = layoutMultiServiceView(GIT_REPO, [OFFLINE], seed);
    const [g] = groupOf(l, 'users-gitlab');
    expect(groupOf(l, 'users-gitlab')).toHaveLength(1);
    const edges = l.edges.filter((e) => e.groupId === g.id);
    expect(edges.map((e) => e.serviceId)).toEqual([GIT_REPO, OFFLINE]);
    const n = g.memberCount;
    expect(n).toBeGreaterThan(0);
    expect(edges[0].statusCounts).toEqual({ reachable: n, routersOffline: 0, noSharedRouter: 0, notAuthorized: 0 });
    expect(edges[1].statusCounts).toEqual({ reachable: 0, routersOffline: n, noSharedRouter: 0, notAuthorized: 0 });
  });

  it('git-repo-hosts appears once (named + rule groups), with edges to git-repo only', () => {
    const l = layoutMultiServiceView(GIT_REPO, [OFFLINE], seed);
    const hosts = groupOf(l, 'git-repo-hosts');
    expect(hosts.map((g) => g.kind)).toEqual(['named', 'rule']);
    expect(l.edges.filter((e) => hosts.some((g) => g.id === e.groupId)).map((e) => e.serviceId)).toEqual([GIT_REPO, GIT_REPO]);
  });

  it('orders each lane by the services its policies connect to', () => {
    // Column: git-repo(0), offline-svc(1), api-prod(2). users-gitlab covers 0,1 and
    // admins-dev-access 0,1,2, so users-gitlab goes first though it sorts second by name.
    // Bind: git-repo-hosts (both groups at 0), then git-servers-host (0,1), then
    // servers-bind-api (2).
    const l = layoutMultiServiceView(GIT_REPO, [OFFLINE, API_PROD], seed);
    const name = (id: string) => l.groups.find((g) => g.id === id)!.policyName;
    expect(l.order.dial.map(name)).toEqual(['users-gitlab', 'admins-dev-access']);
    expect(l.order.bind.map(name)).toEqual(['git-repo-hosts', 'git-repo-hosts', 'git-servers-host', 'servers-bind-api']);
  });

  it("a policy's groups are always adjacent, named before rule — sorting moves whole policies", () => {
    const canvases: [string, string[]][] = [
      [GIT_REPO, []],
      [GIT_REPO, [OFFLINE, API_PROD]],
      [API_PROD, [GIT_REPO]],
      [OFFLINE, [NO_SERP, API_PROD, GIT_REPO]],
    ];
    for (const [focus, others] of canvases) {
      const l = layoutMultiServiceView(focus, others, seed);
      for (const lane of ['bind', 'dial'] as const) {
        const groups = l.order[lane].map((id) => l.groups.find((g) => g.id === id)!);
        const policies = groups.map((g) => g.policyId);
        // Each policy's run is contiguous: once left, it never reappears.
        expect(policies.filter((p, i) => i === 0 || p !== policies[i - 1]), `${focus} ${lane}`).toEqual([...new Set(policies)]);
        for (let i = 1; i < groups.length; i++) {
          if (groups[i].policyId === groups[i - 1].policyId) expect([groups[i - 1].kind, groups[i].kind]).toEqual(['named', 'rule']);
        }
      }
    }
    // git-repo-hosts' named group (git-repo only) and rule group stay together even
    // when api-prod is focused and git-servers-host would otherwise sort between them.
    const l = layoutMultiServiceView(API_PROD, [GIT_REPO], seed);
    const name = (id: string) => l.groups.find((g) => g.id === id)!.policyName;
    expect(l.order.bind.map(name)).toEqual(['servers-bind-api', 'git-repo-hosts', 'git-repo-hosts', 'git-servers-host']);
  });

  it('more than four services is an error; a repeated id counts once', () => {
    expect(() => layoutMultiServiceView(GIT_REPO, [API_PROD, OFFLINE, NO_SERP, 'svc-008'], seed)).toThrowError(/at most 4/);
    expect(layoutMultiServiceView(GIT_REPO, [GIT_REPO, OFFLINE], seed).services.map((s) => s.id)).toEqual([GIT_REPO, OFFLINE]);
  });
});

describe('edgeTone — the worst status present', () => {
  const c = (reachable: number, routersOffline: number, noSharedRouter: number) =>
    ({ reachable, routersOffline, noSharedRouter, notAuthorized: 0 });
  it('ok / warn / bad / none', () => {
    expect([c(3, 0, 0), c(0, 3, 0), c(0, 0, 3), c(0, 0, 0)].map(edgeTone)).toEqual(['ok', 'warn', 'bad', 'none']);
  });
  it('mixed takes the worst', () => {
    expect([c(2, 1, 0), c(2, 0, 1), c(1, 1, 1)].map(edgeTone)).toEqual(['warn', 'bad', 'bad']);
  });
});
