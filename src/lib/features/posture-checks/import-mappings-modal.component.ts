import { Component, computed, input, output } from '@angular/core';
import { ModalShellComponent } from '../../shared/components/modal-shell/modal-shell.component';
import type { MatchSampleIdentity } from './device-matching';
import type { IdentityMapping } from './provider-connection.models';

/**
 * Mock "Import identity → device mappings" CSV dialog, shared by the device-matching
 * overview and the create form's manual mapping table. No file is read: confirming
 * pins every identity the host passed in to a placeholder device id, as a CSV of
 * those pairs would.
 *
 * Controlled and write-free: it EMITS the batch and the host commits it — the
 * overview writes to the saved connection, the create form merges into its
 * unsaved rows. The host also owns open/close (render it inside an @if).
 */
@Component({
  selector: 'app-import-mappings-modal',
  standalone: true,
  imports: [ModalShellComponent],
  templateUrl: './import-mappings-modal.component.html',
  styleUrl: './import-mappings-modal.component.css',
})
export class ImportMappingsModalComponent {
  /** Identities the import would pin — the host's own unmatched set. */
  readonly identities = input.required<MatchSampleIdentity[]>();
  /** Provider display name for the copy ("the CrowdStrike device ID"). */
  readonly providerLabel = input('');

  /** The pairs to commit; the host closes the dialog. */
  readonly imported = output<IdentityMapping[]>();
  /** Cancel, Escape or backdrop. */
  readonly dismissed = output<void>();

  /** Service identities have no device, so they're never pinned — whatever the host passed. */
  readonly mappable = computed(() => this.identities().filter(i => i.kind !== 'service'));

  confirm(): void {
    this.imported.emit(this.mappable().map(i => ({ identityId: i.id, externalDeviceId: `CSV-IMPORT-${i.id}` })));
  }
}
