import { Component, computed, inject, input, signal } from '@angular/core';
import { PillComponent, PillVariant } from '../../../shared/components/pill/pill.component';
import { Alert, AlertEvent, AlertEventType, AlertSeverity, Matcher, Mute, Timeline, componentTypeForAlertType } from '../alerts.models';
import { componentDisplayName, componentId, formatAlertTimestamp, matcherToWords } from '../alerts.logic';
import { MockDataService } from '../../../shared/services/mock-data.service';

/** Resolved ownership passed down from the list (parent resolves it once). */
type AlertOwnership = { kind: 'claimed' | 'muted'; name: string; email: string | null };

/** Detail-pane tabs. Bodies are placeholders this pass (B2 fills them). */
type DetailTab = 'details' | 'source' | 'muting' | 'history' | 'advanced';

/**
 * Split-pane detail for a single alert. A structural skeleton: header (type,
 * pager, close), a tab strip, and empty tab bodies — the tab CONTENT lands in
 * B2. Parent-driven actions arrive as callback INPUTS (repo convention — no
 * output()); `this` is bound by the parent when it passes the methods in.
 */
@Component({
  selector: 'app-alert-detail',
  standalone: true,
  imports: [PillComponent],
  templateUrl: './alert-detail.component.html',
  styleUrl: './alert-detail.component.css',
})
export class AlertDetailComponent {
  readonly alert = input.required<Alert>();
  /** Resolved by the parent list (ownership → consoleUser); the pane does not
   *  re-resolve the actor. null when unowned. */
  readonly ownership = input<AlertOwnership | null>(null);
  /** Covering mute + its creator, resolved by the parent (never re-queried
   *  here). null mute = alert not suppressed OR the mute id didn't resolve. */
  readonly mute = input<Mute | null>(null);
  readonly muteCreator = input<{ name: string; email: string | null } | null>(null);
  /** Event history for this alert, resolved by the parent from the fixture and
   *  passed in (the pane never reads alertTimelines itself). null = no recorded
   *  history → the History tab shows an empty state. */
  readonly timeline = input<Timeline | null>(null);
  readonly onClose = input.required<() => void>();
  readonly onPrev = input.required<() => void>();
  readonly onNext = input.required<() => void>();
  /** Pager position over the list the user is looking at; null = not in it. */
  readonly position = input<{ index: number; total: number } | null>(null);

  readonly activeTab = signal<DetailTab>('details');
  readonly tabs: { id: DetailTab; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'source', label: 'Source' },
    { id: 'muting', label: 'Muting' },
    { id: 'history', label: 'History' },
    { id: 'advanced', label: 'Advanced' },
  ];

  /** Prev/next are only meaningful when the alert sits in the filtered list. */
  readonly pagerEnabled = computed<boolean>(() => this.position() !== null);

  setTab(tab: DetailTab): void {
    this.activeTab.set(tab);
  }

  /** Human display name for a raw alertType code (mirrors the list). */
  alertTypeDisplay(alertType: string): string {
    switch (alertType) {
      case 'ziti.router.flapping':     return 'Router Flapping';
      case 'ziti.service.unreachable': return 'Service Unreachable';
      default: {
        const tail = alertType.split('.').pop() ?? alertType;
        return tail.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
  }

  componentType(alertType: string): string | null {
    return componentTypeForAlertType(alertType);
  }

  /** Component display name / id — shared helpers, same values as the list. */
  componentName(alert: Alert): string | null {
    return componentDisplayName(alert);
  }

  componentId(alert: Alert): string | null {
    return componentId(alert);
  }

  /** Same timestamp formatter the list uses for First Asserted. */
  formatTimestamp(iso: string | null): string {
    return formatAlertTimestamp(iso);
  }

  /** Label bag as ordered [key, value] rows for the Advanced tab. */
  labelEntries(): [string, string][] {
    return Object.entries(this.alert().labels);
  }

  /** Evidence bag as [key, value] rows; value stringified for display. */
  evidenceEntries(): [string, string][] {
    return Object.entries(this.alert().evidence).map(
      ([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string],
    );
  }

  // ─── Muting-tab display helpers ──────────────────────────────────────
  /** Mute's alert types, or 'Every type' when empty or the ['*'] wildcard. */
  muteAlertTypes(mute: Mute): string {
    const types = mute.alertTypes;
    if (types.length === 0 || (types.length === 1 && types[0] === '*')) return 'Every type';
    return types.join(', ');
  }

  /** A matcher as human text — delegates to the shared helper so the Muting
   *  tab and the Mutes list phrase matchers identically. */
  matcherText(m: Matcher): string {
    return matcherToWords(m);
  }

  /** Mute window bound → 'Now'/'Indefinite' for nulls, else formatted. */
  muteStart(mute: Mute): string {
    return mute.starts === null ? 'Now' : formatAlertTimestamp(mute.starts);
  }

  muteEnd(mute: Mute): string {
    return mute.ends === null ? 'Indefinite' : formatAlertTimestamp(mute.ends);
  }

  // ─── History-tab helpers ─────────────────────────────────────────────
  private readonly data = inject(MockDataService);

  /** Event type → readable label (never the raw enum). */
  eventLabel(type: AlertEventType): string {
    switch (type) {
      case 'OPENED':           return 'Opened';
      case 'FIRED':            return 'Fired';
      case 'SEVERITY_CHANGED': return 'Severity changed';
      case 'STALE':            return 'Went stale';
      case 'RECOVERED':        return 'Recovered';
      case 'ACKNOWLEDGED':     return 'Acknowledged';
      case 'UNACKNOWLEDGED':   return 'Unacknowledged';
      case 'RESOLVED':         return 'Resolved';
    }
  }

  /** Resolve an event actor UUID to a display NAME via the SAME consoleUser
   *  collection used everywhere else (falls back to the raw id). Callers only
   *  invoke this when actor is non-null — a null actor renders no line at all. */
  eventActorName(event: AlertEvent): string | null {
    if (event.actor === null) return null;
    const u = this.data.consoleUsers().find((cu) => cu.id === event.actor);
    return u?.name ?? event.actor;
  }

  severityVariant(severity: AlertSeverity): PillVariant {
    switch (severity) {
      case 'CRITICAL': return 'severity-critical';
      case 'MAJOR':    return 'severity-major';
      case 'MINOR':    return 'severity-minor';
      case 'INFO':     return 'severity-info';
    }
  }
}
