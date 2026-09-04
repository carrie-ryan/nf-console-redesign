import { Component, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PillComponent } from '../../shared/components/pill/pill.component';
import { ConcernDismissStore } from './concern-dismiss.store';
import {
  ConcernListData,
  HealthConcern,
  LatencyConcern,
  UtilizationConcern,
} from './concern.models';

/**
 * Drawer body for the 'concern-list' type — renders the FULL (pre-cap) concern
 * set for one Areas-of-Attention panel as a plain SORTABLE table, reusing the
 * panel's columns. Dismiss (with inline two-step confirm) works exactly as on
 * the panel: both read the same ConcernDismissStore, so a dismissal here removes
 * the row from the drawer (this component re-filters) AND the panel.
 *
 * NO filter controls in this increment (part 1) — sortable columns only.
 */
@Component({
  selector: 'app-concern-list-content',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, PillComponent],
  templateUrl: './concern-list-content.component.html',
  styleUrl: './concern-list-content.component.css',
})
export class ConcernListContentComponent {
  private readonly store = inject(ConcernDismissStore);

  readonly data = input.required<ConcernListData>();

  /** Route the latency rows navigate to (mirrors the panel). */
  readonly latencyRoute = '/metrics/fabric-latency';

  // ─── Sort state (RoutersComponent sortCol/sortDir pattern) ───────────
  /** Active sort column key; '' keeps the incoming worst-first order. */
  readonly sortCol = signal<string>('');
  readonly sortDir = signal<'asc' | 'desc'>('asc');

  sortBy(col: string): void {
    if (this.sortCol() === col) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortCol.set(col);
      this.sortDir.set('asc');
    }
  }

  sortIconFor(col: string): string {
    if (this.sortCol() !== col) return 'fa-solid fa-sort';
    return this.sortDir() === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
  }

  /** Generic filter (dismissed removed) + sort by a per-column value extractor. */
  private filterSort<T extends { id: string }>(
    rows: T[],
    value: (r: T, col: string) => string | number,
  ): T[] {
    const visible = rows.filter((r) => !this.store.isDismissed(r.id));
    const col = this.sortCol();
    if (!col) return visible; // preserve incoming worst-first order
    const dir = this.sortDir();
    return [...visible].sort((a, b) => {
      const av = value(a, col);
      const bv = value(b, col);
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }

  // One typed computed per panel; the non-active ones return []. The template
  // switches on data().panel so only the active list is rendered.
  readonly visibleLatency = computed<LatencyConcern[]>(() => {
    const d = this.data();
    if (d.panel !== 'latency') return [];
    return this.filterSort(d.concerns, (r, col) =>
      col === 'peak' ? r.peakMs : `${r.source} → ${r.destination}`,
    );
  });

  readonly visibleUtilization = computed<UtilizationConcern[]>(() => {
    const d = this.data();
    if (d.panel !== 'utilization') return [];
    return this.filterSort(d.concerns, (r, col) =>
      col === 'util' ? r.utilizationPct : col === 'type' ? r.typeLabel : r.entityName,
    );
  });

  readonly visibleHealth = computed<HealthConcern[]>(() => {
    const d = this.data();
    if (d.panel !== 'health') return [];
    return this.filterSort(d.concerns, (r, col) =>
      col === 'status' ? r.status : col === 'type' ? r.typeLabel : col === 'lastSeen' ? r.lastSeenLabel : r.entityName,
    );
  });

  // ─── Per-row inline dismiss confirmation (mirrors DashboardComponent) ─
  private readonly pendingDismissId = signal<string | null>(null);

  isDismissPending(id: string): boolean {
    return this.pendingDismissId() === id;
  }
  requestDismiss(id: string): void {
    this.pendingDismissId.set(id);
  }
  confirmDismiss(id: string): void {
    this.store.dismiss(id);
    this.pendingDismissId.set(null);
  }
  cancelDismiss(): void {
    this.pendingDismissId.set(null);
  }
}
