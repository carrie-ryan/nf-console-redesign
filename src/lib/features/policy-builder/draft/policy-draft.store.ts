/**
 * POLICY DRAFT STORE — the pending ops on top of MockDataService's live world.
 *
 * live       = buildSeedWorld(data), re-read whenever a seed signal changes
 * draftWorld = applyDraft(live, ops)
 * diff       = diffWorlds(live, draftWorld)
 *
 * Every mutator validates: an op list that would not apply on top of live is
 * rejected (throws, changes nothing).
 *
 * The editors keep ONE op per policy (per target collection): upsertUpdate folds
 * edits into the existing update op (or into the create op of a policy the draft
 * created), and drops the update entirely once the policy matches live again;
 * deletePolicy replaces a policy's pending ops with a delete (or, for a
 * draft-created policy, just removes its create). Both default to service
 * policies; other targets (router policies, posture checks, a service's strategy,
 * an identity's hosting defaults) pass theirs. Nothing reaches MockDataService
 * until commit.
 *
 * Every commit is recorded in `history` (draft/history.ts): its change lines, ops,
 * and the touched entities before and after. `startRevert` turns one back into a
 * NEW draft of inverse ops — reviewed, tested and committed like any other — leaving
 * out entities changed since (`reverting().conflicts`).
 *
 * Live can still change underneath an accepted op (e.g. a policy is
 * deleted elsewhere); then `error` is set, draftWorld falls back to live (so the
 * diff is empty), and commit throws without changing anything.
 *
 * Conflicts (draft/conflicts.ts): when an op first touches an entity, its live state
 * is recorded as the entity's baseline. A touched entity whose live state has since
 * left its baseline is a conflict; commit is blocked until each is resolved —
 * `reapply` (my fields on top of the latest, the user picking where both changed) or
 * `dropChange`.
 *
 * Live changes (draft/live-changes.ts): `applyLiveChange` writes ops straight to live
 * for someone outside the builder (another admin, Terraform), recorded in history
 * under their name. Those made while a draft is open are kept in `liveSinceDraft` —
 * the draft bar's notices and the canvas's "changed in live" marks — until the draft
 * empties (commit, discard, its last op removed).
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { MockDataService, type Policy } from '../../../shared/services/mock-data.service';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { diffWorlds } from './draft-diff';
import { describeOps } from './draft-summary';
import { COLLECTION, entityLabel, revertOps, touchedStates, type CommitRecord, type EntityState, type ReviewEvent } from './history';
import { dropOps, entityConflicts, nextBaselines, reapplyOps } from './conflicts';
import { liveImpact, type LiveChange } from './live-changes';
import { DemoClock } from '../demo-clock';
import { dropPastExpiries, expiredRestores, type ExpiredRestore } from '../expiry';
import {
  applyDraft,
  isServicePolicyOp,
  opPolicyId,
  targetOf,
  type DraftOp,
  type DraftTarget,
  type EdgeRouterPolicyPatch,
  type AccessTestPatch,
  type IdentityHostingPatch,
  type PolicyPatch,
  type PostureCheckPatch,
  type ServiceConfigPatch,
  type ServiceEdgeRouterPolicyPatch,
} from './policy-draft';

/** The commit a draft reverts: which, what it left out, and the time-limited access it
 *  restores without its (passed) expiry. */
export interface Reverting {
  commitId: string;
  conflicts: string[];
  expired: ExpiredRestore[];
}

/** What a commit gate (approval) says: why commit is blocked, or who approved it. */
export type CommitGate = { blocked: string } | { approvedBy: string | null };

/** A draft as discard found it — what restore puts back. */
export interface DraftSnapshot {
  ops: readonly DraftOp[];
  baselines: ReadonlyMap<string, EntityState>;
  reverting: Reverting | null;
  liveSinceDraft: readonly LiveChange[];
}

/** How a policy differs from live, for marking its nodes. */
export type PolicyMark = 'new' | 'edited';

/** A commit as it happened: its record and live just before and just after it. */
export interface CommitEvent {
  record: CommitRecord;
  before: TrifectaWorld;
  after: TrifectaWorld;
}

type Applied = { world: TrifectaWorld; error: null } | { world: null; error: string };

/** The ops for one policy of one target collection. */
const isOpFor = (op: DraftOp, policyId: string, target: DraftTarget) =>
  targetOf(op) === target && opPolicyId(op) === policyId;

