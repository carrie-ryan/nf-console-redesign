import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { PROVIDER_CATALOG, providerSpec } from '../posture-checks/provider-catalog';
import { ProviderPickerComponent } from '../posture-checks/provider-picker.component';
import { ProviderConnectionFormComponent } from '../posture-checks/provider-connection-form.component';
import type { ProviderConnection, ProviderType } from '../posture-checks/provider-connection.models';

/**
 * Add a provider connection without a posture check: pick a provider, then fill in the
 * shared connection form. Saving stores the connection and opens its detail page.
 */
@Component({
  selector: 'app-add-provider',
  standalone: true,
  imports: [RouterLink, ProviderPickerComponent, ProviderConnectionFormComponent],
  templateUrl: './add-provider.component.html',
  styleUrl: './add-provider.component.css'
})
export class AddProviderComponent {
  private readonly data = inject(MockDataService);
  private readonly router = inject(Router);

  readonly providerOptions = PROVIDER_CATALOG;
  readonly providerType = signal<ProviderType | ''>('');
  readonly spec = computed(() => {
    const type = this.providerType();
    return type ? providerSpec(type) : undefined;
  });

  onSaved(conn: ProviderConnection): void {
    this.data.providerConnections.update(list => [...list, conn]);
    this.router.navigate(['/external-providers', conn.id]);
  }

  onCancelled(): void {
    this.router.navigate(['/external-providers']);
  }
}
