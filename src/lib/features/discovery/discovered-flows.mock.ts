/**
 * PART 2 — realistic mock data for the discovery → policy engine.
 *
 * CIDR-FIRST MODEL (re-grounded): this is the PRE-DISCOVERY reality — someone
 * points discovery at CIDR /24 blocks (subnets) they don't fully know. Discovery
 * surfaces the SPECIFIC source IPs inside each block and where they dial. A source
 * IP is EITHER mapped to an enrolled Identity or not:
 *
 *   • enrolled   → its `dialingIdentityId` is a real Identity id (disc-0NN) present
 *                  in DISCOVERY_IDENTITIES; name = the Identity's real name.
 *   • unenrolled → `dialingIdentityId` = `null` (no resolvable identity — an
 *                  observed ADDRESS, not a principal). The IP still renders honestly
 *                  as the display string via `ingressIp` / `ingressEntityName`
 *                  (NEVER '' — tables/rationale show the IP, never blank). The IP is
 *                  the address side; it is NEVER coerced into the identity id.
 *
 * Enrollment is DERIVED, never stored: a source counts as enrolled iff its id
 * resolves in MockDataService.identities (which spreads DISCOVERY_IDENTITIES).
 * There is no `enrolled` field and nothing is nullable.
 *
 * Two exports:
 *   • DISCOVERY_IDENTITIES — ONLY the enrolled subset of sources. Every enrolledId
 *     referenced in a SourceSpec has a record here; every unenrolled IP does NOT.
 *     They carry NO cluster attributes (attributes: []) — every #role comes from
 *     discovery.
 *   • DISCOVERED_FLOWS — observed traffic, authored from a terse CIDR-nested spec
 *     (block → sources → [destination, circuitCount]) then expanded to full
 *     DiscoveredFlow records. The spec is deliberately visible so a reviewer can
 *     read each block's observed hosts + dial-sets at a glance.
 *
 * IMPORTANT — the clusters are NOT hardcoded. This data is authored to *resemble a
 * real network* (functional groups with realistic overlap + a messy tail); the
 * clusters, matches, and proposals all EMERGE from the Jaccard math in
 * discovery-engine.ts. The comment below documents the *intended* shape so a
 * reviewer can check the engine reproduces it — but nothing here assigns a cluster.
 *
 * Intended network (blocks the operator pointed discovery at):
 *   • 10.30.11.0/24  Corp engineering — dev toolchain (gitlab/jenkins/artifactory
 *     /api), per-host drift (one skips api, one adds wiki). → ONE cluster.
 *   • 10.70.1.0/24   Plant floor (OT) — scada/historian/plc-gateway/mes. → ONE.
 *   • 10.10.20.0/24  Admin/ops — rdp/vault/grafana/db (+ api on two). → ONE.
 *   • 10.10.30.0/24  IT infrastructure/identity — dc(ldap+kerberos)/dns/fileserver
 *     (+ bastion on the domain-admins). → ONE.
 *   • 10.10.31.0/24  Database administration — mssql-prod/reporting-db(+fileserver). → ONE.
 *   • 192.168.60.0/24 Vendor/contractor DMZ — scattered, unique reaches. → the tail
 *     (each source clears the threshold with nobody, stays UNGROUPED).
 *
 * Destinations mix MATCHED (existing seed services) and UNMATCHED (brownfield):
 *   matched  : gitlab.corp:22 (svc-001) · api.corp:443 (svc-002) · db.corp:5432 (svc-003)
 *   unmatched: everything else (brownfield candidates for new services)
 */

import type { Identity } from '../../shared/services/mock-data.service';
import type { AppProtocol, DiscoveredFlow } from './discovery.models';