/** A patch for any target's entity. */
export type AnyPatch =
  | PolicyPatch
  | EdgeRouterPolicyPatch
  | ServiceEdgeRouterPolicyPatch
  | PostureCheckPatch
  | ServiceConfigPatch
  | IdentityHostingPatch
  | AccessTestPatch;

/** Builds an op for `target` (service-policy ops keep omitting it, as they always have). */
const opFor = (target: DraftTarget, op: Record<string, unknown>): DraftOp =>
  (target === 'servicePolicy' ? op : { ...op, target }) as DraftOp;

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function tryApply(live: TrifectaWorld, ops: readonly DraftOp[]): Applied {
  try {
    return { world: applyDraft(live, ops), error: null };
  } catch (e) {
    return { world: null, error: e instanceof Error ? e.message : String(e) };
  }
}

@Injectable({ providedIn: 'root' })
export class PolicyDraftStore {
  private readonly data = inject(MockDataService);
  private readonly clock = inject(DemoClock);
  private readonly _ops = signal<readonly DraftOp[]>([]);

  readonly ops = this._ops.asReadonly();
  readonly live = computed(() => buildSeedWorld(this.data));

  /** Per touched entity ('<target>:<id>'): its live state when an op first touched it. */
  private readonly _baselines = signal<ReadonlyMap<string, EntityState>>(new Map());
  readonly baselines = this._baselines.asReadonly();
  /** Touched entities changed in live since — commit is blocked while any remain. */
  readonly conflicts = computed(() => entityConflicts(this._baselines(), this.live(), this._ops()));

  private readonly applied = computed(() => tryApply(this.live(), this._ops()));
  /** Why the ops no longer apply to live; null when they do. */
  readonly error = computed(() => this.applied().error);
  /** Live itself while there are no ops (so live's memos — e.g. the warmed diff side — serve panel previews). */
  readonly draftWorld = computed(() => (this._ops().length ? (this.applied().world ?? this.live()) : this.live()));
  readonly diff = computed(() => diffWorlds(this.live(), this.draftWorld()));

  private readonly _history = signal<readonly CommitRecord[]>([]);
  /** Every commit this session, newest first. */
  readonly history = computed(() => [...this._history()].reverse());

  /** The commit the current draft reverts, and what it left out; null otherwise. */
  private readonly _reverting = signal<Reverting | null>(null);
  readonly reverting = this._reverting.asReadonly();

  /** Live changes made outside the builder while this draft was open, oldest first. */
  private readonly _liveSinceDraft = signal<readonly LiveChange[]>([]);
  readonly liveSinceDraft = this._liveSinceDraft.asReadonly();
  /** The latest live change made outside the builder (draft or not); null before any. */
  private readonly _lastLiveChange = signal<LiveChange | null>(null);
  readonly lastLiveChange = this._lastLiveChange.asReadonly();

  /** Bumped whenever the draft empties (commit, discard, its last op removed): state about
   *  "this draft" (a review) holds only within one generation. */
  private readonly _generation = signal(0);
  readonly generation = this._generation.asReadonly();
  private emptied(): void {
    this._generation.update((g) => g + 1);
  }

  /** Why the draft can't be changed right now (submitted for review); null when it can. */
  private readonly _lock = signal<string | null>(null);
  readonly lock = this._lock.asReadonly();
  /** Locks (a reason) or unlocks (null) the draft: while locked, every draft mutation throws. */
  setLock(reason: string | null): void {
    this._lock.set(reason);
  }
  private assertUnlocked(): void {
    const reason = this._lock();
    if (reason) throw new Error(reason);
  }

  /** Decides whether commit may go ahead (required review); none: it always may. */
  private commitGate: (() => CommitGate) | null = null;
  setCommitGate(gate: (() => CommitGate) | null): void {
    this.commitGate = gate;
  }

  /** Service policyId → 'new' (created by the draft) | 'edited' (has a pending update). */
  readonly marks = computed(() => {
    const marks = new Map<string, PolicyMark>();
    for (const op of this._ops()) {
      if (!isServicePolicyOp(op)) continue;
      if (op.kind === 'create') marks.set(op.policy.id, 'new');
      else if (op.kind === 'update' && !marks.has(op.policyId)) marks.set(op.policyId, 'edited');
    }
    return marks;
  });

