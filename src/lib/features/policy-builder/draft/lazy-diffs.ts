/**
 * LAZY DIFFS — previews of draft ops for the side panels, computed off the open
 * path. A panel renders at once; a job's diff runs through the scoped, chunked path
 * (diffSteps + runChunked) only once it's WANTED — a fix card asks when it comes on
 * screen (appInView) — and wanted jobs run one at a time in screen order (the jobs'
 * order, which is the cards' order). Results land in `results` by key; until then the
 * panel shows "Calculating…". New jobs (the panel's content changed) or cancel() (it
 * closed) abandon whatever is still pending.
 *
 * A job's REACH (affectedServices ∪ affectedPairs — no resolving) is cheap: it's
 * computed synchronously as the card comes on screen (want), so the card shows it
 * at once, ahead of the numbers: "Reaches 200 services · 3,000 identities —
 * calculating…". reach(key) is null until then (or when the ops don't apply).
 */

import { signal } from '@angular/core';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { affectedPairs, affectedServices } from './affected-services';
import { diffSteps, runChunked, type DraftDiff } from './draft-diff';
import { applyDraft, type DraftOp } from './policy-draft';

export interface DiffJob<T> {
  key: string;
  /** The world the ops are previewed against. */
  world: TrifectaWorld;
  ops: readonly DraftOp[];
  /** From the diff (and the world after the ops) to what the panel shows. */
  map: (diff: DraftDiff, after: TrifectaWorld) => T;
}

/** What a job's ops can reach: the services, and the distinct identities to re-resolve. */
export interface Reach {
  services: number;
  identities: number;
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "Reaches 200 services · 3,000 identities". */
export function reachText(r: Reach): string {
  if (!r.services) return 'Reaches no services';
  return `Reaches ${count(r.services, 'service', 'services')} · ${count(r.identities, 'identity', 'identities')}`;
}

/** The "calculating" line for a job: its reach first, when the ops apply. */
export function calculatingText(r: Reach | null): string {
  return r ? `${reachText(r)} — calculating…` : 'Calculating…';
}

/** The reach of `ops` on `world` (→ `after`): affectedServices ∪ affectedPairs. */
export function reachOf(world: TrifectaWorld, ops: readonly DraftOp[], after: TrifectaWorld): Reach {
  const pairs = affectedPairs(ops, world, after);
  const services = new Set([...affectedServices(ops, world, after), ...pairs.keys()]);
  const ids = new Set<string>();
  for (const scope of pairs.values()) {
    if (scope === 'all') return { services: services.size, identities: world.identities.length }; // every identity on that service
    for (const id of scope) ids.add(id);
  }
  return { services: services.size, identities: ids.size };
}

export class LazyDiffs<T> {
  /** Finished previews, by job key. */
  readonly results = signal<ReadonlyMap<string, T>>(new Map());
  private jobs: readonly DiffJob<T>[] = [];
  private wanted = new Set<string>();
  private settled = new Set<string>();
  private token = 0;
  private working = false;
  /** Per key: the world after the job's ops (null: they don't apply), and its reach. */
  private applied = new Map<string, TrifectaWorld | null>();
  private readonly reaches = signal<ReadonlyMap<string, Reach>>(new Map());

  /** Replaces the jobs (abandoning pending ones); none runs until wanted. */
  setJobs(jobs: readonly DiffJob<T>[]): void {
    this.token++;
    this.jobs = jobs;
    this.wanted = new Set();
    this.settled = new Set();
    this.working = false;
    this.applied = new Map();
    this.reaches.set(new Map());
    this.results.set(new Map());
  }

  /** A wanted job's reach; null before it's wanted, or when its ops don't apply. */
  reach(key: string): Reach | null {
    return this.reaches().get(key) ?? null;
  }

  private after(job: DiffJob<T>): TrifectaWorld | null {
    if (!this.applied.has(job.key)) {
      try {
        this.applied.set(job.key, applyDraft(job.world, job.ops));
      } catch {
        this.applied.set(job.key, null); // ops that no longer apply: no preview
      }
    }
    return this.applied.get(job.key)!;
  }

  /** A job's card is on screen: compute it (after any wanted job above it). */
  want(key: string): void {
    if (this.wanted.has(key)) return;
    this.wanted.add(key);
    this.measure([key]);
    this.kick();
  }

  /** Every job, wanted at once (a panel with one preview). */
  run(jobs: readonly DiffJob<T>[]): void {
    this.setJobs(jobs);
    for (const j of jobs) this.wanted.add(j.key);
    this.measure(jobs.map((j) => j.key));
    this.kick();
  }

  /** Reach for these jobs, now. */
  private measure(keys: readonly string[]): void {
    const found = new Map(this.reaches());
    for (const key of keys) {
      const job = this.jobs.find((j) => j.key === key);
      const after = job && this.after(job);
      if (job && after) found.set(key, reachOf(job.world, job.ops, after));
    }
    this.reaches.set(found);
  }

  cancel(): void {
    this.token++;
    this.working = false;
  }

  private kick(): void {
    if (this.working) return;
    this.working = true;
    const token = this.token;
    // After the current render.
    setTimeout(() => void this.work(token), 0);
  }

  private async work(token: number): Promise<void> {
    const alive = () => token === this.token;
    for (;;) {
      if (!alive()) return;
      const job = this.jobs.find((j) => this.wanted.has(j.key) && !this.settled.has(j.key)); // topmost first
      if (!job) {
        this.working = false;
        return;
      }
      this.settled.add(job.key);
      const after = this.after(job);
      if (!after) continue;
      const diff = await runChunked(diffSteps(job.world, after), undefined, () => !alive());
      if (!diff || !alive()) return;
      this.results.update((m) => new Map(m).set(job.key, job.map(diff, after)));
    }
  }
}
