import { Component, OnInit, computed, effect, inject, isDevMode, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MockDataService, EntityHealthRecord } from '../../shared/services/mock-data.service';
import { PillComponent } from '../../shared/components/pill/pill.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { DrawerService } from '../../shared/services/drawer.service';
import { NetworkContextService } from '../../data-access/network-context.service';
import {
  TemplateSearchService,
  DialLogRecord,
  FabricCircuitTemplateQueryParameter,
  FabricLatencySeries,
  FabricLinkLatencyTemplateQueryParameter,
  UtilizationRecord,
  UtilizationTemplateQueryParameter,
  UtilizationEntityType,
} from '../../data-access/template-search.service';
import { groupDialLogs, DialLogGroup } from '../dial-logs/dial-logs.logic';
import { ConcernDismissStore } from './concern-dismiss.store';
import {
  LatencyConcern,
  UtilizationConcern,
  HealthConcern,
  ConcernListData,
} from './concern.models';

interface ChecklistStep {
  id: string;
  title: string;
  description: string;
  route: string;
  cta: string;
  complete: boolean;
}

/**
 * Peak fabric-latency (ms) above which a link is surfaced as a concern in the
 * Insights "High Latency Links" panel. Links whose peak is at or below this do
 * not appear. Hardcoded for now — tune here.
 */
const LATENCY_THRESHOLD_MS = 100;

/**
 * Utilization percentage above which an entity is surfaced as a concern in the
 * Insights "High Utilization" panel. Entities at or below this do not appear.
 * POC-arbitrary (matches the existing "85% of limit" mock event) — tune here.
 */
const UTILIZATION_THRESHOLD_PCT = 80;

/** Max rows the High Utilization panel shows (worst-first). */
const UTILIZATION_TOP_N = 10;

const UTILIZATION_TYPE_LABELS: Record<UtilizationEntityType, string> = {
  service: 'Service',
  identity: 'Identity',
  router: 'Router',
};

/** Max rows the Unhealthy Entities panel shows (worst-first). */
const UNHEALTHY_TOP_N = 10;

/**
 * Max NAMED slices in a usage pie; everything past this is rolled into one
 * "Other" wedge. Without a cap the pie emits one wedge and one legend row per
 * entity, so a roster of any real size buries the few entities that actually
 * carry traffic under a tail of zero-width 0% rows — and USAGE_SLICE_COLORS has
 * five colours, so the tail repeats them anyway. Same treatment, and the same
 * number, as UTILIZATION_TOP_N / UNHEALTHY_TOP_N above.
 */
const USAGE_TOP_N = 10;

/** Label for the rolled-up remainder slice. */
const USAGE_OTHER_LABEL = 'Other';

/**
 * Worst-first status ordering for the Unhealthy Entities panel: offline is more
 * urgent than degraded, so it sorts ahead. (Lower rank = worse = shown first.)
 */
const HEALTH_STATUS_RANK: Record<'offline' | 'degraded', number> = {
  offline: 0,
  degraded: 1,
};

const HEALTH_TYPE_LABELS: Record<EntityHealthRecord['entityType'], string> = {
  router: 'Router',
  identity: 'Identity',
};

/**
 * Stable, collision-resistant ids for the three Areas-of-Attention concern
 * kinds. Each id encodes the concern's DISCRETE identity only — the health
 * status and utilization entityType are part of the key, but continuous
 * magnitudes (peakMs, utilizationPct) are deliberately excluded so an id stays
 * stable as a value fluctuates. Namespaced by kind so ids never collide across
 * panels. Pure functions — no component state.
 */
function buildLatencyConcernId(linkKey: string): string {
  return `latency|${linkKey}`;
}

function buildUtilizationConcernId(
  entityType: UtilizationEntityType,
  entityName: string,
): string {
  return `util|${entityType}|${entityName}`;
}

function buildHealthConcernId(
  typeLabel: string,
  entityName: string,
  status: 'offline' | 'degraded',
): string {
  return `health|${typeLabel}|${entityName}|${status}`;
}

/**
 * Categorical slice palette for the usage pie (slot 1 = brand-primary, rest
 * from the validated data-viz categorical order). Colorblind-safe as an ordered
 * set (worst adjacent CVD ΔE 24.2); relief for the lower-contrast slots is the
 * ranked list beside the pie. Assigned in ranked order so slice/list/dot match.
 * Max 5 entities per tab today == palette length, so hues are never cycled.
 */
