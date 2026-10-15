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
  // ── MANAGED ESTATE: the application tiers the tagged roster dials ──
  ['payments-api.corp:8443', 'https'],
  ['payments-db.corp:5432', 'tcp'],
  ['crm-api.corp:8443', 'https'],
  ['crm-db.corp:1433', 'tcp'],
  ['logistics-api.plant:8443', 'https'],
  ['logistics-db.plant:5432', 'tcp'],
  ['analytics-api.corp:8443', 'https'],
  ['analytics-db.corp:1433', 'tcp'],
  ['sso.corp:443', 'https'],
  ['backup.corp:445', 'tcp'],
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
  // managed estate — note NO new AppProtocol members were needed: every tier
  // speaks something the union already carries.
  ['payments-api.corp:8443', 'https'],
  ['payments-db.corp:5432', 'postgres'],
  ['crm-api.corp:8443', 'https'],
  ['crm-db.corp:1433', 'mssql'],
  ['logistics-api.plant:8443', 'https'],
  ['logistics-db.plant:5432', 'postgres'],
  ['analytics-api.corp:8443', 'https'],
  ['analytics-db.corp:1433', 'mssql'],
  ['sso.corp:443', 'https'],
  ['backup.corp:445', 'smb'],
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
  // ── MANAGED ESTATE tiers. serviceName stays '' throughout: none of these is a
  //    real record in MockDataService.services() (only gitlab/api/db are), and the
  //    NAMING HONESTY rule above applies to them exactly as to the capture. ──
  ['payments-api.corp:8443',     { egressIp: '10.20.11.10', egressPort: 8443, egressEntityName: 'Payments API Cluster',  serviceName: '' }],
  ['payments-db.corp:5432',      { egressIp: '10.20.11.20', egressPort: 5432, egressEntityName: 'Payments DB Primary',   serviceName: '' }],
  ['crm-api.corp:8443',          { egressIp: '10.40.11.10', egressPort: 8443, egressEntityName: 'CRM API Cluster',       serviceName: '' }],
  ['crm-db.corp:1433',           { egressIp: '10.40.11.20', egressPort: 1433, egressEntityName: 'CRM DB Primary',        serviceName: '' }],
  ['logistics-api.plant:8443',   { egressIp: '10.70.6.10',  egressPort: 8443, egressEntityName: 'WMS API Cluster',       serviceName: '' }],
  ['logistics-db.plant:5432',    { egressIp: '10.70.6.20',  egressPort: 5432, egressEntityName: 'WMS DB Primary',        serviceName: '' }],
  ['analytics-api.corp:8443',    { egressIp: '10.20.21.10', egressPort: 8443, egressEntityName: 'Analytics API Cluster', serviceName: '' }],
  ['analytics-db.corp:1433',     { egressIp: '10.20.21.20', egressPort: 1433, egressEntityName: 'Analytics Warehouse',   serviceName: '' }],
  ['sso.corp:443',               { egressIp: '10.10.9.10',  egressPort: 443,  egressEntityName: 'Identity Provider',     serviceName: '' }],
  ['backup.corp:445',            { egressIp: '10.10.9.40',  egressPort: 445,  egressEntityName: 'Backup Vault',          serviceName: '' }],
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

