/**
 * LARGE OT / MANUFACTURING fixture — a Purdue-model microsegmentation network at
 * scale, authored to stress-test BOTH authorization surfaces (matrix + graph) at
 * ~24 segments. It is a drop-in alternative to authorization.fixtures.ts: SAME
 * three exported shapes (suffixed `_OT` so both coexist), SAME segment prefixes
 * ('#discovered-group-' / '#discovered-svc-'), fed to the SAME resolver unchanged.
 *
 * ── PARTITION (the load-bearing contract; see authorization-resolver.ts:194-197) ──
 *   • Every identity carries EXACTLY ONE '#discovered-group-*' attribute — or zero
 *     (deliberately ungrouped → the '#ungrouped' catch-all row).
 *   • Every service carries EXACTLY ONE '#discovered-svc-*' attribute — or zero
 *     (one deliberately untagged service → the '#ungrouped' catch-all column).
 *   • An entity that spans two Purdue zones is modeled as SEPARATE segments, never
 *     as one entity with two group attrs. This is what makes the conservation
 *     invariant (Σ segmentEdge.authorizedCount === pairs.length) hold; violate it
 *     and the live header renders "DROPPED".
 *   Entities carry OTHER role tags freely (#mfa-verified, #vendor-approved,
 *   #unmanaged); the one-group / one-svc rule applies ONLY to the two prefixes.
 *
 * ── TOPOLOGY (3 plants: Sheffield / Cleveland / Grand Prairie) ──
 *   Identity segments (14 real + 1 ungrouped):
 *     L1 field   : <plant>-l1-field                    ×3   (Safety I/O, sensors)
 *     L2 control : sheffield split per line (line-a/line-b) + cleveland + grand-prairie ×4
 *     shared L3+ : l3-mes, l3-historian, remote-engineering, vendor-oem,
 *                  enterprise-it, dmz-brokers, security-monitoring               ×7
 *     ungrouped  : orphan/legacy/contractor (no #discovered-group-*)
 *   Service segments (9 real + 1 ungrouped):
 *     plant floor: sheffield line-a/line-b + cleveland + grand-prairie floors    ×4
 *     shared     : mes-svc, historian-svc, dmz-svc, it-svc, patch-svc            ×5
 *     ungrouped  : legacy-scada-hmi (untagged)
 *
 * ── AUTHORIZATION SHAPE (sparse + blocky, like real OT) ──
 *   • Strong intra-plant vertical conduits (L1↔floor, L2↔floor within a plant).
 *   • L2 → L3 (MES / historian) allowed; L1 → L3 is NOT (Purdue skip-level = none).
 *   • Shared L3 columns fan IN from every plant's L2 → dense shared columns.
 *   • Enterprise-IT ↔ OT only via the DMZ pinch: enterprise reaches dmz-svc/it-svc/
 *     patch-svc but NOT the floors (a BIND policy that MUST be ignored is the only
 *     enterprise→floor link — it must stay 'none'); dmz-brokers reach MES only.
 *   • remote-engineering (AllOf + #mfa-verified) reaches a narrow, audited set of
 *     floors — eng-ws-3 lacks MFA → failed-allof partials.
 *   • vendor-oem (AllOf + #vendor-approved) reaches ONLY the Grand Prairie floor —
 *     vendor-fanuc-1 is unapproved → failed-allof partial.
 *   • security-monitoring dials '#all' — the legitimate wildcard (full SOC row,
 *     the only edge that touches the ungrouped service column).
 *   • Everything else (cross-plant, skip-level) has NO policy → 'none' cells: the
 *     matrix is mostly none with dense plant diagonals + shared columns.
 */

import type { EntityStatus, Identity, Policy, Service } from '../../shared/services/mock-data.service';

const T = '2026-06-01T00:00:00Z';

// Shared status literals — also the one deliberate use of the imported EntityStatus.
const ONLINE: EntityStatus = 'online';
const OFFLINE: EntityStatus = 'offline';
const ACTIVE: EntityStatus = 'active';

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITIES — each carries exactly one #discovered-group-* (or none = ungrouped)
// ─────────────────────────────────────────────────────────────────────────────