const USAGE_SLICE_COLORS = ['#1B4FD8', '#1BAF7A', '#EDA100', '#008300', '#4A3AA7'];

/** Pie geometry (SVG user units); the viewBox is SIZE×SIZE. */
const PIE = { size: 160, cx: 80, cy: 80, r: 76 };

/** One rendered pie slice + its ranked-list row. */
interface UsageSlice {
  name: string;
  usage: number;
  /** Share of total, rounded to a whole percent. */
  pct: number;
  color: string;
  /** SVG path `d` for the wedge (unused when isFull). */
  path: string;
  /** True when a single entity holds 100% — render a full circle, not a wedge. */
  isFull: boolean;
}

interface UsageBreakdown {
  slices: UsageSlice[];
  total: number;
}

/**
 * Build ranked pie slices (biggest-first by usage) from name/usage pairs, capped
 * at USAGE_TOP_N named entries plus one "Other" remainder.
 *
 * `total` is the total across EVERYTHING, not just the named slices, so the
 * percentages still sum to 100 and the headline figure stays the true total.
 * The remainder is only emitted when it is non-zero: entities with no usage
 * contribute a zero-width wedge and a "0%" legend row, which is noise, so a tail
 * of un-used entities collapses to nothing rather than to an "Other 0%".
 */
function buildUsageBreakdown(items: { name: string; usage: number }[]): UsageBreakdown {
  const sorted = [...items].sort((a, b) => b.usage - a.usage);
  const total = sorted.reduce((n, i) => n + i.usage, 0);

  const named = sorted.slice(0, USAGE_TOP_N);
  const restUsage = sorted.slice(USAGE_TOP_N).reduce((n, i) => n + i.usage, 0);
  const ranked =
    restUsage > 0 ? [...named, { name: USAGE_OTHER_LABEL, usage: restUsage }] : named;
  const { cx, cy, r } = PIE;
  let angle = -Math.PI / 2; // start at 12 o'clock

  const slices = ranked.map((item, idx) => {
    const frac = total > 0 ? item.usage / total : 0;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    const x0 = cx + r * Math.cos(start);
    const y0 = cy + r * Math.sin(start);
    const x1 = cx + r * Math.cos(end);
    const y1 = cy + r * Math.sin(end);
    const largeArc = end - start > Math.PI ? 1 : 0;
    return {
      name: item.name,
      usage: item.usage,
      pct: Math.round(frac * 100),
      color: USAGE_SLICE_COLORS[idx % USAGE_SLICE_COLORS.length],
      path: `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`,
      isFull: frac >= 0.999999,
    };
  });

  return { slices, total };
}

// ─── Network Utilization (Tx/Rx area chart) ──────────────────────────────

/** Selectable time ranges for the Network Utilization chart. */
type UtilRange = '6h' | '24h' | '7d';

/** How many trailing hourly samples each range shows (7d = the full 168). */
const UTIL_WINDOW_HOURS: Record<UtilRange, number> = {
  '6h': 6,
  '24h': 24,
  '7d': 168,
};

/**
 * Area-chart geometry in SVG user units (viewBox is vbW×vbH). Short-and-wide
 * (5:1) so proportional preserveAspectRatio scaling yields a short band rather
 * than a tall block on wide screens; a CSS max-height also caps it. The plot
 * area is vbW/vbH minus the gutters: ~1528×260, with a left gutter for Y labels
 * and a bottom gutter for X labels. All tick/scale math derives from these, so
 * changing vbW/vbH rescales the whole chart.
 */
const UTIL_CHART = { vbW: 1600, vbH: 320, padL: 56, padR: 16, padT: 16, padB: 44 } as const;

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** One Y gridline/label. */
interface UtilYTick { y: number; label: string; }
/** One X time tick. */
interface UtilXTick { x: number; label: string; }

// ─── Active Identities (static 7-day bar chart) ──────────────────────────

/**
 * Bar-chart geometry for the Active Identities panel. Short-and-wide viewBox
 * like utilization; its aspect (vbH/vbW ≈ 0.37) is tuned so that at ~35% column
 * width this chart renders at about the same natural height as the utilization
 * chart at ~65% width, keeping the paired panels visually level. Scale/tick math
 * mirrors UTIL_CHART. Same gutters (left for Y labels, bottom for X labels).
 */
