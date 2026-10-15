/**
 * LIVE WARM-UP — fills live's per-service diff side (liveDiffSide) in the background,
 * so the first review and the first fix previews in a fresh page pay only for their
 * draft side.
 *
 * Lowest priority: it starts once the page has loaded, and runs only in idle periods
 * (requestIdleCallback), IDLE_SLICE_MS at most per callback. Any user input
 * (pointer, key, wheel, touch) pauses it at once; it resumes after RESUME_AFTER_MS of
 * quiet. A new live world restarts it (services already warm are skipped). Without
 * requestIdleCallback (tests, old browsers) it does nothing — the diff warms the
 * same memo on demand anyway.
 */

import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { warmLiveSteps } from './draft-diff';
import { PolicyDraftStore } from './policy-draft.store';

/** Work per idle callback: well under the browser's 50 ms idle budget, so input
 *  arriving mid-slice waits only a few ms. */
const IDLE_SLICE_MS = 16;

/** Quiet time after the last input before warming resumes. */
export const RESUME_AFTER_MS = 1000;

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

interface Idle {
  request: (cb: (deadline: IdleDeadline) => void) => number;
  cancel: (handle: number) => void;
}

const browserIdle = (): Idle | null =>
  typeof requestIdleCallback === 'function'
    ? { request: (cb) => requestIdleCallback(cb), cancel: (h) => cancelIdleCallback(h) }
    : null;

@Injectable({ providedIn: 'root' })
export class LiveWarmup {
  private readonly store = inject(PolicyDraftStore);
  private readonly started = signal(false);
  /** Services warm in the current live world, of its total (for the console and specs). */
  readonly progress = signal<{ done: number; total: number }>({ done: 0, total: 0 });

  private idle: Idle | null = browserIdle();
  private steps: Generator<number, void, void> | null = null;
  private handle: number | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pause = () => this.onInput();

  constructor() {
    effect(() => {
      if (!this.started()) return;
      const live = this.store.live();
      untracked(() => this.restart(live));
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Starts warming after the page has loaded (idempotent). `idle` overrides the scheduler (specs). */
  start(idle?: Idle): void {
    if (idle) this.idle = idle;
    if (!this.idle || this.started()) return;
    const go = () => {
      for (const e of INPUT_EVENTS) window.addEventListener(e, this.pause, { capture: true, passive: true });
      this.started.set(true);
    };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }

  private restart(live: TrifectaWorld): void {
    this.steps = warmLiveSteps(live);
    this.progress.set({ done: 0, total: live.services.length });
    this.request();
  }

  private request(): void {
    if (this.handle !== null || !this.steps || !this.idle) return;
    this.handle = this.idle.request((deadline) => {
      this.handle = null;
      this.work(deadline);
    });
  }

  private work(deadline: IdleDeadline): void {
    const steps = this.steps;
    if (!steps) return;
    const end = performance.now() + IDLE_SLICE_MS;
    while (deadline.timeRemaining() > 1 && performance.now() < end) {
      const next = steps.next();
      if (next.done) {
        this.steps = null;
        this.progress.update((p) => ({ ...p, done: p.total }));
        performance.mark('live-warmup-done'); // visible in DevTools' timeline
        return;
      }
      if (next.value !== this.progress().done) this.progress.update((p) => ({ ...p, done: next.value as number }));
    }
    this.request();
  }

  /** User input: give the main thread back now; resume after a quiet spell. */
  private onInput(): void {
    if (this.handle !== null) this.idle?.cancel(this.handle);
    this.handle = null;
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => this.request(), RESUME_AFTER_MS);
  }

  private stop(): void {
    this.steps = null;
    if (this.handle !== null) this.idle?.cancel(this.handle);
    this.handle = null;
    clearTimeout(this.resumeTimer);
    for (const e of INPUT_EVENTS) window.removeEventListener(e, this.pause, { capture: true });
  }
}
