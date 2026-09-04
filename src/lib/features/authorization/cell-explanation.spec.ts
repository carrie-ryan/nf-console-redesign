/**
 * Headless verify harness for explainCell — per-member authorization status +
 * exclusion reasons for a segment-pair cell. Runs the REAL resolver over the
 * labeled post-discovery fixtures, then explains cells and asserts the reasons.
 *
 * THE assertion: admin→secrets excludes ops3 with a 'failed-allof' reason that
 * names the actual missing attribute (#mfa-verified) — verified against the
 * AllOf policy, using the resolver's own matcher.
 */

import {
  FIXTURE_IDENTITIES,
  FIXTURE_SERVICES,
  FIXTURE_POLICIES,
  FIXTURE_IDENTITY_SEGMENT_ATTR,
  FIXTURE_SERVICE_SEGMENT_ATTR,
} from './authorization.fixtures';
import {
  resolveDialAuthorizations,
  resolveDialAuthorizationGraph,
} from './authorization-resolver';
import { explainCell, type ExplainCellContext } from './cell-explanation';

describe('explainCell — per-member authorization status + exclusion reasons', () => {
  const { pairs, segmentNodes } = resolveDialAuthorizationGraph(
    FIXTURE_IDENTITIES,
    FIXTURE_SERVICES,
    FIXTURE_POLICIES,
    FIXTURE_IDENTITY_SEGMENT_ATTR,
    FIXTURE_SERVICE_SEGMENT_ATTR,
  );

  const ctx: ExplainCellContext = {
    identities: FIXTURE_IDENTITIES,
    services: FIXTURE_SERVICES,
    policies: FIXTURE_POLICIES,
    pairs,
    segmentNodes,
  };

  const ID_ADMIN = '#discovered-group-admin';
  const ID_ENG = '#discovered-group-eng';
  const SVC_SECRETS = '#discovered-svc-secrets';
  const SVC_DEVTOOLS = '#discovered-svc-devtools';

  const idExpl = (cell: ReturnType<typeof explainCell>, name: string) =>
    cell.identities.find((i) => i.name === name);

  it('DUMP — admin→secrets full explanation (inspect this)', () => {
    const cell = explainCell(ID_ADMIN, SVC_SECRETS, ctx);
    // eslint-disable-next-line no-console
    console.log(`\n===== explainCell(admin → secrets) =====`);
    // eslint-disable-next-line no-console
    console.table(
      cell.identities.map((i) => ({
        identity: i.name,
        status: i.status,
        reaches: i.authorizedServiceIds?.join(', ') ?? '—',
        reasonKind: i.reason?.kind ?? '—',
        nearestPolicy: i.reason?.nearestPolicyName ?? '—',
        missingRoles: i.reason?.missingRoles?.join(', ') ?? '—',
      })),
    );
    // eslint-disable-next-line no-console
    console.table(
      cell.services.map((s) => ({
        service: s.name,
        status: s.status,
        reachedBy: s.reachedByIdentityIds?.length ?? 0,
        reasonKind: s.reason?.kind ?? '—',
      })),
    );
    // eslint-disable-next-line no-console
    console.log('');

    expect(cell.identities.length).toBe(3);
    expect(cell.services.length).toBe(1);
  });

  // THE assertion — ops3 fails AllOf, reason names the real missing attribute ---
  it("admin→secrets: ops1/ops2 authorized; ops3 excluded via failed-allof missing #mfa-verified", () => {
    const cell = explainCell(ID_ADMIN, SVC_SECRETS, ctx);

    const ops1 = idExpl(cell, 'admin-ws-ops1');
    const ops2 = idExpl(cell, 'admin-ws-ops2');
    const ops3 = idExpl(cell, 'admin-ws-ops3');

    expect(ops1?.status).toBe('authorized');
    expect(ops1?.reason).toBeUndefined();
    expect(ops1?.authorizedServiceIds).toContain('auth-svc-vault');
    expect(ops2?.status).toBe('authorized');
    expect(ops2?.reason).toBeUndefined();

    expect(ops3?.status).toBe('excluded');
    expect(ops3?.authorizedServiceIds).toBeUndefined();
    expect(ops3?.reason?.kind).toBe('failed-allof');
    expect(ops3?.reason?.missingRoles).toEqual(['#mfa-verified']);
    // nearestPolicyId is the real policy id; its human name matches the fixture.
    expect(ops3?.reason?.nearestPolicyId).toBe('auth-pol-admin-secrets');
    expect(ops3?.reason?.nearestPolicyName).toBe('dial-admin-mfa-secrets');
  });

  // Full cell — everyone authorized, no reasons; all services reached ----------
  it('eng→devtools (full): every identity authorized (no reason); every service reached', () => {
    const cell = explainCell(ID_ENG, SVC_DEVTOOLS, ctx);

    expect(cell.identities.length).toBe(3);
    for (const i of cell.identities) {
      expect(i.status).toBe('authorized');
      expect(i.reason).toBeUndefined();
      expect(i.authorizedServiceIds?.length).toBe(3);
    }
    expect(cell.services.length).toBe(3);
    for (const s of cell.services) {
      expect(s.status).toBe('reached');
      expect(s.reason).toBeUndefined();
      expect(s.reachedByIdentityIds?.length).toBe(3);
    }
  });

  // None cell — all excluded via no-matching-policy, no missingRoles -----------
  it("eng→secrets (none): all identities excluded via 'no-matching-policy', no missingRoles", () => {
    const cell = explainCell(ID_ENG, SVC_SECRETS, ctx);

    expect(cell.identities.length).toBe(3);
    for (const i of cell.identities) {
      expect(i.status).toBe('excluded');
      expect(i.reason?.kind).toBe('no-matching-policy');
      expect(i.reason?.missingRoles).toBeUndefined();
      expect(i.reason?.nearestPolicyId).toBeUndefined();
    }
    // vault is unreached from eng (no eng identity reaches it).
    expect(cell.services.length).toBe(1);
    expect(cell.services[0].status).toBe('unreached');
    expect(cell.services[0].reason?.kind).toBe('no-matching-policy');
  });

  // Consistency invariant — authorized/reached members NEVER carry a reason ----
  it('status/reason consistency across several cells', () => {
    for (const [from, to] of [
      [ID_ADMIN, SVC_SECRETS],
      [ID_ENG, SVC_DEVTOOLS],
      [ID_ENG, SVC_SECRETS],
    ] as const) {
      const cell = explainCell(from, to, ctx);
      for (const i of cell.identities) {
        if (i.status === 'authorized') expect(i.reason).toBeUndefined();
        else expect(i.reason).toBeDefined();
      }
      for (const s of cell.services) {
        if (s.status === 'reached') expect(s.reason).toBeUndefined();
        else expect(s.reason).toBeDefined();
      }
    }
  });

  // Resolver output unchanged — nothing in this increment touched the resolver.
  it('resolveDialAuthorizations output is unchanged (24 pairs; ops3→vault absent)', () => {
    const fresh = resolveDialAuthorizations(FIXTURE_IDENTITIES, FIXTURE_SERVICES, FIXTURE_POLICIES);
    expect(fresh.length).toBe(24);
    expect(fresh.some((p) => p.identityName === 'admin-ws-ops1' && p.serviceName === 'vault')).toBe(true);
    expect(fresh.some((p) => p.identityName === 'admin-ws-ops3' && p.serviceName === 'vault')).toBe(false);
  });
});
