import { Injectable, signal } from '@angular/core';
import { DISCOVERY_IDENTITIES } from '../../features/discovery/discovered-flows.mock';
import type { Alert, Mute, Timeline } from '../../features/alerts/alerts.models';

export type EntityStatus = 'online' | 'offline' | 'pending' | 'degraded' | 'inactive' | 'active';

/**
 * ⚠️ INFERRED / POC — health/online-status for the Insights "Unhealthy
 * Entities" panel. There is NO real health/online-status query in the project:
 * this is Tier-2, permission-walled data we have never fetched live, so it is
 * mocked here. Shape is a REASONABLE GUESS — VERIFY (and likely replace this
 * signal with a real service call) once live access lands.
 *
 * Only 'router' and 'identity' entities appear — services don't go offline the
 * same way. `status` is narrowed to the health-relevant subset; 'online' rows
 * are healthy and get filtered out by the panel. `lastSeen` is an ISO string.
 */
export interface EntityHealthRecord {
  entityName: string;
  entityType: 'router' | 'identity';
  status: 'online' | 'offline' | 'degraded';
  lastSeen: string;
}

export interface Identity {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  type: 'device' | 'user' | 'router' | 'service';
  attributes: string[];
  authPolicy?: string;
  externalId?: string;
  isAdmin?: boolean;
  enrollmentType?: 'ott' | 'ottca' | 'updb';
  hostingCost?: number;
  hostingPrecedence?: string;
  tags?: Record<string, string>;
  appData?: string;
  /**
   * POC MOCK — total data transferred (GB), drives the dashboard usage pie.
   * Optional: freshly-created entities have no usage yet (treated as 0).
   */
  totalUsage?: number;
}

/**
 * A console/org USER — the human who signs into the console (has a display name
 * AND an email). Distinct from a Ziti edge `Identity` (a device/service handle):
 * the alerting API returns only a UUID for who claimed an alert / created a
 * mute, and the console resolves that UUID against THIS collection, not
 * identities(). Kept minimal for the POC (id/name/email).
 */
export interface ConsoleUser {
  id: string;
  name: string;
  email: string;
}

export interface Service {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  protocol: 'tcp' | 'udp' | 'http' | 'https';
  interceptAddress: string;
  hostAddress: string;
  attributes?: string[];
  encryptionRequired?: boolean;
  terminatorStrategy?: string;
  tags?: Record<string, string>;
  /**
   * POC MOCK — total data transferred (GB), drives the dashboard usage pie.
   * Optional: freshly-created entities have no usage yet (treated as 0).
   */
  totalUsage?: number;
}

export interface Policy {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  type: 'dial' | 'bind';
  semantic: 'AnyOf' | 'AllOf';
  identityRoles: string[];
  serviceRoles: string[];
  postureCheckRoles: string[];
}

export type PostureCheckType = 'OS' | 'MFA' | 'Process' | 'Domain' | 'MAC' | 'WindowsDomain';

export interface PostureCheck {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  type: PostureCheckType;
  attributes: string[];
}

export interface Router {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  os: 'linux' | 'windows' | 'macos' | null;
  attributes: string[];
  verified: boolean;
  isOnline: boolean;
  hostname: string;
  version: string;
  advertiseAddress: string;
  provisioningStatus: 'PROVISIONED' | 'PROVISIONING' | 'ERROR';
  wssEnabled: boolean;
  cloudProvider: string | null;
  location: string;
  hostSize?: string;
  ipAddress?: string;
  domainName?: string;
  altDomain?: string;
  /**
   * POC MOCK — total data transferred (GB), drives the dashboard usage pie.
   * Optional: freshly-created entities have no usage yet (treated as 0).
   */
  totalUsage?: number;
}

export interface TransitRouter {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  isOnline: boolean;
  hostname: string;
  version: string;
  verified: boolean;
  token: string | null;
  jwt: string | null;
}

export interface RouterPolicy {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  routerRoles: string[];
  identityRoles: string[];
}