/**
 * ─── the MANAGED ESTATE's observed traffic ────────────────────────────────────
 *
 * Authored in the SAME terse spec as the capture above, and expanded by the same
 * builder — the only difference is that every source here carries an `enrolledId`
 * pointing at a tagged roster identity (`id-0NN`), so `buildFlows` stamps a real
 * `dialingIdentityId` and nothing is an observed address.
 *
 * TAG-COHERENT BY CONSTRUCTION. The dial-sets were derived from each identity's
 * attributes, so the traffic corroborates the grouping rather than sitting beside
 * it: ROLE picks the tier a host talks to, APPLICATION picks which instance of
 * that tier, and a person (tagged with an app but no role, because a person is
 * not a tier) reaches the app's front door and the shared services instead.
 *
 *   #role-web    → its application's API   + sso
 *   #role-api    → its application's DB     + sso + dns
 *   #role-db     → backup                   + dns
 *   #role-worker → its application's DB     + backup   (+ mes, on the plant)
 *   a person     → sso + its application's API + wiki
 *   no app tag   → shared services only (dns / ntp / bastion / api)
 *
 * Several destinations are SHARED with the capture above (dns.corp:53,
 * ntp.corp:123, bastion.corp:22, wiki.corp:443, api.corp:443, mes.corp:8080).
 * That overlap is deliberate — without it the flow map would render two
 * disconnected halves and the clustering would never see the two populations as
 * related.
 *
 * One ingress IP per identity, one /24 per application: `IdentityGroup` in
 * raw-traffic.component.ts documents a 1:1 identity↔ingressIp invariant and
 * silently shows only the first IP if it is broken.
 */
