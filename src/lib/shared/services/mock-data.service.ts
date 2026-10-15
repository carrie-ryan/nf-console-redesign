import { Injectable, signal } from '@angular/core';
import { DISCOVERY_IDENTITIES } from '../../features/discovery/discovered-flows.mock';
import type { Alert, Mute, Timeline } from '../../features/alerts/alerts.models';
import type { ProviderConnection } from '../../features/posture-checks/provider-connection.models';

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
  /** A router identity (type 'router'): the edge router it is the tunneler of. */
  routerId?: string;
  /**
   * POC MOCK — total data transferred (GB), drives the dashboard usage pie.
   * Optional: freshly-created entities have no usage yet (treated as 0).
   */
  totalUsage?: number;
}

/** Lifecycle of a console user's org membership. */
export type ConsoleUserStatus = 'active' | 'invited' | 'disabled';

/**
 * A role someone holds (or is being invited with), plus whether they may hand
 * that role out to other people — grant it AND revoke it.
 *
 * `canGrant` is per user AND per role: an admin can give someone Network Group
 * Admin without also letting them grant Network Group Admin to anyone else.
 * Surfaced as the "Can grant to others" toggle in the invite modal and the
 * "Can grant" badge in the Users table. This is the legacy console's "User
 * Grant" checkbox, renamed because the old label named neither the object nor
 * who it affected.
 */
export interface RoleGrant {
  roleId: string;
  canGrant: boolean;
}

/**
 * A console/org USER — the human who signs into the console (has a display name
 * AND an email). Distinct from a Ziti edge `Identity` (a device/service handle):
 * the alerting API returns only a UUID for who claimed an alert / created a
 * mute, and the console resolves that UUID against THIS collection, not
 * identities().
 *
 * Everything past `email` is OPTIONAL on purpose: alert ownership resolution
 * only ever needs id/name/email, so the /users page can grow columns without
 * forcing every consumer (or every fixture that mints a user) to supply them.
 */
export interface ConsoleUser {
  id: string;
  name: string;
  email: string;
  /** The org roles this user holds, by `OrgRole.id`, each carrying whether the
   *  user may grant it onward. The Users table derives both its Role cell text
   *  and its "Can grant" badge from this — there is no separate label string. */
  roleGrants?: RoleGrant[];
  status?: ConsoleUserStatus;
  mfaEnabled?: boolean;
  /** ISO timestamp; undefined for a user who has never signed in (invited). */
  lastLoginAt?: string;
  createdAt?: string;
}

/** The account / network-group every seeded role is scoped to. */
const ORG_SCOPE = 'alanLocal08-17-2';

/**
 * An assignable ORG role — what a console user is granted, as opposed to a Ziti
 * `#roleAttribute` on an identity or service. `scope` is the account or network
 * group the role applies within; the console shows it as a suffix on the role
 * name, since the same role name can exist under several scopes.
 */
/** What a role lets you do to its resource. */
export type RoleStrategy = 'Admin' | 'Read-Only';

/** The kind of thing a role is scoped to. Roles come as one per
 *  resource-type × strategy pair — "Billing Account Read-Only", and so on. */
export type RoleResourceType = 'Organization' | 'Network Group' | 'Billing Account';

export interface OrgRole {
  id: string;
  /** Display name WITHOUT the scope suffix — the console appends `scope`. */
  name: string;
  scope: string;
  strategy: RoleStrategy;
  resourceType: RoleResourceType;
  /** 'Standard' for the built-in roles; custom roles would differ. */
  roleType: string;
  description?: string;
  /** Part of the org's default role set — applied by "Use default roles". */
  isDefault?: boolean;
  /** New members invited with this role start out able to grant and revoke it.
   *  A DEFAULT for the invite modal's per-user "Can grant to others" toggle,
   *  not a hard rule — an admin can still override it per person. Both this and
   *  `isDefault` are edited in the Edit Role Options modal. */
  grantableByDefault?: boolean;
}

export interface Service {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  protocol: 'tcp' | 'udp' | 'http' | 'https';
  interceptAddress: string;
  /**
   * What the service intercepts: addresses (names, '*.domain' wildcards, IPs, CIDR
   * ranges), port ranges and protocols. Unset, it is derived from interceptAddress
   * (interceptOf in policy-builder/intercepts.ts) — which stays as it is: discovery
   * matches on it.
   */
  intercept?: Intercept;
  hostAddress: string;
  attributes?: string[];
  encryptionRequired?: boolean;
  /** How the controller picks among a service's terminators. Unset means
   *  'smartrouting' (the Ziti default); every seed service sets it explicitly. */
  terminatorStrategy?: TerminatorStrategy;
  tags?: Record<string, string>;
  /**
   * POC MOCK — total data transferred (GB), drives the dashboard usage pie.
   * Optional: freshly-created entities have no usage yet (treated as 0).
   */
  totalUsage?: number;
}

export interface PortRange {
  low: number;
  high: number;
}

export interface Intercept {
  addresses: string[];
  portRanges: PortRange[];
  protocols: ('tcp' | 'udp')[];
}

export type TerminatorStrategy = 'smartrouting' | 'weighted' | 'random';

/**
 * A hosting identity's registration of a service on one edge router — what makes an
 * authorized host actually serve. `precedence` orders terminators for the strategy:
 * 'required' beats 'default'; 'failed' is set by the controller after dial failures
 * and only gets traffic when nothing better is left.
 */
export interface Terminator {
  id: string;
  serviceId: string;
  identityId: string;
  routerId: string;
  precedence: 'required' | 'default' | 'failed';
  cost: number;
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
  /**
   * PROTOTYPE — time-limited access. Ziti has no native expiry: this assumes a
   * NetFoundry-side scheduler that deletes the policy at `expiresAt` (ISO), or removes
   * a named (@) identity entry from identityRoles at its own `expiresAt`.
   */
  expiresAt?: string;
  expiringEntries?: ExpiringEntry[];
}

/** A named identity entry ('@name' in identityRoles) that the scheduler removes at `expiresAt`. */
export interface ExpiringEntry {
  role: string;
  expiresAt: string;
}

export type PostureCheckType = 'OS' | 'MFA' | 'Process' | 'Domain' | 'MAC' | 'WindowsDomain' | 'ServiceProvider';

/** One rule a ServiceProvider check evaluates against a provider attribute. */
export interface PostureCondition {
  attribute: string;
  op: string;
  value: unknown;
}

/** A reason a ServiceProvider check can't evaluate an identity against provider data. */
export type UnavailableCondition =
  /** No mapping from identity → provider device id. */
  | 'onUnmapped'
  /** Mapping exists; the provider affirmatively has no record for the device. */
  | 'onNoRecord'
  /**
   * The router has no fresh data (never polled / timed out / aged out). NO_RECORD is pushed to
   * routers, so onStale ("couldn't ask") stays distinct from onNoRecord ("asked, none exists").
   */
  | 'onStale'
  /** Record exists but the JSON Pointer path is missing / null / "". */
  | 'onNoValue'
  /** Value is present but of the wrong type. */
  | 'onTypeMismatch';

