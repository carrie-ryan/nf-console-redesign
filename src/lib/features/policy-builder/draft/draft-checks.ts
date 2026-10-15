/**
 * DRAFT CHECKS — the review computation, split off the edit path.
 *
 * On each draft change the canvas renders synchronously (its own layouts and
 * verdicts), and so does `affected` (affectedServices: "also affects N services").
 * Everything the review and the Tests panel need — the full diff, the hosting
 * changes, the access tests — runs here instead: 300 ms after the last change, in
 * time-sliced chunks that yield to the browser, and restarted whenever the draft
 * changes again. Until it completes, `state()` says "checking" with progress, and
 * commit stays disabled. With no draft ops there's nothing to check: `state()` is
 * done at once, with live's own test results (cached per live world).
 *
 * The work itself is one generator, checkSteps(), built from the same three diff
 * steps diffWorlds uses (planDiff → diffService per service → assembleDiff) and the
 * same evaluateTest. The async driver and the synchronous flush() both run it to
 * completion, so their results are those of the synchronous functions; a guard spec
 * compares them.
 */

import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { evaluateTest, evaluateTests, type TestResult } from '../access-tests';
import { indexFor } from '../../authorization/world-index';
import { hostingChanges, type HostingChange } from '../hosting';
import { affectedServices } from './affected-services';
import { assembleDiff, diffService, planDiff, runChunked, type DraftDiff, type ServiceDiff } from './draft-diff';
import { PolicyDraftStore } from './policy-draft.store';

export const CHECK_DEBOUNCE_MS = 300;
/** Work per chunk before yielding to the browser. */
const SLICE_MS = 12;

export interface CheckResult {
  diff: DraftDiff;
  /** Per service in the diff's scope: the serving hosts the draft stops. */
  hosting: HostingChange[];
  /** Every access test, against the draft (reasons naming draft edits, vs live). */
  tests: TestResult[];
}

export interface CheckProgress {
  /** Services diffed so far. */
  done: number;
  /** Services in the diff's scope. */
  total: number;
}

/**
 * The review computation as steps: yields progress after each service (and after
 * each test, with `done === total`), returns the result.
 */
export function* checkSteps(live: TrifectaWorld, draft: TrifectaWorld): Generator<CheckProgress, CheckResult, void> {
  const plan = planDiff(live, draft);
  const total = plan.serviceIds.length;
  yield { done: 0, total };
  const parts: ServiceDiff[] = [];
  for (const id of plan.serviceIds) {
    parts.push(diffService(live, draft, id, plan.candidates(id)));
    yield { done: parts.length, total };
  }
  const diff = assembleDiff(plan, parts);
  const hosting = hostingChanges(live, draft, plan.serviceIds);
  const tests: TestResult[] = [];
  for (const t of draft.accessTests ?? []) {
    tests.push(evaluateTest(t, draft, live));
    yield { done: total, total };
  }
  return { diff, hosting, tests };
}

/** Runs checkSteps to completion synchronously; `total` is the services in scope. */
export function runChecksSync(live: TrifectaWorld, draft: TrifectaWorld): { result: CheckResult; total: number } {
  const steps = checkSteps(live, draft);
  let total = 0;
  for (;;) {
    const next = steps.next();
    if (next.done) return { result: next.value, total };
    total = next.value.total;
  }
}

/**
 * Runs checkSteps in time slices (`sliceMs` of work each), yielding between them.
 * Resolves with the result, or null once `cancelled()` turns true.
 */
export function runChecks(
  live: TrifectaWorld,
  draft: TrifectaWorld,
  onProgress: (p: CheckProgress) => void = () => undefined,
  cancelled: () => boolean = () => false,
  sliceMs = SLICE_MS,
): Promise<CheckResult | null> {
  return runChunked(checkSteps(live, draft), onProgress, cancelled, sliceMs);
}

/** Live's own access-test results — evaluated once per live world. */
export function liveTestResults(live: TrifectaWorld): TestResult[] {
  return indexFor(live).memo('tests:live', () => evaluateTests(live, live));
}

/** With no draft ops there is nothing to diff, and the tests are live's. */
const noDraftResult = (live: TrifectaWorld): CheckResult => ({
  diff: { pairChanges: [], services: [], affectedServiceIds: [], configChanges: [], loosenings: [] },
  hosting: [],
  tests: liveTestResults(live),
});

/** What the review and Tests panel read. */
export type ChecksView =
  | { status: 'checking'; done: number; total: number; result: null }
  | { status: 'done'; done: number; total: number; result: CheckResult };

interface Input {
  live: TrifectaWorld;
  draft: TrifectaWorld;
  error: string | null;
}

@Injectable({ providedIn: 'root' })
export class DraftChecks {
  private readonly store = inject(PolicyDraftStore);

  /** What the checks are for: a new object whenever live, the draft or its error changes. */
  private readonly input = computed<Input>(() => ({ live: this.store.live(), draft: this.store.draftWorld(), error: this.store.error() }));

  /** Synchronous on every change: the services the draft's ops can reach (live order). */
  readonly affected = computed(() => {
    try {
      return affectedServices(this.store.ops(), this.store.live(), this.store.draftWorld());
    } catch {
      return []; // the ops no longer apply; store.error says why
    }
  });

  private readonly run = signal<{ input: Input; progress: CheckProgress; result: CheckResult | null } | null>(null);
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Checking (with progress) until the current draft's checks complete. A draft that
   *  doesn't apply has nothing to check: its result is live against itself. */
  readonly state = computed<ChecksView>(() => {
    const input = this.input();
    // No draft: live's cached results, never a checking state.
    if (!input.error && this.store.ops().length === 0) return { status: 'done', done: 0, total: 0, result: noDraftResult(input.live) };
    const run = this.run();
    if (run?.input === input && run.result) return { status: 'done', done: run.progress.total, total: run.progress.total, result: run.result };
    const mine = run?.input === input ? run.progress : null;
    return { status: 'checking', done: mine?.done ?? 0, total: mine?.total ?? this.affected().length, result: null };
  });

  constructor() {
    effect(() => {
      const input = this.input();
      untracked(() => this.schedule(input));
    });
  }

  /** Runs the current checks to completion now (specs; nothing to do when done). */
  flush(): void {
    const input = this.input();
    if (!input.error && this.store.ops().length === 0) return; // nothing to run
    if (this.run()?.input === input && this.run()!.result) return;
    this.cancel();
    const { result, total } = runChecksSync(input.live, input.draft);
    this.run.set({ input, progress: { done: total, total }, result });
  }

  private cancel(): void {
    this.token++;
    clearTimeout(this.timer);
  }

  private schedule(input: Input): void {
    if (this.run()?.input === input && this.run()!.result) return; // flushed already
    this.cancel();
    if (!input.error && this.store.ops().length === 0) return; // state() serves live's results
    const token = this.token;
    // A draft that doesn't apply: draftWorld is live, so this is quick — no wait.
    const delay = input.error ? 0 : CHECK_DEBOUNCE_MS;
    this.timer = setTimeout(() => void this.execute(input, token), delay);
  }

  private async execute(input: Input, token: number): Promise<void> {
    const live = () => token === this.token;
    this.run.set({ input, progress: { done: 0, total: this.affected().length }, result: null });
    let last: CheckProgress = { done: 0, total: 0 };
    const result = await runChecks(
      input.live,
      input.draft,
      (p) => {
        last = p;
        if (live()) this.run.set({ input, progress: p, result: null });
      },
      () => !live(),
    );
    if (result && live()) this.run.set({ input, progress: { done: last.total, total: last.total }, result });
  }
}
