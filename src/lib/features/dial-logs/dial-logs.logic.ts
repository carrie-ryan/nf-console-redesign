import type { DialLogRecord } from '../../data-access/template-search.service';

/**
 * Framework-agnostic dial-log logic, lifted from customer-connect-console's
 * connector-activity-logs-content.component.ts (grouping + the failure-hint
 * decoder and error table), then reworded to CloudZiti's hybrid vocabulary:
 *
 *   CC term         → CloudZiti term
 *   ─────────────────────────────────
 *   Host Connector  → Terminator
 *   Dialer          → dialing identity
 *   App             → Service
 *   Listen Address  → Terminator address
 *
 * No Angular here — pure functions over DialLogRecord[] so the same logic can
 * be unit-tested and reused outside the drawer.
 */

/** Status filter for the activity table (matches CC's All / Success / Failed). */
export type DialLogStatusFilter = 'all' | 'success' | 'failed';

// ─── Failure TYPE classification ─────────────────────────────────────────────

/**
 * Coarse failure TYPE for the activity table's type filter — a router/host
 * error (a route existed and the router or host reported a failure) vs a
 * terminator/no-host error (the fabric found nothing to route to) vs anything
 * else. This is DISTINCT from `DialFailureSide` below: `side` is a
 * remediation-investigation axis (which is orthogonal — even inverted — to this
 * one, e.g. ROUTER_ERR_CONN_REFUSED is `side: 'terminator'` but TYPE 'router').
 * This is the single source of truth for the drawer filter and the dashboard
 * presets; never reuse `side` for it.
 */
export type DialFailureType = 'router' | 'terminator' | 'other';

/** Type filter for the activity table — 'all' plus the failure TYPEs. */
export type DialLogTypeFilter = 'all' | DialFailureType;

/**
 * Classify a raw `failure_cause` into its TYPE bucket by code shape:
 *   • ROUTER_ERR_* and ROUTER_RESPONSE_TIMEOUT → 'router' (a route existed;
 *     router/host reported the failure) — EXCEPT ROUTER_ERR_DIAL_CANCELLED,
 *     which is identity-side (the client aborted), not a router-health failure.
 *   • NO_TERMINATORS / NO_ONLINE_TERMINATORS / NO_HOSTS / NO_PATH → 'terminator'
 *     (nothing to route to — same "no host" family).
 *   • unknown / unmatched / successes (no cause) → 'other'.
 */
export function dialFailureType(cause: string | undefined): DialFailureType {
  if (!cause) return 'other';
  switch (cause) {
    case 'NO_TERMINATORS':
    case 'NO_ONLINE_TERMINATORS':
    case 'NO_HOSTS':
    case 'NO_PATH':
      return 'terminator';
    case 'ROUTER_ERR_DIAL_CANCELLED':
      return 'other';
    case 'ROUTER_RESPONSE_TIMEOUT':
      return 'router';
    default:
      return cause.startsWith('ROUTER_ERR_') ? 'router' : 'other';
  }
}

// ─── Grouping ──────────────────────────────────────────────────────────────

/** A roll-up of dial events targeting the same CloudZiti service. */
export interface DialLogGroup {
  key: string;
  serviceName: string | null;
  records: DialLogRecord[];
  count: number;
  successCount: number;
  failedCount: number;
  latestTimestampMs: number;
}

/**
 * Stable per-service group key — service id first (ground truth), service name
 * as fallback, and finally the terminator + event type so records with neither
 * id nor name still coalesce rather than each forming a singleton group.
 * Lifted from CC's `groupKey`.
 */
function groupKey(r: DialLogRecord): string {
  if (r.serviceId) return `svc:${r.serviceId}`;
  if (r.serviceName) return `svcname:${r.serviceName}`;
  return `host:${r.hostName ?? ''}|${r.networkEventType}`;
}

/**
 * Group dial records by service, tallying success/failure counts and tracking
 * the latest timestamp per group. Groups are returned newest-first (by latest
 * dial). Lifted from CC's `displayGroups` + `groupComparator` (lastDial desc).
 */
export function groupDialLogs(records: DialLogRecord[]): DialLogGroup[] {
  const groups = new Map<string, DialLogGroup>();
  for (const r of records) {
    const key = groupKey(r);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        serviceName: r.serviceName ?? null,
        records: [],
        count: 0,
        successCount: 0,
        failedCount: 0,
        latestTimestampMs: 0,
      };
      groups.set(key, g);
    }
    g.records.push(r);
    g.count++;
    if (r.success === true) g.successCount++;
    if (r.success === false) g.failedCount++;
    if (r.timestampMs > g.latestTimestampMs) g.latestTimestampMs = r.timestampMs;
  }
  const out = Array.from(groups.values());
  // Newest activity first; child records newest-first within each group.
  out.sort((a, b) => b.latestTimestampMs - a.latestTimestampMs);
  for (const g of out) g.records.sort((a, b) => b.timestampMs - a.timestampMs);
  return out;
}

