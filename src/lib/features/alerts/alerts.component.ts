import { Component, WritableSignal, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ConsoleUser, MockDataService } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { PillComponent, PillVariant } from '../../shared/components/pill/pill.component';
import { AlertDetailComponent } from './alert-detail/alert-detail.component';
import { ModalShellComponent } from '../../shared/components/modal-shell/modal-shell.component';
import { ClaimAlertModalComponent } from './claim-alert-modal/claim-alert-modal.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { MuteAlertModalComponent } from './mute-alert-modal/mute-alert-modal.component';
import { RescheduleMuteModalComponent } from './reschedule-mute-modal/reschedule-mute-modal.component';
import { ActionMenuComponent, ActionMenuItem } from '../../shared/components/action-menu/action-menu.component';
import {
  Alert,
  AlertSeverity,
  AlertStatus,
  ComponentType,
  Matcher,
  Mute,
  MuteRequest,
  Timeline,
  componentTypeForAlertType,
} from './alerts.models';
import {
  componentDisplayName,
  computeAlertStats,
  computeSuppression,
  formatAlertTimestamp,
  isOpenAlert,
  matcherToWords,
} from './alerts.logic';

/** Component-scoped alias for the four non-null component kinds. */
type ConcreteComponent = Exclude<ComponentType, null>;
/** Which filter dropdown is currently open (null = none). */
type FilterName = 'status' | 'severity' | 'component' | 'ownership' | 'muted';

type AlertsTab = 'alerts' | 'mutes';