const ACT_CHART = { vbW: 860, vbH: 320, padL: 44, padR: 12, padT: 16, padB: 44 } as const;

/** One rendered bar. */
interface ActBar { x: number; y: number; width: number; height: number; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, PillComponent, EmptyStateComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  readonly data = inject(MockDataService);
  private readonly drawer = inject(DrawerService);
  private readonly templates = inject(TemplateSearchService);
  private readonly ctx = inject(NetworkContextService);
  private readonly dismissStore = inject(ConcernDismissStore);

  // ─── Dial-log alert summary (feeds the "Service Alerts" card) ─────────
  private readonly dialRecords = signal<DialLogRecord[]>([]);

  private readonly allGroups = computed<DialLogGroup[]>(() => groupDialLogs(this.dialRecords()));

  /** Service groups that have at least one failed dial. */
  private readonly failingGroups = computed<DialLogGroup[]>(() =>
    this.allGroups().filter((g) => g.failedCount > 0),
  );

  /** Total individual failed dials across all groups (matches the drawer rows). */
  readonly failureCount = computed(() =>
    this.allGroups().reduce((n, g) => n + g.failedCount, 0),
  );

  /** Number of distinct services carrying at least one failure. */
  readonly serviceCount = computed(() => this.failingGroups().length);

  /**
   * Dial records whose failure is a missing/unavailable terminator: the fabric
   * found no active terminator (NO_TERMINATORS) or none currently online
   * (NO_ONLINE_TERMINATORS). This is a distinct "no host is bound / reachable"
   * signal — the service can't be reached at all, not a transient dial failure.
   */
  private readonly noTerminatorRecords = computed<DialLogRecord[]>(() =>
    this.dialRecords().filter(
      (r) =>
        r.failureCause === 'NO_TERMINATORS' ||
        r.failureCause === 'NO_ONLINE_TERMINATORS',
    ),
  );

  /** Number of distinct services with a no-terminator failure. */
  readonly noTerminatorCount = computed(() => {
    const services = new Set(
      this.noTerminatorRecords().map((r) => r.serviceName ?? r.serviceId ?? ''),
    );
    services.delete('');
    return services.size;
  });

  // ─── Fabric latency (feeds the Insights "High Latency Links" panel) ───
  private readonly latencySeries = signal<FabricLatencySeries[]>([]);

  /** Route the latency concern rows navigate to. */
  readonly latencyRoute = '/metrics/fabric-latency';

  /**
   * All latency concerns (peak > threshold), worst-first, BEFORE dismiss
   * filtering. `latencyConcerns` (visible) and `latencyDismissedCount` both
   * derive from this so a dismissed row is excluded, not counted twice.
   */
  private readonly latencyCandidates = computed<LatencyConcern[]>(() =>
    this.latencySeries()
      .map((s) => ({
        id: buildLatencyConcernId(s.linkKey),
        linkKey: s.linkKey,
        source: s.sourceRouter,
        destination: s.destinationRouter,
        peakMs: s.latenciesMs.length ? Math.round(Math.max(...s.latenciesMs)) : 0,
      }))
      .filter((c) => c.peakMs > LATENCY_THRESHOLD_MS)
      .sort((a, b) => b.peakMs - a.peakMs),
  );

  /**
   * Links whose PEAK latency exceeds LATENCY_THRESHOLD_MS, worst-first, with
   * dismissed concerns removed. (No top-N cap on this panel.)
   */
  readonly latencyConcerns = computed<LatencyConcern[]>(() =>
    this.latencyCandidates().filter((c) => !this.dismissStore.isDismissed(c.id)),
  );

  /** Count of currently-dismissed latency concerns (for the panel indicator). */
  readonly latencyDismissedCount = computed(() =>
    this.latencyCandidates().filter((c) => this.dismissStore.isDismissed(c.id)).length,
  );

  // ─── Entity utilization (feeds the Insights "High Utilization" panel) ──
  private readonly utilizationRecords = signal<UtilizationRecord[]>([]);

