/**
 * APPROVAL BEFORE COMMIT (demo: "Require review before commit", off by default).
 *
 * With review required, the author ("You") can't commit a draft directly:
 *
 *   submit          → submitted: the draft is LOCKED (PolicyDraftStore.setLock — every
 *                     draft mutation throws; the page disables canvas edits, editors
 *                     and the assist). The author may withdraw (unlocks, cancels it).
 *   requestChanges  → (reviewer) unlocks the draft for the author; the note shows in
 *                     the draft bar until the author submits again or the draft empties.
 *   approve         → (reviewer; never the submitter, never while there are conflicts
 *                     or failing tests) unlocks it: the author may commit. The approval
 *                     holds only for the exact ops approved and while no conflict exists
 *                     — any change to the draft, or a new conflict, cancels it.
 *
 * Commit goes through PolicyDraftStore's commit gate: blocked until approved, and
 * recorded with `approvedBy`. Each step is a History entry ("You · Submitted 2
 * changes for review", "Dana · Approved 2 changes").
 *
 * "View as" (the Demo panel) switches who is looking: the author or the reviewer.
 * With review off, nothing here applies and commit behaves as it always has.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { DemoClock } from '../demo-clock';
import type { DraftOp } from './policy-draft';
import { PolicyDraftStore } from './policy-draft.store';

export const AUTHOR = 'You';
export const REVIEWER = 'Dana';

export type Viewer = 'author' | 'reviewer';

/** The draft's review state. `ops` is the draft the step was taken on. */
export type Submission = { by: string; at: string; ops: readonly DraftOp[]; generation: number } & (
  | { status: 'submitted' }
  | { status: 'changesRequested'; note: string }
  | { status: 'approved'; submittedBy: string }
);

export const LOCK_MESSAGE = 'The draft is submitted for review — withdraw it to make changes';

const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;

@Injectable({ providedIn: 'root' })
export class ApprovalStore {
  private readonly store = inject(PolicyDraftStore);
  private readonly clock = inject(DemoClock);

  /** The Demo panel's "Require review before commit". */
  readonly required = signal(false);
  /** The Demo panel's "View as". */
  readonly viewer = signal<Viewer>('author');
  /** Who is looking, by name. */
  readonly viewerName = computed(() => (this.viewer() === 'author' ? AUTHOR : REVIEWER));

  private readonly _submission = signal<Submission | null>(null);

  /**
   * The current review state — null with review off, with no draft, or once the draft
   * it was about is gone. An approval lapses as soon as the draft changes or a conflict
   * appears; a request for changes stays (as the note) while the draft is edited.
   */
  readonly submission = computed<Submission | null>(() => {
    const s = this._submission();
    if (!s || !this.required() || !this.store.ops().length || s.generation !== this.store.generation()) return null;
    if (s.status === 'approved' && (s.ops !== this.store.ops() || this.store.conflicts().length)) return null;
    return s;
  });

  readonly submitted = computed(() => this.submission()?.status === 'submitted');
  readonly approved = computed(() => {
    const s = this.submission();
    return s?.status === 'approved' ? s : null;
  });
  readonly changesRequested = computed(() => {
    const s = this.submission();
    return s?.status === 'changesRequested' ? s : null;
  });

  /** The viewer is the one who submitted (and so can't approve). */
  readonly viewerIsSubmitter = computed(() => {
    const s = this.submission();
    return !!s && s.status === 'submitted' && s.by === this.viewerName();
  });

  constructor() {
    this.store.setCommitGate(() => {
      if (!this.required()) return { approvedBy: null };
      const a = this.approved();
      return a ? { approvedBy: a.by } : { blocked: 'Review is required: submit the draft and get it approved first' };
    });
  }

  /** The author submits the draft: it locks until withdrawn, approved or sent back. */
  submit(): void {
    if (!this.required()) throw new Error('Review isn\'t required — commit directly');
    const ops = this.store.ops();
    if (!ops.length) throw new Error('Nothing to submit');
    if (this.submitted()) throw new Error('Already submitted');
    const by = this.viewerName();
    this._submission.set({ status: 'submitted', by, at: this.clock.now().toISOString(), ops, generation: this.store.generation() });
    this.store.setLock(LOCK_MESSAGE);
    this.store.recordReview(by, 'submitted', `Submitted ${changes(ops.length)} for review`);
  }

  /** The submitter takes it back: unlocked, submission cancelled. */
  withdraw(): void {
    const s = this.submission();
    if (s?.status !== 'submitted') throw new Error('Nothing submitted');
    this.unlock();
    this._submission.set(null);
    this.store.recordReview(s.by, 'withdrawn', 'Withdrew the draft from review');
  }

  /** Why the viewer can't approve now; null when they can. */
  readonly approveBlocked = computed<string | null>(() => {
    const s = this.submission();
    if (s?.status !== 'submitted') return 'Nothing is waiting for review';
    if (this.viewerIsSubmitter()) return 'You submitted this draft — someone else has to approve it';
    if (this.store.conflicts().length) return 'Live changed under this draft — the author has to resolve the conflicts first';
    return null;
  });

  /** The reviewer approves: unlocked, and the author may commit this exact draft. `testsFail`: from the checks. */
  approve(testsFail = false): void {
    const blocked = this.approveBlocked() ?? (testsFail ? 'Access tests fail — request changes instead' : null);
    if (blocked) throw new Error(blocked);
    const s = this.submission() as Extract<Submission, { status: 'submitted' }>;
    const by = this.viewerName();
    this.unlock();
    this._submission.set({ status: 'approved', by, at: this.clock.now().toISOString(), submittedBy: s.by, ops: this.store.ops(), generation: this.store.generation() });
    this.store.recordReview(by, 'approved', `Approved ${changes(this.store.ops().length)}`);
  }

  /** The reviewer sends it back with a note: unlocked for the author. */
  requestChanges(note: string): void {
    const s = this.submission();
    if (s?.status !== 'submitted') throw new Error('Nothing is waiting for review');
    if (this.viewerIsSubmitter()) throw new Error('You submitted this draft — withdraw it instead');
    const by = this.viewerName();
    const text = note.trim();
    this.unlock();
    this._submission.set({ status: 'changesRequested', by, at: this.clock.now().toISOString(), note: text, ops: this.store.ops(), generation: this.store.generation() });
    this.store.recordReview(by, 'changesRequested', text ? `Requested changes: ${text}` : 'Requested changes');
  }

  /** Review switched off: whatever was pending goes, and the draft unlocks. */
  setRequired(on: boolean): void {
    this.required.set(on);
    if (!on) {
      this.unlock();
      this._submission.set(null);
    }
  }

  private unlock(): void {
    this.store.setLock(null);
  }
}
