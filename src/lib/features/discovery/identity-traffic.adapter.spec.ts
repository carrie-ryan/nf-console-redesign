/**
 * Headless harness for the per-identity traffic rollup.
 *
 * The function was extracted from `RawTrafficComponent.destinationRows()` with no
 * intended behaviour change, so these assertions are written as a BEHAVIOUR PIN:
 * they describe what the Raw Traffic table renders today (row shape, ordering,
 * app-protocol handling), not what a redesigned rollup might prefer.
 *
 * Two fixture sources, kept apart on purpose:
 *   • DISCOVERED_FLOWS — the real capture, for the end-to-end "a known identity's
 *     rollup matches its authored dial-set" assertions.
 *   • Tiny synthetic arrays built by SPREADING real flow records — for the two
 *     rules the real capture cannot exercise, because every (source, destination)
 *     pair appears exactly once there and every destination carries a protocol:
 *     circuit summation across duplicate destinations, and the empty-protocol
 *     fallback.
 */

import { DISCOVERED_FLOWS } from './discovered-flows.mock';
import { buildIdentityPolicySeed, rollUpIdentityDestinations } from './identity-traffic.adapter';
import type { DiscoveredFlow } from './discovery.models';

/** The flows one identity dialed — the same selection RawTrafficComponent's
 *  `identityGroups` makes for an ENROLLED source (keyed by identity id). */
const flowsOf = (identityId: string): DiscoveredFlow[] =>
  DISCOVERED_FLOWS.filter((f) => f.dialingIdentityId === identityId);