// ─── enrolled identities ONLY (the source IPs we deliberately enrolled) ───────
// A source IP is "enrolled" iff its id appears here (presence == the switch).
// Every unenrolled source in the blocks below is a bare IP absent from this list.
export const DISCOVERY_IDENTITIES: Identity[] = [
  // Corp engineering (10.30.11.0/24)
  { id: 'disc-001', name: 'eng-ws-anderson', createdAt: '2025-04-02T09:00:00Z', status: 'online',  type: 'device', attributes: [], authPolicy: 'Default', enrollmentType: 'ott' },
  { id: 'disc-002', name: 'eng-ws-bhatt',    createdAt: '2025-04-02T09:05:00Z', status: 'online',  type: 'device', attributes: [], authPolicy: 'Default', enrollmentType: 'ott' },
  // Plant floor / OT (10.70.1.0/24)
  { id: 'disc-005', name: 'plc-gw-line1',    createdAt: '2025-03-18T08:00:00Z', status: 'online',  type: 'device', attributes: [], authPolicy: 'Default', enrollmentType: 'ottca' },
  // Admin / ops (10.10.20.0/24)
  { id: 'disc-008', name: 'admin-ws-ops1',   createdAt: '2025-02-20T13:00:00Z', status: 'online',  type: 'user',   attributes: [], authPolicy: 'MFA-Required', enrollmentType: 'updb' },
  // Vendor / contractor DMZ (192.168.60.0/24) — one enrolled contractor in the tail
  { id: 'disc-014', name: 'contractor-laptop-vendor', createdAt: '2025-06-01T14:00:00Z', status: 'offline', type: 'device', attributes: [], authPolicy: 'Default', enrollmentType: 'ott' },
  // IT infrastructure / identity (10.10.30.0/24)
  { id: 'disc-017', name: 'domain-admin-01', createdAt: '2025-01-15T09:00:00Z', status: 'online',  type: 'user',   attributes: [], authPolicy: 'MFA-Required', enrollmentType: 'updb' },
  { id: 'disc-018', name: 'domain-admin-02', createdAt: '2025-01-15T09:05:00Z', status: 'online',  type: 'user',   attributes: [], authPolicy: 'MFA-Required', enrollmentType: 'updb' },
  // Database administration (10.10.31.0/24)
  { id: 'disc-023', name: 'dba-ws-01',       createdAt: '2025-02-10T13:00:00Z', status: 'online',  type: 'user',   attributes: [], authPolicy: 'MFA-Required', enrollmentType: 'updb' },
];

// ─── terse CIDR-nested access-pattern spec ────────────────────────────────────
// A block is a /24 the operator pointed discovery at; each source is an observed
// IP in it (enrolled → enrolledId/enrolledName set; unenrolled → bare IP).

interface SourceSpec {
  /** Observed source IP — becomes both `ingressIp` and (for unenrolled) the id. */
  ip: string;
  /** Set iff enrolled: the real Identity id (must exist in DISCOVERY_IDENTITIES). */
  enrolledId?: string;
  /** The enrolled Identity's real display name. */
  enrolledName?: string;
  dials: Array<[hostPort: string, circuits: number]>;
}
interface CidrBlockSpec {
  /** The /24 the operator pointed discovery at, e.g. '10.30.11.0/24'. */
  cidr: string;
  sources: SourceSpec[];
}

// Protocol per destination — used when a proposal must author a new service.
const DEST_PROTOCOL: ReadonlyMap<string, DiscoveredFlow['protocol']> = new Map([
  ['gitlab.corp:22', 'tcp'],
  ['api.corp:443', 'https'],
  ['db.corp:5432', 'tcp'],
  ['jenkins.corp:8080', 'http'],
  ['artifactory.corp:443', 'https'],
  ['wiki.corp:443', 'https'],
  ['scada.plant:502', 'tcp'],
  ['historian.plant:1433', 'tcp'],
  ['plc-gateway.plant:44818', 'tcp'],
  ['mes.corp:8080', 'http'],
  ['rdp-jumphost.corp:3389', 'tcp'],
  ['vault.corp:8200', 'https'],
  ['grafana.corp:3000', 'http'],
  // ── EXPANSION: new IT destinations ──
  ['dc.corp:389', 'tcp'],
  ['dc.corp:88', 'tcp'],
  ['dns.corp:53', 'udp'],
  ['fileserver.corp:445', 'tcp'],
  ['bastion.corp:22', 'tcp'],
  ['mssql-prod.corp:1433', 'tcp'],
  ['ntp.corp:123', 'udp'],
  ['sccm.corp:8530', 'https'],
  ['reporting-db.corp:5432', 'tcp'],
  // ── EXPANSION: new OT destinations ──
  ['opcua-historian.plant:4840', 'tcp'],
  ['s7-plc.plant:102', 'tcp'],
  ['modbus-rtu.plant:502', 'tcp'],
]);