  /**
   * All above-threshold utilization concerns, worst-first, BEFORE the top-N cap
   * and BEFORE dismiss filtering. Building the id here (not after the slice)
   * lets dismissed concerns be removed BEFORE the cap, so a dismissed entity
   * frees its slot for the next-ranked one instead of leaving a gap.
   */
  private readonly utilizationCandidates = computed<UtilizationConcern[]>(() =>
    this.utilizationRecords()
      .filter((r) => r.utilizationPct > UTILIZATION_THRESHOLD_PCT)
      .sort((a, b) => b.utilizationPct - a.utilizationPct)
      .map((r) => ({
        id: buildUtilizationConcernId(r.entityType, r.entityName),
        entityName: r.entityName,
        entityType: r.entityType,
        typeLabel: UTILIZATION_TYPE_LABELS[r.entityType],
        utilizationPct: r.utilizationPct,
      })),
  );

  /**
   * Top-N above-threshold utilization concerns, worst-first, dismissed removed.
   * Dismiss filter runs BEFORE the top-N cap (see utilizationCandidates).
   */
  readonly utilizationConcerns = computed<UtilizationConcern[]>(() =>
    this.utilizationCandidates()
      .filter((c) => !this.dismissStore.isDismissed(c.id))
      .slice(0, UTILIZATION_TOP_N),
  );

  /** Count of currently-dismissed utilization concerns (for the panel indicator). */
  readonly utilizationDismissedCount = computed(() =>
    this.utilizationCandidates().filter((c) => this.dismissStore.isDismissed(c.id)).length,
  );

  /**
   * Unhealthy routers + identities (offline or degraded), worst-first: offline
   * before degraded, then longest-offline (oldest lastSeen) first. Healthy
   * ('online') entities are excluded. Capped at the top N. Reads from the
   * MockDataService health mock — a real query replaces this source later.
   */
  /**
   * All unhealthy (offline/degraded) entities, worst-first, BEFORE the top-N cap
   * and BEFORE dismiss filtering. Id built here (not after the slice) so
   * dismissed concerns are removed BEFORE the cap.
   */
  private readonly healthCandidates = computed<HealthConcern[]>(() =>
    this.data
      .entityHealth()
      .filter(
        (r): r is EntityHealthRecord & { status: 'offline' | 'degraded' } =>
          r.status === 'offline' || r.status === 'degraded',
      )
      .sort((a, b) => {
        const byStatus = HEALTH_STATUS_RANK[a.status] - HEALTH_STATUS_RANK[b.status];
        if (byStatus !== 0) return byStatus;
        // Same status → oldest lastSeen (longest unhealthy) first.
        return Date.parse(a.lastSeen) - Date.parse(b.lastSeen);
      })
      .map((r) => {
        const typeLabel = HEALTH_TYPE_LABELS[r.entityType];
        return {
          id: buildHealthConcernId(typeLabel, r.entityName, r.status),
          entityName: r.entityName,
          typeLabel,
          status: r.status,
          lastSeenLabel: this.formatLastSeen(r.lastSeen),
        };
      }),
  );

  /**
   * Top-N unhealthy entities, worst-first, dismissed removed. Dismiss filter
   * runs BEFORE the top-N cap (see healthCandidates).
   */
  readonly healthConcerns = computed<HealthConcern[]>(() =>
    this.healthCandidates()
      .filter((c) => !this.dismissStore.isDismissed(c.id))
      .slice(0, UNHEALTHY_TOP_N),
  );

  /** Count of currently-dismissed health concerns (for the panel indicator). */
  readonly healthDismissedCount = computed(() =>
    this.healthCandidates().filter((c) => this.dismissStore.isDismissed(c.id)).length,
  );

  // ─── Per-row inline dismiss confirmation ────────────────────────────
  /** Concern id whose row is currently showing the confirm/cancel pair (only
   *  one at a time); null when no row is mid-confirm. */
  private readonly pendingDismissId = signal<string | null>(null);

  /** True when this row should render its confirm/cancel affordance. */
  isDismissPending(id: string): boolean {
    return this.pendingDismissId() === id;
  }

  /** First click on the × — arm the inline confirm for this row. */
  requestDismiss(id: string): void {
    this.pendingDismissId.set(id);
  }

  /** Confirm click (✓) — actually dismiss, then clear the confirm state. */
  confirmDismiss(id: string): void {
    this.dismissStore.dismiss(id);
    this.pendingDismissId.set(null);
  }