@Component({
  selector: 'app-alerts',
  standalone: true,
  imports: [EmptyStateComponent, PillComponent, AlertDetailComponent, ClaimAlertModalComponent, ConfirmDialogComponent, MuteAlertModalComponent, RescheduleMuteModalComponent, ActionMenuComponent],
  templateUrl: './alerts.component.html',
  styleUrl: './alerts.component.css',
})
export class AlertsComponent {
  readonly data = inject(MockDataService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly activeTab = signal<AlertsTab>('alerts');

  // ─── URL-addressable selection (?selected=<id>) ──────────────────────
  /** Bound from the `selected` query param via withComponentInputBinding().
   *  Reading route.snapshot instead would NOT update the split-pane as the
   *  selection changes — the input keeps this reactive. */
  readonly selected = input<string | undefined>();

  /** The DERIVED alert set the UI reads everywhere: each alert's suppression is
   *  recomputed from the LIVE mutes, not trusted from its stored `suppressed*`
   *  fields. A new/expired/revoked mute reactively flips the MUTED chip, the
   *  Muted filter, and the detail Muting tab across every covered alert. Writes
   *  (claim/resolve) still target data.alerts() by id — mutate the source,
   *  display the derived set. */
  readonly suppressedAlerts = computed<Alert[]>(() => {
    const now = new Date();
    const mutes = this.data.mutes();
    return this.data.alerts().map((a) => ({ ...a, ...computeSuppression(a, mutes, now) }));
  });

  /** The selected alert, or null when nothing is selected OR the param points
   *  at an id that no longer exists (treat a dangling id as no selection). */
  readonly selectedAlert = computed<Alert | null>(
    () => this.suppressedAlerts().find((a) => a.id === this.selected()) ?? null,
  );

  /** Pager position over filteredAlerts() — the list the user is looking at.
   *  null when the selected alert isn't in that list (e.g. deep-linked past
   *  active filters), which disables prev/next in the pane. */
  readonly paneposition = computed<{ index: number; total: number } | null>(() => {
    const sel = this.selectedAlert();
    if (!sel) return null;
    const list = this.filteredAlerts();
    const index = list.findIndex((a) => a.id === sel.id);
    return index === -1 ? null : { index, total: list.length };
  });

  /** Ownership for the selected alert, resolved by the SAME list resolver
   *  (ownership → consoleUser) and passed into the pane so it doesn't
   *  re-resolve the actor independently. */
  readonly selectedOwnership = computed(() => {
    const sel = this.selectedAlert();
    return sel ? this.ownership(sel) : null;
  });

  /** The mute covering the selected alert (id === suppressedBy), resolved once
   *  here and passed into the pane — the pane never re-queries mutes(). null
   *  when the alert isn't suppressed or the mute id doesn't resolve. */
  readonly selectedMute = computed(() => {
    const sel = this.selectedAlert();
    if (!sel || !sel.suppressed || !sel.suppressedBy) return null;
    return this.data.mutes().find((m) => m.id === sel.suppressedBy) ?? null;
  });

  /** The mute's creator, via the SAME consoleUser resolver used for ownership
   *  (name over email; falls back to the raw id). Passed into the pane. */
  readonly selectedMuteCreator = computed<{ name: string; email: string | null } | null>(() => {
    const mute = this.selectedMute();
    if (!mute) return null;
    const u = this.consoleUser(mute.createdByIdentityId);
    return { name: u?.name ?? mute.createdByIdentityId, email: u?.email ?? null };
  });

  /** Event timeline for the selected alert (fixture keyed by id), resolved here
   *  and passed into the pane so it never reads the fixture itself. null when
   *  nothing is selected or the alert has no recorded history. */
  readonly selectedTimeline = computed<Timeline | null>(() => {
    const sel = this.selectedAlert();
    return sel ? this.data.alertTimelines()[sel.id] ?? null : null;
  });

  /** Stats-header counts, derived from the FULL alert set — deliberately NOT the
   *  filtered list. The header summarizes the whole network; the filters below
   *  drive only the table (filteredAlerts). */
  readonly stats = computed(() => computeAlertStats(this.suppressedAlerts().filter(isOpenAlert)));

  // ─── List filters (drive the table ONLY, never stats) ────────────────
  readonly searchText = signal<string>('');
  readonly statusFilter = signal<Set<AlertStatus>>(new Set());
  readonly severityFilter = signal<Set<AlertSeverity>>(new Set());
  readonly componentFilter = signal<Set<ConcreteComponent>>(new Set());
  readonly ownershipFilter = signal<Set<'claimed' | 'unclaimed'>>(new Set());
  readonly mutedFilter = signal<Set<'muted' | 'unmuted'>>(new Set());

  /** Which filter dropdown is open (null = none). Mirrors the sessions
   *  openMenuId pattern — an outside click on the list body closes it. */
  readonly openFilter = signal<FilterName | null>(null);

  readonly statusOptions: AlertStatus[] = ['PENDING', 'FIRING', 'RESOLVED'];
  readonly severityOptions: AlertSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
  readonly componentOptions: ConcreteComponent[] = ['Service', 'Edge Router', 'Link', 'Detector'];
  readonly ownershipOptions: { value: 'claimed' | 'unclaimed'; label: string }[] = [
    { value: 'claimed', label: 'Claimed' },
    { value: 'unclaimed', label: 'Unclaimed' },
  ];
  readonly mutedOptions: { value: 'muted' | 'unmuted'; label: string }[] = [
    { value: 'muted', label: 'Muted' },
    { value: 'unmuted', label: 'Not muted' },
  ];

  /** Alerts after all six filters. Within a dimension the members OR together;
   *  across dimensions they AND; an empty set means "no constraint". */
  readonly filteredAlerts = computed<Alert[]>(() => {
    const q = this.searchText().toLowerCase().trim();
    const statuses = this.statusFilter();
    const sevs = this.severityFilter();
    const comps = this.componentFilter();
    const owns = this.ownershipFilter();
    const muted = this.mutedFilter();
    return this.suppressedAlerts().filter((a) => {
      if (q && !(this.componentName(a) ?? '').toLowerCase().includes(q)) return false;
      // Default view is open alerts only ("every open alert"): with no explicit
      // Status filter, hide non-open (RESOLVED) via the shared predicate. An
      // explicit Status set is honored exactly, so filtering for RESOLVED still
      // surfaces them.
      if (statuses.size === 0 && !isOpenAlert(a)) return false;
      if (statuses.size && !statuses.has(a.status)) return false;
      if (sevs.size && !sevs.has(a.severity)) return false;
      if (comps.size) {
        const ct = componentTypeForAlertType(a.alertType);
        if (ct === null || !comps.has(ct)) return false;
      }
      if (owns.size && !owns.has(a.ack.acked === true ? 'claimed' : 'unclaimed')) return false;
      if (muted.size && !muted.has(a.suppressed === true ? 'muted' : 'unmuted')) return false;
      return true;
    });
  });

  /** True when any filter or the search is active (drives Clear visibility). */
  readonly anyFilterActive = computed<boolean>(() =>
    this.searchText().trim().length > 0 ||
    this.statusFilter().size > 0 ||
    this.severityFilter().size > 0 ||
    this.componentFilter().size > 0 ||
    this.ownershipFilter().size > 0 ||
    this.mutedFilter().size > 0,
  );

  setTab(tab: AlertsTab): void {
    this.activeTab.set(tab);
  }

  // ─── Selection ↔ URL (arrow-fields: passed to the pane as callbacks, so
  //     `this` must stay bound) ─────────────────────────────────────────
  /** Reflect a row selection into the URL. replaceUrl so pane-to-pane hops
   *  don't flood browser history; merge to preserve any other query params. */
  selectAlert = (id: string): void => {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { selected: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  };

  /** Drop the `selected` param — closes the pane. */
  clearSelection = (): void => {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { selected: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  };

  /** Move selection to the previous alert in filteredAlerts() (clamped). */
  selectPrev = (): void => {
    const pos = this.paneposition();
    if (!pos || pos.index <= 0) return;
    this.selectAlert(this.filteredAlerts()[pos.index - 1].id);
  };

  /** Move selection to the next alert in filteredAlerts() (clamped). */
  selectNext = (): void => {
    const pos = this.paneposition();
    if (!pos || pos.index >= pos.total - 1) return;
    this.selectAlert(this.filteredAlerts()[pos.index + 1].id);
  };

  // ─── Claim / Release ─────────────────────────────────────────────────
  /** Alert id whose Claim modal is open (null = closed). */
  readonly claimingAlertId = signal<string | null>(null);

  /** The alert the Claim modal is for, or null when the modal is closed OR the
   *  id no longer resolves (treat a stale id as closed). */
  readonly claimingAlert = computed<Alert | null>(
    () => this.suppressedAlerts().find((a) => a.id === this.claimingAlertId()) ?? null,
  );

  /** Open the Claim modal for an alert. */
  openClaim = (id: string): void => {
    this.claimingAlertId.set(id);
  };

  /** Close the Claim modal without claiming. */
  cancelClaim = (): void => {
    this.claimingAlertId.set(null);
  };

  /** Confirm the open Claim modal — write the ack, then close. */
  confirmClaim = (note: string): void => {
    const id = this.claimingAlertId();
    if (id) this.claimAlert(id, note);
    this.claimingAlertId.set(null);
  };

  /** Take ownership: write an ack attributed to the current user. In-memory,
   *  immutable — the Ownership column and the detail pane both read ack, so
   *  they update reactively. (Real API takes the actor from the token.) */
  private claimAlert(id: string, note: string): void {
    this.data.alerts.update((alerts) =>
      alerts.map((a) =>
        a.id === id
          ? {
              ...a,
              ack: {
                acked: true,
                identityId: this.data.currentUser.id,
                at: new Date().toISOString(),
                note: note || null,
              },
            }
          : a,
      ),
    );
  }

  /** Give up ownership: clear the ack. No modal — the API's unack takes no body. */
  releaseAlert = (id: string): void => {
    this.data.alerts.update((alerts) =>
      alerts.map((a) =>
        a.id === id ? { ...a, ack: { acked: false, identityId: null, at: null, note: null } } : a,
      ),
    );
  };

  // ─── Resolve ─────────────────────────────────────────────────────────
  /** Alert id whose Resolve confirm dialog is open (null = closed). */
  readonly resolvingAlertId = signal<string | null>(null);

  /** The alert the Resolve dialog is for, or null when closed / id no longer
   *  resolves. */
  readonly resolvingAlert = computed<Alert | null>(
    () => this.suppressedAlerts().find((a) => a.id === this.resolvingAlertId()) ?? null,
  );

  /** Close by hand: mark the alert RESOLVED. In-memory, immutable — the header
   *  stats and (if selected) the detail pane read status/open/resolvedAt, so
   *  they recompute reactively. Does NOT stop the condition — a still-asserting
   *  detector opens a fresh alert on its next evaluation (real-world behavior,
   *  not modeled here). */
  resolveAlert = (id: string): void => {
    this.data.alerts.update((alerts) =>
      alerts.map((a) =>
        a.id === id
          ? {
              ...a,
              status: 'RESOLVED',
              open: false,
              resolvedAt: new Date().toISOString(),
              resolutionReason: 'MANUAL',
            }
          : a,
      ),
    );
    this.resolvingAlertId.set(null);
  };

  // ─── Mute ────────────────────────────────────────────────────────────
  /** Alert id whose Mute modal is open (null = closed). */
  readonly mutingAlertId = signal<string | null>(null);

  /** The alert the Mute modal is for, or null when closed / id no longer
   *  resolves. */
  readonly mutingAlert = computed<Alert | null>(
    () => this.suppressedAlerts().find((a) => a.id === this.mutingAlertId()) ?? null,
  );

  /** Whether the header "Mute all alerts" modal is open (alert=null → scope C). */
  readonly muteAllOpen = signal(false);

  /** Create a real mute from the modal's request and push it onto data.mutes()
   *  immutably. Because suppression is DERIVED from mutes(), this reactively
   *  suppresses every covered alert. Closes whichever Mute modal was open. */
  createMute = (req: MuteRequest): void => {
    const mute: Mute = {
      id: 'mute-' + crypto.randomUUID().slice(0, 8),
      matchers: req.matchers,
      alertTypes: req.alertTypes,
      starts: req.starts,
      ends: req.ends,
      reason: req.reason,
      createdByIdentityId: this.data.currentUser.id,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      revokedByIdentityId: null,
    };
    this.data.mutes.update((mutes) => [...mutes, mute]);
    this.mutingAlertId.set(null);
    this.muteAllOpen.set(false);
  };

  // ─── Reschedule / Revoke (Mutes tab) ─────────────────────────────────
  /** Mute id whose Reschedule modal is open (null = closed). */
  readonly reschedulingMuteId = signal<string | null>(null);
  /** Mute id whose Revoke confirm is open (null = closed). */
  readonly revokingMuteId = signal<string | null>(null);

  /** The mute being rescheduled, or null when closed / id no longer resolves. */
  readonly reschedulingMute = computed<Mute | null>(
    () => this.data.mutes().find((m) => m.id === this.reschedulingMuteId()) ?? null,
  );
  /** The mute being revoked, or null when closed / id no longer resolves. */
  readonly revokingMute = computed<Mute | null>(
    () => this.data.mutes().find((m) => m.id === this.revokingMuteId()) ?? null,
  );

  /** Confirm the open Reschedule modal — apply to whichever mute it's for.
   *  Reads the id from the signal (the modal's `@if` alias isn't narrowed inside
   *  the callback closure, so we don't rely on it). */
  confirmReschedule = (ends: string | null): void => {
    const id = this.reschedulingMuteId();
    if (id) this.rescheduleMute(id, ends);
  };

  /** Move a mute's end. Suppression is derived from mutes(), so covered alerts
   *  update reactively — never touch alerts here. */
  rescheduleMute = (id: string, ends: string | null): void => {
    this.data.mutes.update((mutes) =>
      mutes.map((m) => (m.id === id ? { ...m, ends } : m)),
    );
    this.reschedulingMuteId.set(null);
  };

  /** Revoke a mute: stamp revokedAt/By. isMuteActive excludes revoked mutes, so
   *  it stops suppressing immediately (covered alerts page again) but stays
   *  listed as a record. Not removed from the list. */
  revokeMute = (id: string): void => {
    this.data.mutes.update((mutes) =>
      mutes.map((m) =>
        m.id === id
          ? { ...m, revokedAt: new Date().toISOString(), revokedByIdentityId: this.data.currentUser.id }
          : m,
      ),
    );
    this.revokingMuteId.set(null);
  };

  // ─── Filter interaction helpers ──────────────────────────────────────
  toggleDropdown(name: FilterName): void {
    this.openFilter.update((cur) => (cur === name ? null : name));
  }

  closeDropdowns(): void {
    this.openFilter.set(null);
  }

  /** Toggle one value in a Set-backed filter signal (generic over value type). */
  toggleFilter<T>(sig: WritableSignal<Set<T>>, value: T): void {
    sig.update((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  clearFilters(): void {
    this.searchText.set('');
    this.statusFilter.set(new Set());
    this.severityFilter.set(new Set());
    this.componentFilter.set(new Set());
    this.ownershipFilter.set(new Set());
    this.mutedFilter.set(new Set());
    this.openFilter.set(null);
  }

  /** Severity → dedicated severity pill variant. The pill shows the severity
   *  text (label), colored by its own severity palette (not the status ramp). */
  severityVariant(severity: AlertSeverity): PillVariant {
    switch (severity) {
      case 'CRITICAL': return 'severity-critical';
      case 'MAJOR':    return 'severity-major';
      case 'MINOR':    return 'severity-minor';
      case 'INFO':     return 'severity-info';
    }
  }

  /** Human display name for a raw alertType code (shown over the code). */
  alertTypeDisplay(alertType: string): string {
    switch (alertType) {
      case 'ziti.router.flapping':     return 'Router Flapping';
      case 'ziti.service.unreachable': return 'Service Unreachable';
      default: {
        // Fallback: last dotted segment, spaced + title-cased.
        const tail = alertType.split('.').pop() ?? alertType;
        return tail.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
  }

  /** Component label ("<name> · <ComponentType>") from labels + the type map,
   *  or null when the alert isn't scoped to a single component. */
  componentType(alertType: string): string | null {
    return componentTypeForAlertType(alertType);
  }

  /** Best display name for the component the alert is about, from its labels.
   *  Delegates to the shared helper so the detail pane shows the same value. */
  componentName(alert: Alert): string | null {
    return componentDisplayName(alert);
  }

  /** State-aware overflow-menu items for a list row. Built from the DERIVED
   *  alert (from filteredAlerts()/suppressedAlerts()), so `ack` and `suppressed`
   *  reflect live ownership and mute coverage. Items appear only when actionable:
   *  Mute is hidden while suppressed (the MUTED chip already signals it) and
   *  Resolve is hidden once resolved. Order: ownership, mute, resolve. */
  alertMenuItems(alert: Alert): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];

    if (alert.ack.acked) {
      items.push({ label: 'Release', icon: 'fa-solid fa-user-slash', onClick: () => this.releaseAlert(alert.id) });
    } else {
      items.push({ label: 'Claim', icon: 'fa-solid fa-user-plus', onClick: () => this.claimingAlertId.set(alert.id) });
    }

    if (!alert.suppressed) {
      items.push({ label: 'Mute', icon: 'fa-solid fa-volume-xmark', onClick: () => this.mutingAlertId.set(alert.id) });
    }

    if (alert.status !== 'RESOLVED') {
      items.push({ label: 'Resolve', icon: 'fa-solid fa-circle-check', danger: true, onClick: () => this.resolvingAlertId.set(alert.id) });
    }

    return items;
  }

  /** Overflow-menu items for a Mutes-tab row. A revoked mute has nothing left to
   *  do, so it returns [] — the action-menu then omits the ⋮ entirely, leaving a
   *  blank Actions cell (intended). Active mutes (expired/scheduled treated as
   *  active for now; full state-awareness rides with the deferred State filter)
   *  can be rescheduled or revoked. */
  muteMenuItems(mute: Mute): ActionMenuItem[] {
    if (mute.revokedAt !== null) return [];
    return [
      { label: 'Reschedule', icon: 'fa-solid fa-clock', onClick: () => this.reschedulingMuteId.set(mute.id) },
      { label: 'Revoke', icon: 'fa-solid fa-ban', danger: true, onClick: () => this.revokingMuteId.set(mute.id) },
    ];
  }

  /** Resolve a console-user UUID to its org-user record (human name + email).
   *  The actor is a console/org USER, so this resolves against consoleUsers(),
   *  NOT identities() (which holds Ziti edge handles). Null when unknown. */
  private consoleUser(userId: string | null): ConsoleUser | null {
    if (!userId) return null;
    return this.data.consoleUsers().find((u) => u.id === userId) ?? null;
  }

  /** Ownership cell — "Claimed by <who>" when acked, "Muted by <who>" when
   *  suppressed, else null (unowned). Resolves the actor UUID to a name + email
   *  (rendered on two lines); falls back to the raw UUID when unresolved. Ack
   *  takes precedence over mute. */
  ownership(alert: Alert): { kind: 'claimed' | 'muted'; name: string; email: string | null } | null {
    if (alert.ack.acked && alert.ack.identityId) {
      const u = this.consoleUser(alert.ack.identityId);
      return { kind: 'claimed', name: u?.name ?? alert.ack.identityId, email: u?.email ?? null };
    }
    if (alert.suppressed) {
      const mute = alert.suppressedBy ? this.data.mutes().find((m) => m.id === alert.suppressedBy) : null;
      const u = mute ? this.consoleUser(mute.createdByIdentityId) : null;
      return { kind: 'muted', name: u?.name ?? mute?.createdByIdentityId ?? 'a mute', email: u?.email ?? null };
    }
    return null;
  }

  formatDate(iso: string | null): string {
    return formatAlertTimestamp(iso);
  }

  // ─── Mutes tab display helpers ───────────────────────────────────────
  /** The alert-type(s) a mute covers as a readable phrase; 'Every alert type'
   *  when empty or the ['*'] wildcard. */
  muteAlertTypesPhrase(mute: Mute): string {
    const types = mute.alertTypes;
    if (types.length === 0 || (types.length === 1 && types[0] === '*')) return 'Every alert type';
    return types.join(', ');
  }

  /** A mute matcher as human text — shared helper, same phrasing as the
   *  Muting tab in the detail pane. */
  muteMatcherWords(m: Matcher): string {
    return matcherToWords(m);
  }

  /** Mute window bounds → 'Now'/'Indefinite' for nulls, else formatted. */
  muteWindowStart(mute: Mute): string {
    return mute.starts === null ? 'Now' : formatAlertTimestamp(mute.starts);
  }

  muteWindowEnd(mute: Mute): string {
    return mute.ends === null ? 'Indefinite' : formatAlertTimestamp(mute.ends);
  }

  /** Mute creator via the SAME consoleUser resolver used for ownership (name
   *  over email; falls back to the raw id). */
  muteCreatedBy(mute: Mute): { name: string; email: string | null } {
    const u = this.consoleUser(mute.createdByIdentityId);
    return { name: u?.name ?? mute.createdByIdentityId, email: u?.email ?? null };
  }
}