// ─── App-level (L7) protocol per destination ──────────────────────────────────
// The Sankey's "Protocol" stage. SEMANTIC protocol observed on the wire —
// distinct from transport `protocol` above (a service needs tcp/udp; the wire
// carried ssh/ldap/modbus/…). Keyed by hostPort exactly like DEST_PROTOCOL, so
// every flow gets a coherent app-protocol and the Sankey stage isn't half-empty.
// The 13 original destinations are backfilled with their real app-protocol.
const DEST_APP_PROTOCOL: ReadonlyMap<string, AppProtocol> = new Map([
  // backfill — the original 13
  ['gitlab.corp:22', 'ssh'],
  ['api.corp:443', 'https'],
  ['db.corp:5432', 'postgres'],
  ['jenkins.corp:8080', 'http'],
  ['artifactory.corp:443', 'https'],
  ['wiki.corp:443', 'https'],
  ['scada.plant:502', 'modbus'],
  ['historian.plant:1433', 'mssql'],
  ['plc-gateway.plant:44818', 'enip'],
  ['mes.corp:8080', 'http'],
  ['rdp-jumphost.corp:3389', 'rdp'],
  ['vault.corp:8200', 'https'],
  ['grafana.corp:3000', 'http'],
  // new IT destinations
  ['dc.corp:389', 'ldap'],
  ['dc.corp:88', 'kerberos'],
  ['dns.corp:53', 'dns'],
  ['fileserver.corp:445', 'smb'],
  ['bastion.corp:22', 'ssh'],
  ['mssql-prod.corp:1433', 'mssql'],
  ['ntp.corp:123', 'ntp'],
  ['sccm.corp:8530', 'https'],
  ['reporting-db.corp:5432', 'postgres'],
  // new OT destinations
  ['opcua-historian.plant:4840', 'opcua'],
  ['s7-plc.plant:102', 's7'],
  ['modbus-rtu.plant:502', 'modbus'],
]);