  /** Cancel click (✕) — revert to the idle × without dismissing. */
  cancelDismiss(): void {
    this.pendingDismissId.set(null);
  }

  // ─── "Show more" → full-concern-list drawer (panels with depth only) ─
  // Full (pre-cap) concern sets with dismissed removed — what the drawer shows.
  // (latencyConcerns is already the uncapped, dismiss-filtered latency list.)
  readonly utilizationFull = computed<UtilizationConcern[]>(() =>
    this.utilizationCandidates().filter((c) => !this.dismissStore.isDismissed(c.id)),
  );
  readonly healthFull = computed<HealthConcern[]>(() =>
    this.healthCandidates().filter((c) => !this.dismissStore.isDismissed(c.id)),
  );

  /**
   * "Has depth" flags — true when a panel currently has MORE non-dismissed
   * concerns than it shows (top-N cap), i.e. rows live only in the drawer. Only
   * these panels get a "Show more" control. Latency has no cap, so it never has
   * depth (always shows all) — no flag/control for it. If dismissals drop a
   * panel back to <= cap, its flag flips off and the control disappears.
   */
  readonly utilizationHasMore = computed(() => this.utilizationFull().length > UTILIZATION_TOP_N);
  readonly healthHasMore = computed(() => this.healthFull().length > UNHEALTHY_TOP_N);

  /** Open the full-concern-list drawer for a panel (full set minus dismissed). */
  openUtilizationList(): void {
    const concerns = this.utilizationFull();
    const data: ConcernListData = {
      panel: 'utilization',
      title: 'High Utilization',
      subtitle: `${concerns.length} entities over threshold`,
      concerns,
    };
    this.drawer.open({ type: 'concern-list', data });
  }

  openHealthList(): void {
    const concerns = this.healthFull();
    const data: ConcernListData = {
      panel: 'health',
      title: 'Unhealthy Entities',
      subtitle: `${concerns.length} entities`,
      concerns,
    };
    this.drawer.open({ type: 'concern-list', data });
  }

  ngOnInit(): void {
    const params: FabricCircuitTemplateQueryParameter = {
      indexName: 'ncfabriccircuits',
      networkGroupId: this.ctx.networkGroupId,
      networkId: this.ctx.networkId,
      size: '500',
    };
    this.templates.getDialLogs(params).subscribe((recs) => this.dialRecords.set(recs));

    const latencyParams: FabricLinkLatencyTemplateQueryParameter = {
      indexName: 'nclinklatency',
      networkGroupId: this.ctx.networkGroupId,
      networkId: this.ctx.networkId,
    };
    this.templates
      .getFabricLatency(latencyParams)
      .subscribe((series) => this.latencySeries.set(series));

    const utilizationParams: UtilizationTemplateQueryParameter = {
      indexName: 'ncutilization',
      networkGroupId: this.ctx.networkGroupId,
      networkId: this.ctx.networkId,
    };
    this.templates
      .getUtilization(utilizationParams)
      .subscribe((recs) => this.utilizationRecords.set(recs));
  }

  /**
   * Open the ONE unified activity drawer over the full record set — the
   * complete failures view (all types, failed status). The consolidated
   * critical-signal banner is the single entry point; the no-terminator view is
   * reached from the in-drawer Terminator pill rather than a separate opener.
   * The drawer derives its own LIVE subheading from its filter state, so no
   * static subtitle is passed here.
   */
  openServiceAlerts(): void {
    const records = this.dialRecords();
    if (records.length === 0) return;
    this.drawer.open({
      type: 'service-activity',
      data: {
        title: 'Service Activity',
        records,
        defaultStatusFilter: 'failed',
        defaultTypeFilter: 'all',
      },
    });
  }

  readonly steps = computed<ChecklistStep[]>(() => [
    {
      id: 'identity',
      title: 'Create an Identity',
      description: 'Enroll a device or user to start securing access.',
      route: '/identities/new',
      cta: 'Start',
      complete: this.data.identities().length > 0
    },
    {
      id: 'service',
      title: 'Define a Service',
      description: 'Specify what resources your identities can reach.',
      route: '/services/new',
      cta: 'Start',
      complete: this.data.services().length > 0
    },
    {
      id: 'policy',
      title: 'Create a Policy',
      description: 'Bind identities to services to authorize connectivity.',
      route: '/policies/new',
      cta: 'Start',
      complete: this.data.policies().length > 0
    },
    {
      id: 'verify',
      title: 'Verify Connection',
      description: 'Confirm traffic flows end-to-end across your network.',
      route: '/metrics',
      cta: 'Verify',
      complete: this.data.connectionVerified()
    }
  ]);

