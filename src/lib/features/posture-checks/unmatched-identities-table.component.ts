import { Component, computed, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ImportMappingsModalComponent } from './import-mappings-modal.component';
import type { UnmatchedIdentity } from './device-matching';
import type { IdentityMapping } from './provider-connection.models';

/**
 * The unmatched sample identities for the connection's strategy, each with an
 * inline "Device ID + Map" control, plus bulk resolution through the shared mock
 * CSV import. Controlled: emits mappings and leaves persisting
 * them to the parent.
 */
@Component({
  selector: 'app-unmatched-identities-table',
  standalone: true,
  imports: [DecimalPipe, ImportMappingsModalComponent],
  templateUrl: './unmatched-identities-table.component.html',
  styleUrl: './unmatched-identities-table.component.css',
})
export class UnmatchedIdentitiesTableComponent {
  readonly rows = input.required<UnmatchedIdentity[]>();
  /** Display-scaled unmatched total, for "Showing N of M". */
  readonly scaledCount = input.required<number>();
  /** The connection's saved manual mappings — pre-fills each row's Device ID. */
  readonly mappings = input<IdentityMapping[]>([]);
  /** Whether the connection matches by manual mapping — only changes the hint's wording. */
  readonly manualKey = input(false);
  /** Provider display name, for the import copy ("CrowdStrike device ID"). */
  readonly providerLabel = input('');

  /** One pin from a row's Map, or a batch from Import. */
  readonly mapped = output<IdentityMapping[]>();

  /** Device ID typed into a row but not yet mapped, by identity id. */
  private readonly drafts = signal<Record<string, string>>({});

  private readonly savedById = computed(() => new Map(this.mappings().map(m => [m.identityId, m.externalDeviceId])));

  /** Rows that can be pinned — service identities have no device. */
  readonly mappable = computed(() => this.rows().filter(r => r.identity.kind !== 'service'));
  /** What the shared import dialog pins. */
  readonly mappableIdentities = computed(() => this.mappable().map(r => r.identity));

  readonly importOpen = signal(false);
  /** "Mapped N identities from CSV." after an import; cleared by the next action. */
  readonly importNote = signal<string | null>(null);

  saved(identityId: string): string | undefined {
    return this.savedById().get(identityId);
  }

  value(identityId: string): string {
    return this.drafts()[identityId] ?? this.saved(identityId) ?? '';
  }

  setDraft(identityId: string, v: string): void {
    this.drafts.update(d => ({ ...d, [identityId]: v }));
  }

  /** Mappable when there's a device id that differs from the saved one. */
  canMap(identityId: string): boolean {
    const v = this.value(identityId).trim();
    return !!v && v !== this.saved(identityId);
  }

  map(identityId: string): void {
    if (!this.canMap(identityId)) return;
    this.importNote.set(null);
    this.mapped.emit([{ identityId, externalDeviceId: this.value(identityId).trim() }]);
    this.drafts.update(({ [identityId]: _, ...rest }) => rest);
  }

  /** The shared import dialog's batch — passed up for the overview to commit. */
  onImported(batch: IdentityMapping[]): void {
    this.importOpen.set(false);
    if (!batch.length) return;
    this.mapped.emit(batch);
    this.importNote.set(`Mapped ${batch.length} identities from CSV.`);
  }
}