// ─── CloudZiti Traffic-Analysis column data ───────────────────────────────────
// Per-destination egress detail — the host/gateway (egressEntityName) is DISTINCT
// from the logical service (serviceName): one gateway fronts several services, so
// the columns read meaningfully different, mirroring real Traffic Analysis. The
// egress port matches the destination port EXCEPT where the terminator forwards to
// a different host port (api.corp intercepts :443 but the app listens on :8443) —
// exactly the intercept-vs-host distinction CloudZiti surfaces.
//
// NAMING HONESTY: `serviceName` is populated ONLY for destinations that map to a
// real existing Service (interceptAddress match) — gitlab.corp:22, api.corp:443,
// db.corp:5432. A flow to an as-yet-undefined destination has NO service, so it
// carries NO service name (''); the UI shows "—" and the create-policy modals
// default a new service's name to its host (e.g. scada.plant), user-editable.
// Fabricated product names ("SCADA Master", …) would imply a service exists that
// doesn't — so they're gone.
interface DestMeta {
  egressIp: string;
  egressPort: number;
  egressEntityName: string;
  serviceName: string;
}
const DEST_META: ReadonlyMap<string, DestMeta> = new Map([
  // Engineering dev toolchain
  ['gitlab.corp:22',        { egressIp: '10.0.1.50',  egressPort: 22,    egressEntityName: 'Dev Tools Host',    serviceName: 'gitlab-internal' }],
  ['jenkins.corp:8080',     { egressIp: '10.0.1.61',  egressPort: 8080,  egressEntityName: 'Dev Tools Host',    serviceName: '' }],
  ['artifactory.corp:443',  { egressIp: '10.0.1.62',  egressPort: 443,   egressEntityName: 'Dev Tools Host',    serviceName: '' }],
  ['api.corp:443',          { egressIp: '10.0.2.10',  egressPort: 8443,  egressEntityName: 'Prod API Cluster',  serviceName: 'app-api-prod' }],
  ['wiki.corp:443',         { egressIp: '10.0.4.12',  egressPort: 443,   egressEntityName: 'Confluence Host',   serviceName: '' }],
  // Plant floor (OT) — one gateway, several services on distinct ports
  ['scada.plant:502',       { egressIp: '10.70.2.11', egressPort: 502,   egressEntityName: 'Austin Plant Floor GW', serviceName: '' }],
  ['historian.plant:1433',  { egressIp: '10.70.2.14', egressPort: 1433,  egressEntityName: 'Austin Plant Floor GW', serviceName: '' }],
  ['plc-gateway.plant:44818',{ egressIp: '10.70.2.21', egressPort: 44818, egressEntityName: 'Austin Plant Floor GW', serviceName: '' }],
  ['mes.corp:8080',         { egressIp: '10.20.5.30', egressPort: 8080,  egressEntityName: 'MES App Server',    serviceName: '' }],
  // Admin / ops
  ['rdp-jumphost.corp:3389',{ egressIp: '10.10.0.9',  egressPort: 3389,  egressEntityName: 'Bastion Host',      serviceName: '' }],
  ['vault.corp:8200',       { egressIp: '10.10.1.20', egressPort: 8200,  egressEntityName: 'Secrets Cluster',   serviceName: '' }],
  ['grafana.corp:3000',     { egressIp: '10.10.2.31', egressPort: 3000,  egressEntityName: 'Observability Host', serviceName: '' }],
  ['db.corp:5432',          { egressIp: '10.0.3.20',  egressPort: 5432,  egressEntityName: 'Prod DB Primary',   serviceName: 'postgres-db' }],
  // ── EXPANSION: new IT destinations (serviceName '' — unmatched observed flows) ──
  ['dc.corp:389',           { egressIp: '10.10.5.10',  egressPort: 389,   egressEntityName: 'Domain Controller DC1', serviceName: '' }],
  ['dc.corp:88',            { egressIp: '10.10.5.10',  egressPort: 88,    egressEntityName: 'Domain Controller DC1', serviceName: '' }],
  ['dns.corp:53',           { egressIp: '10.10.5.20',  egressPort: 53,    egressEntityName: 'Core DNS',           serviceName: '' }],
  ['fileserver.corp:445',   { egressIp: '10.10.6.30',  egressPort: 445,   egressEntityName: 'File Server Cluster', serviceName: '' }],
  ['bastion.corp:22',       { egressIp: '10.10.0.10',  egressPort: 22,    egressEntityName: 'Bastion Host',       serviceName: '' }],
  ['mssql-prod.corp:1433',  { egressIp: '10.10.7.40',  egressPort: 1433,  egressEntityName: 'SQL Server Prod',    serviceName: '' }],
  ['ntp.corp:123',          { egressIp: '10.10.5.25',  egressPort: 123,   egressEntityName: 'Core NTP',           serviceName: '' }],
  ['sccm.corp:8530',        { egressIp: '10.10.8.50',  egressPort: 8530,  egressEntityName: 'SCCM Server',        serviceName: '' }],
  ['reporting-db.corp:5432',{ egressIp: '10.10.7.45',  egressPort: 5432,  egressEntityName: 'Reporting DB',       serviceName: '' }],
  // ── EXPANSION: new OT destinations (Line-4 OT gateway fronts several) ──
  ['opcua-historian.plant:4840', { egressIp: '10.70.4.11', egressPort: 4840, egressEntityName: 'Line-4 OT Gateway', serviceName: '' }],
  ['s7-plc.plant:102',      { egressIp: '10.70.4.12', egressPort: 102,   egressEntityName: 'Line-4 OT Gateway',  serviceName: '' }],
  ['modbus-rtu.plant:502',  { egressIp: '10.70.4.13', egressPort: 502,   egressEntityName: 'Line-4 OT Gateway',  serviceName: '' }],
]);

