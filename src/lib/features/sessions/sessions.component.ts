import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { TruncatedCellComponent } from '../../shared/components/truncated-cell/truncated-cell.component';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

type SessionTab = 'sessions' | 'api-sessions';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent, TruncatedCellComponent],
  templateUrl: './sessions.component.html',
  styleUrl: './sessions.component.css'
})
export class SessionsComponent {
  readonly data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);
  private readonly router = inject(Router);

  readonly activeTab = signal<SessionTab>('sessions');
  readonly filterText = signal('');
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly openMenuId = signal<string | null>(null);

  readonly filteredSessions = computed(() => {
    const q = this.filterText().toLowerCase().trim();
    if (!q) return this.data.sessions();
    return this.data.sessions().filter(s =>
      s.id.toLowerCase().includes(q) ||
      s.serviceName.toLowerCase().includes(q) ||
      s.serviceId.toLowerCase().includes(q) ||
      s.edgeRouters.some(r => r.name.toLowerCase().includes(q)) ||
      s.type.toLowerCase().includes(q)
    );
  });

  readonly filteredApiSessions = computed(() => {
    const q = this.filterText().toLowerCase().trim();
    if (!q) return this.data.apiSessions();
    return this.data.apiSessions().filter(s =>
      s.id.toLowerCase().includes(q) ||
      s.token.toLowerCase().includes(q) ||
      s.identityName.toLowerCase().includes(q)
    );
  });

  setTab(tab: SessionTab): void {
    this.activeTab.set(tab);
    this.filterText.set('');
    this.selectedIds.set(new Set());
    this.openMenuId.set(null);
  }

  toggleMenu(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.update(current => current === id ? null : id);
  }

  closeMenu(): void {
    this.openMenuId.set(null);
  }

  navigateToDetail(id: string): void {
    this.router.navigate(['/sessions', id]);
  }

  toggleSelect(id: string): void {
    this.selectedIds.update(set => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  toggleSelectAll(): void {
    const all = this.filteredSessions().map(s => s.id);
    const current = this.selectedIds();
    if (all.every(id => current.has(id))) {
      this.selectedIds.set(new Set());
    } else {
      this.selectedIds.set(new Set(all));
    }
  }

  isAllSelected(): boolean {
    const filtered = this.filteredSessions();
    return filtered.length > 0 && filtered.every(s => this.selectedIds().has(s.id));
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  edgeRouterNames(routers: Array<{ id: string; name: string }>): string {
    return routers.map(r => r.name).join(', ');
  }
}
