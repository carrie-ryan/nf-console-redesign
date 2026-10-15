/**
 * DEMO — the NetFoundry-side expiry scheduler (prototype; Ziti has no native expiry).
 *
 * Once the demo clock passes a policy's `expiresAt`, the policy is deleted; once it
 * passes a named entry's, that entry leaves the policy's identityRoles. Each run is a
 * live change under the actor "Expiry" (PolicyDraftStore.applyLiveChange), so it gets
 * everything an outside change gets: a History entry, the draft bar's live-change
 * notice, conflicts with a draft that touches the policy — and, through the binding
 * simulation listening to live changes, hosts that lose authorization stop serving.
 *
 * It runs when the next expiry comes due in real time (one timer, re-armed whenever
 * live changes) and when the Demo panel advances the clock (`runDue`).
 */

import { Injectable, effect, inject, untracked } from '@angular/core';
import { PolicyDraftStore } from './draft/policy-draft.store';
import type { LiveChange } from './draft/live-changes';
import { DemoClock } from './demo-clock';
import { EXPIRY_ACTOR, dueExpiryOps, nextExpiry } from './expiry';

/** setTimeout's ceiling (~24.8 days); a later expiry re-arms on the way. */
const MAX_WAIT_MS = 2 ** 31 - 1;

@Injectable({ providedIn: 'root' })
export class ExpiryScheduler {
  private readonly store = inject(PolicyDraftStore);
  private readonly clock = inject(DemoClock);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      this.store.live();
      this.clock.offsetMs();
      untracked(() => this.arm());
    });
  }

  /** Applies every expiry the demo clock has passed; returns the live change (null if none was due). */
  runDue(): LiveChange | null {
    const ops = dueExpiryOps(this.store.live(), this.clock.now().getTime());
    const change = ops.length ? this.store.applyLiveChange(ops, EXPIRY_ACTOR) : null;
    this.arm();
    return change;
  }

  /** One timer, for the next expiry after now. */
  private arm(): void {
    clearTimeout(this.timer);
    const now = this.clock.now().getTime();
    if (dueExpiryOps(this.store.live(), now).length) {
      this.timer = setTimeout(() => this.runDue(), 0);
      return;
    }
    const next = nextExpiry(this.store.live(), now);
    if (next === null) return;
    this.timer = setTimeout(() => this.runDue(), Math.min(MAX_WAIT_MS, next - now));
  }
}
