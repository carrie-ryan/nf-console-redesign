import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { ToastService } from '../../shared/services/toast.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { ModalShellComponent } from '../../shared/components/modal-shell/modal-shell.component';
import type { ProviderConnection } from '../posture-checks/provider-connection.models';

/**
 * Delete one provider connection — or explain why it can't be. While any posture check reads
 * from it, deletion isn't offered (a check must never point at a deleted provider): a modal
 * lists those checks with only Close. Otherwise a danger confirm; on confirm the connection is
 * removed, a "Deleted …" toast shows, and `deleted` fires so the host can navigate.
 */
@Component({
  selector: 'app-delete-provider-dialog',
  standalone: true,
  imports: [RouterLink, ConfirmDialogComponent, ModalShellComponent],
  template: `
    @if (usedBy().length; as used) {
      <!-- ConfirmDialog always shows a confirm button, so the blocked case uses the bare modal frame. -->
      <app-modal-shell (dismissed)="closed.emit()">
        <span modal-title>Can't delete {{ connection().name }}</span>
        <p class="dp-copy">Used by {{ used }} posture check{{ used === 1 ? '' : 's' }}. Remove it from these checks first:</p>
        <ul class="dp-checks">
          @for (check of usedBy(); track check.id) {
            <li><a [routerLink]="['/posture-checks', check.id, 'edit']" (click)="closed.emit()">{{ check.name }}</a></li>
          }
        </ul>
        <ng-container modal-footer>
          <button type="button" class="btn btn-secondary" (click)="closed.emit()">Close</button>
        </ng-container>
      </app-modal-shell>
    } @else {
      <app-confirm-dialog [title]="'Delete ' + connection().name + '?'" [message]="confirmMessage()"
        confirmLabel="Delete" [danger]="true" (confirmed)="delete()" (cancelled)="closed.emit()" />
    }
  `,
  styles: `
    .dp-copy { margin: 0 0 0.5rem; font-size: 0.875rem; color: var(--color-text-2); }
    .dp-checks { margin: 0; padding-left: 1.125rem; font-size: 0.875rem; display: flex; flex-direction: column; gap: 0.25rem; }
    .dp-checks a { color: var(--brand-primary); font-weight: 500; text-decoration: none; }
    .dp-checks a:hover { text-decoration: underline; }
  `,
})
export class DeleteProviderDialogComponent {
  private readonly data = inject(MockDataService);
  private readonly toast = inject(ToastService);

  readonly connection = input.required<ProviderConnection>();

  /** The connection was removed. */
  readonly deleted = output<void>();
  /** Dismissed without deleting (Cancel, Close, backdrop, or following a check link). */
  readonly closed = output<void>();

  readonly usedBy = computed(() => this.data.postureChecks().filter(c => c.connectionId === this.connection().id));

  readonly confirmMessage = computed(() => {
    const n = this.connection().manualMappings?.length ?? 0;
    return "This can't be undone." + (n ? ` Its ${n} device mapping${n === 1 ? ' is' : 's are'} deleted too.` : '');
  });

  delete(): void {
    const { id, name } = this.connection();
    // Re-checked at the moment of deletion, not just when the dialog opened.
    if (this.data.postureChecks().some(c => c.connectionId === id)) return;
    this.data.providerConnections.update(list => list.filter(c => c.id !== id));
    this.toast.show(`Deleted ${name}`);
    this.deleted.emit();
  }
}