export type UnavailableOutcome = 'pass' | 'fail';

/** Per-condition outcome when posture data is unavailable — lives on the check, not the connection. */
export type UnavailablePolicy = Record<UnavailableCondition, UnavailableOutcome>;

/** Applied when a ServiceProvider check omits `unavailablePolicy`: every condition fails. */
export const DEFAULT_UNAVAILABLE_POLICY: UnavailablePolicy = {
  onUnmapped: 'fail',
  onNoRecord: 'fail',
  onStale: 'fail',
  onNoValue: 'fail',
  onTypeMismatch: 'fail',
};

/**
 * Applied when a ServiceProvider check omits `maxAgeSeconds`: provider data older than
 * 3600 s (1 hour) counts as stale, triggering the `onStale` outcome.
 */
export const DEFAULT_MAX_AGE_SECONDS = 3600;

export interface PostureCheck {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  type: PostureCheckType;
  attributes: string[];
  /** ServiceProvider only — the ProviderConnection this check reads from. */
  connectionId?: string;
  /** ServiceProvider only — all must pass. */
  conditions?: PostureCondition[];
  /** ServiceProvider only — outcome when posture data is unavailable; omitted means DEFAULT_UNAVAILABLE_POLICY. */
  unavailablePolicy?: UnavailablePolicy;
  /** ServiceProvider only — age (seconds) after which provider data is stale (`onStale`); omitted means DEFAULT_MAX_AGE_SECONDS. */
  maxAgeSeconds?: number;
  /** MFA only — seconds an MFA pass stays valid (omitted: no timeout), and whether to re-prompt on wake / unlock. */
  timeoutSeconds?: number;
  promptOnWake?: boolean;
  promptOnUnlock?: boolean;
  /** OS only — allowed operating systems, each with an optional minimum version. */
  operatingSystems?: PostureOs[];
  /** Process only — the executable that must be running. */
  processPath?: string;
  /** Domain / WindowsDomain only — accepted domains. */
  domains?: string[];
  /** MAC only — accepted MAC addresses. */
  macAddresses?: string[];
}

export interface PostureOs {
  type: 'Windows' | 'macOS' | 'Linux' | 'iOS' | 'Android';
  minVersion?: string;
}

/**
 * An access test — a rule the network must keep, checked against every draft before
 * it can be committed. `who` matches identities by name, OR by having any of the
 * attributes.
 *   mustNotDial / mustNotHost — authorization only: no matching identity may be
 *                               Dial / Bind authorized, whatever its routes or posture.
 *   mustConnect               — every matching identity can actually connect: route,
 *                               posture, and an active host.
 */
export interface AccessTest {
  id: string;
  kind: 'mustNotDial' | 'mustNotHost' | 'mustConnect';
  who: { names?: string[]; attributes?: string[] };
  serviceId: string;
  note: string;
}

/** An identity's current posture: the checks it passes (everything else fails). */
export interface PostureResult {
  identityId: string;
  passedCheckIds: string[];
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

/** An edge router as an authorization subject — the role-matchable side of edge
 *  router policies and service edge router policies. */
export interface EdgeRouter {
  id: string;
  name: string;
  attributes: string[];
  isOnline: boolean;
  /** Runs a tunneler: Ziti gives it an identity of its own (type 'router', routerId = this id). */
  tunnelerEnabled?: boolean;
}

/** Which identities may use which edge routers. Ziti default semantic is AllOf. */
export interface EdgeRouterPolicy {
  id: string;
  name: string;
  createdAt: string;
  status: EntityStatus;
  semantic: Policy['semantic'];
  edgeRouterRoles: string[];
  identityRoles: string[];
  /** Created and owned by Ziti (a router identity's grant of its own router): read-only. */
  isSystem?: boolean;
}

/** Which services may be reached through which edge routers. Ziti default semantic is AllOf. */
export interface ServiceEdgeRouterPolicy {
  id: string;
  name: string;
  semantic: Policy['semantic'];
  serviceRoles: string[];
  edgeRouterRoles: string[];
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

