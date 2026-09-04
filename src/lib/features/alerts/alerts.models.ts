/**
 * Alerting-API domain models for the alerts feature. Kept in a feature-level
 * `.models.ts` (like discovery.models / concern.models) rather than inlined in
 * MockDataService, so both the feature components and the shared mock service
 * import the SAME shapes — MockDataService imports these types the same way
 * DrawerService imports DiscoveredFlow / ConcernListData from their features.
 *
 * Shapes are faithful to the alerting API: timestamps are ISO-8601 strings (or
 * null when the lifecycle stage hasn't happened yet), `labels` carry the
 * component identity (routerId/serviceName/…), and `evidence` is an
 * open detector-specific bag.
 */

export type AlertStatus = 'PENDING' | 'FIRING' | 'RESOLVED';
export type AlertSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';
export type ResolutionReason = 'CLEARED' | 'EXPIRED' | 'MANUAL' | null;

/** Acknowledgement sub-record — who claimed the alert and when, plus a note. */
export interface AlertAck {
  acked: boolean;
  identityId: string | null;
  at: string | null;
  note: string | null;
}

export interface Alert {
  id: string;
  alertType: string;
  detectorId: string;
  sourceId: string;
  /** 64-char hex dedup hash from the API's AlertView. */
  fingerprint: string;
  status: AlertStatus;
  severity: AlertSeverity;
  labels: Record<string, string>;
  /** Lifecycle timestamps — ISO-8601, null until that stage is reached. */
  firstAssertedAt: string | null;
  openedAt: string | null;
  lastAssertedAt: string | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  resolutionReason: ResolutionReason;
  stale: boolean;
  open: boolean;
  suppressed: boolean;
  suppressedBy: string | null;
  suppressionReason: string | null;
  evidence: Record<string, unknown>;
  ack: AlertAck;
}

/** One label-matching clause used by a Mute to select which alerts it covers. */
export interface Matcher {
  label: string;
  op: 'EQ' | 'NOT_EQ' | 'PREFIX';
  value: string;
}

export interface Mute {
  id: string;
  createdByIdentityId: string;
  createdAt: string;
  matchers: Matcher[];
  /** Alert types this mute applies to; [] or ['*'] means every type. */
  alertTypes: string[];
  /** null starts = effective now; null ends = indefinite. */
  starts: string | null;
  ends: string | null;
  reason: string | null;
  revokedAt: string | null;
  revokedByIdentityId: string | null;
}

/**
 * What the Mute-create form emits on confirm — the shape a POST /mutes would
 * carry. Mirrors the persisted Mute's targeting fields (matchers + alertTypes +
 * window) without the server-assigned/lifecycle bits (id, createdBy, revoked…).
 * Empty matchers = whole network; empty alertTypes = every type. null starts =
 * effective now; null ends = indefinite.
 */
export interface MuteRequest {
  matchers: Matcher[];
  alertTypes: string[];
  starts: string | null;
  ends: string | null;
  reason: string | null;
}

/** A lifecycle event on an alert, from the alerting API's event log. */
export type AlertEventType =
  | 'OPENED'
  | 'FIRED'
  | 'SEVERITY_CHANGED'
  | 'STALE'
  | 'RECOVERED'
  | 'ACKNOWLEDGED'
  | 'UNACKNOWLEDGED'
  | 'RESOLVED';

/** One event on an alert's timeline. `actor` is the console-user UUID that
 *  performed it (null for detector-driven events, and null for EVERY event on
 *  a derived timeline — see Timeline.derived). `detail` is an open bag. */
export interface AlertEvent {
  type: AlertEventType;
  at: string;
  sequence: number;
  actor: string | null;
  detail?: Record<string, unknown>;
}

/**
 * An alert's event history. `derived:false` is a real recorded log (actors and
 * ordering are authoritative). `derived:true` is RECONSTRUCTED after the fact —
 * exact ordering and who did what are not recoverable, so every event's `actor`
 * is null. Consumers must present the two distinctly (audit requirement).
 */
export interface Timeline {
  events: AlertEvent[];
  derived: boolean;
}

/**
 * The kind of network component an alert is about, derived from its alertType
 * prefix. `null` means the alert isn't scoped to a single component.
 */
export type ComponentType = 'Service' | 'Edge Router' | 'Link' | 'Detector' | null;

/**
 * Map a raw alertType code to the component kind it concerns, by prefix.
 * Shared across the feature so the list, detail, and (later) filters all agree.
 */
export function componentTypeForAlertType(alertType: string): ComponentType {
  if (alertType.startsWith('ziti.router.')) return 'Edge Router';
  if (alertType.startsWith('ziti.service.') || alertType.startsWith('service.')) return 'Service';
  if (alertType.startsWith('ziti.link.')) return 'Link';
  if (alertType.startsWith('ziti.detector.')) return 'Detector';
  return null;
}
