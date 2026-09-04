import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DialLogRecord } from '../../data-access/template-search.service';
import { DrawerService } from '../../shared/services/drawer.service';
import {
  DialLogGroup,
  DialLogStatusFilter,
  DialLogTypeFilter,
  dialFailureType,
  groupDialLogs,
  failureHintForRecord,
  headlineText,
} from './dial-logs.logic';

/**
 * Presentation-only grouped dial-log activity table — the reusable drawer body
 * (B1/B2). Takes raw `records` and groups them; hosts (the standalone
 * /dial-logs page and the slide-in drawer) own fetching + loading and just feed
 * records in. Logic, data, and copy are unchanged from B1/B2.
 *
 * DENSITY — model (b): on failure rows the headline + raw error code are ALWAYS
 * visible; the remediation explanation expands INLINE per row via a chevron
 * (NOT a hover tooltip). This intentionally differs from CC's tooltip — an
 * accessibility improvement: the remediation text is reachable by keyboard and
 * stays on screen while the operator reads it.
 */
@Component({
  selector: 'app-dial-logs-content',
  standalone: true,
  imports: [],
  templateUrl: './dial-logs-content.component.html',
  styleUrl: './dial-logs-content.component.css',
})
export class DialLogsContentComponent {
  readonly records = input<DialLogRecord[]>([]);

  /** Initial status filter, chosen by the opener — 'failed' when summoned from
   *  an alert so the user lands on failures, 'all' otherwise. */
  readonly initialStatus = input<DialLogStatusFilter>('all');

  /** Initial failure-TYPE filter, chosen by the opener — e.g. 'terminator' when
   *  summoned from the no-terminators critical-signal card, 'all' otherwise. */
  readonly initialType = input<DialLogTypeFilter>('all');

  /** Show the "View all alerts" link at the top of the body. Off by default so
   *  the standalone /dial-logs page (which reuses this component) doesn't show
   *  it — only the drawer opener (service-activity) turns it on. */
  readonly showAllAlertsLink = input<boolean>(false);

  private readonly drawer = inject(DrawerService);
  private readonly router = inject(Router);

  /** Close the drawer, then go to the full alerts list. Closing first so the
   *  drawer isn't left open on top of the /alerts page. */
  viewAllAlerts(): void {
    this.drawer.close();
    this.router.navigate(['/alerts']);
  }

  readonly groups = computed<DialLogGroup[]>(() => groupDialLogs(this.records()));