  readonly completedCount = computed(() => this.steps().filter(s => s.complete).length);
  readonly allStepsComplete = computed(() => this.completedCount() === this.steps().length);

  get onlineIdentities(): number {
    return this.data.identities().filter(i => i.status === 'online').length;
  }

  get onlineServices(): number {
    return this.data.services().filter(s => s.status === 'online').length;
  }

  get onlineRouters(): number {
    return this.data.routers().filter(r => r.isOnline).length;
  }

  // ─── Network Utilization (Tx/Rx area chart) ─────────────────────────
  /** Selected time range for the utilization chart. */
  readonly selectedUtilRange = signal<UtilRange>('7d');
  /** Range options, in toggle order. */
  readonly utilRanges: UtilRange[] = ['6h', '24h', '7d'];
  /** Chart geometry, exposed for the template viewBox. */
  readonly utilChart = UTIL_CHART;
  private get utilPlotW(): number { return UTIL_CHART.vbW - UTIL_CHART.padL - UTIL_CHART.padR; }
  private get utilPlotH(): number { return UTIL_CHART.vbH - UTIL_CHART.padT - UTIL_CHART.padB; }

  setUtilRange(range: UtilRange): void {
    this.selectedUtilRange.set(range);
  }

  /** Tx/Rx tail-sliced to the last WINDOW_HOURS[range] samples. */
  readonly utilWindow = computed<{ tx: number[]; rx: number[] }>(() => {
    const n = UTIL_WINDOW_HOURS[this.selectedUtilRange()];
    const u = this.data.networkUtilization();
    return { tx: u.tx.slice(-n), rx: u.rx.slice(-n) };
  });

  /** Peak across BOTH sliced series in the current window (floored at 1 so the
   *  Y scale never collapses). Drives per-window Y-axis rescaling. */
  readonly utilYMax = computed<number>(() => {
    const w = this.utilWindow();
    return Math.max(1, ...w.tx, ...w.rx);
  });

  private utilXScale(i: number, count: number): number {
    const denom = count > 1 ? count - 1 : 1;
    return UTIL_CHART.padL + (i / denom) * this.utilPlotW;
  }

  private utilYScale(v: number): number {
    return UTIL_CHART.padT + this.utilPlotH - (v / this.utilYMax()) * this.utilPlotH;
  }

  /** Polyline points ("x,y ...") for a series' stroke line. */
  private utilLinePoints(series: number[]): string {
    const n = series.length;
    return series
      .map((v, i) => `${this.utilXScale(i, n).toFixed(1)},${this.utilYScale(v).toFixed(1)}`)
      .join(' ');
  }

  /** Closed area path (series curve down to the zero baseline) for a fill. */
  private utilAreaPath(series: number[]): string {
    const n = series.length;
    if (n === 0) return '';
    const base = this.utilYScale(0).toFixed(1);
    const line = series
      .map((v, i) => `${this.utilXScale(i, n).toFixed(1)},${this.utilYScale(v).toFixed(1)}`)
      .join(' L ');
    const x0 = this.utilXScale(0, n).toFixed(1);
    const xN = this.utilXScale(n - 1, n).toFixed(1);
    return `M ${x0},${base} L ${line} L ${xN},${base} Z`;
  }

  readonly utilTxArea = computed(() => this.utilAreaPath(this.utilWindow().tx));
  readonly utilTxLine = computed(() => this.utilLinePoints(this.utilWindow().tx));
  readonly utilRxArea = computed(() => this.utilAreaPath(this.utilWindow().rx));
  readonly utilRxLine = computed(() => this.utilLinePoints(this.utilWindow().rx));

