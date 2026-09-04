import { Injectable, computed, signal } from '@angular/core';

/**
 * In-memory dismiss store for Areas-of-Attention concerns (POC). Signal-backed,
 * one-way: a concern id can be dismissed but not restored, and NOTHING is
 * persisted — state is ephemeral and resets on reload by design. Mirrors the
 * lightweight signal-store pattern used elsewhere (e.g. discovery's
 * proposed-policy-store) but deliberately smaller and WITHOUT localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ConcernDismissStore {
  /** Ids of concerns the user has dismissed this session. */
  private readonly ids = signal<Set<string>>(new Set());

  /** Total dismissed across all panels (set size). */
  readonly dismissedCount = computed(() => this.ids().size);

  /** Dismiss a concern by id (idempotent; one-way — no restore). */
  dismiss(id: string): void {
    this.ids.update((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  /** Reactive: true once `id` has been dismissed. */
  isDismissed(id: string): boolean {
    return this.ids().has(id);
  }
}