  readonly statusOptions: { id: DialLogStatusFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'success', label: 'Success' },
    { id: 'failed', label: 'Failed' },
  ];

  readonly typeOptions: { id: DialLogTypeFilter; label: string }[] = [
    { id: 'all', label: 'All types' },
    { id: 'router', label: 'Router' },
    { id: 'terminator', label: 'Terminator' },
    { id: 'other', label: 'Other' },
  ];

  /** User-switchable status filter, seeded from `initialStatus` and reset to it
   *  whenever the opener changes (linkedSignal). Controls which CHILD ROWS
   *  render — it never affects the ratio-meter counts, which summarize the
   *  whole group off the unfiltered records. */
  readonly statusFilter = linkedSignal<DialLogStatusFilter>(() => this.initialStatus());

  /** User-switchable failure-TYPE filter, seeded from `initialType`. Mirrors
   *  `statusFilter`: narrows CHILD ROWS (by dialFailureType of each failure),
   *  never the ratio-meter counts. Applies to FAILURES only — successful rows
   *  have no failure type, so a specific type hides them (they show under
   *  'all'). */
  readonly typeFilter = linkedSignal<DialLogTypeFilter>(() => this.initialType());

  private readonly expandedGroups = signal<Set<string>>(new Set());
  private readonly expandedExplanations = signal<Set<string>>(new Set());

  /** Child rows to render for a group under the current status + type filters —
   *  a row shows only if it matches BOTH. Groups and their ratio meters are
   *  always computed from the full record set, so the denominator ("1 of 5
   *  failed") stays true even when a filter is active. The type filter targets
   *  FAILURES: a specific type requires `success === false` (successful/neutral
   *  rows have no failure type, so they show only under type 'all'). */
  visibleChildren(g: DialLogGroup): DialLogRecord[] {
    const status = this.statusFilter();
    const type = this.typeFilter();
    return g.records.filter((r) => {
      if (status === 'failed' && r.success !== false) return false;
      if (status === 'success' && r.success !== true) return false;
      if (type !== 'all') {
        if (r.success !== false) return false;
        if (dialFailureType(r.failureCause) !== type) return false;
      }
      return true;
    });
  }

  /** Groups to render. When any filter narrows the view, groups with no child
   *  row matching the active filters are hidden (so filtering to 'terminator'
   *  doesn't leave behind groups whose only failures are router errors). Under
   *  All/All every group shows, matching the prior behavior. */
  readonly visibleGroups = computed<DialLogGroup[]>(() => {
    const groups = this.groups();
    if (this.statusFilter() === 'all' && this.typeFilter() === 'all') return groups;
    return groups.filter((g) => this.visibleChildren(g).length > 0);
  });

  /**
   * Live one-line summary of what's CURRENTLY shown, recomputed from the visible
   * (filtered) set so it always tracks the pills — never the entry point that
   * opened the drawer. Hosts render this as the drawer subheading; switching a
   * filter updates it immediately. Wording keys off the active type first (the
   * terminator view keeps the "no terminators" phrasing the old banner carried),
   * then the status filter. */
  readonly subheading = computed<string>(() => {
    const status = this.statusFilter();
    const type = this.typeFilter();
    const groups = this.visibleGroups();
    const services = groups.length;
    const rows = groups.reduce((n, g) => n + this.visibleChildren(g).length, 0);
    const svc = `${services} ${services === 1 ? 'service' : 'services'}`;
    const failures = `${rows} ${rows === 1 ? 'failure' : 'failures'}`;

    if (rows === 0) return 'No matching dials';
    if (type === 'terminator') return `${svc} with no terminators`;
    if (type === 'router') return `${rows} router ${rows === 1 ? 'failure' : 'failures'} across ${svc}`;
    if (type === 'other') return `${rows} other ${rows === 1 ? 'failure' : 'failures'} across ${svc}`;
    // type === 'all' → wording follows the status filter.
    if (status === 'success')
      return `${rows} successful ${rows === 1 ? 'dial' : 'dials'} across ${svc}`;
    if (status === 'failed') return `${failures} across ${svc}`;
    return `${rows} ${rows === 1 ? 'dial' : 'dials'} across ${svc}`;
  });

  // ─── Group expand/collapse ──────────────────────────────────────────
  isExpanded(key: string): boolean {
    return this.expandedGroups().has(key);
  }

  toggleGroup(key: string): void {
    this.expandedGroups.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ─── Per-row remediation explanation expand (density model b) ────────
  private recordKey(r: DialLogRecord): string {
    return `${r.timestampMs}|${r.networkEventType}|${r.endpointName ?? ''}`;
  }

  isExplanationExpanded(r: DialLogRecord): boolean {
    return this.expandedExplanations().has(this.recordKey(r));
  }

  toggleExplanation(r: DialLogRecord): void {
    const key = this.recordKey(r);
    this.expandedExplanations.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ─── Presentation helpers (unchanged from B1/B2) ─────────────────────
  groupStatusText(g: DialLogGroup): string {
    if (g.failedCount === 0) return `${g.count} successful`;
    return `${g.failedCount} of ${g.count} failed`;
  }

  failureHeadline(r: DialLogRecord): string | null {
    const hint = failureHintForRecord(r);
    return hint ? headlineText(hint.headline) : null;
  }

  failureExplanation(r: DialLogRecord): string | null {
    return failureHintForRecord(r)?.explanation ?? null;
  }

  formatTimestamp(ms: number): string {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  groupLabel(g: DialLogGroup): string {
    return g.serviceName ?? '—';
  }
}