  /** Any non-service-policy entity's draft state, as `marks` gives it for service policies. */
  routerMark(target: Exclude<DraftTarget, 'servicePolicy'>, policyId: string): PolicyMark | null {
    let mark: PolicyMark | null = null;
    for (const op of this._ops()) {
      if (!isOpFor(op, policyId, target)) continue;
      if (op.kind === 'create') mark = 'new';
      else if (op.kind === 'update') mark ??= 'edited';
    }
    return mark;
  }

  addOp(op: DraftOp): void {
    this.addOps([op]);
  }

  /** Appends several ops at once — all or nothing. */
  addOps(ops: readonly DraftOp[]): void {
    this.setOps([...this._ops(), ...ops]);
  }

  /** One op per policy: merges `patch` into the policy's create op (if the draft
   *  created it) or its update op (replacing any existing ones). An update that
   *  leaves the policy equal to live is dropped. Validated like addOp. */
  upsertUpdate(policyId: string, patch: AnyPatch, target: DraftTarget = 'servicePolicy'): void {
    const ops = this._ops();
    const createAt = ops.findIndex((op) => isOpFor(op, policyId, target) && op.kind === 'create');
    const created = ops[createAt];
    if (created && created.kind === 'create') {
      const policy = { ...created.policy, ...patch, id: policyId };
      this.setOps(ops.map((op, i) => (i === createAt ? opFor(target, { kind: 'create', policy }) : op)));
      return;
    }

    const isUpdate = (op: DraftOp) => isOpFor(op, policyId, target) && op.kind === 'update';
    const merged: Record<string, unknown> = {};
    for (const op of ops) if (isUpdate(op) && op.kind === 'update') Object.assign(merged, op.patch);
    Object.assign(merged, patch);

    const live = ((this.live()[COLLECTION[target]] ?? []) as readonly { id: string }[]).find((p) => p.id === policyId) as
      | Record<string, unknown>
      | undefined;
    const unchanged = live !== undefined && Object.keys(merged).every((k) => sameValue(merged[k], live[k]));
    const update = opFor(target, { kind: 'update', policyId, patch: merged });

    // The merged op takes the first update's place (or goes last); other updates for it go.
    const updateAt = ops.findIndex(isUpdate);
    const kept = ops.flatMap((op, i) => (i === updateAt && !unchanged ? [update] : isUpdate(op) ? [] : [op]));
    this.setOps(updateAt < 0 && !unchanged ? [...kept, update] : kept);
  }

  /** Drops the policy's pending ops; adds a delete unless the draft created it. */
  deletePolicy(policyId: string, target: DraftTarget = 'servicePolicy'): void {
    const ops = this._ops();
    const createdHere = ops.some((op) => isOpFor(op, policyId, target) && op.kind === 'create');
    const rest = ops.filter((op) => !isOpFor(op, policyId, target));
    this.setOps(createdHere ? rest : [...rest, opFor(target, { kind: 'delete', policyId })]);
  }

  /** Adds a create op for an empty `type` policy on one service; returns its id. */
  createForService(type: Policy['type'], serviceId: string): string {
    const taken = new Set([...this.live().policies, ...this.draftWorld().policies].map((p) => p.id));
    let n = 1;
    while (taken.has(`pol-draft-${n}`)) n++;
    const id = `pol-draft-${n}`;
    this.addOp({
      kind: 'create',
      policy: {
        id,
        name: `new-${type}-rule-${n}`,
        createdAt: new Date().toISOString(),
        status: 'active',
        type,
        semantic: 'AnyOf',
        identityRoles: [],
        serviceRoles: [`@${serviceId}`],
        postureCheckRoles: [],
      },
    });
    return id;
  }

  removeOp(index: number): void {
    const ops = this._ops();
    if (index < 0 || index >= ops.length) throw new Error(`removeOp: no op at index ${index}`);
    this.replaceOps(ops.filter((_, i) => i !== index));
    if (this._ops().length === 0) this._reverting.set(null);
  }

  /** Resolves a conflict: my edited fields on top of the latest live entity, which
   *  becomes the baseline. `picks` decides each field both sides changed. */
  reapply(key: string, picks: Readonly<Record<string, 'theirs' | 'mine'>> = {}): void {
    this.assertUnlocked();
    const c = this.conflicts().find((x) => x.key === key);
    if (!c) throw new Error(`reapply: no conflict '${key}'`);
    const next = reapplyOps(c, this.live(), this._ops(), picks);
    applyDraft(this.live(), next);
    const baselines = new Map(this._baselines());
    baselines.delete(key); // re-recorded from live
    this._baselines.set(baselines);
    this.setOps(next);
  }