export interface Session {
  id: string;
  serviceId: string;
  serviceName: string;
  identityId: string;
  identityName: string;
  apiSessionId: string;
  type: 'Bind' | 'Dial';
  isSystem: boolean;
  edgeRouters: Array<{ id: string; name: string }>;
  servicePolicies: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiSession {
  id: string;
  token: string;
  identityId: string;
  identityName: string;
  createdAt: string;
  expiresAt: string;
}

export interface NetworkEvent {
  id: string;
  timestamp: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'success';
}

/**
 * Current billing-cycle usage for the dashboard "Billing Usage" panel — a single
 * cycle snapshot (NOT a historical month series). Units are MB. `daysRemaining`,
 * `elapsedDays`, and `cycleDays` are stored as-of `asOfLabel` rather than derived
 * from the wall clock, so the panel renders deterministically. The projected
 * total and fill % are DERIVED in the component (flat run-rate), not stored here.
 */
export interface BillingCycle {
  /** Cycle start label, e.g. 'Jul 1'. */
  cycleStart: string;
  /** Cycle end label, e.g. 'Aug 1'. */
  cycleEnd: string;
  /** Days left in the cycle as of `asOfLabel` (stored, not computed from today). */
  daysRemaining: number;
  /** Usage so far this cycle, in MB. */
  currentMb: number;
  /** "As of" caption, e.g. 'Jul 20, 1:00 PM'. */
  asOfLabel: string;
  /** Total days in the cycle. */
  cycleDays: number;
  /** Days elapsed as of `asOfLabel`. */
  elapsedDays: number;
}

/**
 * Network throughput for the dashboard "Network Utilization" panel — a single
 * window of hourly Tx/Rx samples for a Tx/Rx area chart. UNIT: KILOBYTES (KB)
 * per hourly sample, for BOTH `tx` and `rx`. 168 samples = 7 days hourly,
 * ordered oldest → newest (newest sample corresponds to `endTime`). The panel
 * tail-slices this to the selected range (6h/24h/7d) and rescales its Y axis to
 * the window peak. Tx >= Rx holds at every sample by construction.
 */
export interface NetworkUtilization {
  /** ISO timestamp of the most recent (last) sample. No zone suffix — treated
   *  as the environment's local time when formatting axis ticks. */
  endTime: string;
  /** Hourly transmit samples in KB, oldest → newest. Length 168. */
  tx: number[];
  /** Hourly receive samples in KB, oldest → newest. Length 168. Rx <= Tx. */
  rx: number[];
}

/**
 * Deterministically build 168 hourly Tx/Rx samples (KB) with realistic
 * character: long near-idle stretches punctuated by several active plateaus and
 * bursts, peaks kept under ~1000 KB, and Tx >= Rx at every point. Uses a seeded
 * LCG (NOT Math.random) so the series is identical on every load — evaluated
 * once at field init, never at signal-read time.
 */
function buildNetworkUtilizationSeries(): { tx: number[]; rx: number[] } {
  let seed = 0x1a2b3c4d;
  // LCG (Numerical Recipes constants) → deterministic pseudo-random in [0,1).
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  // Active windows over the 168-hour span: [startHour, endHour, peakKB].
  // Everything outside these sits at the near-idle baseline.
  const windows: Array<[number, number, number]> = [
    [22, 46, 520],   // day 1 — sustained working-hours plateau
    [70, 82, 880],   // day 3 — sharp burst
    [96, 120, 400],  // day 4–5 — steady moderate activity
    [140, 150, 760], // day 6 — second burst
  ];

  const tx: number[] = [];
  const rx: number[] = [];
  for (let i = 0; i < 168; i++) {
    // Idle baseline 6–14 KB with light jitter.
    let level = 6 + rand() * 8;
    for (const [start, end, peak] of windows) {
      if (i >= start && i <= end) {
        const mid = (start + end) / 2;
        const span = (end - start) / 2 || 1;
        const shape = 1 - Math.abs(i - mid) / span; // triangular ramp 0→1→0
        const active = peak * (0.5 + 0.5 * shape) - rand() * peak * 0.1;
        level = Math.max(level, active);
      }
    }
    const txv = Math.round(level);
    // Rx is 45–65% of Tx; clamp to Tx so Tx >= Rx can never be violated.
    const rxv = Math.min(txv, Math.round(level * (0.45 + rand() * 0.2)));
    tx.push(txv);
    rx.push(rxv);
  }
  return { tx, rx };
}

/**
 * Active-endpoint count for the dashboard "Active Identities" panel — a single
 * static 7-day view (no range toggle) of hourly counts for a bar chart. 168
 * integer samples, oldest → newest, newest sample corresponds to `endTime`.
 */
export interface ActiveIdentities {
  /** ISO timestamp of the most recent (last) sample. Same anchor as
   *  NetworkUtilization so the two charts line up on the X axis. */
  endTime: string;
  /** Hourly active-endpoint counts, oldest → newest. Length 168. */
  counts: number[];
}

/**
 * Deterministically build 168 hourly active-endpoint counts (integers ~0–20)
 * with long near-idle stretches and several active plateaus. Active windows are
 * loosely aligned to buildNetworkUtilizationSeries' periods so the two panels
 * tell a coherent story (they need not match exactly). Seeded LCG (NOT
 * Math.random), evaluated once at field init.
 */
function buildActiveIdentitiesCounts(): number[] {
  let seed = 0x51ed2a9f;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  // Active windows [startHour, endHour, peakCount] — loosely aligned to the
  // utilization fixture's active periods.
  const windows: Array<[number, number, number]> = [
    [22, 46, 14],   // day 1 — plateau
    [70, 82, 18],   // day 3 — peak activity
    [96, 120, 10],  // day 4–5 — steady moderate
    [140, 150, 16], // day 6 — second peak
  ];

  const counts: number[] = [];
  for (let i = 0; i < 168; i++) {
    // Near-idle baseline: mostly 0, occasional 1–2.
    let level = rand() < 0.35 ? Math.round(rand() * 2) : 0;
    for (const [start, end, peak] of windows) {
      if (i >= start && i <= end) {
        const mid = (start + end) / 2;
        const span = (end - start) / 2 || 1;
        const shape = 1 - Math.abs(i - mid) / span; // triangular ramp 0→1→0
        const active = peak * (0.55 + 0.45 * shape) - rand() * peak * 0.15;
        level = Math.max(level, active);
      }
    }
    counts.push(Math.max(0, Math.round(level)));
  }
  return counts;
}

@Injectable({ providedIn: 'root' })
export class MockDataService {
  readonly isOnboarded = signal<boolean>(true);
  readonly connectionVerified = signal<boolean>(false);