describe('identity-traffic adapter — per-identity destination rollup', () => {
  it('DUMP — domain-admin-01 (inspect this)', () => {
    const rows = rollUpIdentityDestinations(flowsOf('disc-017'));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(rows, null, 2));
    expect(rows.length).toBeGreaterThan(0);
  });

  // ─── row shape ────────────────────────────────────────────────────────────

  it('emits exactly the six display fields, one row per distinct destination', () => {
    const flows = flowsOf('disc-017');
    const rows = rollUpIdentityDestinations(flows);

    expect(rows.length).toBe(new Set(flows.map((f) => f.destinationHostPort)).size);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        ['appProtocol', 'circuits', 'egressEntityName', 'egressIp', 'egressPort', 'hostPort'].sort(),
      );
      expect(typeof r.hostPort).toBe('string');
      expect(typeof r.egressEntityName).toBe('string');
      expect(typeof r.appProtocol).toBe('string');
      expect(typeof r.egressIp).toBe('string');
      expect(typeof r.egressPort).toBe('number');
      expect(typeof r.circuits).toBe('number');
    }
  });

  // ─── a known identity's rollup ────────────────────────────────────────────

  it("matches domain-admin-01's authored dial-set exactly, circuits desc", () => {
    // disc-017 @ 10.10.30.11 — dns 420, dc:389 180, dc:88 150, fileserver 95,
    // bastion 25 (see the IT-infrastructure block in discovered-flows.mock.ts).
    expect(rollUpIdentityDestinations(flowsOf('disc-017'))).toEqual([
      { hostPort: 'dns.corp:53', egressEntityName: 'Core DNS', appProtocol: 'DNS', egressIp: '10.10.5.20', egressPort: 53, circuits: 420 },
      { hostPort: 'dc.corp:389', egressEntityName: 'Domain Controller DC1', appProtocol: 'LDAP', egressIp: '10.10.5.10', egressPort: 389, circuits: 180 },
      { hostPort: 'dc.corp:88', egressEntityName: 'Domain Controller DC1', appProtocol: 'KERBEROS', egressIp: '10.10.5.10', egressPort: 88, circuits: 150 },
      { hostPort: 'fileserver.corp:445', egressEntityName: 'File Server Cluster', appProtocol: 'SMB', egressIp: '10.10.6.30', egressPort: 445, circuits: 95 },
      { hostPort: 'bastion.corp:22', egressEntityName: 'Bastion Host', appProtocol: 'SSH', egressIp: '10.10.0.10', egressPort: 22, circuits: 25 },
    ]);
  });

  it("matches eng-ws-anderson's authored dial-set (a second, unrelated identity)", () => {
    // disc-001 @ 10.30.11.21 — api 78, gitlab 62, jenkins 44, artifactory 41.
    expect(
      rollUpIdentityDestinations(flowsOf('disc-001')).map((r) => [r.hostPort, r.appProtocol, r.circuits]),
    ).toEqual([
      ['api.corp:443', 'HTTPS', 78],
      ['gitlab.corp:22', 'SSH', 62],
      ['jenkins.corp:8080', 'HTTP', 44],
      ['artifactory.corp:443', 'HTTPS', 41],
    ]);
  });

  // ─── ordering ─────────────────────────────────────────────────────────────

  it('sorts strictly by circuits descending, for every enrolled identity', () => {
    const enrolledIds = [...new Set(DISCOVERED_FLOWS.map((f) => f.dialingIdentityId))].filter(
      (id): id is string => id !== null,
    );
    // 8 discovery identities (disc-*) + the 55 tagged estate hosts that now carry
    // their own observed traffic. Pinned so a fixture edit is deliberate.
    expect(enrolledIds.length).toBe(63);

    for (const id of enrolledIds) {
      const circuits = rollUpIdentityDestinations(flowsOf(id)).map((r) => r.circuits);
      expect(circuits).toEqual([...circuits].sort((a, b) => b - a));
    }
  });

  it('keeps first-seen order for rows tied on circuits (stable sort)', () => {
    const [a, b] = flowsOf('disc-017');
    const tied = [
      { ...a, destinationHostPort: 'first.corp:1', circuitCount: 10 },
      { ...b, destinationHostPort: 'second.corp:2', circuitCount: 10 },
    ];
    expect(rollUpIdentityDestinations(tied).map((r) => r.hostPort)).toEqual([
      'first.corp:1',
      'second.corp:2',
    ]);
  });

  // ─── aggregation ──────────────────────────────────────────────────────────

  it('sums circuits across repeat flows to one destination, first flow fixing the egress columns', () => {
    const base = flowsOf('disc-017')[0];
    const rows = rollUpIdentityDestinations([
      { ...base, id: 'x-1', circuitCount: 7, egressEntityName: 'First Seen', egressIp: '10.0.0.1', egressPort: 1 },
      { ...base, id: 'x-2', circuitCount: 5, egressEntityName: 'Later Seen', egressIp: '10.0.0.2', egressPort: 2 },
    ]);

    expect(rows.length).toBe(1);
    expect(rows[0].circuits).toBe(12);
    // FIRST FLOW WINS — only circuits accumulate.
    expect(rows[0].egressEntityName).toBe('First Seen');
    expect(rows[0].egressIp).toBe('10.0.0.1');
    expect(rows[0].egressPort).toBe(1);
  });

  it('returns an empty array for an identity with no flows', () => {
    // Still a real state, and still the drawer's empty-state branch: the ORIGINAL
    // demo block (id-001…id-021) is roster-only, unlike the estate block
    // (id-022…id-076) which now carries traffic of its own.
    expect(flowsOf('id-001')).toEqual([]);
    expect(flowsOf('id-021')).toEqual([]);
    expect(rollUpIdentityDestinations([])).toEqual([]);
  });

  // ─── the managed estate's traffic is coherent with its tags ───────────────

  it('an estate host dials the tier its #role says it should', () => {
    // pay-web-01 is #app-payments #role-web: a web tier reaches its application's
    // API and the shared identity provider — never the database directly.
    const web = rollUpIdentityDestinations(flowsOf('id-022')).map((r) => r.hostPort);
    expect(web).toContain('payments-api.corp:8443');
    expect(web).toContain('sso.corp:443');
    expect(web).not.toContain('payments-db.corp:5432');

    // pay-api-01 is #role-api: it is the tier that DOES reach the database.
    const api = rollUpIdentityDestinations(flowsOf('id-025')).map((r) => r.hostPort);
    expect(api).toContain('payments-db.corp:5432');

    // crm-web-01 is #role-web too, but #app-crm — same tier, different instance.
    const crm = rollUpIdentityDestinations(flowsOf('id-036')).map((r) => r.hostPort);
    expect(crm).toContain('crm-api.corp:8443');
    expect(crm).not.toContain('payments-api.corp:8443');
  });

  it('every estate flow resolves real egress metadata (no DEST_META fallback)', () => {
    // A destination missing from DEST_META silently yields egressIp '10.0.0.0'
    // and serviceName === the hostPort. Both are the signature of a half-authored
    // destination, so assert neither ever appears.
    for (const f of DISCOVERED_FLOWS) {
      expect(f.egressIp).not.toBe('10.0.0.0');
      expect(f.serviceName).not.toBe(f.destinationHostPort);
    }
  });

  // ─── app protocol ─────────────────────────────────────────────────────────

  it('reads the observed L7 protocol and uppercases it — never derives one from the port', () => {
    const rows = rollUpIdentityDestinations(flowsOf('disc-005')); // plant floor / OT
    const byDest = new Map(rows.map((r) => [r.hostPort, r.appProtocol]));

    // Two destinations on the SAME port 502 vs 1433/44818 — the value tracks the
    // capture's per-destination appProtocol, uppercased, not the port number.
    expect(byDest.get('scada.plant:502')).toBe('MODBUS');
    expect(byDest.get('historian.plant:1433')).toBe('MSSQL');
    expect(byDest.get('plc-gateway.plant:44818')).toBe('ENIP');
    expect(byDest.get('mes.corp:8080')).toBe('HTTP');

    // and it IS the flow's own field, uppercased — for every row, everywhere.
    for (const f of DISCOVERED_FLOWS) {
      const [row] = rollUpIdentityDestinations([f]);
      expect(row.appProtocol).toBe((f.appProtocol ?? f.protocol ?? '').toUpperCase());
    }
  });

  it('falls back to the transport protocol, then to empty — unknown stays unknown', () => {
    const base = flowsOf('disc-017')[0];

    const noAppProtocol: DiscoveredFlow = { ...base, appProtocol: undefined, protocol: 'udp' };
    expect(rollUpIdentityDestinations([noAppProtocol])[0].appProtocol).toBe('UDP');

    const neither: DiscoveredFlow = { ...base, appProtocol: undefined, protocol: undefined };
    expect(rollUpIdentityDestinations([neither])[0].appProtocol).toBe('');
  });
});

