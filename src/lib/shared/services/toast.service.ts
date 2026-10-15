import { Injectable, signal } from '@angular/core';
import type { ToastVariant } from '../components/toast/toast.component';

export interface ToastMessage {
  id: number;
  message: string;
  variant: ToastVariant;
}

/**
 * One app-wide toast, rendered by the console shell — so a toast raised just before a
 * navigation (e.g. "Deleted …" from a detail page) survives it. A new toast replaces the current one.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly current = signal<ToastMessage | null>(null);
  private seq = 0;

  show(message: string, variant: ToastVariant = 'success'): void {
    this.current.set({ id: ++this.seq, message, variant });
  }

  /** Clears the toast only if it's still the one that asked — a newer toast stays. */
  dismiss(id: number): void {
    if (this.current()?.id === id) this.current.set(null);
  }
}
