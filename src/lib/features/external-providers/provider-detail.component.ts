import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { providerSpec } from '../posture-checks/provider-catalog';
import { acquisitionSummary, matchSummary, modeLabel, needsAttention } from '../posture-checks/connection-summary';
import { CopyFieldComponent } from '../posture-checks/copy-field.component';
import { DeviceMatchingOverviewComponent } from '../posture-checks/device-matching-overview.component';
import { DeleteProviderDialogComponent } from './delete-provider-dialog.component';
import type { ConnectionMode, ProviderConnection } from '../posture-checks/provider-connection.models';

/** One row of the Connection card: a credential field's label and what may be shown for it. */
interface SettingRow {
  label: string;
  /** Secrets are write-only and never stored — shown masked, never with a value. */
  secret: boolean;
  /** The saved non-secret value; null when nothing was recorded. Always null for a secret. */
  value: string | null;
}

/**
 * One provider connection: an Overview tab (settings, acquisition, matching, the checks
 * that read from it) and a Device matching tab, which is the existing device-matching
 * overview. The tab rides on ?tab= (absent = overview). Read-only apart from
 * the observe ↔ enforce flip; Edit opens the connection form on its own page, Delete the delete dialog.
 */
@Component({
  selector: 'app-provider-detail',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent, CopyFieldComponent, DeviceMatchingOverviewComponent, DeleteProviderDialogComponent],
  templateUrl: './provider-detail.component.html',
  styleUrl: './provider-detail.component.css'
})
export class ProviderDetailComponent {
  private readonly data = inject(MockDataService);
  private readonly router = inject(Router);

  /** Route param `:id`. */
  readonly id = input.required<string>();
  /** Query param `tab`; anything but 'matching' shows the overview. */
  readonly tab = input<string | undefined>();

  readonly activeTab = computed(() => (this.tab() === 'matching' ? 'matching' : 'overview'));

  readonly modeLabel = modeLabel;
  readonly needsAttention = needsAttention;
  readonly matchSummary = matchSummary;

  readonly connection = computed(() => this.data.providerConnections().find(c => c.id === this.id()));
  readonly spec = computed(() => {
    const conn = this.connection();
    return conn ? providerSpec(conn.providerType) : undefined;
  });
  readonly providerLabel = computed(() => this.spec()?.label ?? this.connection()?.providerType ?? '');

  /** "Polls every 15 min" / "Receives events". */
  readonly acquisition = computed(() => {
    const conn = this.connection();
    if (!conn) return '';
    const phrase = acquisitionSummary(conn);
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  });

  /**
   * The provider's credential fields in catalog order. Non-secret values come from what the
   * connection kept (endpoint, customerId, settings); secrets are never stored, so never shown.
   */
  readonly settings = computed<SettingRow[]>(() => {
    const conn = this.connection();
    const spec = this.spec();
    if (!conn || !spec) return [];
    const saved: Record<string, string | undefined> = {
      ...conn.settings,
      ...(conn.endpoint ? { api_url: conn.endpoint } : {}),
      ...(conn.customerId ? { customer_id: conn.customerId } : {}),
    };
    return spec.credentialFields.map(f => ({
      label: f.label,
      secret: !!f.secret,
      value: f.secret ? null : saved[f.key] || null,
    }));
  });

  readonly usedBy = computed(() => this.data.postureChecks().filter(c => c.connectionId === this.id()));

  /** The connection the delete dialog is open for; null when closed. */
  readonly deleting = signal<ProviderConnection | null>(null);

  onDeleted(): void {
    this.deleting.set(null);
    this.router.navigate(['/external-providers']);
  }

  /** Deliberate observe ↔ enforce flip; affects every check that reads from this connection. */
  setMode(mode: ConnectionMode): void {
    this.data.providerConnections.update(list => list.map(c => c.id !== this.id() ? c : { ...c, mode }));
  }
}