const MANAGED_BLOCKS: CidrBlockSpec[] = [

  // ── Payments application tiers (us-east) ──
  {
    cidr: '10.20.10.0/24',
    sources: [
      { ip: '10.20.10.11', enrolledId: 'id-022', enrolledName: 'pay-web-01', dials: [
        ['payments-api.corp:8443', 180], ['sso.corp:443', 60],
      ] },
      { ip: '10.20.10.12', enrolledId: 'id-023', enrolledName: 'pay-web-02', dials: [
        ['payments-api.corp:8443', 187], ['sso.corp:443', 67],
      ] },
      { ip: '10.20.10.13', enrolledId: 'id-024', enrolledName: 'pay-web-03', dials: [
        ['payments-api.corp:8443', 194], ['sso.corp:443', 74],
      ] },
      { ip: '10.20.10.14', enrolledId: 'id-025', enrolledName: 'pay-api-01', dials: [
        ['payments-db.corp:5432', 261], ['sso.corp:443', 66], ['dns.corp:53', 171],
      ] },
      { ip: '10.20.10.15', enrolledId: 'id-026', enrolledName: 'pay-api-02', dials: [
        ['payments-db.corp:5432', 245], ['sso.corp:443', 50], ['dns.corp:53', 155],
      ] },
      { ip: '10.20.10.16', enrolledId: 'id-027', enrolledName: 'pay-api-03', dials: [
        ['payments-db.corp:5432', 252], ['sso.corp:443', 57], ['dns.corp:53', 162],
      ] },
      { ip: '10.20.10.17', enrolledId: 'id-028', enrolledName: 'pay-db-01', dials: [
        ['backup.corp:445', 109], ['dns.corp:53', 139],
      ] },
      { ip: '10.20.10.18', enrolledId: 'id-029', enrolledName: 'pay-db-02', dials: [
        ['backup.corp:445', 93], ['dns.corp:53', 123],
      ] },
      { ip: '10.20.10.19', enrolledId: 'id-030', enrolledName: 'pay-worker-01', dials: [
        ['payments-db.corp:5432', 140], ['backup.corp:445', 50],
      ] },
      { ip: '10.20.10.20', enrolledId: 'id-031', enrolledName: 'pay-worker-02', dials: [
        ['payments-db.corp:5432', 147], ['backup.corp:445', 57],
      ] },
      { ip: '10.20.10.21', enrolledId: 'id-032', enrolledName: 'pay-ops-anna', dials: [
        ['sso.corp:443', 71], ['payments-api.corp:8443', 56], ['wiki.corp:443', 13],
      ] },
      { ip: '10.20.10.22', enrolledId: 'id-033', enrolledName: 'pay-ops-ben', dials: [
        ['sso.corp:443', 78], ['payments-api.corp:8443', 63], ['wiki.corp:443', 20],
      ] },
      { ip: '10.20.10.23', enrolledId: 'id-034', enrolledName: 'pay-qa-01', dials: [
        ['payments-db.corp:5432', 255], ['sso.corp:443', 60], ['dns.corp:53', 165],
      ] },
      { ip: '10.20.10.24', enrolledId: 'id-035', enrolledName: 'pay-cache-01', dials: [
        ['payments-db.corp:5432', 152], ['backup.corp:445', 62],
      ] },
    ],
  },

  // ── Analytics application tiers (us-east) ──
  {
    cidr: '10.20.20.0/24',
    sources: [
      { ip: '10.20.20.11', enrolledId: 'id-063', enrolledName: 'ana-web-01', dials: [
        ['analytics-api.corp:8443', 180], ['sso.corp:443', 60],
      ] },
      { ip: '10.20.20.12', enrolledId: 'id-064', enrolledName: 'ana-api-01', dials: [
        ['analytics-db.corp:1433', 247], ['sso.corp:443', 52], ['dns.corp:53', 157],
      ] },
      { ip: '10.20.20.13', enrolledId: 'id-065', enrolledName: 'ana-api-02', dials: [
        ['analytics-db.corp:1433', 254], ['sso.corp:443', 59], ['dns.corp:53', 164],
      ] },
      { ip: '10.20.20.14', enrolledId: 'id-066', enrolledName: 'ana-db-01', dials: [
        ['backup.corp:445', 111], ['dns.corp:53', 141],
      ] },
      { ip: '10.20.20.15', enrolledId: 'id-067', enrolledName: 'ana-db-02', dials: [
        ['backup.corp:445', 95], ['dns.corp:53', 125],
      ] },
      { ip: '10.20.20.16', enrolledId: 'id-068', enrolledName: 'ana-worker-01', dials: [
        ['analytics-db.corp:1433', 142], ['backup.corp:445', 52],
      ] },
      { ip: '10.20.20.17', enrolledId: 'id-069', enrolledName: 'ana-worker-02', dials: [
        ['analytics-db.corp:1433', 149], ['backup.corp:445', 59],
      ] },
      { ip: '10.20.20.18', enrolledId: 'id-070', enrolledName: 'ana-ds-ivan', dials: [
        ['sso.corp:443', 73], ['analytics-api.corp:8443', 58], ['wiki.corp:443', 15],
      ] },
      { ip: '10.20.20.19', enrolledId: 'id-071', enrolledName: 'ana-ds-julia', dials: [
        ['sso.corp:443', 80], ['analytics-api.corp:8443', 65], ['wiki.corp:443', 22],
      ] },
      { ip: '10.20.20.20', enrolledId: 'id-072', enrolledName: 'ana-etl-01', dials: [
        ['analytics-db.corp:1433', 147], ['backup.corp:445', 57],
      ] },
    ],
  },

  // ── CRM application tiers (eu) ──
  {
    cidr: '10.40.10.0/24',
    sources: [
      { ip: '10.40.10.11', enrolledId: 'id-036', enrolledName: 'crm-web-01', dials: [
        ['crm-api.corp:8443', 180], ['sso.corp:443', 60],
      ] },
      { ip: '10.40.10.12', enrolledId: 'id-037', enrolledName: 'crm-web-02', dials: [
        ['crm-api.corp:8443', 187], ['sso.corp:443', 67],
      ] },
      { ip: '10.40.10.13', enrolledId: 'id-038', enrolledName: 'crm-web-03', dials: [
        ['crm-api.corp:8443', 194], ['sso.corp:443', 74],
      ] },
      { ip: '10.40.10.14', enrolledId: 'id-039', enrolledName: 'crm-api-01', dials: [
        ['crm-db.corp:1433', 261], ['sso.corp:443', 66], ['dns.corp:53', 171],
      ] },
      { ip: '10.40.10.15', enrolledId: 'id-040', enrolledName: 'crm-api-02', dials: [
        ['crm-db.corp:1433', 245], ['sso.corp:443', 50], ['dns.corp:53', 155],
      ] },
      { ip: '10.40.10.16', enrolledId: 'id-041', enrolledName: 'crm-db-01', dials: [
        ['backup.corp:445', 102], ['dns.corp:53', 132],
      ] },
      { ip: '10.40.10.17', enrolledId: 'id-042', enrolledName: 'crm-db-02', dials: [
        ['backup.corp:445', 109], ['dns.corp:53', 139],
      ] },
      { ip: '10.40.10.18', enrolledId: 'id-043', enrolledName: 'crm-worker-01', dials: [
        ['crm-db.corp:1433', 133], ['backup.corp:445', 43],
      ] },
      { ip: '10.40.10.19', enrolledId: 'id-044', enrolledName: 'crm-worker-02', dials: [
        ['crm-db.corp:1433', 140], ['backup.corp:445', 50],
      ] },
      { ip: '10.40.10.20', enrolledId: 'id-045', enrolledName: 'crm-sales-dana', dials: [
        ['sso.corp:443', 87], ['crm-api.corp:8443', 72], ['wiki.corp:443', 29],
      ] },
      { ip: '10.40.10.21', enrolledId: 'id-046', enrolledName: 'crm-sales-erik', dials: [
        ['sso.corp:443', 71], ['crm-api.corp:8443', 56], ['wiki.corp:443', 13],
      ] },
      { ip: '10.40.10.22', enrolledId: 'id-047', enrolledName: 'crm-sales-fiona', dials: [
        ['sso.corp:443', 78], ['crm-api.corp:8443', 63], ['wiki.corp:443', 20],
      ] },
      { ip: '10.40.10.23', enrolledId: 'id-048', enrolledName: 'crm-report-01', dials: [
        ['crm-db.corp:1433', 255], ['sso.corp:443', 60], ['dns.corp:53', 165],
      ] },
    ],
  },

  // ── Logistics / WMS application tiers (plant) ──
  {
    cidr: '10.70.5.0/24',
    sources: [
      { ip: '10.70.5.11', enrolledId: 'id-049', enrolledName: 'log-web-01', dials: [
        ['logistics-api.plant:8443', 180], ['sso.corp:443', 60],
      ] },
      { ip: '10.70.5.12', enrolledId: 'id-050', enrolledName: 'log-web-02', dials: [
        ['logistics-api.plant:8443', 187], ['sso.corp:443', 67],
      ] },
      { ip: '10.70.5.13', enrolledId: 'id-051', enrolledName: 'log-api-01', dials: [
        ['logistics-db.plant:5432', 254], ['sso.corp:443', 59], ['dns.corp:53', 164], ['mes.corp:8080', 62],
      ] },
      { ip: '10.70.5.14', enrolledId: 'id-052', enrolledName: 'log-api-02', dials: [
        ['logistics-db.plant:5432', 261], ['sso.corp:443', 66], ['dns.corp:53', 171], ['mes.corp:8080', 69],
      ] },
      { ip: '10.70.5.15', enrolledId: 'id-053', enrolledName: 'log-db-01', dials: [
        ['backup.corp:445', 95], ['dns.corp:53', 125],
      ] },
      { ip: '10.70.5.16', enrolledId: 'id-054', enrolledName: 'log-db-02', dials: [
        ['backup.corp:445', 102], ['dns.corp:53', 132],
      ] },
      { ip: '10.70.5.17', enrolledId: 'id-055', enrolledName: 'log-worker-01', dials: [
        ['logistics-db.plant:5432', 149], ['backup.corp:445', 59], ['mes.corp:8080', 67],
      ] },
      { ip: '10.70.5.18', enrolledId: 'id-056', enrolledName: 'log-worker-02', dials: [
        ['logistics-db.plant:5432', 133], ['backup.corp:445', 43], ['mes.corp:8080', 51],
      ] },
      { ip: '10.70.5.19', enrolledId: 'id-057', enrolledName: 'log-worker-03', dials: [
        ['logistics-db.plant:5432', 140], ['backup.corp:445', 50], ['mes.corp:8080', 58],
      ] },
      { ip: '10.70.5.20', enrolledId: 'id-058', enrolledName: 'log-scanner-01', dials: [
        ['sso.corp:443', 87], ['logistics-api.plant:8443', 72], ['wiki.corp:443', 29],
      ] },
      { ip: '10.70.5.21', enrolledId: 'id-059', enrolledName: 'log-scanner-02', dials: [
        ['sso.corp:443', 71], ['logistics-api.plant:8443', 56], ['wiki.corp:443', 13],
      ] },
      { ip: '10.70.5.22', enrolledId: 'id-060', enrolledName: 'log-floor-gita', dials: [
        ['sso.corp:443', 78], ['logistics-api.plant:8443', 63], ['wiki.corp:443', 20],
      ] },
      { ip: '10.70.5.23', enrolledId: 'id-061', enrolledName: 'log-floor-hana', dials: [
        ['sso.corp:443', 85], ['logistics-api.plant:8443', 70], ['wiki.corp:443', 27],
      ] },
      { ip: '10.70.5.24', enrolledId: 'id-062', enrolledName: 'log-hmi-01', dials: [
        ['logistics-api.plant:8443', 202], ['sso.corp:443', 82],
      ] },
    ],
  },

  // ── Shared infrastructure — no application of its own ──
  {
    cidr: '10.20.30.0/24',
    sources: [
      { ip: '10.20.30.11', enrolledId: 'id-073', enrolledName: 'infra-bastion-01', dials: [
        ['dns.corp:53', 200], ['ntp.corp:123', 110], ['bastion.corp:22', 30],
      ] },
      { ip: '10.20.30.12', enrolledId: 'id-074', enrolledName: 'infra-monitor-01', dials: [
        ['dns.corp:53', 207], ['ntp.corp:123', 117], ['api.corp:443', 42],
      ] },
      { ip: '10.20.30.13', enrolledId: 'id-075', enrolledName: 'edge-gw-plant-01', dials: [
        ['dns.corp:53', 214], ['ntp.corp:123', 124],
      ] },
      { ip: '10.20.30.14', enrolledId: 'id-076', enrolledName: 'edge-gw-eu-01', dials: [
        ['dns.corp:53', 221], ['ntp.corp:123', 131],
      ] },
    ],
  },
];

