/**
 * ACCESS REPORT — who may reach what, as an export. Pure and headless.
 *
 * One row per authorized (identity, service, direction): the identity and its
 * attributes, the service, Dial or Bind, every granting policy (matched by name, or the
 * rule that matched) with the posture checks it requires, and the pair's status
 * — can connect, or authorized but can't connect with the reason (the identity lens's
 * reasons). Status reads observed state (routers online, terminators, posture results),
 * so the export labels it as observed at generation time.
 *
 * Always LIVE: callers pass the store's live world, never the draft.
 *
 * Generation is a generator (accessReportSteps) so it can run in time slices with
 * progress (accessReportAsync); accessReport runs the same steps synchronously.
 */

import { resolve, type ResolvedPair, type TrifectaWorld } from '../authorization/trifecta-resolver';
import { entityMatchesRoles } from '../authorization/authorization-resolver';
import { indexFor } from '../authorization/world-index';
import type { Identity, Policy } from '../../shared/services/mock-data.service';
import { runChunked } from './draft/draft-diff';
import { bindReason, dialReason } from './identity-view.layout';
import { hostingFor, type Hosting } from './hosting';
import { bypassesFor, postureFor } from './posture';

export type ReportScope =
  | { kind: 'all' }
  | { kind: 'services'; ids: readonly string[] }
  | { kind: 'identities'; ids: readonly string[] };

export type Direction = 'Dial' | 'Bind';

export interface ReportGrant {
  policyId: string;
  policyName: string;
  by: 'name' | 'rule';
  /** "by name", or the rule that matched: "#admins" / "all of #servers, #prod". */
  match: string;
  /** Names of the posture checks this policy requires, in world order. */
  requiredChecks: string[];
}

/** Dial rows: can connect / authorized, can't connect. Bind rows: the host's state on
 *  the service — active, standby, authorized but not serving, or can't host (and why). */
export type ReportStatus =
  | 'can connect'
  | "authorized, can't connect"
  | 'active host'
  | 'standby host'
  | 'authorized, not serving'
  | "authorized, can't host";

export interface ReportBypass {
  /** The check skipped… */
  checkName: string;
  /** …through this granting policy, which doesn't require it (posture panel's choice). */
  viaPolicyName: string;
}

export interface AccessRow {
  identityId: string;
  identityName: string;
  identityAttributes: readonly string[];
  serviceId: string;
  serviceName: string;
  direction: Direction;
  /** world.policies order. */
  grants: ReportGrant[];
  status: ReportStatus;
  /** Why it can't connect / can't host; null otherwise. */
  reason: string | null;
  /** Checks the identity skips on this track, each with the policy that lets it in without. */
  bypassed: ReportBypass[];
}

export interface ReportProgress {
  /** Services done. */
  done: number;
  total: number;
  rows: number;
}

/** Pairs resolved between progress reports (and so between time slices). */
const PAIRS_PER_STEP = 200;

function ruleText(p: Policy): string {
  const terms = p.identityRoles.filter((r) => !r.startsWith('@'));
  if (terms.length <= 1) return terms.join('');
  return `${p.semantic === 'AllOf' ? 'all of' : 'any of'} ${terms.join(', ')}`;
}

function grantsOf(world: TrifectaWorld, policyIds: readonly string[], identity: Identity): ReportGrant[] {
  const ix = indexFor(world);
  return policyIds.map((id) => {
    const p = ix.policy(id)!;
    const named = p.identityRoles.some(
      (r) => r.startsWith('@') && entityMatchesRoles([r], 'AnyOf', identity.attributes ?? [], identity.name, identity.id),
    );
    return {
      policyId: p.id,
      policyName: p.name,
      by: named ? 'name' : 'rule',
      match: named ? 'by name' : ruleText(p),
      requiredChecks: ix.requiredChecks(p).map((c) => c.name),
    };
  });
}

