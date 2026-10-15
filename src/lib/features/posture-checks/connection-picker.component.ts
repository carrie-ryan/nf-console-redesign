import { Component, computed, input, output } from '@angular/core';
import type { ProviderConnection } from './provider-connection.models';
import { connectionDetails, needsAttention } from './connection-summary';
import { DisclosurePicker } from './disclosure-picker';

/**
 * Connection chooser for the ServiceProvider sub-form: a custom dropdown whose
 * rows each carry an Edit button beside the connection they belong to.
 *
 * CONTROLLED — the parent owns which connection is selected and whether a new
 * one is being created; this only emits intents. Open/keyboard behavior comes
 * from DisclosurePicker.
 */
@Component({
  selector: 'app-connection-picker',
  standalone: true,
  templateUrl: './connection-picker.component.html',
  styleUrl: './connection-picker.component.css',
})
export class ConnectionPickerComponent extends DisclosurePicker {
  readonly connections = input.required<ProviderConnection[]>();
  readonly selectedId = input<string | null>(null);
  /** The user chose "New connection" — shown in the trigger in place of a name. */
  readonly creating = input(false);
  /** id for the trigger button, so the field's <label for> points at it. */
  readonly triggerId = input('sp-connection');

  readonly picked = output<string>();
  readonly editRequested = output<string>();
  readonly createRequested = output<void>();

  readonly selected = computed(() => this.connections().find(c => c.id === this.selectedId()));

  readonly needsAttention = needsAttention;
  readonly details = connectionDetails;

  pick(id: string): void {
    this.close();
    this.picked.emit(id);
  }

  edit(id: string): void {
    this.close();
    this.editRequested.emit(id);
  }

  createNew(): void {
    this.close();
    this.createRequested.emit();
  }
}
