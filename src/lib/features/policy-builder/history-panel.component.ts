import { Component, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PolicyDraftStore } from './draft/policy-draft.store';

/**
 * Side panel listing this session's commits, newest first — each with who made it
 * ("You", or someone outside the builder: "Terraform"), its change lines and "Revert". Revert replaces the (empty) draft with the commit's inverse ops
 * and hands over to the draft review; it never writes live itself. Entities changed
 * since the commit are listed here as conflicts and left out of the revert draft.
 */
@Component({
  selector: 'app-history-panel',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './history-panel.component.html',
  styleUrls: ['./policy-editor.component.css', './tag-input.css', './history-panel.component.css'],
})
export class HistoryPanelComponent {
  private readonly store = inject(PolicyDraftStore);
  readonly closed = output<void>();
  /** A revert draft was built — review it. */
  readonly reverted = output<void>();

  readonly commits = this.store.history;

  /** Revert needs an empty draft. */
  readonly draftPending = computed(() => this.store.ops().length > 0);

  /** The last revert tried here that left nothing to revert: its conflicts, by commit. */
  readonly conflictsOnly = signal<{ commitId: string; conflicts: string[] } | null>(null);
  readonly error = signal<string | null>(null);

  revertedBy(commitId: string): string | null {
    return this.store.history().find((c) => c.revertOf === commitId)?.id ?? null;
  }

  revert(commitId: string): void {
    try {
      const conflicts = this.store.startRevert(commitId);
      this.error.set(null);
      if (this.store.ops().length) {
        this.conflictsOnly.set(null);
        this.reverted.emit();
      } else {
        this.conflictsOnly.set({ commitId, conflicts });
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
