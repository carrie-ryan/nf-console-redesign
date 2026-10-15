import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MockDataService, PostureCheck } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { ActionMenuComponent, ActionMenuItem } from '../../shared/components/action-menu/action-menu.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { UserPrefsService } from '../../shared/services/user-prefs.service';
import { providerSpec } from './provider-catalog';
import { builderReturn } from './return-to';
import { PolicyDraftStore } from '../policy-builder/draft/policy-draft.store';

/** What a ServiceProvider row shows about its connection. `missing` = connectionId resolves to nothing. */
type ConnectionDetail =
  | { missing: false; provider: string; name: string }
  | { missing: true; connectionId: string };

@Component({
  selector: 'app-posture-checks',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent, ActionMenuComponent, ConfirmDialogComponent],
  templateUrl: './posture-checks.component.html',
  styleUrl: './posture-checks.component.css'
})
export class PostureChecksComponent {
  readonly data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);
  private readonly router = inject(Router);

  /** `?returnTo=`: opened from the Policy Builder — "Back to Policy Builder" returns to that
   *  service (the draft is kept), and New / Edit carry it along. */
  readonly returnTo = input<string>();
  readonly back = computed(() => builderReturn(this.returnTo()));
  /** The builder's draft is open (it lives in a root store, so it outlasts this visit). */
  private readonly draft = inject(PolicyDraftStore);
  readonly hasDraft = computed(() => this.draft.ops().length > 0);
  readonly params = computed(() => {
    const back = this.back();
    return back ? { returnTo: back } : {};
  });

  /** A return url's query params ("?service=svc-004&with=…"), for routerLink. */
  returnQuery(url: string): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? ''));
  }

  /** Resolve a ServiceProvider check's connection; null for every other type. */
  connectionDetail(check: PostureCheck): ConnectionDetail | null {
    if (check.type !== 'ServiceProvider') return null;
    const conn = this.data.providerConnections().find(c => c.id === check.connectionId);
    if (!conn) return { missing: true, connectionId: check.connectionId ?? '' };
    return { missing: false, provider: providerSpec(conn.providerType)?.label ?? conn.providerType, name: conn.name };
  }

  conditionCount(check: PostureCheck): string {
    const n = check.conditions?.length ?? 0;
    return `${n} condition${n === 1 ? '' : 's'}`;
  }

  menuItems(check: PostureCheck): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
      { label: 'Edit', icon: 'fa-solid fa-pen', onClick: () => this.router.navigate(['/posture-checks', check.id, 'edit'], { queryParams: this.params() }) },
    ];
    // View API has no target yet — shown disabled.
    if (this.prefs.isPowerUser()) {
      items.push({ label: 'View API', icon: 'fa-solid fa-code', disabled: true, onClick: () => {} });
    }
    items.push({ label: 'Delete', icon: 'fa-solid fa-trash', danger: true, onClick: () => this.deletingCheckId.set(check.id) });
    return items;
  }

  // ─── Delete ──────────────────────────────────────────────────────
  /** Check id whose Delete confirm dialog is open (null = closed). */
  readonly deletingCheckId = signal<string | null>(null);

  readonly deletingCheck = computed<PostureCheck | null>(
    () => this.data.postureChecks().find(c => c.id === this.deletingCheckId()) ?? null,
  );

  deleteMessage(check: PostureCheck): string {
    const connNote = check.type === 'ServiceProvider' ? ' Its provider connection is kept.' : '';
    return `“${check.name}” will be removed. This can't be undone.${connNote}`;
  }

  deleteCheck(id: string): void {
    this.data.postureChecks.update(list => list.filter(c => c.id !== id));
    this.deletingCheckId.set(null);
  }
}