/**
 * The identity-side seed for the construct-policy modal.
 *
 * These pin the TRANSPOSE: the same carve-out raw-traffic and flow-detail perform,
 * with the identity held fixed instead of the destination. The rules that matter
 * are the ones a future edit could quietly break — one source per card, the ref
 * never widening to a #role, and card order tracking the Traffic tab.
 */
describe('identity-traffic adapter — construct-policy seed', () => {
  const PAY_WEB = { id: 'id-022', name: 'pay-web-01' };

  it('emits one card per distinct destination, in the Traffic tab’s own order', () => {
    const flows = flowsOf(PAY_WEB.id);
    const seed = buildIdentityPolicySeed(PAY_WEB, flows);

    expect(seed.length).toBe(new Set(flows.map((f) => f.destinationHostPort)).size);
    // Built by mapping over the rollup, so the order is the rollup's (circuits
    // desc) BY CONSTRUCTION — the modal lists what the drawer listed, in sequence.
    expect(seed.map((d) => d.hostPort)).toEqual(
      rollUpIdentityDestinations(flows).map((r) => r.hostPort),
    );
  });

  it('grants the launching identity ALONE — one @-ref per card, never a #role', () => {
    const seed = buildIdentityPolicySeed(PAY_WEB, flowsOf(PAY_WEB.id));
    expect(seed.length).toBeGreaterThan(1); // more than one card, same single source

    for (const dest of seed) {
      expect(dest.identities).toEqual([
        { kind: 'identity', id: 'id-022', name: 'pay-web-01' },
      ]);
    }
  });

  it('never seeds another dialer of a SHARED destination', () => {
    // sso.corp:443 is dialed by many estate hosts; the seed carries only the one
    // the drawer was opened for. This is raw-traffic's "just-X, NOT every dialer of
    // the destination" rule, which the identity path must not quietly widen.
    const sso = 'sso.corp:443';
    const otherDialers = DISCOVERED_FLOWS.filter(
      (f) => f.destinationHostPort === sso && f.dialingIdentityId !== PAY_WEB.id,
    );
    expect(otherDialers.length).toBeGreaterThan(0);

    const card = buildIdentityPolicySeed(PAY_WEB, flowsOf(PAY_WEB.id)).find(
      (d) => d.hostPort === sso,
    );
    expect(card?.identities.length).toBe(1);
  });

  it('classifies every source as an identity — the address arm is unreachable here', () => {
    // The caller resolves a roster Identity before opening the drawer, so a seed
    // built from this path is enrolled by construction and can never produce the
    // {kind:'address'} entries that make the modal withhold a grant.
    for (const id of ['id-022', 'id-025', 'disc-001', 'disc-017']) {
      for (const dest of buildIdentityPolicySeed({ id, name: id }, flowsOf(id))) {
        for (const src of dest.identities) expect(src.kind).toBe('identity');
      }
    }
  });

  it('carries the TRANSPORT protocol when unanimous, null when mixed', () => {
    const [base] = flowsOf(PAY_WEB.id);

    const unanimous = buildIdentityPolicySeed(PAY_WEB, [
      { ...base, id: 'p-1', destinationHostPort: 'one.corp:1', protocol: 'tcp' },
      { ...base, id: 'p-2', destinationHostPort: 'one.corp:1', protocol: 'tcp' },
    ]);
    expect(unanimous[0].protocol).toBe('tcp');

    const mixed = buildIdentityPolicySeed(PAY_WEB, [
      { ...base, id: 'p-3', destinationHostPort: 'two.corp:2', protocol: 'tcp' },
      { ...base, id: 'p-4', destinationHostPort: 'two.corp:2', protocol: 'udp' },
    ]);
    expect(mixed[0].protocol).toBeNull();

    const absent = buildIdentityPolicySeed(PAY_WEB, [
      { ...base, id: 'p-5', destinationHostPort: 'three.corp:3', protocol: undefined },
    ]);
    expect(absent[0].protocol).toBeNull();
  });

  it('takes protocol from the flows, NOT the rollup’s uppercased appProtocol', () => {
    // The rollup reports 'HTTPS'; the modal's field is the lowercase transport
    // union. Seeding from IdentityDestinationRow would put an invalid value here.
    const flows = flowsOf(PAY_WEB.id);
    const seed = buildIdentityPolicySeed(PAY_WEB, flows);
    for (const dest of seed) {
      if (dest.protocol !== null) {
        expect(['tcp', 'udp', 'http', 'https']).toContain(dest.protocol);
      }
    }
    // and the rollup really does disagree in case, so this is a live distinction
    expect(rollUpIdentityDestinations(flows).map((r) => r.appProtocol)).toContain('HTTPS');
  });

  it('gives each card its own source object — cards must not alias', () => {
    const seed = buildIdentityPolicySeed(PAY_WEB, flowsOf(PAY_WEB.id));
    expect(seed[0].identities[0]).not.toBe(seed[1].identities[0]);
    expect(seed[0].identities[0]).toEqual(seed[1].identities[0]);
  });

  it('honours a FILTERED flow list — the mechanism destination selection rides on', () => {
    // The drawer narrows to the ticked destinations by filtering flows at the call
    // site; the adapter itself knows nothing about selection. This pins that the
    // filter is sufficient: fewer flows in, exactly those destinations out, same
    // order, still one @-ref per card.
    const all = flowsOf(PAY_WEB.id);
    const keep = 'sso.corp:443';
    const selected = all.filter((f) => f.destinationHostPort === keep);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThan(all.length);

    const seed = buildIdentityPolicySeed(PAY_WEB, selected);
    expect(seed.map((d) => d.hostPort)).toEqual([keep]);
    expect(seed[0].identities).toEqual([{ kind: 'identity', id: 'id-022', name: 'pay-web-01' }]);

    // and the unselected destination is genuinely absent, not merely reordered
    expect(seed.map((d) => d.hostPort)).not.toContain('payments-api.corp:8443');
  });

  it('returns no cards for an identity with no observed traffic', () => {
    // What gates the drawer's action off for the roster-only block.
    expect(buildIdentityPolicySeed({ id: 'id-001', name: 'laptop-alice' }, flowsOf('id-001')))
      .toEqual([]);
    expect(buildIdentityPolicySeed(PAY_WEB, [])).toEqual([]);
  });
});