    // ─── tagged demo population (grouped-roster view) ────────────────────────
    // Seeded so grouping by attribute-tag has something to show: the five
    // identities above alone leave every tag-node but #users a singleton.
    // Deliberate distribution, modelled on the #discovered-group-* / #mfa-verified
    // pattern in authorization.fixtures.ts (a MODEL only — not imported, and these
    // stay in this file's own #users/#laptops/#servers/#prod/#mobile/#admins/#kiosks
    // vocabulary):
    //   • #users / #laptops / #servers are multi-member, so those nodes read as
    //     real groups rather than dots;
    //   • several identities carry exactly TWO tags (a laptop is also a user, a
    //     prod box is also a server) so one identity appears under two nodes —
    //     the cross-node presence hover-isolate needs to light anything up;
    //   • a few carry one tag only (laptop-emeka has no #users, server-stage-01
    //     no #prod) so the overlap is partial, not a uniform pairing;
    //   • three carry attributes: [] so the no-tag catch-all arm is populated by
    //     MANAGED identities, not only the untagged disc-* discovery roster.
    // NO flows reference these ids — they are roster-only by design, so they must
    // not surface in Raw traffic or the flow map (both key off DISCOVERED_FLOWS).
    // totalUsage is omitted throughout: freshly-seeded identities have no usage yet.
    { id: 'id-006', name: 'laptop-bhatt', createdAt: '2025-03-04T09:20:00Z', status: 'online', type: 'device', attributes: ['#users', '#laptops'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-007', name: 'laptop-chen', createdAt: '2025-03-04T09:35:00Z', status: 'online', type: 'device', attributes: ['#users', '#laptops'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-008', name: 'laptop-dorsey', createdAt: '2025-03-06T14:10:00Z', status: 'offline', type: 'device', attributes: ['#users', '#laptops'], authPolicy: 'Default', enrollmentType: 'ott' },
    // single-tag drift: a managed laptop never tagged #users
    { id: 'id-009', name: 'laptop-emeka', createdAt: '2025-03-07T11:45:00Z', status: 'online', type: 'device', attributes: ['#laptops'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-010', name: 'phone-carla', createdAt: '2025-03-11T08:55:00Z', status: 'online', type: 'device', attributes: ['#users', '#mobile'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-011', name: 'server-prod-02', createdAt: '2025-03-12T16:00:00Z', status: 'online', type: 'service', attributes: ['#servers', '#prod'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-012', name: 'server-prod-03', createdAt: '2025-03-12T16:20:00Z', status: 'degraded', type: 'service', attributes: ['#servers', '#prod'], authPolicy: 'Default', enrollmentType: 'ott' },
    // single-tag drift: non-prod servers
    { id: 'id-013', name: 'server-stage-01', createdAt: '2025-03-18T10:05:00Z', status: 'online', type: 'service', attributes: ['#servers'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-014', name: 'server-build-01', createdAt: '2025-03-19T13:30:00Z', status: 'online', type: 'service', attributes: ['#servers'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-015', name: 'bob@corp.com', createdAt: '2025-03-21T09:00:00Z', status: 'online', type: 'user', attributes: ['#admins', '#users'], authPolicy: 'MFA-Required', enrollmentType: 'updb' },
    { id: 'id-016', name: 'carol@corp.com', createdAt: '2025-03-21T09:15:00Z', status: 'online', type: 'user', attributes: ['#admins'], authPolicy: 'MFA-Required', enrollmentType: 'updb' },
    { id: 'id-017', name: 'kiosk-reception', createdAt: '2025-03-25T08:00:00Z', status: 'online', type: 'device', attributes: ['#kiosks'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-018', name: 'kiosk-cafeteria', createdAt: '2025-03-25T08:10:00Z', status: 'offline', type: 'device', attributes: ['#kiosks'], authPolicy: 'Default', enrollmentType: 'ott' },
    // managed but ungrouped — the no-tag catch-all arm
    { id: 'id-019', name: 'tablet-warehouse', createdAt: '2025-04-08T12:00:00Z', status: 'online', type: 'device', attributes: [], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-020', name: 'printer-floor2', createdAt: '2025-04-09T15:40:00Z', status: 'pending', type: 'device', attributes: [], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-021', name: 'vm-sandbox-01', createdAt: '2025-04-14T10:25:00Z', status: 'online', type: 'service', attributes: [], authPolicy: 'Default', enrollmentType: 'ott' },

    // ─── multi-dimensional estate (Attribute groups map) ────────────────────
    // The block above proves the MECHANISM of tag grouping; this one gives it an
    // estate to draw. Modelled on how segmentation products actually label a
    // network: every record carries one APPLICATION, one ROLE (its tier), and one
    // LOCATION, on top of the device/persona vocabulary above.
    //
    // The three dimensions are what make overlap worth rendering. Within a
    // dimension the tags are MUTUALLY EXCLUSIVE — a host sits in one application,
    // one tier, one site — so #role-web never shares an identity with #role-api.
    // ACROSS dimensions they intersect heavily: every #app-payments host is also
    // some role and some location. So a hover on the Attribute groups map draws
    // lines to the other dimensions and to nothing inside its own, which is the
    // structure a flat list of tags cannot show.
    //
    // Deliberate imperfections, so the picture is an estate and not a lattice:
    //   • people (pay-ops-*, crm-sales-*, ana-ds-*) carry an app and a location
    //     but NO role — a person is not a tier;
    //   • #app-analytics spans TWO locations, so location does not simply
    //     partition application;
    //   • infra-* and edge-gw-* carry no application at all — shared plumbing
    //     that belongs to everything and therefore to nothing;
    //   • a handful are offline/degraded/pending rather than uniformly online.
    //
    // No #env-* dimension on purpose: #prod already exists above, and #prod
    // sitting beside #env-prod would read as a data bug rather than two ideas.
    //
    // These ids DO carry observed traffic — see MANAGED_BLOCKS in
    // discovered-flows.mock.ts, where each one is an enrolled source whose
    // dial-set was derived from the tags below (role picks the tier, application
    // picks the instance). So they surface in Raw traffic, the flow map and the
    // per-identity Traffic tab. The block above (id-001…id-021) stays
    // roster-only, which is what keeps the drawer's empty state reachable.
    // Ids stay in the id-0NN space (never a disc-* id) and no name is an IP
    // string: both are load-bearing for the adapter spec's unmanaged-arm
    // assertions, since an id-0NN dialer is treated as MANAGED everywhere.
    // ── #app-payments · us-east ────────────────────────────────────────
    { id: 'id-022', name: 'pay-web-01', createdAt: '2025-04-22T08:00:00Z', status: 'online', type: 'service', attributes: ['#app-payments', '#role-web', '#loc-us-east', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 96 },
    { id: 'id-023', name: 'pay-web-02', createdAt: '2025-04-25T09:07:00Z', status: 'online', type: 'service', attributes: ['#app-payments', '#role-web', '#loc-us-east', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 88 },
    { id: 'id-024', name: 'pay-web-03', createdAt: '2025-04-28T10:14:00Z', status: 'online', type: 'service', attributes: ['#app-payments', '#role-web', '#loc-us-east'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-025', name: 'pay-api-01', createdAt: '2025-05-01T11:21:00Z', status: 'online', type: 'service', attributes: ['#app-payments', '#role-api', '#loc-us-east', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 174 },
    { id: 'id-026', name: 'pay-api-02', createdAt: '2025-05-04T12:28:00Z', status: 'online', type: 'service', attributes: ['#app-payments', '#role-api', '#loc-us-east', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 168 },
    { id: 'id-027', name: 'pay-api-03', createdAt: '2025-05-07T13:35:00Z', status: 'degraded', type: 'service', attributes: ['#app-payments', '#role-api', '#loc-us-east'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-028', name: 'pay-db-01', createdAt: '2025-05-10T14:42:00Z', status: 'online', type: 'service', attributes: ['#app-payments', '#role-db', '#loc-us-east', '#servers', '#prod'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 240 },
    { id: 'id-029', name: 'pay-db-02', createdAt: '2025-05-13T15:49:00Z', status: 'online', type: 'service', attributes: ['#app-payments', '#role-db', '#loc-us-east', '#prod'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 205 },
    { id: 'id-030', name: 'pay-worker-01', createdAt: '2025-05-16T16:56:00Z', status: 'online', type: 'service', attributes: ['#app-payments', '#role-worker', '#loc-us-east', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 54 },
    { id: 'id-031', name: 'pay-worker-02', createdAt: '2025-05-19T08:03:00Z', status: 'offline', type: 'service', attributes: ['#app-payments', '#role-worker', '#loc-us-east'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-032', name: 'pay-ops-anna', createdAt: '2025-05-22T09:10:00Z', status: 'online', type: 'user', attributes: ['#app-payments', '#loc-us-east', '#users', '#laptops'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 27 },
    { id: 'id-033', name: 'pay-ops-ben', createdAt: '2025-05-25T10:17:00Z', status: 'online', type: 'user', attributes: ['#app-payments', '#loc-us-east', '#users', '#laptops'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 19 },
    { id: 'id-034', name: 'pay-qa-01', createdAt: '2025-05-28T11:24:00Z', status: 'online', type: 'device', attributes: ['#app-payments', '#role-api', '#loc-us-east'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-035', name: 'pay-cache-01', createdAt: '2025-05-31T12:31:00Z', status: 'online', type: 'service', attributes: ['#app-payments', '#role-worker', '#loc-us-east'], authPolicy: 'Default', enrollmentType: 'ott' },

    // ── #app-crm · eu ──────────────────────────────────────────────────
    { id: 'id-036', name: 'crm-web-01', createdAt: '2025-06-03T13:38:00Z', status: 'online', type: 'service', attributes: ['#app-crm', '#role-web', '#loc-eu', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 72 },
    { id: 'id-037', name: 'crm-web-02', createdAt: '2025-06-06T14:45:00Z', status: 'online', type: 'service', attributes: ['#app-crm', '#role-web', '#loc-eu', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 69 },
    { id: 'id-038', name: 'crm-web-03', createdAt: '2025-06-09T15:52:00Z', status: 'offline', type: 'service', attributes: ['#app-crm', '#role-web', '#loc-eu'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-039', name: 'crm-api-01', createdAt: '2025-06-12T16:59:00Z', status: 'online', type: 'service', attributes: ['#app-crm', '#role-api', '#loc-eu', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 131 },
    { id: 'id-040', name: 'crm-api-02', createdAt: '2025-06-15T08:06:00Z', status: 'online', type: 'service', attributes: ['#app-crm', '#role-api', '#loc-eu'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-041', name: 'crm-db-01', createdAt: '2025-06-18T09:13:00Z', status: 'online', type: 'service', attributes: ['#app-crm', '#role-db', '#loc-eu', '#servers', '#prod'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 198 },
    { id: 'id-042', name: 'crm-db-02', createdAt: '2025-06-21T10:20:00Z', status: 'degraded', type: 'service', attributes: ['#app-crm', '#role-db', '#loc-eu', '#prod'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 164 },
    { id: 'id-043', name: 'crm-worker-01', createdAt: '2025-06-24T11:27:00Z', status: 'online', type: 'service', attributes: ['#app-crm', '#role-worker', '#loc-eu', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 43 },
    { id: 'id-044', name: 'crm-worker-02', createdAt: '2025-06-27T12:34:00Z', status: 'online', type: 'service', attributes: ['#app-crm', '#role-worker', '#loc-eu'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-045', name: 'crm-sales-dana', createdAt: '2025-06-30T13:41:00Z', status: 'online', type: 'user', attributes: ['#app-crm', '#loc-eu', '#users', '#laptops'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 31 },
    { id: 'id-046', name: 'crm-sales-erik', createdAt: '2025-07-03T14:48:00Z', status: 'offline', type: 'user', attributes: ['#app-crm', '#loc-eu', '#users', '#laptops'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 22 },
    { id: 'id-047', name: 'crm-sales-fiona', createdAt: '2025-07-06T15:55:00Z', status: 'online', type: 'user', attributes: ['#app-crm', '#loc-eu', '#users', '#mobile'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 14 },
    { id: 'id-048', name: 'crm-report-01', createdAt: '2025-07-09T16:02:00Z', status: 'online', type: 'service', attributes: ['#app-crm', '#role-api', '#loc-eu'], authPolicy: 'Default', enrollmentType: 'ott' },

    // ── #app-logistics · plant (the OT side) ───────────────────────────
    { id: 'id-049', name: 'log-web-01', createdAt: '2025-07-12T08:09:00Z', status: 'online', type: 'service', attributes: ['#app-logistics', '#role-web', '#loc-plant', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 58 },
    { id: 'id-050', name: 'log-web-02', createdAt: '2025-07-15T09:16:00Z', status: 'online', type: 'service', attributes: ['#app-logistics', '#role-web', '#loc-plant'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-051', name: 'log-api-01', createdAt: '2025-07-18T10:23:00Z', status: 'online', type: 'service', attributes: ['#app-logistics', '#role-api', '#loc-plant', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 112 },
    { id: 'id-052', name: 'log-api-02', createdAt: '2025-07-21T11:30:00Z', status: 'online', type: 'service', attributes: ['#app-logistics', '#role-api', '#loc-plant', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 104 },
    { id: 'id-053', name: 'log-db-01', createdAt: '2025-07-24T12:37:00Z', status: 'online', type: 'service', attributes: ['#app-logistics', '#role-db', '#loc-plant', '#servers', '#prod'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 221 },
    { id: 'id-054', name: 'log-db-02', createdAt: '2025-07-27T13:44:00Z', status: 'online', type: 'service', attributes: ['#app-logistics', '#role-db', '#loc-plant', '#prod'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 187 },
    { id: 'id-055', name: 'log-worker-01', createdAt: '2025-07-30T14:51:00Z', status: 'online', type: 'service', attributes: ['#app-logistics', '#role-worker', '#loc-plant', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 66 },
    { id: 'id-056', name: 'log-worker-02', createdAt: '2025-08-02T15:58:00Z', status: 'online', type: 'service', attributes: ['#app-logistics', '#role-worker', '#loc-plant', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 61 },
    { id: 'id-057', name: 'log-worker-03', createdAt: '2025-08-05T16:05:00Z', status: 'degraded', type: 'service', attributes: ['#app-logistics', '#role-worker', '#loc-plant'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-058', name: 'log-scanner-01', createdAt: '2025-08-08T08:12:00Z', status: 'online', type: 'device', attributes: ['#app-logistics', '#loc-plant', '#kiosks'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-059', name: 'log-scanner-02', createdAt: '2025-08-11T09:19:00Z', status: 'pending', type: 'device', attributes: ['#app-logistics', '#loc-plant', '#kiosks'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-060', name: 'log-floor-gita', createdAt: '2025-08-14T10:26:00Z', status: 'online', type: 'user', attributes: ['#app-logistics', '#loc-plant', '#users', '#mobile'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 11 },
    { id: 'id-061', name: 'log-floor-hana', createdAt: '2025-08-17T11:33:00Z', status: 'online', type: 'user', attributes: ['#app-logistics', '#loc-plant', '#users', '#mobile'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 8 },
    { id: 'id-062', name: 'log-hmi-01', createdAt: '2025-08-20T12:40:00Z', status: 'online', type: 'device', attributes: ['#app-logistics', '#role-web', '#loc-plant', '#kiosks'], authPolicy: 'Default', enrollmentType: 'ott' },

    // ── #app-analytics · deliberately split across TWO locations ───────
    { id: 'id-063', name: 'ana-web-01', createdAt: '2025-08-23T13:47:00Z', status: 'online', type: 'service', attributes: ['#app-analytics', '#role-web', '#loc-us-east', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 47 },
    { id: 'id-064', name: 'ana-api-01', createdAt: '2025-08-26T14:54:00Z', status: 'online', type: 'service', attributes: ['#app-analytics', '#role-api', '#loc-us-east', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 93 },
    { id: 'id-065', name: 'ana-api-02', createdAt: '2025-08-29T15:01:00Z', status: 'online', type: 'service', attributes: ['#app-analytics', '#role-api', '#loc-eu'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-066', name: 'ana-db-01', createdAt: '2025-09-01T16:08:00Z', status: 'online', type: 'service', attributes: ['#app-analytics', '#role-db', '#loc-us-east', '#servers', '#prod'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 212 },
    { id: 'id-067', name: 'ana-db-02', createdAt: '2025-09-04T08:15:00Z', status: 'online', type: 'service', attributes: ['#app-analytics', '#role-db', '#loc-eu', '#prod'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 176 },
    { id: 'id-068', name: 'ana-worker-01', createdAt: '2025-09-07T09:22:00Z', status: 'online', type: 'service', attributes: ['#app-analytics', '#role-worker', '#loc-us-east', '#servers'], authPolicy: 'Default', enrollmentType: 'ott', totalUsage: 38 },
    { id: 'id-069', name: 'ana-worker-02', createdAt: '2025-09-10T10:29:00Z', status: 'offline', type: 'service', attributes: ['#app-analytics', '#role-worker', '#loc-eu', '#servers'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-070', name: 'ana-ds-ivan', createdAt: '2025-09-13T11:36:00Z', status: 'online', type: 'user', attributes: ['#app-analytics', '#loc-us-east', '#users', '#laptops'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 35 },
    { id: 'id-071', name: 'ana-ds-julia', createdAt: '2025-09-16T12:43:00Z', status: 'online', type: 'user', attributes: ['#app-analytics', '#loc-eu', '#users', '#laptops'], authPolicy: 'MFA-Required', enrollmentType: 'updb', totalUsage: 29 },
    { id: 'id-072', name: 'ana-etl-01', createdAt: '2025-09-19T13:50:00Z', status: 'online', type: 'service', attributes: ['#app-analytics', '#role-worker', '#loc-us-east'], authPolicy: 'Default', enrollmentType: 'ott' },

    // ── shared infrastructure: no application tag — partial membership ─
    { id: 'id-073', name: 'infra-bastion-01', createdAt: '2025-09-22T14:57:00Z', status: 'online', type: 'service', attributes: ['#role-api', '#loc-us-east', '#servers'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-074', name: 'infra-monitor-01', createdAt: '2025-09-25T15:04:00Z', status: 'online', type: 'service', attributes: ['#role-worker', '#loc-eu', '#servers'], authPolicy: 'Default', enrollmentType: 'ott' },
    { id: 'id-075', name: 'edge-gw-plant-01', createdAt: '2025-09-28T16:11:00Z', status: 'online', type: 'router', attributes: ['#loc-plant', '#servers'], authPolicy: 'Default', enrollmentType: 'ottca' },
    { id: 'id-076', name: 'edge-gw-eu-01', createdAt: '2025-10-01T08:18:00Z', status: 'online', type: 'router', attributes: ['#loc-eu', '#servers'], authPolicy: 'Default', enrollmentType: 'ottca' },

    // ─── router identities ───────────────────────────────────────────────
    // A tunneler-enabled edge router (er-001, er-003 below) gets an identity of its
    // own: type 'router', named after the router, no attributes, linked by routerId.
    // Each has a system ERP granting it its own router (see edgeRouterPolicies).
    { id: 'id-077', name: 'edge-public-us-east-1', createdAt: '2025-01-05T09:00:00Z', status: 'online', type: 'router', attributes: [], routerId: 'er-001' },
    { id: 'id-078', name: 'edge-eu-west-1', createdAt: '2025-01-05T09:05:00Z', status: 'online', type: 'router', attributes: [], routerId: 'er-003' },

    // Discovery → policy feature (Part 2): wildcard-intercepted identities with
    // NO cluster attributes — discovery assigns #roles. See discovered-flows.mock.ts.
    ...DISCOVERY_IDENTITIES,
  ]);

  /** The network this console manages (named in exports such as the access report). */
  readonly network = signal({ id: 'net-001', name: 'corp-prod' });

  readonly services = signal<Service[]>([
    { id: 'svc-001', name: 'gitlab-internal', createdAt: '2025-01-08T10:00:00Z', status: 'online', protocol: 'tcp', interceptAddress: 'gitlab.corp:22', hostAddress: '10.0.1.50:22', terminatorStrategy: 'smartrouting', totalUsage: 32 },
    { id: 'svc-002', name: 'app-api-prod', createdAt: '2025-01-15T12:00:00Z', status: 'online', protocol: 'https', interceptAddress: 'api.corp:443', hostAddress: '10.0.2.10:8443', terminatorStrategy: 'smartrouting', totalUsage: 148 },
    { id: 'svc-003', name: 'postgres-db', createdAt: '2025-02-10T16:00:00Z', status: 'degraded', protocol: 'tcp', interceptAddress: 'db.corp:5432', hostAddress: '10.0.3.20:5432', terminatorStrategy: 'smartrouting', totalUsage: 54 },
    // ─ Trifecta coverage — one service per terminal state. Intercept addresses are
    //   deliberately outside discovered-flows.mock so discovery never matches them. ─
    // AUTHORIZED_REACHABLE: #git → pol-002 lets #users dial it; serp-003 routes it
    // to #public (er-001 online), which #users also get via rp-001.
    { id: 'svc-004', name: 'git-repo', createdAt: '2025-03-02T10:00:00Z', status: 'online', protocol: 'tcp', interceptAddress: 'git-repo.corp.internal:22', hostAddress: '10.0.4.10:22', attributes: ['#git'], terminatorStrategy: 'smartrouting' },
    // Dial NOT_AUTHORIZED for #servers, Bind authorized: #apis → pol-003 binds #servers.
    // serp-004 routes it to #public (er-001 online). Only #admins can dial it (pol-001).
    { id: 'svc-005', name: 'api-prod', createdAt: '2025-03-05T10:00:00Z', status: 'online', protocol: 'https', interceptAddress: 'api-prod.corp.internal:443', hostAddress: '10.0.4.20:8443', attributes: ['#apis'], terminatorStrategy: 'smartrouting' },
    // BLOCKED_ROUTERS_OFFLINE: #git → #users dial it, but serp-005 routes it ONLY to
    // er-002, which is offline.
    { id: 'svc-006', name: 'offline-svc', createdAt: '2025-03-08T10:00:00Z', status: 'degraded', protocol: 'tcp', interceptAddress: 'offline-svc.corp.internal:8080', hostAddress: '10.0.4.30:8080', attributes: ['#git'], terminatorStrategy: 'smartrouting' },
    // AUTHORIZED_NO_ROUTER (no-SERP sub-case): #git → #users dial it, but NO service
    // edge router policy matches it, so it has no routers at all.
    { id: 'svc-007', name: 'no-serp-svc', createdAt: '2025-03-11T10:00:00Z', status: 'online', protocol: 'tcp', interceptAddress: 'no-serp-svc.corp.internal:9000', hostAddress: '10.0.4.40:9000', attributes: ['#git'], terminatorStrategy: 'smartrouting' },
    // A fresh service: no service policy and no SERP reaches it — the policy
    // builder's "start from nothing" case.
    { id: 'svc-008', name: 'reports-svc', createdAt: '2025-03-14T10:00:00Z', status: 'online', protocol: 'https', interceptAddress: 'reports.corp.internal:443',
      // Intercepts all of *.corp.internal on 443 — so it overlaps api-prod for anyone who may dial both.
      intercept: { addresses: ['*.corp.internal'], portRanges: [{ low: 443, high: 443 }], protocols: ['tcp'] },
      hostAddress: '10.0.4.50:8443', attributes: ['#reports'], terminatorStrategy: 'smartrouting' },
  ]);

  readonly policies = signal<Policy[]>([
    // Requires require-mfa (#mfa-required): alice passes it; bob and carol don't — bob
    // still reaches git-repo through users-gitlab, which has no checks.
    { id: 'pol-001', name: 'admins-dev-access', createdAt: '2025-01-09T10:00:00Z', status: 'active', type: 'dial', semantic: 'AnyOf', identityRoles: ['#admins'], serviceRoles: ['#git', '#apis'], postureCheckRoles: ['#mfa-required'] },
    { id: 'pol-002', name: 'users-gitlab', createdAt: '2025-01-20T11:00:00Z', status: 'active', type: 'dial', semantic: 'AnyOf', identityRoles: ['#users'], serviceRoles: ['#git'], postureCheckRoles: [] },
    // Requires corp-os-check (#corp-devices): every #servers identity passes it but
    // infra-bastion-01, which isn't serving api-prod anyway.
    { id: 'pol-003', name: 'servers-bind-api', createdAt: '2025-02-12T09:00:00Z', status: 'active', type: 'bind', semantic: 'AllOf', identityRoles: ['#servers'], serviceRoles: ['#apis'], postureCheckRoles: ['#corp-devices'] },
    // MIXED AllOf Bind: @server-build-01 (only #servers, no #prod) hosts by name; otherwise
    // a host needs #servers AND #prod. Service side is @svc-004 so it binds git-repo alone.
    { id: 'pol-004', name: 'git-repo-hosts', createdAt: '2025-03-02T10:30:00Z', status: 'active', type: 'bind', semantic: 'AllOf', identityRoles: ['@server-build-01', '#servers', '#prod'], serviceRoles: ['@svc-004'], postureCheckRoles: [] },
    // Hosts every #git service by name: server-stage-01 (#servers → the #public routers)
    // is reachable on git-repo, routers-offline on offline-svc, no-router on no-serp-svc.
    { id: 'pol-005', name: 'git-servers-host', createdAt: '2025-03-20T10:00:00Z', status: 'active', type: 'bind', semantic: 'AnyOf', identityRoles: ['@server-stage-01'], serviceRoles: ['#git'], postureCheckRoles: [] },
    // A long real-world name (generated by automation) — exercises truncation in the
    // Policies tabs, group-card headers and review lines. Hosts postgres-db by name.
    { id: 'pol-006', name: 'tod-share-3 | bind | a4581ffb-f3e6-4faa-8949-663f88b8a1c2', createdAt: '2025-04-02T08:00:00Z', status: 'active', type: 'bind', semantic: 'AnyOf', identityRoles: ['@server-prod-01'], serviceRoles: ['@svc-003'], postureCheckRoles: [] },
  ]);

  // Hosts that are actually serving. Only git-repo and api-prod have any: every
  // terminator's identity is Bind-authorized for its service and its router is in
  // that pair's common set (validateTerminators in policy-builder/hosting.ts).
  readonly terminators = signal<Terminator[]>([
    // git-repo: 9 authorized hosts, 2 serving — each on two #public routers.
    { id: 'term-001', serviceId: 'svc-004', identityId: 'id-014', routerId: 'er-001', precedence: 'default', cost: 0 },
    { id: 'term-002', serviceId: 'svc-004', identityId: 'id-014', routerId: 'er-003', precedence: 'default', cost: 0 },
    { id: 'term-003', serviceId: 'svc-004', identityId: 'id-013', routerId: 'er-001', precedence: 'default', cost: 0 },
    { id: 'term-004', serviceId: 'svc-004', identityId: 'id-013', routerId: 'er-003', precedence: 'default', cost: 0 },
    // api-prod: 31 authorized, 3 serving; server-prod-03 has failed.
    { id: 'term-005', serviceId: 'svc-005', identityId: 'id-002', routerId: 'er-001', precedence: 'default', cost: 0 },
    { id: 'term-006', serviceId: 'svc-005', identityId: 'id-011', routerId: 'er-003', precedence: 'default', cost: 0 },
    { id: 'term-007', serviceId: 'svc-005', identityId: 'id-012', routerId: 'er-001', precedence: 'failed', cost: 0 },
  ]);

  readonly postureChecks = signal<PostureCheck[]>([
    { id: 'pc-001', name: 'require-mfa', createdAt: '2025-01-10T10:00:00Z', status: 'active', type: 'MFA', attributes: ['#mfa-required'],
      timeoutSeconds: 1800, promptOnWake: true, promptOnUnlock: false },
    { id: 'pc-002', name: 'corp-os-check', createdAt: '2025-01-15T12:00:00Z', status: 'active', type: 'OS', attributes: ['#corp-devices'],
      operatingSystems: [{ type: 'Windows', minVersion: '10.0.19045' }, { type: 'macOS', minVersion: '14.0' }, { type: 'Linux' }] },
    { id: 'pc-003', name: 'crowdstrike-healthy', createdAt: '2025-03-04T09:30:00Z', status: 'active', type: 'ServiceProvider', attributes: ['#edr-required'],
      connectionId: 'conn-001',
      conditions: [
        { attribute: 'overall', op: 'gte', value: 70 },
        { attribute: 'state', op: 'eq', value: 'Online' },
      ],
      unavailablePolicy: { ...DEFAULT_UNAVAILABLE_POLICY, onStale: 'pass' },
      maxAgeSeconds: 900 },
    { id: 'pc-004', name: 'cloudflare-managed-desktop', createdAt: '2025-05-12T11:00:00Z', status: 'active', type: 'ServiceProvider', attributes: ['#cf-posture'],
      connectionId: 'conn-005',
      conditions: [
        { attribute: 'score', op: 'gte', value: 80 },
        { attribute: 'platform', op: 'in', value: ['windows', 'mac', 'linux'] },
      ],
      unavailablePolicy: { ...DEFAULT_UNAVAILABLE_POLICY },
      maxAgeSeconds: 900 },
  ]);

  // Access tests every draft must pass before commit (policy-builder/access-tests.ts).
  readonly accessTests = signal<AccessTest[]>([
    { id: 'at-001', kind: 'mustNotHost', who: { attributes: ['#kiosks'] }, serviceId: 'svc-005',
      note: 'Kiosks are shared devices; they never serve the production API.' },
    { id: 'at-002', kind: 'mustConnect', who: { names: ['laptop-alice'] }, serviceId: 'svc-004',
      note: "Alice's laptop is the reference developer machine for git-repo." },
    { id: 'at-003', kind: 'mustNotDial', who: { attributes: ['#kiosks'] }, serviceId: 'svc-005',
      note: 'Kiosks have no reason to call the production API.' },
  ]);

  // Which posture checks each identity currently passes. An identity with no entry, or
  // a check not listed, fails — see policy-builder/posture.ts.
  readonly postureResults = signal<PostureResult[]>([
    // require-mfa (admins-dev-access): alice passes; bob and carol fail.
    { identityId: 'id-004', passedCheckIds: ['pc-001'] }, // alice@corp.com
    { identityId: 'id-015', passedCheckIds: [] },         // bob@corp.com
    { identityId: 'id-016', passedCheckIds: [] },         // carol@corp.com
    // corp-os-check (servers-bind-api): every #servers identity but infra-bastion-01.
    ...this.identities()
      .filter((i) => i.attributes?.includes('#servers') && i.name !== 'infra-bastion-01')
      .map((i) => ({ identityId: i.id, passedCheckIds: ['pc-002'] })),
  ]);

  readonly providerConnections = signal<ProviderConnection[]>([
    { id: 'conn-001', name: 'CrowdStrike Falcon (US-1)', providerType: 'CrowdStrike', endpoint: 'https://api.crowdstrike.com',
      acquisition: 'poll', pollFrequency: '15m', matchKey: 'identityName', mode: 'enforce', status: 'active',
      lastVerifiedAt: '2025-05-18T14:00:00Z', createdAt: '2025-03-01T10:00:00Z', credentialRef: 'cred-7f3a91',
      customerId: 'A81F3E2C9D0B4E17', settings: { client_id: '3f9c1a2b7e4d4f6a8c0e', api_url: 'https://api.crowdstrike.com', customer_id: 'A81F3E2C9D0B4E17' } },
    { id: 'conn-002', name: 'Kolide', providerType: 'Kolide', endpoint: 'https://api.kolide.com',
      acquisition: 'poll', pollFrequency: '1h', matchKey: 'tag', matchTagKey: 'serial', mode: 'observe', status: 'active',
      lastVerifiedAt: '2025-05-18T13:00:00Z', createdAt: '2025-03-12T15:00:00Z', credentialRef: 'cred-2b8e40',
      settings: {} },
    // Failing connection — credentials rejected at last verify. EntityStatus has no
    // 'error' member; 'offline' is the closest existing value.
    { id: 'conn-003', name: 'Intune (Corp tenant)', providerType: 'Intune', endpoint: 'https://graph.microsoft.com',
      acquisition: 'poll', pollFrequency: '30m', matchKey: 'identityId', mode: 'observe', status: 'offline',
      lastVerifiedAt: null, createdAt: '2025-04-02T11:00:00Z', customerId: '8f14e45f-ceea-4a7b-9e2d-3c1f0b6a7d52', credentialRef: 'cred-c41d07',
      settings: { client_id: 'b2d7e8f0-4c1a-4e9b-9f3d-6a5c2e1b0d47', customer_id: '8f14e45f-ceea-4a7b-9e2d-3c1f0b6a7d52' } },
    // Event connection — the provider pushes posture to our receive endpoint rather than being polled.
    { id: 'conn-004', name: 'CrowdStrike Falcon (EU-1, events)', providerType: 'CrowdStrike', endpoint: 'https://api.eu-1.crowdstrike.com',
      acquisition: 'event', eventEndpoint: 'https://events.netfoundry.example/posture/conn-004', matchKey: 'identityName', mode: 'observe', status: 'active',
      lastVerifiedAt: '2025-05-18T14:05:00Z', createdAt: '2025-05-02T09:00:00Z', credentialRef: 'cred-9e21d5',
      customerId: 'C42B7D1E8F3A4C09', settings: { client_id: '7a1e4c9b2d5f4a8e9c3b', api_url: 'https://api.eu-1.crowdstrike.com', customer_id: 'C42B7D1E8F3A4C09' } },
    // Cloudflare is event-only: it pushes normalized posture (score + platform) to the generated receive URL.
    { id: 'conn-005', name: 'Cloudflare Access', providerType: 'Cloudflare', endpoint: '',
      acquisition: 'event', eventEndpoint: 'https://events.netfoundry.example/posture/conn-005', matchKey: 'identityName', mode: 'observe', status: 'active',
      lastVerifiedAt: '2025-05-18T14:10:00Z', createdAt: '2025-05-10T08:30:00Z', credentialRef: 'cred-5d0c3a',
      settings: { account_id: '023e105f4ecef8ad9ca31a8372d0c353' } },
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

  readonly edgeRouters = signal<EdgeRouter[]>([
    { id: 'er-001', name: 'edge-public-us-east-1', attributes: ['#us-east', '#public'], isOnline: true, tunnelerEnabled: true },
    { id: 'er-002', name: 'edge-public-us-east-2', attributes: ['#us-east', '#public'], isOnline: false },
    { id: 'er-003', name: 'edge-eu-west-1', attributes: ['#eu-edge', '#public'], isOnline: true, tunnelerEnabled: true },
    { id: 'er-004', name: 'edge-hq-private', attributes: ['#hq', '#customer'], isOnline: true },
  ]);

  readonly edgeRouterPolicies = signal<EdgeRouterPolicy[]>([
    // Identity → router grants by REAL identity attributes (no #all on either side).
    // #users / #servers / #admins all get the #public routers (er-001 on, er-002 off,
    // er-003 on). Identities with none of these (incl. DISCOVERY_IDENTITIES) get none.
    { id: 'rp-001', name: 'users-public-routers', createdAt: '2025-01-06T10:00:00Z', status: 'active', semantic: 'AllOf', edgeRouterRoles: ['#public'], identityRoles: ['#users'] },
    { id: 'rp-002', name: 'edge-us-east', createdAt: '2025-01-07T10:00:00Z', status: 'active', semantic: 'AllOf', edgeRouterRoles: ['#us-east'], identityRoles: ['#us-users'] },
    { id: 'rp-003', name: 'servers-public-routers', createdAt: '2025-01-08T10:00:00Z', status: 'active', semantic: 'AllOf', edgeRouterRoles: ['#public'], identityRoles: ['#servers'] },
    { id: 'rp-004', name: 'admins-public-routers', createdAt: '2025-01-08T11:00:00Z', status: 'active', semantic: 'AllOf', edgeRouterRoles: ['#public'], identityRoles: ['#admins'] },
    // SYSTEM: one per router identity, granting it its own router — modelled on what a
    // controller does for a tunneler-enabled router. Auto-creation (and this naming)
    // is unverified against a real controller.
    { id: 'rp-sys-er-001', name: 'edge-router-er-001-system', createdAt: '2025-01-05T09:00:00Z', status: 'active', semantic: 'AnyOf', edgeRouterRoles: ['@er-001'], identityRoles: ['@id-077'], isSystem: true },
    { id: 'rp-sys-er-003', name: 'edge-router-er-003-system', createdAt: '2025-01-05T09:05:00Z', status: 'active', semantic: 'AnyOf', edgeRouterRoles: ['@er-003'], identityRoles: ['@id-078'], isSystem: true },
  ]);

  // Scoped per service — no #all, so each service gets exactly the routers its
  // intended trifecta state needs. svc-001..003 carry no attributes, so they are
  // addressed by @id.
  readonly serviceEdgeRouterPolicies = signal<ServiceEdgeRouterPolicy[]>([
    { id: 'serp-001', name: 'legacy-services-public-routers', semantic: 'AnyOf', serviceRoles: ['@svc-001', '@svc-002', '@svc-003'], edgeRouterRoles: ['#public'] },
    { id: 'serp-002', name: 'postgres-hq-router', semantic: 'AllOf', serviceRoles: ['@svc-003'], edgeRouterRoles: ['#hq'] },
    { id: 'serp-003', name: 'git-repo-public-routers', semantic: 'AllOf', serviceRoles: ['@svc-004'], edgeRouterRoles: ['#public'] },
    { id: 'serp-004', name: 'apis-public-routers', semantic: 'AllOf', serviceRoles: ['#apis'], edgeRouterRoles: ['#public'] },
    // ONLY the offline er-002 — makes offline-svc BLOCKED_ROUTERS_OFFLINE.
    { id: 'serp-005', name: 'offline-svc-east-2', semantic: 'AllOf', serviceRoles: ['@svc-006'], edgeRouterRoles: ['@er-002'] },
    // A long real-world name (see pol-006). Routes postgres-db to #public, as serp-001 already does.
    { id: 'serp-006', name: 'tod-share-3 | service-edge-router | 0d7b2e64-91c5-4a3e-b8f0-5c6e2a9d1f47', semantic: 'AllOf', serviceRoles: ['@svc-003'], edgeRouterRoles: ['#public'] },
    // Deliberately NO SERP matches svc-007 (no-serp-svc).
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
        { id: 'pol-001', name: 'admins-dev-access' },
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
    { id: 'me-003', timestamp: '2025-05-17T22:10:00Z', message: 'Policy admins-dev-access applied to 4 identities', severity: 'info' },
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
    // KEEP FIRST — `currentUser` below is consoleUsers()[0], and the seeded alert
    // ack/mute reference this exact id. Reordering silently breaks both.
    { id: '2f9c1e7a-8b3d-4c6f-a1e2-5d7b9c0f4a31', name: 'NFADMIN Root User', email: 'no-reply@netfoundry.io',
      roleGrants: [{ roleId: 'role-org-admin', canGrant: true }],
      status: 'active', mfaEnabled: true, lastLoginAt: '2026-09-25T08:14:00Z', createdAt: '2025-01-06T09:00:00Z' },
    { id: 'b47ac10b-58cc-4372-a567-0e02b2c3d479', name: 'Carrie Ryan', email: 'carrie.ryan@netfoundry.io',
      roleGrants: [{ roleId: 'role-org-admin', canGrant: true }],
      status: 'active', mfaEnabled: true, lastLoginAt: '2026-09-24T16:42:00Z', createdAt: '2025-02-18T13:20:00Z' },
    { id: 'c1d8e3f2-7a94-4b15-9c63-2e8f0a4d6b57', name: 'Marcus Webb', email: 'marcus.webb@netfoundry.io',
      roleGrants: [{ roleId: 'role-ng-admin', canGrant: false }],
      status: 'active', mfaEnabled: true, lastLoginAt: '2026-09-25T07:02:00Z', createdAt: '2025-03-04T10:45:00Z' },
    // Deliberately the PARTIAL case: two roles, only one of them grantable, so
    // the badge and its tooltip have to distinguish between them.
    { id: 'd9e2f5a1-3c47-4e8b-b210-6f9a7c3d5e84', name: 'Priya Raghunathan', email: 'priya.r@netfoundry.io',
      roleGrants: [{ roleId: 'role-ng-admin', canGrant: false }, { roleId: 'role-billing-admin', canGrant: true }],
      status: 'active', mfaEnabled: false, lastLoginAt: '2026-09-22T11:30:00Z', createdAt: '2025-05-12T08:15:00Z' },
    { id: 'e4f7a8b2-6d51-4390-8c7e-1b5d9f2a4c63', name: 'Tomás Herrera', email: 'tomas.herrera@netfoundry.io',
      roleGrants: [{ roleId: 'role-org-readonly', canGrant: false }],
      status: 'active', mfaEnabled: true, lastLoginAt: '2026-09-19T14:08:00Z', createdAt: '2025-06-30T15:50:00Z' },
    { id: 'f6a9b3c4-8e72-41d5-9f08-3c7e1a5b9d26', name: 'Dana Okafor', email: 'dana.okafor@netfoundry.io',
      roleGrants: [{ roleId: 'role-billing-readonly', canGrant: false }],
      status: 'invited', mfaEnabled: false, createdAt: '2026-09-23T09:12:00Z' },
    { id: 'a2b5c8d1-4f96-4a73-b1e5-8d0c2f6a9e41', name: 'Sven Lindqvist', email: 'sven.lindqvist@netfoundry.io',
      roleGrants: [{ roleId: 'role-org-readonly', canGrant: false }],
      status: 'invited', mfaEnabled: false, createdAt: '2026-09-24T10:05:00Z' },
    { id: 'b8c1d4e7-9a35-4c62-8f14-5e2b7d0a3c98', name: 'Rachel Fontaine', email: 'rachel.fontaine@netfoundry.io',
      roleGrants: [{ roleId: 'role-ng-readonly', canGrant: false }],
      status: 'disabled', mfaEnabled: true, lastLoginAt: '2026-04-11T09:55:00Z', createdAt: '2025-01-22T11:00:00Z' },
  ]);

  /**
   * The signed-in operator. With no auth in fixtures, actions that the real API
   * attributes to the caller's token (claiming an alert writes an ack actor)
   * attribute to this user instead. Deliberately the same NFADMIN Root User id
   * already on the seeded ack/mute, so resolution stays consistent.
   */
  readonly currentUser: ConsoleUser = this.consoleUsers()[0];

  /**
   * POC MOCK — the org roles assignable when inviting a user, plus the two
   * org-level options the Edit Role Options modal edits: `isDefault` (applied
   * by the invite modal's "Use default roles") and `grantableByDefault` (presets
   * that invite's per-user "Can grant to others" toggle). Seeded as a genuine
   * mix so the modal doesn't open all-on or all-off.
   */
  readonly orgRoles = signal<OrgRole[]>([
    { id: 'role-billing-admin',    name: 'Billing Account Admin',     scope: ORG_SCOPE, strategy: 'Admin',     resourceType: 'Billing Account', roleType: 'Standard',
      description: 'Manage subscriptions, invoices, and payment methods.',   isDefault: true, grantableByDefault: true },
    { id: 'role-billing-readonly', name: 'Billing Account Read-Only', scope: ORG_SCOPE, strategy: 'Read-Only', resourceType: 'Billing Account', roleType: 'Standard',
      description: 'View billing and invoices without changing them.' },
    { id: 'role-ng-admin',         name: 'Network Group Admin',       scope: ORG_SCOPE, strategy: 'Admin',     resourceType: 'Network Group',   roleType: 'Standard',
      description: 'Create and manage networks within the network group.',   isDefault: true, grantableByDefault: true },
    { id: 'role-ng-readonly',      name: 'Network Group Read-Only',   scope: ORG_SCOPE, strategy: 'Read-Only', resourceType: 'Network Group',   roleType: 'Standard',
      description: 'View networks in the group without changing them.' },
    { id: 'role-org-admin',        name: 'Organization Admin',        scope: ORG_SCOPE, strategy: 'Admin',     resourceType: 'Organization',    roleType: 'Standard',
      description: 'Full control of the organization, its users, and billing.', isDefault: true, grantableByDefault: true },
    { id: 'role-org-readonly',     name: 'Organization Read-Only',    scope: ORG_SCOPE, strategy: 'Read-Only', resourceType: 'Organization',    roleType: 'Standard',
      description: 'View the console. No changes of any kind.' },
  ]);
}