// ─── Failure-hint decoder ────────────────────────────────────────────────────

/**
 * Coarse "which side to investigate first" classification for a dial failure.
 * Reworded from CC's DialFailureSide (host/dialer/config/unknown).
 */
export type DialFailureSide = 'terminator' | 'identity' | 'config' | 'unknown';

/**
 * One run of headline text. `mono: true` flags a literal value (the terminator
 * address) so the view can render it in a monospace face inline. Kept as
 * segments (rather than a flat string) so a later phase can promote a segment
 * to a clickable link without string surgery — B1 renders text only.
 */
export interface FailureHeadlineSegment {
  text: string;
  mono?: boolean;
}

export interface DialFailureHint {
  side: DialFailureSide;
  /** Plain-language summary of the failure. */
  headline: FailureHeadlineSegment[];
  /** Multi-sentence explanation with a remediation hint (tooltip text). */
  explanation: string;
}

/** What each headline builder can weave into its message. */
interface HeadlineContext {
  serviceName: string | null;
  /** Dialing identity (the client endpoint that initiated the dial). */
  identity: string | null;
  /** Terminator address — the target address the host was configured to reach. */
  terminator: string | null;
}

interface FailureHintTemplate {
  side: DialFailureSide;
  buildHeadline: (ctx: HeadlineContext) => FailureHeadlineSegment[];
  explanation: string;
}

/**
 * Router/terminator failure-code → human translation. Lifted verbatim in
 * structure from CC's FAILURE_HINT_TEMPLATES_BY_CODE; headlines and
 * explanations are reworded to match cloudziti-error-remediation-table.md and
 * the hybrid vocabulary (Service / dialing identity / host / Terminator
 * address).
 *
 * ACTOR RULE: "terminator" names ONLY the binding record itself (an active
 * terminator, re-publishing a terminator). It is NEVER the actor that
 * reaches / serves / refuses / hosts — those actions belong to "the host",
 * "the hosting identity", or "the service". `side: 'terminator'` is an
 * internal classification key (host-side), not rendered copy.
 *
 * Codes are the literal `failure_cause` strings the ncfabriccircuits index
 * records; unknown codes fall through to UNKNOWN_FAILURE_HINT_TEMPLATE so
 * every failed row still gets a headline.
 */
