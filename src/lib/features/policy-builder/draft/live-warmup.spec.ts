/**
 * Live warm-up: warmLiveSteps fills exactly the memo the diff reads (so a diff after
 * it equals one on a cold world), in small steps; the LiveWarmup service runs only in
 * idle callbacks, pauses on input, and resumes after a quiet spell.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/live-warmup.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { indexFor } from '../../authorization/world-index';
import { diffWorlds, warmLiveSteps } from './draft-diff';
import { LiveWarmup, RESUME_AFTER_MS } from './live-warmup';
import { PolicyDraftStore } from './policy-draft.store';
import { applyDraft, type DraftOp } from './policy-draft';

describe('warmLiveSteps', () => {
  it('warms every service\'s live side; a diff afterwards equals one on a cold live world', () => {
    const live = buildSeedWorld();
    let steps = 0;
    let last = -1;
    for (const done of warmLiveSteps(live, 4)) {
      steps++;
      expect(done).toBeGreaterThanOrEqual(last); // services done only goes up
      last = done;
    }
    expect(last).toBe(live.services.length);
    expect(steps).toBeGreaterThan(live.services.length); // batches of 4 pairs: many small steps
    for (const s of live.services) expect(indexFor(live).hasMemo(`diff:live:${s.id}`)).toBe(true);

    const ops: DraftOp[] = [{ kind: 'update', policyId: 'pol-002', patch: { semantic: 'AllOf', identityRoles: ['#users', '#laptops'] } }];
    const draft = applyDraft(live, ops);
    expect(diffWorlds(live, draft)).toEqual(diffWorlds({ ...live }, draft, { scope: 'all' }));
  });

  it('skips services already warm', () => {
    const live = buildSeedWorld();
    [...warmLiveSteps(live)];
    expect([...warmLiveSteps(live)]).toEqual(live.services.map((_, i) => i + 1)); // one step each
  });
});

describe('LiveWarmup service', () => {
  /** A fake idle scheduler: callbacks run when the spec says, with `ms` to spare. */
  const fakeIdle = () => {
    const queue = new Map<number, (d: IdleDeadline) => void>();
    let next = 1;
    return {
      queue,
      request: (cb: (d: IdleDeadline) => void) => (queue.set(next, cb), next++),
      cancel: (h: number) => void queue.delete(h),
      /** Runs the pending callbacks with a deadline allowing `steps` steps each. */
      flush(steps: number) {
        const cbs = [...queue.values()];
        queue.clear();
        for (const cb of cbs) {
          let left = steps;
          cb({ didTimeout: false, timeRemaining: () => (left-- > 0 ? 10 : 0) });
        }
      },
    };
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs only in idle callbacks, pauses on input, resumes after a quiet spell', async () => {
    TestBed.configureTestingModule({});
    const warmup = TestBed.inject(LiveWarmup);
    const live = TestBed.inject(PolicyDraftStore).live();
    const idle = fakeIdle();
    warmup.start(idle);
    TestBed.tick(); // the effect starts the run
    expect(warmup.progress()).toEqual({ done: 0, total: live.services.length });
    expect(idle.queue.size).toBe(1); // waiting for idle time, nothing done yet

    idle.flush(3);
    expect(idle.queue.size).toBe(1); // deadline over: asks for the next idle period
    const before = warmup.progress().done;

    // Input: the pending idle callback is cancelled…
    window.dispatchEvent(new Event('pointerdown'));
    expect(idle.queue.size).toBe(0);
    await vi.advanceTimersByTimeAsync(RESUME_AFTER_MS - 1);
    expect(idle.queue.size).toBe(0);
    // …and requested again after the quiet spell.
    await vi.advanceTimersByTimeAsync(1);
    expect(idle.queue.size).toBe(1);
    expect(warmup.progress().done).toBe(before);

    while (idle.queue.size) idle.flush(1000);
    expect(warmup.progress()).toEqual({ done: live.services.length, total: live.services.length });
    for (const s of live.services) expect(indexFor(live).hasMemo(`diff:live:${s.id}`)).toBe(true);
  });
});