  readonly identities = signal<Identity[]>([
    { id: 'id-001', name: 'laptop-alice', createdAt: '2025-01-10T10:00:00Z', status: 'online', type: 'device', attributes: ['#users', '#laptops'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 42 },
    { id: 'id-002', name: 'server-prod-01', createdAt: '2025-01-12T14:30:00Z', status: 'online', type: 'service', attributes: ['#servers', '#prod'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 186 },
    { id: 'id-003', name: 'phone-bob', createdAt: '2025-02-01T09:15:00Z', status: 'offline', type: 'device', attributes: ['#users', '#mobile'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 9 },
    { id: 'id-004', name: 'alice@corp.com', createdAt: '2025-02-05T11:00:00Z', status: 'online', type: 'user', attributes: ['#admins'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 61 },
    { id: 'id-005', name: 'kiosk-lobby', createdAt: '2025-03-01T08:00:00Z', status: 'pending', type: 'device', attributes: ['#kiosks'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 3 },
    // Discovery → policy feature (Part 2): wildcard-intercepted identities with
    // NO cluster attributes — discovery assigns #roles. See discovered-flows.mock.ts.
    ...DISCOVERY_IDENTITIES,
  ]);

  readonly services = signal<Service[]>([
    { id: 'svc-001', name: 'gitlab-internal', createdAt: '2025-01-08T10:00:00Z', status: 'online', protocol: 'tcp', interceptAddress: 'gitlab.corp:22', hostAddress: '10.0.1.50:22', totalUsage: 32 },
    { id: 'svc-002', name: 'app-api-prod', createdAt: '2025-01-15T12:00:00Z', status: 'online', protocol: 'https', interceptAddress: 'api.corp:443', hostAddress: '10.0.2.10:8443', totalUsage: 148 },
    { id: 'svc-003', name: 'postgres-db', createdAt: '2025-02-10T16:00:00Z', status: 'degraded', protocol: 'tcp', interceptAddress: 'db.corp:5432', hostAddress: '10.0.3.20:5432', totalUsage: 54 },
  ]);

  readonly policies = signal<Policy[]>([
    { id: 'pol-001', name: 'admins-all-access', createdAt: '2025-01-09T10:00:00Z', status: 'active', type: 'dial', semantic: 'AnyOf', identityRoles: ['#admins'], serviceRoles: ['#all'], postureCheckRoles: [] },
    { id: 'pol-002', name: 'users-gitlab', createdAt: '2025-01-20T11:00:00Z', status: 'active', type: 'dial', semantic: 'AnyOf', identityRoles: ['#users'], serviceRoles: ['#git'], postureCheckRoles: [] },
    { id: 'pol-003', name: 'servers-bind-api', createdAt: '2025-02-12T09:00:00Z', status: 'active', type: 'bind', semantic: 'AllOf', identityRoles: ['#servers'], serviceRoles: ['#apis'], postureCheckRoles: ['#mfa-required'] },
  ]);

  readonly postureChecks = signal<PostureCheck[]>([
    { id: 'pc-001', name: 'require-mfa', createdAt: '2025-01-10T10:00:00Z', status: 'active', type: 'MFA', attributes: ['#mfa-required'] },
    { id: 'pc-002', name: 'corp-os-check', createdAt: '2025-01-15T12:00:00Z', status: 'active', type: 'OS', attributes: ['#corp-devices'] },
  ]);

  readonly routers = signal<Router[]>([
    { id: 'rtr-001', name: 'AWS us-west-2 Edge Router', createdAt: '2026-03-31T13:32:00Z', status: 'online', os: 'linux', attributes: [], verified: true, isOnline: true, hostname: '058b7cb8-7a81-48d6-9b4c-3e2f1a0d5c8e', version: '1.6.14', advertiseAddress: 'tls://058b7cb8-7a81-48d6-9b4c-3e2f1a0d5c8e:443', provisioningStatus: 'PROVISIONED', wssEnabled: true, cloudProvider: 'AWS', location: 'us-west-2', hostSize: 'm5.large', ipAddress: '54.201.45.123', domainName: '058b7cb8-7a81-48d6-9b4c.netfoundry.io', totalUsage: 224 },
    { id: 'rtr-002', name: 'EU West Edge Router', createdAt: '2025-01-05T10:00:00Z', status: 'online', os: 'linux', attributes: ['#eu-edge'], verified: true, isOnline: true, hostname: 'edge1.euwest.netfoundry.io', version: '1.6.12', advertiseAddress: 'tls://edge1.euwest.netfoundry.io:443', provisioningStatus: 'PROVISIONED', wssEnabled: true, cloudProvider: 'AWS', location: 'eu-west-1', hostSize: 'm5.large', ipAddress: '52.49.78.90', domainName: 'edge1.euwest.netfoundry.io', totalUsage: 81 },
    { id: 'rtr-003', name: 'customer-router-hq', createdAt: '2025-02-14T15:00:00Z', status: 'offline', os: 'windows', attributes: ['#hq', '#customer'], verified: false, isOnline: false, hostname: 'router.hq.acmecorp.com', version: '1.3.8', advertiseAddress: 'tls://router.hq.acmecorp.com:443', provisioningStatus: 'ERROR', wssEnabled: false, cloudProvider: 'Custom', location: 'HQ', ipAddress: '192.168.1.1', domainName: 'router.hq.acmecorp.com', altDomain: 'hq.acmecorp.com', totalUsage: 12 },
  ]);

  readonly transitRouters = signal<TransitRouter[]>([
    { id: 'tr-001', name: 'AWS us-west-2 Edge Router 1', createdAt: '2026-03-31T13:32:00Z', status: 'online', isOnline: true, hostname: '058b7cb8-7a81-48d6-9b4c.netfoundry.io', version: '1.6.14', verified: true, token: null, jwt: null },
    { id: 'tr-002', name: 'carrie-ryan controller access', createdAt: '2026-03-31T13:25:00Z', status: 'online', isOnline: true, hostname: 'controller.carrie-ryan.netfoundry.io', version: '1.6.14', verified: true, token: null, jwt: null },
    { id: 'tr-003', name: 'nc-router-90f83be6-c55a-4727-87a1-998', createdAt: '2026-03-31T13:18:00Z', status: 'online', isOnline: true, hostname: 'nc-router-90f83be6.netfoundry.io', version: '1.6.14', verified: true, token: null, jwt: null },
  ]);

  readonly routerPolicies = signal<RouterPolicy[]>([
    { id: 'rp-001', name: 'all-routers-public', createdAt: '2025-01-06T10:00:00Z', status: 'active', routerRoles: ['#all'], identityRoles: ['#all'] },
    { id: 'rp-002', name: 'edge-us-east', createdAt: '2025-01-07T10:00:00Z', status: 'active', routerRoles: ['#us-east'], identityRoles: ['#us-users'] },
  ]);

  readonly sessions = signal<Session[]>([
    {
      id: 'cmnqgytevevx3qio4atih52h6',
      serviceId: '3504k5xQKbHqr3YhDdqabC',
      serviceName: 'nf-mgmt-service',
      identityId: 'id-001',
      identityName: 'nf-mgmt-identity.90f83be6-c55a-4727-87a1-99857ff25586',
      apiSessionId: 'cmnqgyt8jevx1qio4xxr55dvu',
      type: 'Bind',
      isSystem: false,
      edgeRouters: [
        { id: 'rtr-001', name: 'AWS us-west-2 Edge Router 1' },
        { id: 'rtr-002', name: 'carrie-ryan controller access' },
      ],
      servicePolicies: [],
      createdAt: '2026-04-08T13:57:00Z',
      updatedAt: '2026-04-08T13:57:00Z',
    },
    {
      id: 'dmnrgxufvwy4rjp5buji63k7',
      serviceId: 'svc-002',
      serviceName: 'app-api-prod',
      identityId: 'id-004',
      identityName: 'alice@corp.com',
      apiSessionId: 'dmnrgxt9kwz2sjp6cyyr66evw',
      type: 'Dial',
      isSystem: false,
      edgeRouters: [
        { id: 'rtr-001', name: 'AWS us-west-2 Edge Router' },
      ],
      servicePolicies: [
        { id: 'pol-001', name: 'admins-all-access' },
      ],
      createdAt: '2026-04-08T11:30:00Z',
      updatedAt: '2026-04-08T11:30:00Z',
    },
  ]);

  readonly apiSessions = signal<ApiSession[]>([
    {
      id: 'cmnqgyt8jevx1qio4xxr55dvu',
      token: 'tok_7f3a9b2c1d8e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e',
      identityId: 'id-001',
      identityName: 'nf-mgmt-identity.90f83be6-c55a-4727-87a1-99857ff25586',
      createdAt: '2026-04-08T13:57:00Z',
      expiresAt: '2026-04-09T13:57:00Z',
    },
    {
      id: 'dmnrgxt9kwz2sjp6cyyr66evw',
      token: 'tok_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4',
      identityId: 'id-004',
      identityName: 'alice@corp.com',
      createdAt: '2026-04-08T11:30:00Z',
      expiresAt: '2026-04-09T11:30:00Z',
    },
  ]);

  readonly managementEvents = signal<NetworkEvent[]>([
    { id: 'me-001', timestamp: '2025-05-18T14:22:00Z', message: 'Identity laptop-alice enrolled successfully', severity: 'success' },
    { id: 'me-002', timestamp: '2025-05-18T13:45:00Z', message: 'Service app-api-prod configuration updated', severity: 'info' },
    { id: 'me-003', timestamp: '2025-05-17T22:10:00Z', message: 'Policy admins-all-access applied to 4 identities', severity: 'info' },
    { id: 'me-004', timestamp: '2025-05-17T18:30:00Z', message: 'Router customer-router-hq went offline unexpectedly', severity: 'warning' },
    { id: 'me-005', timestamp: '2025-05-17T11:00:00Z', message: 'Certificate rotation failed for server-prod-01', severity: 'error' },
  ]);

  readonly networkEvents = signal<NetworkEvent[]>([
    { id: 'ne-001', timestamp: '2025-05-18T14:30:00Z', message: 'New connection established: laptop-alice → gitlab-internal', severity: 'success' },
    { id: 'ne-002', timestamp: '2025-05-18T14:15:00Z', message: 'High latency detected on eu-west-edge-01 (320ms)', severity: 'warning' },
    { id: 'ne-003', timestamp: '2025-05-18T13:50:00Z', message: 'Connection refused: phone-bob → app-api-prod (policy mismatch)', severity: 'error' },
    { id: 'ne-004', timestamp: '2025-05-18T12:00:00Z', message: 'Tunnel restored: us-east-edge-01 ↔ eu-west-edge-01', severity: 'success' },
    { id: 'ne-005', timestamp: '2025-05-17T23:45:00Z', message: 'Bandwidth threshold reached on postgres-db (85% of limit)', severity: 'warning' },
  ]);

  readonly networkUtilization = signal<NetworkUtilization>({
    endTime: '2025-07-20T13:00:00',
    ...buildNetworkUtilizationSeries(),
  });

  readonly activeIdentities = signal<ActiveIdentities>({
    endTime: '2025-07-20T13:00:00',
    counts: buildActiveIdentitiesCounts(),
  });

  readonly billingUsage = signal<BillingCycle>({
    cycleStart: 'Jul 1',
    cycleEnd: 'Aug 1',
    daysRemaining: 11,
    currentMb: 25.94,
    asOfLabel: 'Jul 20, 1:00 PM',
    cycleDays: 31,
    elapsedDays: 20,
  });

  /**
   * ⚠️ INFERRED / POC mock — see EntityHealthRecord. Mixed routers + identities:
   * some offline, some degraded, some online (healthy). The online rows exist
   * so the panel's unhealthy filter is visibly excluding them. Timestamps are
   * anchored around mid-July 2026 so the "N ago" labels read plausibly.
   */
  readonly entityHealth = signal<EntityHealthRecord[]>([
    // ── offline ──
    { entityName: 'hq-edge-01',       entityType: 'router',   status: 'offline',  lastSeen: '2026-07-10T09:00:00Z' }, // ~4d
    { entityName: 'phone-bob',        entityType: 'identity', status: 'offline',  lastSeen: '2026-07-12T15:00:00Z' }, // ~2d
    { entityName: 'branch-edge-07',   entityType: 'router',   status: 'offline',  lastSeen: '2026-07-14T03:00:00Z' }, // ~hrs
    // ── degraded ──
    { entityName: 'eu-west-edge-01',  entityType: 'router',   status: 'degraded', lastSeen: '2026-07-11T12:00:00Z' }, // ~3d
    { entityName: 'laptop-carol',     entityType: 'identity', status: 'degraded', lastSeen: '2026-07-13T10:00:00Z' }, // ~1d
    { entityName: 'kiosk-lobby',      entityType: 'identity', status: 'degraded', lastSeen: '2026-07-14T08:40:00Z' }, // ~min
    // ── online (healthy — excluded by the panel filter) ──
    { entityName: 'us-east-edge-01',  entityType: 'router',   status: 'online',   lastSeen: '2026-07-14T09:00:00Z' },
    { entityName: 'laptop-alice',     entityType: 'identity', status: 'online',   lastSeen: '2026-07-14T08:55:00Z' },
  ]);

  /**
   * POC MOCK — alerting-API alerts feeding the /alerts list. Types imported from
   * the alerts feature (alerts.models.ts) rather than declared inline here, so
   * the feature and this service share one shape. Mirrors the alerts-list
   * screenshot: two router-flapping alerts (one muted by the mute below), two
   * service-unreachable alerts (one FIRING + acked). `identityId`s reuse real
   * ids from `identities()` above (id-004 = alice@corp.com, an admin).
   */
  readonly alerts = signal<Alert[]>([
    {
      id: 'alrt-flap-1',
      alertType: 'ziti.router.flapping',
      detectorId: 'det-router-flapping',
      sourceId: 'rtr-flap-1',
      fingerprint: '9f2c4a7e1b8d6035e4a1c9f70d2b83e6a5471cd208bf9e63a1740c85d29fb6e1',
      status: 'PENDING',
      severity: 'MAJOR',
      labels: { routerId: 'rtr-flap-1', routerName: 'flap-1' },
      firstAssertedAt: '2026-08-31T22:14:00Z',
      openedAt: '2026-08-31T22:14:00Z',
      lastAssertedAt: '2026-09-01T08:02:00Z',
      expiresAt: '2026-09-01T12:02:00Z',
      resolvedAt: null,
      resolutionReason: null,
      stale: false,
      open: true,
      suppressed: false,
      suppressedBy: null,
      suppressionReason: null,
      evidence: { transitions: 14, windowMinutes: 60 },
      ack: { acked: false, identityId: null, at: null, note: null },
    },
    {
      id: 'alrt-flap-2',
      alertType: 'ziti.router.flapping',
      detectorId: 'det-router-flapping',
      sourceId: 'rtr-flap-2',
      fingerprint: '3d8b1f60a94c7e25db0f43a6e18c592704bf6ad3e9021c7f85630ba4d1ce9f72',
      status: 'PENDING',
      severity: 'MAJOR',
      labels: { routerId: 'rtr-flap-2', routerName: 'flap-2' },
      firstAssertedAt: '2026-08-31T20:41:00Z',
      openedAt: '2026-08-31T20:41:00Z',
      lastAssertedAt: '2026-09-01T07:55:00Z',
      expiresAt: '2026-09-01T11:55:00Z',
      resolvedAt: null,
      resolutionReason: null,
      stale: false,
      open: true,
      suppressed: true,
      suppressedBy: 'mute-flap-2',
      suppressionReason: 'Covered by mute mute-flap-2',
      evidence: { transitions: 9, windowMinutes: 60 },
      ack: { acked: false, identityId: null, at: null, note: null },
    },
    {
      id: 'alrt-svc-004',
      alertType: 'ziti.service.unreachable',
      detectorId: 'det-service-unreachable',
      sourceId: 'fleet-1788206544-svc-004',
      fingerprint: 'c07e5a9142f8b3d6e0a7146c9fbd2830a15e74c96db083f2a4e19675c3d0b8fa',
      status: 'PENDING',
      severity: 'MAJOR',
      labels: { serviceId: 'fleet-1788206544-svc-004', serviceName: 'fleet-1788206544-svc-004' },
      firstAssertedAt: '2026-09-01T06:30:00Z',
      openedAt: '2026-09-01T06:30:00Z',
      lastAssertedAt: '2026-09-01T08:00:00Z',
      expiresAt: '2026-09-01T12:00:00Z',
      resolvedAt: null,
      resolutionReason: null,
      stale: false,
      open: true,
      suppressed: false,
      suppressedBy: null,
      suppressionReason: null,
      evidence: { terminators: 0, lastDialError: 'NO_TERMINATORS' },
      ack: { acked: false, identityId: null, at: null, note: null },
    },
    {
      id: 'alrt-svc-007',
      alertType: 'ziti.service.unreachable',
      detectorId: 'det-service-unreachable',
      sourceId: 'fleet-1788206544-svc-007',
      fingerprint: '7e2a6f0c1b93d84e5027ac6f1e8b40d329756caf0b1e6d84203f9c75a6e1b0d3',
      status: 'FIRING',
      severity: 'MAJOR',
      labels: { serviceId: 'fleet-1788206544-svc-007', serviceName: 'fleet-1788206544-svc-007' },
      firstAssertedAt: '2026-09-01T05:12:00Z',
      openedAt: '2026-09-01T05:12:00Z',
      lastAssertedAt: '2026-09-01T08:05:00Z',
      expiresAt: '2026-09-01T12:05:00Z',
      resolvedAt: null,
      resolutionReason: null,
      stale: false,
      open: true,
      suppressed: false,
      suppressedBy: null,
      suppressionReason: null,
      evidence: { terminators: 0, lastDialError: 'ROUTER_ERR_CONN_REFUSED' },
      ack: { acked: true, identityId: '2f9c1e7a-8b3d-4c6f-a1e2-5d7b9c0f4a31', at: '2026-09-01T06:00:00Z', note: 'Investigating terminator loss.' },
    },
    {
      // A detector's OWN health — not about any network component. Its alertType
      // maps to null in componentTypeForAlertType (no router/service/link/detector
      // prefix), so it counts toward `total` but lands in no component tile — the
      // reason the four tiles need not sum to the total.
      id: 'alrt-det-hb-1',
      alertType: 'detector.heartbeat-missed',
      detectorId: 'det-service-unreachable',
      sourceId: 'det-service-unreachable',
      fingerprint: 'b41f8e0d27a6c93415e0f7b8a2c6d19345e08fa7c3b1d6209e845f7c0a3d1b62',
      status: 'FIRING',
      severity: 'MINOR',
      labels: { detectorId: 'det-service-unreachable', detectorName: 'service-unreachable' },
      firstAssertedAt: '2026-09-01T07:40:00Z',
      openedAt: '2026-09-01T07:40:00Z',
      lastAssertedAt: '2026-09-01T08:06:00Z',
      expiresAt: '2026-09-01T12:06:00Z',
      resolvedAt: null,
      resolutionReason: null,
      stale: false,
      open: true,
      suppressed: false,
      suppressedBy: null,
      suppressionReason: null,
      evidence: { missedHeartbeats: 3, expectedIntervalSeconds: 30, lastHeartbeatAt: '2026-09-01T07:38:30Z' },
      ack: { acked: false, identityId: null, at: null, note: null },
    },
  ]);

  /**
   * POC MOCK — mutes feeding the /alerts Mutes tab. One active mute covering
   * flap-2's router by routerId, scoped to the router-flapping type; this is
   * why alrt-flap-2 above carries suppressed:true / suppressedBy:'mute-flap-2'.
   */
  readonly mutes = signal<Mute[]>([
    {
      id: 'mute-flap-2',
      createdByIdentityId: '2f9c1e7a-8b3d-4c6f-a1e2-5d7b9c0f4a31',
      createdAt: '2026-08-31T21:00:00Z',
      matchers: [{ label: 'routerId', op: 'EQ', value: 'rtr-flap-2' }],
      alertTypes: ['ziti.router.flapping'],
      starts: null,
      ends: null,
      reason: null,
      revokedAt: null,
      revokedByIdentityId: null,
    },
  ]);

  /**
   * POC MOCK — alert event timelines, keyed by alert id. Only two alerts carry
   * a timeline, chosen to contrast the two kinds:
   *   - alrt-svc-007 (FIRING + acked) → a REAL log (derived:false): OPENED and
   *     FIRED are detector-driven (actor null); ACKNOWLEDGED carries the same
   *     console-user UUID recorded on the alert's ack. Timestamps align with the
   *     alert's openedAt (05:12) and ack.at (06:00).
   *   - alrt-flap-2 (muted) → a DERIVED log (derived:true): a couple of
   *     reconstructed events with actor:null on ALL of them — a derived timeline
   *     cannot recover who did anything.
   * The other alerts (alrt-flap-1, alrt-svc-004) have NO entry → empty state.
   */
  readonly alertTimelines = signal<Record<string, Timeline>>({
    'alrt-svc-007': {
      derived: false,
      events: [
        { type: 'OPENED', at: '2026-09-01T05:12:00Z', sequence: 1, actor: null },
        { type: 'FIRED',  at: '2026-09-01T05:12:30Z', sequence: 2, actor: null },
        { type: 'ACKNOWLEDGED', at: '2026-09-01T06:00:00Z', sequence: 3, actor: '2f9c1e7a-8b3d-4c6f-a1e2-5d7b9c0f4a31', detail: { note: 'Investigating terminator loss.' } },
      ],
    },
    'alrt-flap-2': {
      derived: true,
      events: [
        { type: 'OPENED', at: '2026-08-31T20:41:00Z', sequence: 1, actor: null },
        { type: 'FIRED',  at: '2026-08-31T20:42:00Z', sequence: 2, actor: null },
      ],
    },
  });

  /**
   * POC MOCK — console/org users. The alerting API hands back only a UUID for
   * who claimed an alert / created a mute; Ownership resolves that UUID here
   * (name + email), NOT against identities(). Seeded with the org root user.
   */
  readonly consoleUsers = signal<ConsoleUser[]>([
    { id: '2f9c1e7a-8b3d-4c6f-a1e2-5d7b9c0f4a31', name: 'NFADMIN Root User', email: 'no-reply@netfoundry.io' },
  ]);

  /**
   * The signed-in operator. With no auth in fixtures, actions that the real API
   * attributes to the caller's token (claiming an alert writes an ack actor)
   * attribute to this user instead. Deliberately the same NFADMIN Root User id
   * already on the seeded ack/mute, so resolution stays consistent.
   */
  readonly currentUser: ConsoleUser = this.consoleUsers()[0];
}
