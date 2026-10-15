/**
 * Proves draft-summary.ts (op lines + effect rows) on the MockDataService seed world.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/draft-summary.spec.ts`
 */

import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import type { Policy } from '../../../shared/services/mock-data.service';
import { layoutServiceView } from '../service-view.layout';
import { diffWorlds } from './draft-diff';
import { describeOps, effectRows, signed } from './draft-summary';
import { applyDraft, type DraftOp } from './policy-draft';

const rule = (over: Partial<Policy>): Policy => ({
  id: 'pol-draft-1',
  name: 'new-dial-rule-1',
  createdAt: '2026-10-06T00:00:00Z',
  status: 'active',
  type: 'dial',
  semantic: 'AnyOf',
  identityRoles: [],
  serviceRoles: ['@svc-004'],
  postureCheckRoles: [],
  ...over,
});

const KIOSKS: DraftOp[] = [{ kind: 'create', policy: rule({ identityRoles: ['#kiosks'] }) }];
const ALLOF: DraftOp[] = [
  { kind: 'update', policyId: 'pol-002', patch: { semantic: 'AllOf', identityRoles: ['#users', '#laptops'] } },
];

const rowsFor = (ops: DraftOp[], current = 'svc-004') => {
  const live = buildSeedWorld();
  return effectRows(diffWorlds(live, applyDraft(live, ops)), live, current);
};

describe('describeOps', () => {
  const live = buildSeedWorld();

  it('update: lists what was removed / added / switched', () => {
    expect(
      describeOps(live, [{ kind: 'update', policyId: 'pol-004', patch: { identityRoles: ['#servers', '#prod'] } }]),
    ).toEqual(['Updated git-repo-hosts: removed @server-build-01']);
    expect(describeOps(live, ALLOF)).toEqual(['Updated users-gitlab: match all of; added #laptops']);
    expect(
      describeOps(live, [{ kind: 'update', policyId: 'pol-002', patch: { name: 'devs', serviceRoles: ['#git', '@svc-005'] } }]),
    ).toEqual(['Updated users-gitlab: renamed to devs; added service @api-prod']);
  });

  it('create: "Created dial rule for git-repo: #kiosks"; bind is a host rule', () => {
    expect(describeOps(live, KIOSKS)).toEqual(['Created dial rule for git-repo: #kiosks']);
    expect(describeOps(live, [{ kind: 'create', policy: rule({ type: 'bind' }) }])).toEqual([
      'Created host rule for git-repo: no identities yet',
    ]);
    expect(
      describeOps(live, [{ kind: 'create', policy: rule({ semantic: 'AllOf', identityRoles: ['@kiosk-lobby', '#a', '#b'] }) }]),
    ).toEqual(['Created dial rule for git-repo: @kiosk-lobby, all of #a, #b']);
  });

  it('delete, and one line per op in order', () => {
    expect(describeOps(live, [{ kind: 'delete', policyId: 'pol-004' }, ...KIOSKS])).toEqual([
      'Deleted git-repo-hosts (host rule)',
      'Created dial rule for git-repo: #kiosks',
    ]);
  });
});

describe('effectRows', () => {
  it('kiosks rule: dialers +6, can connect ±0, split "+6 authorized · 0 can connect (6 no shared router)"', () => {
    const rows = rowsFor(KIOSKS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serviceName: 'git-repo',
      isCurrent: true,
      dialers: { before: 18, after: 24, delta: 6 },
      canConnect: { before: 17, after: 17, delta: 0 },
      hostsOnline: { delta: 0 },
      reason: null,
      newDialers: '+6 authorized · 0 can connect (6 no shared router)',
      lostDialers: null,
    });
  });

  it('users-gitlab all-of: 3 services, current first, fewer dialers on each', () => {
    const rows = rowsFor(ALLOF, 'svc-006');
    expect(rows.map((r) => r.serviceName)).toEqual(['offline-svc', 'git-repo', 'no-serp-svc']);
    expect(rows.map((r) => r.isCurrent)).toEqual([true, false, false]);
    for (const r of rows) expect(r.dialers).toEqual({ before: 18, after: 13, delta: -5 });
    const git = rows.find((r) => r.serviceId === 'svc-004')!;
    // One more than the dialers lost: bob keeps admins-dev-access, but without
    // users-gitlab (no checks) he is now blocked by require-mfa.
    expect(git.canConnect.delta).toBe(git.dialers.delta - 1);
    expect(git.lostDialers).toMatch(/^−\d+ dialers? no longer authorized$/);
    expect(git.newDialers).toBeNull();
  });

  it('a reason change is reported before → after; unchanged reasons are null', () => {
    // git-repo's two Bind policies: git-repo-hosts and git-servers-host.
    const [row] = rowsFor([
      { kind: 'delete', policyId: 'pol-004' },
      { kind: 'delete', policyId: 'pol-005' },
    ]);
    expect(row.reason).toEqual({ before: null, after: 'no host' });
    expect(row.hostsOnline).toEqual({ before: 9, after: 0, delta: -9 });
  });

  it('a reachable new dialer only "can connect" when a host is online', () => {
    // offline-svc's only host has no online route: reachable or not, nobody new can connect.
    const ops: DraftOp[] = [{ kind: 'create', policy: rule({ identityRoles: ['#kiosks'], serviceRoles: ['@svc-006'] }) }];
    const [row] = rowsFor(ops, 'svc-006');
    expect(row.newDialers).toMatch(/^\+6 authorized · 0 can connect \(/);
  });

  it('signed uses a true minus sign', () => {
    expect([signed(3), signed(-2), signed(0)]).toEqual(['+3', '−2', '±0']);
  });
});

describe('layout: emptyPolicies', () => {
  it('a rule with no identity roles has no group but is listed on its lane', () => {
    const live = buildSeedWorld();
    const draft = applyDraft(live, [{ kind: 'create', policy: rule({}) }]);
    const layout = layoutServiceView('svc-004', draft);
    expect(layout.dial.emptyPolicies).toEqual([{ policyId: 'pol-draft-1', policyName: 'new-dial-rule-1' }]);
    expect(layout.bind.emptyPolicies).toEqual([]);
    expect(layout.dial.groups.some((g) => g.policyId === 'pol-draft-1')).toBe(false);
    expect(layoutServiceView('svc-005', draft).dial.emptyPolicies).toEqual([]);
  });
});