  /** Resolves a conflict by dropping my change to that entity. */
  dropChange(key: string): void {
    const c = this.conflicts().find((x) => x.key === key);
    if (!c) throw new Error(`dropChange: no conflict '${key}'`);
    this.replaceOps(dropOps(c, this._ops()));
    if (this._ops().length === 0) this._reverting.set(null);
  }

  /** Sets the ops and their baselines (no validation — removing ops can't break the rest). */
  private replaceOps(next: readonly DraftOp[]): void {
    this.assertUnlocked();
    this._ops.set(next);
    this._baselines.set(nextBaselines(this._baselines(), this.live(), next));
    if (next.length === 0) {
      this._liveSinceDraft.set([]);
      this.emptied();
    }
  }

  /** Validates against live, then replaces the ops; throws and changes nothing if invalid. */
  private setOps(next: readonly DraftOp[]): void {
    applyDraft(this.live(), next);
    this.replaceOps(next);
    // A draft emptied by edits is no longer a revert.
    if (next.length === 0) this._reverting.set(null);
  }

  /** Empties the draft; returns it as it was, for restore (Undo). */
  discard(): DraftSnapshot {
    this.assertUnlocked();
    const snapshot: DraftSnapshot = {
      ops: this._ops(),
      baselines: this._baselines(),
      reverting: this._reverting(),
      liveSinceDraft: this._liveSinceDraft(),
    };
    this._ops.set([]);
    this._baselines.set(new Map());
    this._reverting.set(null);
    this._liveSinceDraft.set([]);
    this.emptied();
    return snapshot;
  }

  /** Puts a discarded draft back exactly — its ops and a revert's link to its commit.
   *  Not re-validated: it is the draft as it was (if live moved, `error` says so). */
  restore(snapshot: DraftSnapshot): void {
    this.assertUnlocked();
    this.emptied(); // a different draft from whatever was there
    this._ops.set(snapshot.ops);
    this._baselines.set(snapshot.baselines);
    this._reverting.set(snapshot.reverting);
    this._liveSinceDraft.set(snapshot.liveSinceDraft);
  }

  /**
   * Replaces an EMPTY draft with the inverse of `commitId` (see revertOps); returns
   * the conflicts it left out. Throws while a draft is pending — commit or discard
   * it first — or for an unknown commit.
   */
  startRevert(commitId: string): string[] {
    if (this._ops().length) throw new Error('Commit or discard the current draft first');
    const commit = this._history().find((c) => c.id === commitId);
    if (!commit) throw new Error(`startRevert: no commit '${commitId}'`);
    if (commit.observed || commit.review) throw new Error(`startRevert: ${commitId} isn't a commit of config`);
    const plan = revertOps(commit, this.live());
    // Expiries already past would remove what the revert puts back at once: they're
    // dropped, and the review warns that the access no longer expires.
    const now = this.clock.now().getTime();
    this.setOps(dropPastExpiries(plan.ops, now));
    this._reverting.set({ commitId, conflicts: plan.conflicts, expired: expiredRestores(plan.ops, this.live(), now) });
    return plan.conflicts;
  }

  /** Writes each collection the draft changed to its MockDataService signal, then
   *  clears the ops. If the ops no longer apply, throws and changes neither live
   *  nor ops. (applyDraft keeps untouched collections by reference, so only the
   *  targeted signals are written.) */
  commit(): void {
    this.assertUnlocked();
    const gate = this.commitGate?.() ?? { approvedBy: null };
    if ('blocked' in gate) throw new Error(gate.blocked);
    const conflicts = this.conflicts();
    if (conflicts.length) {
      throw new Error(`${conflicts.map((c) => c.name).join(', ')} changed in live since you started editing — resolve the conflicts first`);
    }
    const live = this.live();
    const ops = this._ops();
    const world = applyDraft(live, ops);
    const record: CommitRecord = {
      id: `c-${this._history().length + 1}`,
      at: this.clock.now().toISOString(),
      author: 'you',
      actor: 'You',
      changeLines: describeOps(live, ops, this.clock.now().getTime()),
      ops: structuredClone([...ops]),
      before: touchedStates(live, ops),
      after: touchedStates(world, ops),
      ...(this._reverting() ? { revertOf: this._reverting()!.commitId } : {}),
      ...(gate.approvedBy ? { approvedBy: gate.approvedBy } : {}),
    };
    this.writeLive(live, world);
    this._ops.set([]);
    this._baselines.set(new Map());
    this._history.update((h) => [...h, record]);
    this._reverting.set(null);
    this._liveSinceDraft.set([]);
    this.emptied();
    for (const listener of this.commitListeners) listener({ record, before: live, after: world });
  }

