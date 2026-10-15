import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { ActionMenuComponent, ActionMenuItem } from '../../shared/components/action-menu/action-menu.component';
import { providerSpec } from '../posture-checks/provider-catalog';
import { acquisitionSummary, matchSummary, modeLabel, needsAttention } from '../posture-checks/connection-summary';
import type { ProviderConnection } from '../posture-checks/provider-connection.models';
import { DeleteProviderDialogComponent } from './delete-provider-dialog.component';

/**
 * External providers: the configured posture-provider connections. Connections are added here
 * (Add provider) or from a Service Provider posture check; this page lists them and links
 * each to its detail page.
 */
@Component({
  selector: 'app-external-providers',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent, ActionMenuComponent, DeleteProviderDialogComponent],
  templateUrl: './external-providers.component.html',
  styleUrl: './external-providers.component.css'
})
export class ExternalProvidersComponent {
  readonly data = inject(MockDataService);
  private readonly router = inject(Router);

  open(conn: ProviderConnection): void {
    this.router.navigate(['/external-providers', conn.id]);
  }

  readonly acquisitionSummary = acquisitionSummary;
  readonly matchSummary = matchSummary;
  readonly modeLabel = modeLabel;
  readonly needsAttention = needsAttention;

  providerLabel(conn: ProviderConnection): string {
    return providerSpec(conn.providerType)?.label ?? conn.providerType;
  }

  /** "2 checks" / "1 check" / "Not used" — posture checks reading from this connection. */
  usedBy(conn: ProviderConnection): string {
    const n = this.data.postureChecks().filter(c => c.connectionId === conn.id).length;
    return n === 0 ? 'Not used' : `${n} check${n === 1 ? '' : 's'}`;
  }

  /** The connection the delete dialog is open for; null when closed. Deleting from here stays on the list. */
  readonly deleting = signal<ProviderConnection | null>(null);

  menuItems(conn: ProviderConnection): ActionMenuItem[] {
    return [
      { label: 'Device matching', icon: 'fa-solid fa-link',
        onClick: () => this.router.navigate(['/external-providers', conn.id], { queryParams: { tab: 'matching' } }) },
      { label: 'Delete', icon: 'fa-solid fa-trash', danger: true, onClick: () => this.deleting.set(conn) },
    ];
  }
}
