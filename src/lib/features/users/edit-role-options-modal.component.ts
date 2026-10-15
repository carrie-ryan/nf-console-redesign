import { Component, computed, input, output, signal } from '@angular/core';
import { OrgRole } from '../../shared/services/mock-data.service';
import { ModalShellComponent } from '../../shared/components/modal-shell/modal-shell.component';

/** The two org-level options the modal edits, for one role. */
export interface RoleOptionUpdate {
  roleId: string;
  isDefault: boolean;
  grantableByDefault: boolean;
}

type OptionKey = 'isDefault' | 'grantableByDefault';

/**
 * Edit the org-level options on ONE role — the redesign of the legacy
 * "EDIT ROLE OPTIONS" dialog, opened from a row on the User Roles tab. Both
 * options describe what the role does to NEW members at invite time:
 *
 *  - Default role         → included when an invite uses "Use default roles".
 *  - Grantable by default → presets that invite's per-user "Can grant to
 *                           others" toggle, which the admin can still override.
 *
 * Edits land in a local override and only reach the service on Save, so Cancel
 * genuinely discards. Wraps `app-modal-shell` for the focus trap, Escape,
 * backdrop dismiss, and focus restore.
 */
@Component({
  selector: 'app-edit-role-options-modal',
  standalone: true,
  imports: [ModalShellComponent],
  templateUrl: './edit-role-options-modal.component.html',
  styleUrl: './edit-role-options-modal.component.css'
})
export class EditRoleOptionsModalComponent {
  readonly role = input.required<OrgRole>();

  readonly saved = output<RoleOptionUpdate>();
  readonly cancelled = output<void>();

  /** Null until the user touches something — the "override ?? derived" idiom
   *  used elsewhere in this repo. Reading the role through a computed also means
   *  the seed can't go stale the way a constructor-time copy would. */
  private readonly override = signal<Record<OptionKey, boolean> | null>(null);

  private readonly original = computed<Record<OptionKey, boolean>>(() => ({
    isDefault: this.role().isDefault ?? false,
    grantableByDefault: this.role().grantableByDefault ?? false,
  }));

  readonly options = computed(() => this.override() ?? this.original());

  readonly dirty = computed(() => {
    const o = this.override();
    if (o === null) return false;
    const orig = this.original();
    return o.isDefault !== orig.isDefault || o.grantableByDefault !== orig.grantableByDefault;
  });

  toggle(key: OptionKey): void {
    const cur = this.options();
    this.override.set({ ...cur, [key]: !cur[key] });
  }

  cancel(): void { this.cancelled.emit(); }

  save(): void {
    if (!this.dirty()) return;
    this.saved.emit({ roleId: this.role().id, ...this.options() });
  }
}