  /** Format a KB value for a Y-axis label — promotes to MB once large. */
  private formatUtilValue(kb: number): string {
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${Math.round(kb)} KB`;
  }

  /** ~7 evenly-spaced Y gridlines/labels from 0 to the window peak. */
  readonly utilYTicks = computed<UtilYTick[]>(() => {
    const ymax = this.utilYMax();
    const steps = 6; // 6 intervals → 7 labels (0…ymax)
    const ticks: UtilYTick[] = [];
    for (let k = 0; k <= steps; k++) {
      const value = (ymax * k) / steps;
      ticks.push({ y: this.utilYScale(value), label: this.formatUtilValue(value) });
    }
    return ticks;
  });

  /** X time ticks derived from endTime + the window (no per-point labels are
   *  stored). Day labels ('14 Jul') for 7d, hour labels ('08:00') otherwise. */
  readonly utilXTicks = computed<UtilXTick[]>(() => {
    const range = this.selectedUtilRange();
    const n = this.utilWindow().tx.length;
    if (n === 0) return [];
    const end = new Date(this.data.networkUtilization().endTime).getTime();
    const tickCount = range === '7d' ? 7 : 6;
    const denom = tickCount > 1 ? tickCount - 1 : 1;
    const ticks: UtilXTick[] = [];
    for (let k = 0; k < tickCount; k++) {
      const idx = Math.round((k / denom) * (n - 1));
      const ts = new Date(end - (n - 1 - idx) * 3_600_000);
      const label =
        range === '7d'
          ? `${ts.getDate()} ${MONTHS_SHORT[ts.getMonth()]}`
          : `${String(ts.getHours()).padStart(2, '0')}:00`;
      ticks.push({ x: this.utilXScale(idx, n), label });
    }
    return ticks;
  });

  // ─── Active Identities (static 7-day bar chart) ─────────────────────
  // Independent scaffold copied/adapted from the utilization chart above —
  // deliberately NOT sharing code (per scope: copy, adapt, done).
  /** Chart geometry, exposed for the template viewBox. */
  readonly actChart = ACT_CHART;
  private get actPlotW(): number { return ACT_CHART.vbW - ACT_CHART.padL - ACT_CHART.padR; }
  private get actPlotH(): number { return ACT_CHART.vbH - ACT_CHART.padT - ACT_CHART.padB; }

  /** Full static 168-sample count series (no windowing/toggle). */
  readonly activeCounts = computed<number[]>(() => this.data.activeIdentities().counts);

  /** Peak count (floored at 1 so the Y scale never collapses). */
  readonly actYMax = computed<number>(() => Math.max(1, ...this.activeCounts()));

  private actXScale(i: number, count: number): number {
    const denom = count > 1 ? count - 1 : 1;
    return ACT_CHART.padL + (i / denom) * this.actPlotW;
  }

  private actYScale(v: number): number {
    return ACT_CHART.padT + this.actPlotH - (v / this.actYMax()) * this.actPlotH;
  }

  /** One thin vertical bar per hourly count. */
  readonly actBars = computed<ActBar[]>(() => {
    const counts = this.activeCounts();
    const n = counts.length;
    if (n === 0) return [];
    const slot = this.actPlotW / n;
    const width = Math.max(1, slot * 0.6);
    const base = this.actYScale(0);
    return counts.map((v, i) => {
      const cx = this.actXScale(i, n);
      const y = this.actYScale(v);
      return { x: cx - width / 2, y, width, height: Math.max(0, base - y) };
    });
  });

  /** ~5 Y gridlines/labels from 0 to the peak count (integer labels). */
  readonly actYTicks = computed<UtilYTick[]>(() => {
    const ymax = this.actYMax();
    const steps = 4; // 4 intervals → 5 labels (0…ymax)
    const ticks: UtilYTick[] = [];
    for (let k = 0; k <= steps; k++) {
      const value = (ymax * k) / steps;
      ticks.push({ y: this.actYScale(value), label: `${Math.round(value)}` });
    }
    return ticks;
  });

  /** 7 day-labels across the 7-day span (same logic as utilization's 7d ticks). */
  readonly actXTicks = computed<UtilXTick[]>(() => {
    const counts = this.activeCounts();
    const n = counts.length;
    if (n === 0) return [];
    const end = new Date(this.data.activeIdentities().endTime).getTime();
    const tickCount = 7;
    const denom = tickCount - 1;
    const ticks: UtilXTick[] = [];
    for (let k = 0; k < tickCount; k++) {
      const idx = Math.round((k / denom) * (n - 1));
      const ts = new Date(end - (n - 1 - idx) * 3_600_000);
      ticks.push({ x: this.actXScale(idx, n), label: `${ts.getDate()} ${MONTHS_SHORT[ts.getMonth()]}` });
    }
    return ticks;
  });

  // Projected cycle total (MB). Flat run-rate extrapolation of usage-so-far to
  // the full cycle (currentMb × cycleDays / elapsedDays) — a linear
  // approximation, NOT a predictive model. Rounded to 2 decimals.
  readonly billingProjectedMb = computed(() => {
    const b = this.data.billingUsage();
    if (b.elapsedDays <= 0) return b.currentMb;
    return Math.round(b.currentMb * (b.cycleDays / b.elapsedDays) * 100) / 100;
  });

  // Fill width for the cycle progress bar: current usage as a share of the
  // projected total, clamped to 0–100%.
  readonly billingFillPct = computed(() => {
    const projected = this.billingProjectedMb();
    if (projected <= 0) return 0;
    const pct = (this.data.billingUsage().currentMb / projected) * 100;
    return Math.max(0, Math.min(100, pct));
  });

  readonly severityIcon: Record<string, string> = {
    info: 'fa-solid fa-circle-info',
    warning: 'fa-solid fa-triangle-exclamation',
    error: 'fa-solid fa-circle-xmark',
    success: 'fa-solid fa-circle-check'
  };

  activeTab = 'identities';

  // ─── Usage pie breakdowns for the Network Overview tabs ───────────────
  /** SVG viewBox dimension, exposed for the template. */
  readonly pieSize = PIE.size;

  readonly identityUsage = computed<UsageBreakdown>(() =>
    buildUsageBreakdown(
      this.data.identities().map((i) => ({ name: i.name, usage: i.totalUsage ?? 0 })),
    ),
  );

  readonly serviceUsage = computed<UsageBreakdown>(() =>
    buildUsageBreakdown(
      this.data.services().map((s) => ({ name: s.name, usage: s.totalUsage ?? 0 })),
    ),
  );

  readonly routerUsage = computed<UsageBreakdown>(() =>
    buildUsageBreakdown(
      this.data.routers().map((r) => ({ name: r.name, usage: r.totalUsage ?? 0 })),
    ),
  );

  constructor() {
    effect(() => {
      if (this.allStepsComplete()) {
        this.data.isOnboarded.set(true);
      }
    });

    // Dev-only conservation guard for concern ids. Reactive so it re-checks
    // whenever any concern list changes (including live-data arrival). No-op in
    // prod. Loud on any collision — a dropped/merged concern must never pass
    // silently once dismiss/keying is built on these ids.
    if (isDevMode()) {
      effect(() => this.assertConcernIdConservation());
    }
  }

  /**
   * Assert that every Areas-of-Attention concern id is unique across the union
   * of the three lists, and that the union's id count equals the sum of the
   * three list lengths (no id silently deduped). On any collision, console.error
   * names the offending ids. Dev-only — called from an isDevMode-guarded effect.
   */
  private assertConcernIdConservation(): void {
    const ids = [
      ...this.latencyConcerns().map((c) => c.id),
      ...this.utilizationConcerns().map((c) => c.id),
      ...this.healthConcerns().map((c) => c.id),
    ];
    const unique = new Set(ids);
    if (unique.size === ids.length) return;

    const seen = new Set<string>();
    const collisions = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) collisions.add(id);
      seen.add(id);
    }
    console.error(
      `[dashboard] concern id conservation FAILED: ${ids.length} ids but only ${unique.size} unique. Colliding ids:`,
      [...collisions],
    );
  }

  verifyConnection(): void {
    this.data.connectionVerified.set(true);
  }

  eventClasses(severity: string): string {
    return `event-icon sev-${severity} ${this.severityIcon[severity] ?? ''}`;
  }

  formatTs(iso: string): string {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return iso;
    }
  }

  /** Compact "Nm/h/d ago" label for a last-seen ISO timestamp. */
  formatLastSeen(iso: string): string {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return iso;
    const diffMs = Date.now() - then;
    if (diffMs < 60_000) return 'just now';
    const min = Math.floor(diffMs / 60_000);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
  }
}