// ─── expand terse CIDR spec → full DiscoveredFlow records ──────────────────────
// Timestamps are a stable ~4-week window (no Date.now — deterministic mock).

const WINDOW_FIRST_SEEN = '2026-07-08T09:00:00Z';
const WINDOW_LAST_SEEN = '2026-08-05T17:00:00Z';

function buildFlows(blocks: CidrBlockSpec[], startAt = 0): DiscoveredFlow[] {
  const flows: DiscoveredFlow[] = [];
  let n = startAt;
  for (const block of blocks) {
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

/**
 * The DISCOVERY CAPTURE only — the six /24 blocks someone pointed discovery at,
 * where most sources resolve to no identity. Exported separately because it is a
 * FIXED, hand-authored scenario: an engineering cluster with drift, a low-volume
 * wiki tail, a vendor DMZ that clusters with nobody, and one cluster carrying
 * both enrolled and unenrolled members. discovery-engine.spec.ts pins against
 * this, so the engine's behaviour is tested on a controlled input rather than on
 * however much demo traffic the roster happens to carry.
 */
export const DISCOVERY_CAPTURE_FLOWS: DiscoveredFlow[] = buildFlows(CIDR_BLOCKS);

/**
 * EVERYTHING the network observed — the capture plus the managed estate's own
 * traffic. This is what the app renders: Raw traffic, the flow map, the
 * per-identity Traffic tab, and (deliberately) the discovery clustering, which
 * therefore sees already-tagged hosts alongside the unknown ones.
 *
 * Flow ids stay positional and stable: the capture keeps flow-001…flow-097 and
 * the estate continues from there, so an id never changes meaning when the
 * estate grows.
 */
export const DISCOVERED_FLOWS: DiscoveredFlow[] = [
  ...DISCOVERY_CAPTURE_FLOWS,
  ...buildFlows(MANAGED_BLOCKS, DISCOVERY_CAPTURE_FLOWS.length),
];