  private readonly commitListeners: ((e: CommitEvent) => void)[] = [];

  /** Called after every commit — and every live change from outside the builder
   *  (applyLiveChange) — once live holds it. Returns the unsubscribe. */
  onCommit(listener: (e: CommitEvent) => void): () => void {
    this.commitListeners.push(listener);
    return () => {
      const i = this.commitListeners.indexOf(listener);
      if (i >= 0) this.commitListeners.splice(i, 1);
    };
  }

  /**
   * Observed state changed by the network (not config): a History entry under
   * `actor` with these lines — no ops, nothing to revert. Returns its id.
   */
  recordObserved(actor: string, changeLines: string[]): string {
    const id = `c-${this._history().length + 1}`;
    this._history.update((h) => [
      ...h,
      { id, at: this.clock.now().toISOString(), author: 'outside', actor, changeLines, ops: [], before: [], after: [], observed: true },
    ]);
    return id;
  }

  /** A review step in History (submitted, approved, …) under `actor` — no ops, nothing to revert. */
  recordReview(actor: string, event: ReviewEvent, line: string): string {
    const id = `c-${this._history().length + 1}`;
    this._history.update((h) => [
      ...h,
      { id, at: this.clock.now().toISOString(), author: 'you', actor, changeLines: [line], ops: [], before: [], after: [], review: event },
    ]);
    return id;
  }

  /** Writes each collection `world` changed from `live` to its MockDataService signal
   *  (applyDraft keeps untouched collections by reference). */
  private writeLive(live: TrifectaWorld, world: TrifectaWorld): void {
    if (world.policies !== live.policies) this.data.policies.set([...world.policies]);
    if (world.edgeRouterPolicies !== live.edgeRouterPolicies) {
      this.data.edgeRouterPolicies.set([...world.edgeRouterPolicies]);
    }
    if (world.serviceEdgeRouterPolicies !== live.serviceEdgeRouterPolicies) {
      this.data.serviceEdgeRouterPolicies.set([...world.serviceEdgeRouterPolicies]);
    }
    if (world.postureChecks !== live.postureChecks) this.data.postureChecks.set([...(world.postureChecks ?? [])]);
    if (world.services !== live.services) this.data.services.set([...world.services]);
    if (world.identities !== live.identities) this.data.identities.set([...world.identities]);
    if (world.accessTests !== live.accessTests) this.data.accessTests.set([...(world.accessTests ?? [])]);
  }

  /**
   * Someone outside the builder (`actor`) changes live: `ops` go straight to
   * MockDataService and into history under their name. The draft is left alone — a
   * touched entity it also edits becomes a conflict at once. Returns the change (null
   * for no ops); throws, changing nothing, if the ops don't apply to live.
   */
  applyLiveChange(ops: readonly DraftOp[], actor: string): LiveChange | null {
    if (!ops.length) return null;
    const live = this.live();
    const world = applyDraft(live, ops);
    const before = touchedStates(live, ops);
    const after = touchedStates(world, ops);
    const record: CommitRecord = {
      id: `c-${this._history().length + 1}`,
      at: this.clock.now().toISOString(),
      author: 'outside',
      actor,
      changeLines: describeOps(live, ops, this.clock.now().getTime()),
      ops: structuredClone([...ops]),
      before,
      after,
    };
    const change: LiveChange = {
      commitId: record.id,
      at: record.at,
      actor,
      entities: before.map((b, i) => ({
        target: b.target,
        id: b.id,
        name: entityLabel(b.target, b.entity ?? after[i].entity, b.id, live),
      })),
      impact: liveImpact(live, world, ops),
    };
    this._history.update((h) => [...h, record]);
    this.writeLive(live, world);
    if (this._ops().length) this._liveSinceDraft.update((l) => [...l, change]);
    this._lastLiveChange.set(change);
    for (const listener of this.commitListeners) listener({ record, before: live, after: world });
    return change;
  }
}