// ─── the CIDR-first blocks ────────────────────────────────────────────────────
// ~6 /24 blocks, 4-5 sources each, a MIX of enrolled/unenrolled per block. Five
// blocks are functional groups whose sources share a dial-set (→ clusters emerge);
// the DMZ block is scattered (→ the ungrouped tail). Circuit counts drive volume
// ranking + the low-volume/noise flag exactly as before.
const CIDR_BLOCKS: CidrBlockSpec[] = [
  // ── Corp engineering workstations — dev toolchain (2 enrolled, 3 unenrolled) ──
  {
    cidr: '10.30.11.0/24',
    sources: [
      { ip: '10.30.11.21', enrolledId: 'disc-001', enrolledName: 'eng-ws-anderson', dials: [
        ['gitlab.corp:22', 62], ['jenkins.corp:8080', 44], ['artifactory.corp:443', 41], ['api.corp:443', 78],
      ] },
      { ip: '10.30.11.22', dials: [
        ['gitlab.corp:22', 58], ['jenkins.corp:8080', 47], ['artifactory.corp:443', 39], ['api.corp:443', 83],
      ] },
      { ip: '10.30.11.23', dials: [
        ['gitlab.corp:22', 60], ['jenkins.corp:8080', 45], ['artifactory.corp:443', 43], // no api — drift
      ] },
      { ip: '10.30.11.24', enrolledId: 'disc-002', enrolledName: 'eng-ws-bhatt', dials: [
        ['gitlab.corp:22', 55], ['jenkins.corp:8080', 42], ['artifactory.corp:443', 40], ['api.corp:443', 71],
      ] },
      { ip: '10.30.11.25', dials: [
        ['gitlab.corp:22', 57], ['jenkins.corp:8080', 43], ['artifactory.corp:443', 38], ['api.corp:443', 69], ['wiki.corp:443', 4], // also hits wiki (rarely)
      ] },
    ],
  },

  // ── Plant floor (OT) — identical functional pattern (1 enrolled, 3 unenrolled) ──
  {
    cidr: '10.70.1.0/24',
    sources: [
      { ip: '10.70.1.51', enrolledId: 'disc-005', enrolledName: 'plc-gw-line1', dials: [
        ['scada.plant:502', 152], ['historian.plant:1433', 110], ['plc-gateway.plant:44818', 90], ['mes.corp:8080', 70],
      ] },
      { ip: '10.70.1.52', dials: [
        ['scada.plant:502', 148], ['historian.plant:1433', 115], ['plc-gateway.plant:44818', 88], ['mes.corp:8080', 72],
      ] },
      { ip: '10.70.1.53', dials: [
        ['scada.plant:502', 150], ['historian.plant:1433', 108], ['plc-gateway.plant:44818', 92], ['mes.corp:8080', 68],
      ] },
      { ip: '10.70.1.54', dials: [
        ['scada.plant:502', 145], ['historian.plant:1433', 112], ['plc-gateway.plant:44818', 87], // no mes — drift
      ] },
    ],
  },

  // ── Admin / ops workstations (1 enrolled, 3 unenrolled) ──
  {
    cidr: '10.10.20.0/24',
    sources: [
      { ip: '10.10.20.41', enrolledId: 'disc-008', enrolledName: 'admin-ws-ops1', dials: [
        ['rdp-jumphost.corp:3389', 55], ['vault.corp:8200', 35], ['grafana.corp:3000', 40], ['api.corp:443', 92], ['db.corp:5432', 128],
      ] },
      { ip: '10.10.20.42', dials: [
        ['rdp-jumphost.corp:3389', 58], ['vault.corp:8200', 33], ['grafana.corp:3000', 42], ['api.corp:443', 88], ['db.corp:5432', 121],
      ] },
      { ip: '10.10.20.43', dials: [
        ['rdp-jumphost.corp:3389', 52], ['vault.corp:8200', 37], ['grafana.corp:3000', 38], ['db.corp:5432', 119], // no api — drift
      ] },
      { ip: '10.10.20.44', dials: [
        ['rdp-jumphost.corp:3389', 54], ['vault.corp:8200', 34], ['grafana.corp:3000', 39], ['db.corp:5432', 116], // no api — drift
      ] },
    ],
  },

  // ── IT infrastructure / identity (2 enrolled domain-admins, 3 unenrolled) ──
  {
    cidr: '10.10.30.0/24',
    sources: [
      { ip: '10.10.30.11', enrolledId: 'disc-017', enrolledName: 'domain-admin-01', dials: [
        ['dc.corp:389', 180], ['dc.corp:88', 150], ['dns.corp:53', 420], ['fileserver.corp:445', 95], ['bastion.corp:22', 25],
      ] },
      { ip: '10.10.30.12', enrolledId: 'disc-018', enrolledName: 'domain-admin-02', dials: [
        ['dc.corp:389', 175], ['dc.corp:88', 145], ['dns.corp:53', 410], ['fileserver.corp:445', 90], ['bastion.corp:22', 22],
      ] },
      { ip: '10.10.30.13', dials: [
        ['dc.corp:389', 160], ['dc.corp:88', 140], ['dns.corp:53', 400], ['fileserver.corp:445', 88], // no bastion — drift
      ] },
      { ip: '10.10.30.14', dials: [
        ['dc.corp:389', 155], ['dc.corp:88', 135], ['dns.corp:53', 390], ['fileserver.corp:445', 85], // no bastion — drift
      ] },
      { ip: '10.10.30.15', dials: [
        ['dc.corp:389', 150], ['dc.corp:88', 130], ['dns.corp:53', 380], ['fileserver.corp:445', 82], // no bastion — drift
      ] },
    ],
  },

  // ── Database administration (1 enrolled, 3 unenrolled) ──
  {
    cidr: '10.10.31.0/24',
    sources: [
      { ip: '10.10.31.21', enrolledId: 'disc-023', enrolledName: 'dba-ws-01', dials: [
        ['mssql-prod.corp:1433', 85], ['reporting-db.corp:5432', 110], ['fileserver.corp:445', 20],
      ] },
      { ip: '10.10.31.22', dials: [
        ['mssql-prod.corp:1433', 88], ['reporting-db.corp:5432', 105], ['fileserver.corp:445', 18],
      ] },
      { ip: '10.10.31.23', dials: [
        ['mssql-prod.corp:1433', 82], ['reporting-db.corp:5432', 108], ['fileserver.corp:445', 22],
      ] },
      { ip: '10.10.31.24', dials: [
        ['mssql-prod.corp:1433', 80], ['reporting-db.corp:5432', 102], // no fileserver — drift
      ] },
    ],
  },

  // ── Vendor / contractor DMZ — scattered, unique reaches → the ungrouped tail ──
  // (1 enrolled contractor + 4 unenrolled; every source clears with nobody.)
  {
    cidr: '192.168.60.0/24',
    sources: [
      { ip: '192.168.60.8', dials: [
        ['bastion.corp:22', 12], ['s7-plc.plant:102', 8], // cross IT/OT vendor jump — unique, low volume
      ] },
      { ip: '192.168.60.9', dials: [
        ['s7-plc.plant:102', 15], ['opcua-historian.plant:4840', 10], // partial OT reach — below threshold
      ] },
      { ip: '192.168.60.10', dials: [
        ['gitlab.corp:22', 15], ['wiki.corp:443', 2], // partial dev access — unique
      ] },
      { ip: '192.168.60.11', enrolledId: 'disc-014', enrolledName: 'contractor-laptop-vendor', dials: [
        ['gitlab.corp:22', 20], ['api.corp:443', 30], // a lone contractor — partial eng overlap, stays ungrouped
      ] },
      { ip: '192.168.60.12', dials: [
        ['ntp.corp:123', 180], ['dns.corp:53', 200], ['sccm.corp:8530', 15], // infra probe — scattered reach
      ] },
    ],
  },
];