export const FIXTURE_IDENTITIES_OT: Identity[] = [
  // ── L1 field (Safety I/O + sensors) — one segment per plant ──
  { id: 'ot-shf-io-safety-1', name: 'shf-io-safety-1', createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-sheffield-l1-field'] },
  { id: 'ot-shf-io-sensor-1', name: 'shf-io-sensor-1', createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-sheffield-l1-field'] },
  { id: 'ot-cle-io-safety-1', name: 'cle-io-safety-1', createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-cleveland-l1-field'] },
  { id: 'ot-cle-io-sensor-1', name: 'cle-io-sensor-1', createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-cleveland-l1-field'] },
  { id: 'ot-gp-io-safety-1',  name: 'gp-io-safety-1',  createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-grand-prairie-l1-field'] },
  { id: 'ot-gp-io-sensor-1',  name: 'gp-io-sensor-1',  createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-grand-prairie-l1-field'] },

  // ── L2 control (PLCs / cell controllers). Sheffield is split per production line. ──
  { id: 'ot-shf-plc-a-1', name: 'shf-plc-line-a-1', createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-sheffield-l2-line-a'] },
  { id: 'ot-shf-plc-a-2', name: 'shf-plc-line-a-2', createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-sheffield-l2-line-a'] },
  { id: 'ot-shf-plc-b-1', name: 'shf-plc-line-b-1', createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-sheffield-l2-line-b'] },
  { id: 'ot-shf-plc-b-2', name: 'shf-plc-line-b-2', createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-sheffield-l2-line-b'] },
  { id: 'ot-cle-plc-1',   name: 'cle-plc-1',        createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-cleveland-l2-control'] },
  { id: 'ot-cle-cell-1',  name: 'cle-cellctrl-1',   createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-cleveland-l2-control'] },
  { id: 'ot-gp-plc-1',    name: 'gp-plc-1',         createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-grand-prairie-l2-control'] },
  { id: 'ot-gp-cell-1',   name: 'gp-cellctrl-1',    createdAt: T, status: ONLINE, type: 'device', attributes: ['#discovered-group-grand-prairie-l2-control'] },

  // ── L3 MES clients (5) — reach mes-svc via AnyOf (full), but the historian conduit
  //    is AllOf-gated on #cert-current. HETEROGENEOUS: 3 current (client-1/2/3), 2 not
  //    (client-4/5) → l3-mes → historian-svc resolves 'partial' (6/10). ──
  { id: 'ot-mes-client-1', name: 'mes-client-1', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-l3-mes', '#cert-current'] },
  { id: 'ot-mes-client-2', name: 'mes-client-2', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-l3-mes', '#cert-current'] },
  { id: 'ot-mes-client-3', name: 'mes-client-3', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-l3-mes', '#cert-current'] },
  { id: 'ot-mes-client-4', name: 'mes-client-4', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-l3-mes'] },
  { id: 'ot-mes-client-5', name: 'mes-client-5', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-l3-mes'] },

  // ── L3 historian clients ──
  { id: 'ot-hist-client-1', name: 'historian-client-1', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-l3-historian'] },
  { id: 'ot-hist-client-2', name: 'historian-client-2', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-l3-historian'] },

  // ── Remote engineering (6) — AllOf conduits gate on #mfa-verified.
  //    HETEROGENEOUS: 4 carry #mfa-verified (eng-ws-1/2/4/5), 2 do NOT (eng-ws-3/6),
  //    so every remote-engineering → floor conduit resolves 'partial' (12/18). ──
  { id: 'ot-eng-ws-1', name: 'eng-ws-1', createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-remote-engineering', '#mfa-verified'] },
  { id: 'ot-eng-ws-2', name: 'eng-ws-2', createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-remote-engineering', '#mfa-verified'] },
  { id: 'ot-eng-ws-3', name: 'eng-ws-3', createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-remote-engineering'] },
  { id: 'ot-eng-ws-4', name: 'eng-ws-4', createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-remote-engineering', '#mfa-verified'] },
  { id: 'ot-eng-ws-5', name: 'eng-ws-5', createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-remote-engineering', '#mfa-verified'] },
  { id: 'ot-eng-ws-6', name: 'eng-ws-6', createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-remote-engineering'] },

  // ── Vendor OEM (5) — AllOf conduits gate on #vendor-approved.
  //    HETEROGENEOUS: 3 approved (siemens/rockwell/abb), 2 not (fanuc/kuka) → partial. ──
  { id: 'ot-vendor-siemens-1',  name: 'vendor-siemens-1',  createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-vendor-oem', '#vendor-approved'] },
  { id: 'ot-vendor-fanuc-1',    name: 'vendor-fanuc-1',    createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-vendor-oem'] },
  { id: 'ot-vendor-rockwell-1', name: 'vendor-rockwell-1', createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-vendor-oem', '#vendor-approved'] },
  { id: 'ot-vendor-abb-1',      name: 'vendor-abb-1',      createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-vendor-oem', '#vendor-approved'] },
  { id: 'ot-vendor-kuka-1',     name: 'vendor-kuka-1',     createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-vendor-oem'] },

  // ── Enterprise IT (6) — the dmz-svc conduit is AllOf-gated on #privileged-access.
  //    HETEROGENEOUS: 3 privileged (admin-1/2/3), 3 not (helpdesk-1/2, svc-acct-1) →
  //    enterprise-it → dmz-svc resolves 'partial' (6/12); it-svc/patch-svc stay full. ──
  { id: 'ot-it-admin-1',    name: 'it-admin-1',    createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-enterprise-it', '#privileged-access'] },
  { id: 'ot-it-admin-2',    name: 'it-admin-2',    createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-enterprise-it', '#privileged-access'] },
  { id: 'ot-it-admin-3',    name: 'it-admin-3',    createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-enterprise-it', '#privileged-access'] },
  { id: 'ot-it-helpdesk-1', name: 'it-helpdesk-1', createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-enterprise-it'] },
  { id: 'ot-it-helpdesk-2', name: 'it-helpdesk-2', createdAt: T, status: ONLINE, type: 'user', attributes: ['#discovered-group-enterprise-it'] },
  { id: 'ot-it-svcacct-1',  name: 'it-svc-acct-1', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-enterprise-it'] },

  // ── DMZ relay/broker identities (5) — IT↔OT pinch. The MES conduit is AllOf-gated
  //    on #relay-attested. HETEROGENEOUS: 3 attested (relay-1/2/3), 2 not (relay-4/5)
  //    → dmz-brokers → mes-svc resolves 'partial' (6/10). ──
  { id: 'ot-dmz-relay-1', name: 'dmz-relay-1', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-dmz-brokers', '#relay-attested'] },
  { id: 'ot-dmz-relay-2', name: 'dmz-relay-2', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-dmz-brokers', '#relay-attested'] },
  { id: 'ot-dmz-relay-3', name: 'dmz-relay-3', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-dmz-brokers', '#relay-attested'] },
  { id: 'ot-dmz-relay-4', name: 'dmz-relay-4', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-dmz-brokers'] },
  { id: 'ot-dmz-relay-5', name: 'dmz-relay-5', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-dmz-brokers'] },

  // ── Security monitoring / SOC — the legitimate '#all' wildcard segment ──
  { id: 'ot-soc-collector-1', name: 'soc-collector-1', createdAt: T, status: ONLINE, type: 'service', attributes: ['#discovered-group-security-monitoring'] },

  // ── Deliberately UNGROUPED (no #discovered-group-*) → the '#ungrouped' catch-all
  //    row. No policy matches them (no '#all' on the identity side) → the whole row
  //    is 'none' and the segment resolves 'unresolvable' — realistic unmanaged gear. ──
  { id: 'ot-orphan-hmi',    name: 'orphan-hmi-unmanaged', createdAt: T, status: OFFLINE, type: 'device', attributes: [] },
  { id: 'ot-legacy-jump',   name: 'legacy-jumpbox',       createdAt: T, status: OFFLINE, type: 'device', attributes: [] },
  { id: 'ot-contractor-lt', name: 'contractor-laptop',    createdAt: T, status: ONLINE,  type: 'user',   attributes: ['#unmanaged'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// SERVICES — each carries exactly one #discovered-svc-* (or none = ungrouped)
// OT protocols: PROFINET tcp/34964, OPC-UA tcp/4840, Siemens S7 tcp/102.
// ─────────────────────────────────────────────────────────────────────────────

export const FIXTURE_SERVICES_OT: Service[] = [
  // ── Sheffield floor — line A (PROFINET / OPC-UA / S7) ──
  { id: 'ot-svc-shf-a-safety', name: 'shf-a-safety-io',   createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'profinet.shf-line-a-gw.plant.local:34964', hostAddress: '10.10.11.10:34964', attributes: ['#discovered-svc-sheffield-floor-line-a'] },
  { id: 'ot-svc-shf-a-plc',    name: 'shf-a-line-plc',    createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'opcua.shf-line-a-gw.plant.local:4840',     hostAddress: '10.10.11.20:4840',  attributes: ['#discovered-svc-sheffield-floor-line-a'] },
  { id: 'ot-svc-shf-a-stamp',  name: 'shf-a-stamp-cell',  createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 's7.shf-line-a-gw.plant.local:102',         hostAddress: '10.10.11.30:102',   attributes: ['#discovered-svc-sheffield-floor-line-a'] },

  // ── Sheffield floor — line B ──
  { id: 'ot-svc-shf-b-safety', name: 'shf-b-safety-io',   createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'profinet.shf-line-b-gw.plant.local:34964', hostAddress: '10.10.12.10:34964', attributes: ['#discovered-svc-sheffield-floor-line-b'] },
  { id: 'ot-svc-shf-b-plc',    name: 'shf-b-line-plc',    createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'opcua.shf-line-b-gw.plant.local:4840',     hostAddress: '10.10.12.20:4840',  attributes: ['#discovered-svc-sheffield-floor-line-b'] },
  { id: 'ot-svc-shf-b-stamp',  name: 'shf-b-stamp-cell',  createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 's7.shf-line-b-gw.plant.local:102',         hostAddress: '10.10.12.30:102',   attributes: ['#discovered-svc-sheffield-floor-line-b'] },

  // ── Cleveland floor ──
  { id: 'ot-svc-cle-safety', name: 'cle-safety-io',   createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'profinet.cle-gw.plant.local:34964', hostAddress: '10.20.11.10:34964', attributes: ['#discovered-svc-cleveland-floor-svc'] },
  { id: 'ot-svc-cle-plc',    name: 'cle-line-plc',    createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'opcua.cle-gw.plant.local:4840',     hostAddress: '10.20.11.20:4840',  attributes: ['#discovered-svc-cleveland-floor-svc'] },
  { id: 'ot-svc-cle-stamp',  name: 'cle-stamp-cell',  createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 's7.cle-gw.plant.local:102',         hostAddress: '10.20.11.30:102',   attributes: ['#discovered-svc-cleveland-floor-svc'] },

  // ── Grand Prairie floor ──
  { id: 'ot-svc-gp-safety', name: 'gp-safety-io',   createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'profinet.gp-gw.plant.local:34964', hostAddress: '10.30.11.10:34964', attributes: ['#discovered-svc-grand-prairie-floor-svc'] },
  { id: 'ot-svc-gp-plc',    name: 'gp-line-plc',    createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'opcua.gp-gw.plant.local:4840',     hostAddress: '10.30.11.20:4840',  attributes: ['#discovered-svc-grand-prairie-floor-svc'] },
  { id: 'ot-svc-gp-stamp',  name: 'gp-stamp-cell',  createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 's7.gp-gw.plant.local:102',         hostAddress: '10.30.11.30:102',   attributes: ['#discovered-svc-grand-prairie-floor-svc'] },

  // ── Shared L3: MES ──
  { id: 'ot-svc-mes-web', name: 'mes-web', createdAt: T, status: ONLINE, protocol: 'https', interceptAddress: 'mes.corp.local:443',     hostAddress: '10.5.20.10:8443', attributes: ['#discovered-svc-mes-svc'] },
  { id: 'ot-svc-mes-api', name: 'mes-api', createdAt: T, status: ONLINE, protocol: 'https', interceptAddress: 'mes-api.corp.local:8443', hostAddress: '10.5.20.11:8443', attributes: ['#discovered-svc-mes-svc'] },

  // ── Shared L3: historian ──
  { id: 'ot-svc-hist-db',  name: 'historian-db',  createdAt: T, status: ONLINE, protocol: 'tcp',   interceptAddress: 'historian.corp.local:1433',     hostAddress: '10.5.21.10:1433', attributes: ['#discovered-svc-historian-svc'] },
  { id: 'ot-svc-hist-web', name: 'historian-web', createdAt: T, status: ONLINE, protocol: 'https', interceptAddress: 'historian-web.corp.local:443', hostAddress: '10.5.21.11:8443', attributes: ['#discovered-svc-historian-svc'] },

  // ── Shared DMZ (IT/OT relay tier) ──
  { id: 'ot-svc-dmz-broker', name: 'dmz-mqtt-broker',   createdAt: T, status: ONLINE, protocol: 'tcp',   interceptAddress: 'broker.dmz.local:8883', hostAddress: '172.16.5.10:8883', attributes: ['#discovered-svc-dmz-svc'] },
  { id: 'ot-svc-dmz-proxy',  name: 'dmz-reverse-proxy', createdAt: T, status: ONLINE, protocol: 'https', interceptAddress: 'proxy.dmz.local:443',   hostAddress: '172.16.5.11:8443', attributes: ['#discovered-svc-dmz-svc'] },

  // ── Shared enterprise IT ──
  { id: 'ot-svc-ad-dc',      name: 'ad-domain-controller', createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'ad.corp.local:389',    hostAddress: '10.5.1.10:389', attributes: ['#discovered-svc-it-svc'] },
  { id: 'ot-svc-file-share', name: 'corp-file-share',      createdAt: T, status: ONLINE, protocol: 'tcp', interceptAddress: 'files.corp.local:445', hostAddress: '10.5.1.20:445', attributes: ['#discovered-svc-it-svc'] },

  // ── Shared patch server (WSUS) ──
  { id: 'ot-svc-wsus', name: 'wsus-patch', createdAt: T, status: ONLINE, protocol: 'http', interceptAddress: 'wsus.corp.local:8530', hostAddress: '10.5.1.30:8530', attributes: ['#discovered-svc-patch-svc'] },

  // ── Deliberately UNTAGGED (no #discovered-svc-*) → the '#ungrouped' service
  //    column. Only the security-monitoring '#all' policy reaches it. ──
  { id: 'ot-svc-legacy-hmi', name: 'legacy-scada-hmi', createdAt: T, status: OFFLINE, protocol: 'tcp', interceptAddress: 'hmi.legacy.local:5900', hostAddress: '10.99.9.9:5900', attributes: [] },
];

// ─────────────────────────────────────────────────────────────────────────────
// POLICIES — sparse + blocky. dial unless noted; one BIND that MUST be ignored.
// AllOf policies keep a SINGLE serviceRole (the resolver applies `semantic` to the
// service side too, and each service carries exactly one #discovered-svc-*, so a
// multi-role AllOf serviceRole list would match no service).
// ─────────────────────────────────────────────────────────────────────────────

export const FIXTURE_POLICIES_OT: Policy[] = [
  // ── Intra-plant vertical conduits (L1↔floor, L2↔floor) ──
  // Sheffield L1 field reaches BOTH line floors (shared safety/sensor bus).
  {
    id: 'ot-pol-shf-l1-floor', name: 'dial-sheffield-l1-floor', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-sheffield-l1-field'],
    serviceRoles: ['#discovered-svc-sheffield-floor-line-a', '#discovered-svc-sheffield-floor-line-b'],
    postureCheckRoles: [],
  },
  // Sheffield L2 line-a → line-a floor only (per-line isolation).
  {
    id: 'ot-pol-shf-l2a-floor', name: 'dial-sheffield-l2-line-a-floor', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-sheffield-l2-line-a'],
    serviceRoles: ['#discovered-svc-sheffield-floor-line-a'],
    postureCheckRoles: [],
  },
  // Sheffield L2 line-b → line-b floor only.
  {
    id: 'ot-pol-shf-l2b-floor', name: 'dial-sheffield-l2-line-b-floor', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-sheffield-l2-line-b'],
    serviceRoles: ['#discovered-svc-sheffield-floor-line-b'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-cle-l1-floor', name: 'dial-cleveland-l1-floor', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-cleveland-l1-field'],
    serviceRoles: ['#discovered-svc-cleveland-floor-svc'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-cle-l2-floor', name: 'dial-cleveland-l2-floor', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-cleveland-l2-control'],
    serviceRoles: ['#discovered-svc-cleveland-floor-svc'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-gp-l1-floor', name: 'dial-grand-prairie-l1-floor', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-grand-prairie-l1-field'],
    serviceRoles: ['#discovered-svc-grand-prairie-floor-svc'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-gp-l2-floor', name: 'dial-grand-prairie-l2-floor', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-grand-prairie-l2-control'],
    serviceRoles: ['#discovered-svc-grand-prairie-floor-svc'],
    postureCheckRoles: [],
  },

  // ── L2 → L3 fan-IN (every plant's L2 reaches shared MES + historian).
  //    AnyOf across all four L2 groups → dense shared columns. ──
  {
    id: 'ot-pol-l2-mes', name: 'dial-l2-to-mes', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: [
      '#discovered-group-sheffield-l2-line-a',
      '#discovered-group-sheffield-l2-line-b',
      '#discovered-group-cleveland-l2-control',
      '#discovered-group-grand-prairie-l2-control',
    ],
    serviceRoles: ['#discovered-svc-mes-svc'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-l2-historian', name: 'dial-l2-to-historian', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: [
      '#discovered-group-sheffield-l2-line-a',
      '#discovered-group-sheffield-l2-line-b',
      '#discovered-group-cleveland-l2-control',
      '#discovered-group-grand-prairie-l2-control',
    ],
    serviceRoles: ['#discovered-svc-historian-svc'],
    postureCheckRoles: [],
  },

  // ── L3 client segments reach their own shared services ──
  {
    id: 'ot-pol-mes-clients', name: 'dial-mes-clients', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-l3-mes'],
    serviceRoles: ['#discovered-svc-mes-svc'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-hist-clients', name: 'dial-historian-clients', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-l3-historian'],
    serviceRoles: ['#discovered-svc-historian-svc'],
    postureCheckRoles: [],
  },
  // MES clients ALSO pull from the historian, but only with a current cert (AllOf +
  // #cert-current) → l3-mes → historian-svc is 'partial' (client-4/5 lack the cert).
  {
    id: 'ot-pol-mes-historian', name: 'dial-mes-to-historian-cert', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-l3-mes', '#cert-current'],
    serviceRoles: ['#discovered-svc-historian-svc'],
    postureCheckRoles: [],
  },

  // ── Enterprise IT: DMZ pinch. Reaches dmz-svc / it-svc / patch-svc — NOT floors.
  //    The dmz-svc conduit is AllOf-gated on #privileged-access (only privileged IT
  //    may cross into the DMZ) → enterprise-it → dmz-svc is 'partial'. it-svc and
  //    patch-svc stay AnyOf (full). ──
  {
    id: 'ot-pol-it-dmz', name: 'dial-enterprise-dmz-privileged', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-enterprise-it', '#privileged-access'],
    serviceRoles: ['#discovered-svc-dmz-svc'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-it-it', name: 'dial-enterprise-it-svc', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-enterprise-it'],
    serviceRoles: ['#discovered-svc-it-svc'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-it-patch', name: 'dial-enterprise-patch', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-enterprise-it'],
    serviceRoles: ['#discovered-svc-patch-svc'],
    postureCheckRoles: [],
  },

  // ── DMZ brokers reach ONLY MES in OT (tight relay conduit), and only when the
  //    relay is attested (AllOf + #relay-attested) → dmz-brokers → mes-svc is
  //    'partial' (relay-4/5 are not attested). ──
  {
    id: 'ot-pol-dmz-mes', name: 'dial-dmz-to-mes-attested', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-dmz-brokers', '#relay-attested'],
    serviceRoles: ['#discovered-svc-mes-svc'],
    postureCheckRoles: [],
  },

  // ── Remote engineering (AllOf + #mfa-verified) → narrow audited floors.
  //    eng-ws-3 lacks #mfa-verified → failed-allof (missingRoles: ['#mfa-verified']). ──
  {
    id: 'ot-pol-eng-shf-a', name: 'dial-remote-eng-sheffield-line-a-mfa', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-remote-engineering', '#mfa-verified'],
    serviceRoles: ['#discovered-svc-sheffield-floor-line-a'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-eng-cle', name: 'dial-remote-eng-cleveland-mfa', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-remote-engineering', '#mfa-verified'],
    serviceRoles: ['#discovered-svc-cleveland-floor-svc'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-eng-shf-b', name: 'dial-remote-eng-sheffield-line-b-mfa', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-remote-engineering', '#mfa-verified'],
    serviceRoles: ['#discovered-svc-sheffield-floor-line-b'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-eng-gp', name: 'dial-remote-eng-grand-prairie-mfa', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-remote-engineering', '#mfa-verified'],
    serviceRoles: ['#discovered-svc-grand-prairie-floor-svc'],
    postureCheckRoles: [],
  },

  // ── Vendor OEM (AllOf + #vendor-approved) → ONLY Grand Prairie floor.
  //    vendor-fanuc-1 is unapproved → failed-allof (missingRoles: ['#vendor-approved']). ──
  {
    id: 'ot-pol-vendor-gp', name: 'dial-vendor-grand-prairie-approved', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-vendor-oem', '#vendor-approved'],
    serviceRoles: ['#discovered-svc-grand-prairie-floor-svc'],
    postureCheckRoles: [],
  },
  {
    id: 'ot-pol-vendor-shf-b', name: 'dial-vendor-sheffield-line-b-approved', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-vendor-oem', '#vendor-approved'],
    serviceRoles: ['#discovered-svc-sheffield-floor-line-b'],
    postureCheckRoles: [],
  },

  // ── Security monitoring / SOC — the legitimate '#all' wildcard (full row, the
  //    only edge that reaches the ungrouped service column). ──
  {
    id: 'ot-pol-soc-all', name: 'dial-soc-monitor-all', createdAt: T, status: ACTIVE,
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-security-monitoring'],
    serviceRoles: ['#all'],
    postureCheckRoles: [],
  },

  // ── BIND policy — MUST be ignored by the dial resolver. It links enterprise-it →
  //    the Sheffield line-a floor; if binds leaked in, that pinch would open. It
  //    must stay 'none'. ──
  {
    id: 'ot-pol-it-floor-bind', name: 'bind-enterprise-sheffield-floor', createdAt: T, status: ACTIVE,
    type: 'bind', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-enterprise-it'],
    serviceRoles: ['#discovered-svc-sheffield-floor-line-a'],
    postureCheckRoles: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH PLACEMENT (optional layout hint — NOT authorization data)
//
// A caller-supplied map from RAW segment string → { band, lane } that the graph
// layout consumes to arrange nodes in horizontal bands (top→bottom) with lanes
// (left→right) within each band. It is purely presentational: the resolver never
// reads it, and a fixture that omits it (e.g. the small fixture) falls back to the
// bipartite two-column layout. Domain-neutral by design — `band`/`lane` are plain
// coordinates; the Purdue meaning below is documentation, not code.
//
//   band 1  Enterprise      band 2  DMZ        band 3  Operations (L3)
//   band 4  Supervisory (L2)                   band 5  Field (L1)
//   'aside'  out-of-grid actors (SOC / remote / vendor / ungrouped catch-alls)
//
// LANES encode plant columns: Sheffield=0, Cleveland=1, Grand Prairie=2 across
// bands 4 and 5, so each plant reads as one vertical column. Same-plant segments
// deliberately share a lane and stack within it (Sheffield's two L2 lines / two
// floor lines). Keys are the raw '#discovered-group-*' / '#discovered-svc-*'
// strings (matching SegmentNode.segment); the shared '#ungrouped' key covers both
// the identity and service catch-all nodes.
// ─────────────────────────────────────────────────────────────────────────────

/** A graph-layout placement hint: which band (row) and lane (column) a segment sits in. */
export interface SegmentPlacement {
  /** Horizontal band, numbered top→bottom (lower = higher up). 'aside' = out-of-grid zone. */
  band: number | 'aside';
  /** Lane (column) within the band, left→right. Segments may share a lane and stack. */
  lane: number;
}

export const FIXTURE_GROUPING_OT: Record<string, SegmentPlacement> = {
  // ── band 1 · Enterprise ──
  '#discovered-group-enterprise-it': { band: 1, lane: 0 },
  '#discovered-svc-it-svc': { band: 1, lane: 0 },
  '#discovered-svc-patch-svc': { band: 1, lane: 1 },

  // ── band 2 · DMZ ──
  '#discovered-group-dmz-brokers': { band: 2, lane: 0 },
  '#discovered-svc-dmz-svc': { band: 2, lane: 0 },

  // ── band 3 · Operations (L3) ──
  '#discovered-group-l3-mes': { band: 3, lane: 0 },
  '#discovered-group-l3-historian': { band: 3, lane: 1 },
  '#discovered-svc-mes-svc': { band: 3, lane: 0 },
  '#discovered-svc-historian-svc': { band: 3, lane: 1 },

  // ── band 4 · Supervisory (L2) — plant lanes; Sheffield's two lines share lane 0 ──
  '#discovered-group-sheffield-l2-line-a': { band: 4, lane: 0 },
  '#discovered-group-sheffield-l2-line-b': { band: 4, lane: 0 },
  '#discovered-group-cleveland-l2-control': { band: 4, lane: 1 },
  '#discovered-group-grand-prairie-l2-control': { band: 4, lane: 2 },

  // ── band 5 · Field (L1) — plant lanes aligned with band 4; floors share the lane ──
  '#discovered-group-sheffield-l1-field': { band: 5, lane: 0 },
  '#discovered-group-cleveland-l1-field': { band: 5, lane: 1 },
  '#discovered-group-grand-prairie-l1-field': { band: 5, lane: 2 },
  '#discovered-svc-sheffield-floor-line-a': { band: 5, lane: 0 },
  '#discovered-svc-sheffield-floor-line-b': { band: 5, lane: 0 },
  '#discovered-svc-cleveland-floor-svc': { band: 5, lane: 1 },
  '#discovered-svc-grand-prairie-floor-svc': { band: 5, lane: 2 },

  // ── aside · out-of-grid actors, stacked in supplied lane order ──
  '#discovered-group-security-monitoring': { band: 'aside', lane: 0 },
  '#discovered-group-remote-engineering': { band: 'aside', lane: 1 },
  '#discovered-group-vendor-oem': { band: 'aside', lane: 2 },
  '#ungrouped': { band: 'aside', lane: 3 },
};
