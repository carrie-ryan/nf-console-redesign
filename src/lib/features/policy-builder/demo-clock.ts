import { Injectable, computed, signal } from '@angular/core';

const HOUR_MS = 60 * 60 * 1000;
/** How often `nowMs` re-reads the real clock while something displays it. */
const TICK_MS = 15_000;

/**
 * DEMO — the builder's notion of "now": the real clock plus an offset the Demo panel
 * moves ("Advance clock 1 hour"). Commit and live-change times come from here, so a
 * demo can show time passing — and expiry — without waiting for it.
 */
@Injectable({ providedIn: 'root' })
export class DemoClock {
  private readonly _offsetMs = signal(0);
  readonly offsetMs = this._offsetMs.asReadonly();
  /** Bumped by every advance, so a template showing the time re-reads it. */
  readonly hoursAdvanced = computed(() => Math.round(this._offsetMs() / HOUR_MS));

  private readonly tick = signal(0);
  private ticking: ReturnType<typeof setInterval> | undefined;

  /**
   * Now (ms) as a signal, for countdowns: changes on every advance and, once read,
   * every TICK_MS of real time.
   */
  readonly nowMs = computed(() => {
    this.tick();
    this._offsetMs();
    this.ticking ??= setInterval(() => this.tick.update((t) => t + 1), TICK_MS);
    return Date.now() + this._offsetMs();
  });

  now(): Date {
    return new Date(Date.now() + this._offsetMs());
  }

  advance(ms = HOUR_MS): void {
    this._offsetMs.update((o) => o + ms);
  }

  /** Re-reads the real clock now (specs with fake timers). */
  refresh(): void {
    this.tick.update((t) => t + 1);
  }
}