// ─── expand terse CIDR spec → full DiscoveredFlow records ──────────────────────
// Timestamps are a stable ~4-week window (no Date.now — deterministic mock).

const WINDOW_FIRST_SEEN = '2026-07-08T09:00:00Z';
const WINDOW_LAST_SEEN = '2026-08-05T17:00:00Z';

function buildFlows(): DiscoveredFlow[] {
  const flows: DiscoveredFlow[] = [];
  let n = 0;
  for (const block of CIDR_BLOCKS) {
    for (const src of block.sources) {
      // Derived enrollment: enrolled → real disc id; unenrolled → null identity id
      // (an observed ADDRESS, never a principal). The IP is NOT coerced into the id;
      // it stays the display/address string (never '' — renders honestly in tables).
      const dialingIdentityId = src.enrolledId ?? null;
      const displayName = src.enrolledName ?? src.ip;
      for (const [hostPort, circuits] of src.dials) {
        n += 1;
        const meta = DEST_META.get(hostPort);
        const port = Number(hostPort.slice(hostPort.lastIndexOf(':') + 1));
        flows.push({
          id: `flow-${String(n).padStart(3, '0')}`,
          dialingIdentityId,
          dialingIdentityName: displayName,
          destinationHostPort: hostPort,
          matchedServiceId: null, // raw capture — the engine matches this
          circuitCount: circuits,
          protocol: DEST_PROTOCOL.get(hostPort),
          appProtocol: DEST_APP_PROTOCOL.get(hostPort),
          ingressIp: src.ip,
          egressIp: meta?.egressIp ?? '10.0.0.0',
          egressPort: meta?.egressPort ?? port,
          ingressEntityName: displayName,
          egressEntityName: meta?.egressEntityName ?? hostPort,
          serviceName: meta?.serviceName ?? hostPort,
          firstSeen: WINDOW_FIRST_SEEN,
          lastSeen: WINDOW_LAST_SEEN,
        });
      }
    }
  }
  return flows;
}

export const DISCOVERED_FLOWS: DiscoveredFlow[] = buildFlows();
