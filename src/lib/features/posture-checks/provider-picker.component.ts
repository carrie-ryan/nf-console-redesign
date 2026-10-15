import { Component, computed, input, output } from '@angular/core';
import type { ProviderSpec, ProviderType } from './provider-connection.models';
import { DisclosurePicker } from './disclosure-picker';

/** The generic HTTP-endpoint provider — offered as "Add new provider", not as a list row. */
export const CUSTOM_PROVIDER: ProviderType = 'Custom';

/**
 * Provider chooser for the ServiceProvider sub-form: the catalog's named providers,
 * then an "Add new provider" action that picks the Custom (customer-run endpoint)
 * provider. CONTROLLED — the parent owns the selection; this only emits picks.
 * Shares the connection picker's look (same stylesheet) and DisclosurePicker behavior.
 */
@Component({
  selector: 'app-provider-picker',
  standalone: true,
  templateUrl: './provider-picker.component.html',
  styleUrl: './connection-picker.component.css',
})
export class ProviderPickerComponent extends DisclosurePicker {
  readonly providers = input.required<ProviderSpec[]>();
  readonly selectedType = input<ProviderType | ''>('');
  /** id for the trigger button, so the field's <label for> points at it. */
  readonly triggerId = input('sp-provider');

  readonly picked = output<ProviderType>();

  readonly listed = computed(() => this.providers().filter(p => p.providerType !== CUSTOM_PROVIDER));
  readonly selected = computed(() => this.providers().find(p => p.providerType === this.selectedType()));

  pick(type: ProviderType): void {
    this.close();
    if (type !== this.selectedType()) this.picked.emit(type);
  }

  addNew(): void {
    this.pick(CUSTOM_PROVIDER);
  }
}
