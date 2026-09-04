import type { UtilizationEntityType } from '../../data-access/template-search.service';

/**
 * Row shapes for the three Areas-of-Attention concern panels. Extracted here (out
 * of DashboardComponent) so the panel AND the "Show more" drawer body can share
 * one definition. The id-building logic stays in DashboardComponent — these are
 * data-only projections.
 */

/** One ranked row in the High Latency Links concern panel. */
export interface LatencyConcern {
  /** Stable, collision-resistant id (see buildLatencyConcernId). */
  id: string;
  linkKey: string;
  source: string;
  destination: string;
  /** Peak (max) latency across the link's series, in ms, rounded. */
  peakMs: number;
}

/** One ranked row in the High Utilization concern panel. */
export interface UtilizationConcern {
  /** Stable, collision-resistant id (see buildUtilizationConcernId). */
  id: string;
  entityName: string;
  entityType: UtilizationEntityType;
  /** Human label for the type tag: 'Service' | 'Identity' | 'Router'. */
  typeLabel: string;
  utilizationPct: number;
}

/** One ranked row in the Unhealthy Entities concern panel. */
export interface HealthConcern {
  /** Stable, collision-resistant id (see buildHealthConcernId). */
  id: string;
  entityName: string;
  typeLabel: string;
  /** offline | degraded — drives the app-pill variant. */
  status: 'offline' | 'degraded';
  /** Relative "N ago" label derived from lastSeen. */
  lastSeenLabel: string;
}

/** Which Areas-of-Attention panel a concern list belongs to. */
export type ConcernPanel = 'latency' | 'utilization' | 'health';

/**
 * Payload for the 'concern-list' drawer — the FULL (pre-cap) concern set for one
 * panel, with dismissed ids already filtered out at open time. Discriminated on
 * `panel` so the drawer body renders the right columns. The body additionally
 * re-filters against the dismiss store so a dismissal made inside the drawer
 * removes the row live (and the underlying panel, which reads the same store).
 */
export type ConcernListData =
  | { panel: 'latency'; title: string; subtitle?: string; concerns: LatencyConcern[] }
  | { panel: 'utilization'; title: string; subtitle?: string; concerns: UtilizationConcern[] }
  | { panel: 'health'; title: string; subtitle?: string; concerns: HealthConcern[] };