const FAILURE_HINT_TEMPLATES_BY_CODE: Record<string, FailureHintTemplate> = {
  ROUTER_ERR_DIAL_TIMED_OUT: {
    side: 'terminator',
    buildHeadline: (ctx) =>
      ctx.terminator
        ? [
            { text: 'The host couldn’t reach ' },
            { text: ctx.terminator, mono: true },
            { text: ' in time' },
          ]
        : [{ text: 'The host couldn’t reach the target address in time' }],
    explanation:
      'The dial reached the hosting identity but its forward to the target address timed out. Verify the service at that address is running, that it’s reachable from the host’s network, and that no firewall along the path is dropping the connection.',
  },
  ROUTER_ERR_CONN_REFUSED: {
    side: 'terminator',
    buildHeadline: (ctx) =>
      ctx.terminator
        ? [
            { text: 'The service at ' },
            { text: ctx.terminator, mono: true },
            { text: ' refused the connection' },
          ]
        : [{ text: 'The service at the host’s target address refused the connection' }],
    explanation:
      'The service at the host’s target address actively refused the connection — usually it isn’t listening on the expected port, or its process isn’t running. Confirm the service is up at the shown address.',
  },
  ROUTER_ERR_REJECTED_BY_APPLICATION: {
    side: 'terminator',
    buildHeadline: (ctx) =>
      ctx.terminator
        ? [
            { text: 'The target service at ' },
            { text: ctx.terminator, mono: true },
            { text: ' rejected the connection' },
          ]
        : [{ text: 'The target service rejected the connection' }],
    explanation:
      'The dial reached the target service and a TCP connection was established, but the application protocol layer rejected it. Common causes: authentication or authorization failure at the service, protocol/version mismatch on the port, a failed TLS handshake, or an access policy denying the request. The CloudZiti network side is healthy — check the target service’s own logs at the host’s site for the reason it refused.',
  },
  ROUTER_ERR_DIAL_FAILED: {
    side: 'terminator',
    buildHeadline: (ctx) =>
      ctx.terminator
        ? [
            { text: 'The host couldn’t complete its forward to ' },
            { text: ctx.terminator, mono: true },
          ]
        : [{ text: 'The host couldn’t complete its forward' }],
    explanation:
      'Generic forward failure on the host side — the hosting identity accepted the dial but couldn’t reach its target address. Inspect the host’s logs around the timestamp for the underlying error.',
  },
  ROUTER_ERR_DIAL_CANCELLED: {
    side: 'identity',
    buildHeadline: (ctx) =>
      ctx.identity
        ? [{ text: `${ctx.identity} cancelled the dial` }]
        : [{ text: 'The dialing identity cancelled the dial' }],
    explanation:
      'The dialing identity aborted before the dial completed — usually the client process disconnected, or its endpoint restarted mid-dial. Recurring cancellations may indicate an unstable client or aggressive client timeouts.',
  },
  ROUTER_RESPONSE_TIMEOUT: {
    side: 'terminator',
    buildHeadline: () => [{ text: 'The host didn’t respond before the dial timed out' }],
    explanation:
      'A route was set up but the hosting side never answered within the timeout. Usually the host is offline, overloaded, or unreachable across the fabric — or an over-broad service policy routed the dial to an identity that doesn’t actually host this service. Confirm a healthy host for the service, and that its bind scope targets only identities that serve it.',
  },
  NO_HOSTS: {
    side: 'config',
    buildHeadline: (ctx) =>
      ctx.serviceName
        ? [{ text: `No identity is online to host the ${ctx.serviceName} service` }]
        : [{ text: 'No identity is online to host this service' }],
    explanation:
      'The service has no hosting identity currently online and eligible to serve the dialing identity. Bring a host online for this service, or check that the service policy routes this dialing identity to an existing host.',
  },
  NO_TERMINATORS: {
    side: 'config',
    buildHeadline: (ctx) =>
      ctx.serviceName
        ? [{ text: `No identity is currently hosting the ${ctx.serviceName} service` }]
        : [{ text: 'No identity is currently hosting this service' }],
    explanation:
      'The fabric found no active terminator for this service. The hosting identity may be offline, it hasn’t re-published its terminator since its last restart, or none is bound to the service. Confirm at least one identity is online and hosting the service.',
  },
  NO_ONLINE_TERMINATORS: {
    side: 'config',
    buildHeadline: (ctx) =>
      ctx.serviceName
        ? [{ text: `No online host for the ${ctx.serviceName} service` }]
        : [{ text: 'No online host for this service' }],
    explanation:
      'The service has a registered terminator, but no hosting identity is online right now — so there’s no live host to route the dial to. The host may be offline, restarting, or reconnected without re-publishing its terminator; confirm the hosting identity for this service is online.',
  },
  NO_PATH: {
    side: 'config',
    buildHeadline: (ctx) =>
      ctx.serviceName
        ? [{ text: `No network path to a host for the ${ctx.serviceName} service` }]
        : [{ text: 'No network path to a host for this service' }],
    explanation:
      'The fabric couldn’t compute a route from the dialing identity to any host serving this service. Typically every hosting identity for the service is offline or unreachable, none is bound to the service, or a fabric link between the sites is down. Bring a host online (or fix its binding) and verify connectivity between the dialing-identity and host sites.',
  },
};

const UNKNOWN_FAILURE_HINT_TEMPLATE: FailureHintTemplate = {
  side: 'unknown',
  buildHeadline: () => [{ text: 'Dial failed' }],
  explanation:
    'The router reported a failure without a recognized code. Cross-reference the raw code with the host and dialing-identity logs around the timestamp for context.',
};

/**
 * Decode a raw `failure_cause` code into a plain-language hint. Lifted from
 * CC's `decodeFailureHint`, including the prefix-normalizing lookup: the
 * upstream pipeline emits both `ROUTER_ERR_`-prefixed router codes and bare
 * terminator codes (NO_TERMINATORS, …), so we try the raw code, then strip/add
 * the prefix, then fall back to UNKNOWN.
 */
export function decodeFailureHint(
  cause: string | undefined,
  ctx: HeadlineContext,
): DialFailureHint | null {
  if (!cause) return null;
  const template =
    FAILURE_HINT_TEMPLATES_BY_CODE[cause] ??
    (cause.startsWith('ROUTER_ERR_')
      ? FAILURE_HINT_TEMPLATES_BY_CODE[cause.slice('ROUTER_ERR_'.length)]
      : FAILURE_HINT_TEMPLATES_BY_CODE[`ROUTER_ERR_${cause}`]) ??
    UNKNOWN_FAILURE_HINT_TEMPLATE;
  return {
    side: template.side,
    headline: template.buildHeadline(ctx),
    explanation: template.explanation,
  };
}

/** Convenience: decode the failure hint for a single record from its own fields. */
export function failureHintForRecord(r: DialLogRecord): DialFailureHint | null {
  if (r.success !== false) return null;
  return decodeFailureHint(r.failureCause, {
    serviceName: r.serviceName ?? null,
    identity: r.endpointName ?? null,
    terminator: r.terminatorRemote ?? null,
  });
}

/** Flatten a headline's segments to a plain string (for minimal B1 rendering). */
export function headlineText(headline: FailureHeadlineSegment[]): string {
  return headline.map((s) => s.text).join('');
}
