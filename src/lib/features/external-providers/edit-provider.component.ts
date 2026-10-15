import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { providerSpec } from '../posture-checks/provider-catalog';
import { ProviderConnectionFormComponent } from '../posture-checks/provider-connection-form.component';
import type { ProviderConnection } from '../posture-checks/provider-connection.models';

/**
 * Edit one provider connection in the shared connection form. The provider type is fixed:
 * checks store conditions keyed to that provider's attributes. Saving replaces the connection
 * (same id) and returns to its detail page.
 */
@Component({
  selector: 'app-edit-provider',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent, ProviderConnectionFormComponent],
  templateUrl: './edit-provider.component.html',
  // Same page frame as Add provider.
  styleUrl: './add-provider.component.css'
})
export class EditProviderComponent {
  private readonly data = inject(MockDataService);
  private readonly router = inject(Router);

  /** Route param `:id`. */
  readonly id = input.required<string>();

  /** Live, so a mode flip made elsewhere reaches the open form. */
  readonly connection = computed(() => this.data.providerConnections().find(c => c.id === this.id()));
  readonly providerLabel = computed(() => {
    const conn = this.connection();
    return conn ? providerSpec(conn.providerType)?.label ?? conn.providerType : '';
  });
  readonly usedBy = computed(() => this.data.postureChecks().filter(c => c.connectionId === this.id()));

  onSaved(conn: ProviderConnection): void {
    this.data.providerConnections.update(list => list.map(c => c.id === conn.id ? conn : c));
    this.router.navigate(['/external-providers', conn.id]);
  }

  onCancelled(): void {
    this.router.navigate(['/external-providers', this.id()]);
  }
}