function bindStatus(pair: ResolvedPair, world: TrifectaWorld, hosting: Hosting): { status: ReportStatus; reason: string | null } {
  const id = pair.identityId;
  if (hosting.activeHostIds.includes(id)) return { status: 'active host', reason: null };
  if (hosting.blockedHostIds.includes(id)) return { status: "authorized, can't host", reason: 'blocked by posture' };
  if (hosting.servingHosts.some((h) => h.identityId === id)) return { status: 'standby host', reason: null };
  // Not serving: say why it couldn't (no route, posture) — else it simply isn't.
  const reason = bindReason(pair, world);
  return reason ? { status: "authorized, can't host", reason } : { status: 'authorized, not serving', reason: null };
}

function rowFor(world: TrifectaWorld, pair: ResolvedPair, identity: Identity, direction: Direction, hosting: () => Hosting): AccessRow {
  const ix = indexFor(world);
  const service = ix.service(pair.serviceId)!;
  const track = direction === 'Dial' ? 'dial' : 'bind';
  let status: { status: ReportStatus; reason: string | null };
  if (direction === 'Dial') {
    const reason = dialReason(pair, world);
    status = { status: reason ? "authorized, can't connect" : 'can connect', reason };
  } else {
    status = bindStatus(pair, world, hosting());
  }
  const bypassed = bypassesFor(postureFor(identity.id, service.id, track, world), identity.id).map((b) => ({
    checkName: ix.check(b.checkId)?.name ?? b.checkId,
    viaPolicyName: ix.policy(b.viaPolicyId)?.name ?? b.viaPolicyId,
  }));
  return {
    identityId: identity.id,
    identityName: identity.name,
    identityAttributes: identity.attributes ?? [],
    serviceId: service.id,
    serviceName: service.name,
    direction,
    grants: grantsOf(world, pair[track].viaPolicies, identity),
    ...status,
    bypassed,
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en') || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The report as steps. Sorted: service name A–Z, then Dial before Bind, then identity
 * name A–Z. Per service in scope, only the identities its policies select (limited to
 * the scope's identities) are resolved. Yields progress every PAIRS_PER_STEP pairs and
 * after each service.
 */
export function* accessReportSteps(world: TrifectaWorld, scope: ReportScope): Generator<ReportProgress, AccessRow[], void> {
  const ix = indexFor(world);
  const services = (scope.kind === 'services' ? world.services.filter((s) => scope.ids.includes(s.id)) : [...world.services]).sort(byName);
  const onlyIdentities = scope.kind === 'identities' ? new Set(scope.ids) : null;
  const identities = [...world.identities].sort(byName);
  const rows: AccessRow[] = [];
  const total = services.length;
  yield { done: 0, total, rows: 0 };
  let done = 0;
  for (const service of services) {
    // Only identities some policy of the service selects can be authorized for it.
    const selected = new Set<string>();
    for (const p of ix.policiesForService(service.id)) {
      for (const id of ix.identityIdsMatching(p.identityRoles, p.semantic)) if (!onlyIdentities || onlyIdentities.has(id)) selected.add(id);
    }
    let hosting: Hosting | null = null;
    const hostingOnce = () => (hosting ??= hostingFor(service.id, world));
    const dial: AccessRow[] = [];
    const bind: AccessRow[] = [];
    let n = 0;
    for (const identity of identities) {
      if (!selected.has(identity.id)) continue;
      const pair = resolve(identity.id, service.id, world);
      if (pair.dial.authorized) dial.push(rowFor(world, pair, identity, 'Dial', hostingOnce));
      if (pair.bind.authorized) bind.push(rowFor(world, pair, identity, 'Bind', hostingOnce));
      if (++n % PAIRS_PER_STEP === 0) yield { done, total, rows: rows.length + dial.length + bind.length };
    }
    rows.push(...dial, ...bind);
    done++;
    yield { done, total, rows: rows.length };
  }
  return rows;
}

/** The whole report, synchronously. */
export function accessReport(world: TrifectaWorld, scope: ReportScope): AccessRow[] {
  const steps = accessReportSteps(world, scope);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** The report in time slices, yielding to the browser between them; null once cancelled. */
export function accessReportAsync(
  world: TrifectaWorld,
  scope: ReportScope,
  onProgress: (p: ReportProgress) => void = () => undefined,
  cancelled: () => boolean = () => false,
): Promise<AccessRow[] | null> {
  return runChunked(accessReportSteps(world, scope), onProgress, cancelled);
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export interface ReportMeta {
  /** ISO time the report was generated — and the status observed. */
  generatedAt: string;
  network: string;
  /** "Configuration as of c-3 (2026-10-09T15:00:00.000Z)" / "Configuration: no commits this session". */
  configuration: string;
  /** "All services" / "Services: git-repo" / "Identities: bob@corp.com" */
  scope: string;
}

/** "All services", "Services: git-repo, api-prod", "Identities: bob@corp.com". */
export function scopeLabel(world: TrifectaWorld, scope: ReportScope): string {
  const ix = indexFor(world);
  if (scope.kind === 'all') return 'All services';
  if (scope.kind === 'services') return `Services: ${scope.ids.map((id) => ix.service(id)?.name ?? id).join(', ')}`;
  return `Identities: ${scope.ids.map((id) => ix.identity(id)?.name ?? id).join(', ')}`;
}

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const CSV_COLUMNS = [
  'identity',
  'identity_attributes',
  'service',
  'direction',
  'granting_policies',
  'matched_by',
  'required_posture_checks',
  'status_observed_at_generation',
  'reason',
  'posture_bypassed',
] as const;

/** The header's configuration line: the latest History entry, or none this session. */
export function configurationLine(latest: { id: string; at: string } | null): string {
  return latest ? `Configuration as of ${latest.id} (${latest.at})` : 'Configuration: no commits this session';
}

/** Rows serialised between yields (and so between time slices). */
const CSV_ROWS_PER_STEP = 2000;

function csvLine(r: AccessRow): string {
  return [
    r.identityName,
    r.identityAttributes.join(' '),
    r.serviceName,
    r.direction,
    r.grants.map((g) => g.policyName).join('; '),
    r.grants.map((g) => g.match).join('; '),
    r.grants.map((g) => (g.requiredChecks.length ? g.requiredChecks.join('+') : 'none')).join('; '),
    r.status,
    r.reason ?? '',
    r.bypassed.map((b) => `${b.checkName} (via ${b.viaPolicyName})`).join('; '),
  ]
    .map(cell)
    .join(',');
}

/**
 * The CSV as steps, in parts (concatenated, they are the file): the header block of
 * '#' comment lines (generated at, network, scope, row count, the status note), the
 * column row, then CSV_ROWS_PER_STEP rows per part. Yields rows done after each part.
 * Multi-valued cells are '; '-joined; matched_by and required_posture_checks follow
 * granting_policies' order, a policy's checks '+'-joined ("none" when it has none).
 */
export function* accessReportCsvSteps(rows: readonly AccessRow[], meta: ReportMeta): Generator<number, string[], void> {
  const parts = [
    [
      '# Access report',
      `# Generated at: ${meta.generatedAt}`,
      `# Network: ${meta.network}`,
      `# ${meta.configuration}`,
      `# Scope: ${meta.scope}`,
      `# Rows: ${rows.length}`,
      `# Status is as observed at generation time (${meta.generatedAt}): router status, hosts and posture results change.`,
      CSV_COLUMNS.join(','),
    ].join('\n') + '\n',
  ];
  for (let i = 0; i < rows.length; i += CSV_ROWS_PER_STEP) {
    parts.push(rows.slice(i, i + CSV_ROWS_PER_STEP).map(csvLine).join('\n') + '\n');
    yield Math.min(rows.length, i + CSV_ROWS_PER_STEP);
  }
  return parts;
}

/** The whole CSV as one string (see accessReportCsvSteps). */
export function accessReportCsv(rows: readonly AccessRow[], meta: ReportMeta): string {
  const steps = accessReportCsvSteps(rows, meta);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value.join('');
  }
}

/** "access-report-corp-prod-git-repo-2026-10-09T15-20-00.csv" */
export function reportFileName(meta: ReportMeta, slug: string): string {
  const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `access-report-${safe(meta.network)}-${safe(slug)}-${meta.generatedAt.slice(0, 19).replace(/:/g, '-')}.csv`;
}
