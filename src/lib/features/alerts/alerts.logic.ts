import {
  Alert,
  AlertSeverity,
  AlertStatus,
  Matcher,
  Mute,
  componentTypeForAlertType,
} from './alerts.models';

/**
 * Summary counts for the alerts stats header. All breakdown maps carry EVERY
 * key (zeros included) so the header can render a fixed tile grid without
 * null-checks.
 *
 * `byComponent` is a CLIENT-SIDE derivation, not a server field: the real
 * /alerts/stats endpoint returns `byAlertType`, and the component breakdown is
 * always computed here by mapping each alertType through
 * componentTypeForAlertType. Alerts whose type maps to null (no component —
 * e.g. a detector's own health) are counted in `total` but in NO component
 * bucket, so the four component counts need not sum to `total`.
 */
export interface AlertStats {
  total: number;
  byStatus: Record<AlertStatus, number>;
  bySeverity: Record<AlertSeverity, number>;
  byComponent: Record<'Service' | 'Edge Router' | 'Link' | 'Detector', number>;
}

/** Single source of truth for "open": an alert is open unless it's RESOLVED
 *  (i.e. PENDING or FIRING). Uses `status` — not the `open` boolean — so it's
 *  explicit and lines up with the Status filter enum. The default list AND the
 *  header stats both filter on this, so they can't disagree. */
export const isOpenAlert = (a: Alert): boolean => a.status !== 'RESOLVED';

/** Format an ISO-8601 timestamp the way the alerts list renders First Asserted
 *  (en-US, numeric date + time). '—' when null. Single source of truth so the
 *  list column and the detail pane stay consistent. */
export function formatAlertTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** A mute matcher as human text: "<label> <op-word> <value>"
 *  (EQ→is, NOT_EQ→is not, PREFIX→starts with). Single source of truth so the
 *  Muting tab and the Mutes list phrase matchers identically. */
export function matcherToWords(m: Matcher): string {
  const op = m.op === 'EQ' ? 'is' : m.op === 'NOT_EQ' ? 'is not' : 'starts with';
  return `${m.label} ${op} ${m.value}`;
}

/** Best display name for the component an alert is about, from its labels —
 *  the same value the list's Component column shows. null when unscoped. */
export function componentDisplayName(alert: Alert): string | null {
  return alert.labels['routerName']
    ?? alert.labels['serviceName']
    ?? alert.labels['routerId']
    ?? alert.labels['serviceId']
    ?? null;
}

/** The component id from an alert's labels (routerId / serviceId / …), or null. */
export function componentId(alert: Alert): string | null {
  return alert.labels['routerId'] ?? alert.labels['serviceId'] ?? null;
}

/** The alert's IDENTIFYING labels as EQ matchers — the stable ids that pin the
 *  SAME alert wherever it reasserts (routerId, serviceId, and any key ending in
 *  'Id'). Deliberately excludes display-name labels (routerName, serviceName…),
 *  which are fragile — a rename would slip the mute. Empty when the alert
 *  carries no stable identifier (e.g. a detector-health alert about no
 *  component), in which case a "just this alert" mute can't be scoped tightly. */
export function identifyingLabels(alert: Alert): Matcher[] {
  return Object.entries(alert.labels)
    .filter(([key]) => key.endsWith('Id'))
    .map(([label, value]) => ({ label, op: 'EQ' as const, value }));
}

/** Derive the stats-header counts from the current alert set. Pure. */
export function computeAlertStats(alerts: Alert[]): AlertStats {
  const byStatus: Record<AlertStatus, number> = { PENDING: 0, FIRING: 0, RESOLVED: 0 };
  const bySeverity: Record<AlertSeverity, number> = { CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
  const byComponent: Record<'Service' | 'Edge Router' | 'Link' | 'Detector', number> = {
    'Service': 0,
    'Edge Router': 0,
    'Link': 0,
    'Detector': 0,
  };

  for (const alert of alerts) {
    byStatus[alert.status]++;
    bySeverity[alert.severity]++;
    // Centralized mapping — a null result means the alert is about no component;
    // it stays in `total` but lands in no bucket.
    const component = componentTypeForAlertType(alert.alertType);
    if (component !== null) byComponent[component]++;
  }

  return { total: alerts.length, byStatus, bySeverity, byComponent };
}

// ─── Suppression (DERIVED, never trust a stored `suppressed`) ──────────────
/** Is this mute in force at `now`? Not revoked, already started, not yet ended.
 *  null starts = effective now; null ends = indefinite. */
export function isMuteActive(mute: Mute, now: Date): boolean {
  if (mute.revokedAt !== null) return false;
  if (mute.starts !== null && new Date(mute.starts) > now) return false;
  if (mute.ends !== null && new Date(mute.ends) <= now) return false;
  return true;
}

/** Does this mute's targeting cover this alert? The type must match (empty
 *  alertTypes or a '*' wildcard = every type) AND every matcher must hold
 *  against the alert's labels. Empty matchers = the whole type scope. */
export function muteCovers(mute: Mute, alert: Alert): boolean {
  const typeCovered =
    mute.alertTypes.length === 0 ||
    mute.alertTypes.includes('*') ||
    mute.alertTypes.includes(alert.alertType);
  if (!typeCovered) return false;

  return mute.matchers.every((m) => {
    const actual = alert.labels[m.label];
    switch (m.op) {
      case 'EQ':     return actual === m.value;
      // A missing label satisfies NOT_EQ — "not X" is true when there's no X.
      case 'NOT_EQ': return actual !== m.value;
      case 'PREFIX': return (actual ?? '').startsWith(m.value);
    }
  });
}

/** Derive an alert's suppression from the live mutes — the first ACTIVE covering
 *  mute wins. Never reads the alert's stored `suppressed*` fields. */
export function computeSuppression(
  alert: Alert,
  mutes: Mute[],
  now: Date,
): { suppressed: boolean; suppressedBy: string | null; suppressionReason: string | null } {
  const hit = mutes.find((m) => isMuteActive(m, now) && muteCovers(m, alert));
  return hit
    ? { suppressed: true, suppressedBy: hit.id, suppressionReason: hit.reason }
    : { suppressed: false, suppressedBy: null, suppressionReason: null };
}
