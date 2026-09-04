import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { TruncatedCellComponent } from '../../shared/components/truncated-cell/truncated-cell.component';
import { PillComponent, PillVariant } from '../../shared/components/pill/pill.component';
import { UserPrefsService, RouterColumnVisibility } from '../../shared/services/user-prefs.service';

type RouterTab = 'routers' | 'transit';

@Component({
  selector: 'app-routers',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent, TruncatedCellComponent, PillComponent],
  templateUrl: './routers.component.html',
  styleUrl: './routers.component.css'
})
export class RoutersComponent {
  readonly data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);

  readonly activeTab = signal<RouterTab>('routers');
  readonly filterText = signal('');
  readonly openMenuId = signal<string | null>(null);

  readonly visibleColumns = signal<RouterColumnVisibility>(this.prefs.routerColumns());
  readonly sortCol = signal('name');
  readonly sortDir = signal<'asc' | 'desc'>('asc');
  readonly page = signal(0);
  readonly pageSize = 20;
  readonly selectedIds = signal<Set<string>>(new Set());

  readonly filteredRouters = computed(() => {
    const q = this.filterText().toLowerCase().trim();
    if (!q) return this.data.routers();
    return this.data.routers().filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.location ?? '').toLowerCase().includes(q) ||
      r.version.includes(q) ||
      r.attributes.some(a => a.toLowerCase().includes(q)) ||
      (r.cloudProvider ?? '').toLowerCase().includes(q)
    );
  });

  readonly filteredTransit = computed(() => {
    const q = this.filterText().toLowerCase().trim();
    if (!q) return this.data.transitRouters();
    return this.data.transitRouters().filter(r => r.name.toLowerCase().includes(q));
  });

  readonly sortedRouters = computed(() => {
    const col = this.sortCol();
    const dir = this.sortDir();
    return [...this.filteredRouters()].sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[col] ?? '').toLowerCase();
      const bv = String((b as unknown as Record<string, unknown>)[col] ?? '').toLowerCase();
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  });

  readonly sortedTransit = computed(() => {
    const col = this.sortCol();
    const dir = this.sortDir();
    return [...this.filteredTransit()].sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[col] ?? '').toLowerCase();
      const bv = String((b as unknown as Record<string, unknown>)[col] ?? '').toLowerCase();
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  });

  readonly pagedRouters = computed(() => {
    const s = this.page() * this.pageSize;
    return this.sortedRouters().slice(s, s + this.pageSize);
  });

  readonly pagedTransit = computed(() => {
    const s = this.page() * this.pageSize;
    return this.sortedTransit().slice(s, s + this.pageSize);
  });

  readonly routerTotal = computed(() => this.filteredRouters().length);
  readonly routerStart = computed(() => this.routerTotal() === 0 ? 0 : this.page() * this.pageSize + 1);
  readonly routerEnd = computed(() => Math.min((this.page() + 1) * this.pageSize, this.routerTotal()));
  readonly isLastRouterPage = computed(() => this.routerEnd() >= this.routerTotal());

  readonly transitTotal = computed(() => this.filteredTransit().length);
  readonly transitStart = computed(() => this.transitTotal() === 0 ? 0 : this.page() * this.pageSize + 1);
  readonly transitEnd = computed(() => Math.min((this.page() + 1) * this.pageSize, this.transitTotal()));
  readonly isLastTransitPage = computed(() => this.transitEnd() >= this.transitTotal());

  readonly allPageRoutersSelected = computed(() => {
    const items = this.pagedRouters();
    return items.length > 0 && items.every(r => this.selectedIds().has(r.id));
  });
  readonly somePageRoutersSelected = computed(() => this.pagedRouters().some(r => this.selectedIds().has(r.id)));

  readonly allPageTransitSelected = computed(() => {
    const items = this.pagedTransit();
    return items.length > 0 && items.every(r => this.selectedIds().has(r.id));
  });
  readonly somePageTransitSelected = computed(() => this.pagedTransit().some(r => this.selectedIds().has(r.id)));

  setTab(tab: RouterTab): void {
    this.activeTab.set(tab);
    this.filterText.set('');
    this.openMenuId.set(null);
    this.page.set(0);
    this.selectedIds.set(new Set());
    this.sortCol.set('name');
    this.sortDir.set('asc');
  }

  setFilter(value: string): void {
    this.filterText.set(value);
    this.page.set(0);
  }

  toggleColumn(key: keyof RouterColumnVisibility): void {
    const updated = { ...this.visibleColumns(), [key]: !this.visibleColumns()[key] };
    this.visibleColumns.set(updated);
    this.prefs.setRouterColumns(updated);
  }

  sortBy(col: string): void {
    if (this.sortCol() === col) {
      this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortCol.set(col);
      this.sortDir.set('asc');
    }
    this.page.set(0);
  }

  sortIconFor(col: string): string {
    if (this.sortCol() !== col) return 'fa-solid fa-sort';
    return this.sortDir() === 'asc' ? 'fa-solid fa-arrow-up' : 'fa-solid fa-arrow-down';
  }

  provisionVariant(status: string): PillVariant {
    if (status === 'PROVISIONED') return 'active';
    if (status === 'PROVISIONING') return 'warning';
    return 'offline';
  }

  firstPage(): void { this.page.set(0); }
  prevPage(): void { this.page.update(p => Math.max(0, p - 1)); }
  nextPage(total: number): void {
    this.page.update(p => Math.min(p + 1, Math.max(0, Math.ceil(total / this.pageSize) - 1)));
  }
  lastPage(total: number): void {
    this.page.set(Math.max(0, Math.ceil(total / this.pageSize) - 1));
  }

  toggleSelect(id: string): void {
    this.selectedIds.update(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  selectAllPage(items: { id: string }[]): void {
    const ids = items.map(i => i.id);
    const allSel = ids.every(id => this.selectedIds().has(id));
    this.selectedIds.update(s => {
      const next = new Set(s);
      if (allSel) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  clearSelection(): void { this.selectedIds.set(new Set()); }

  toggleMenu(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.update(current => current === id ? null : id);
  }

  closeMenu(): void { this.openMenuId.set(null); }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }
}
