/**
 * COMMIT HISTORY — what each commit touched, and how to undo it. Pure and headless.
 *
 *   touchedStates — the state of every entity a list of ops touches, in one world
 *                   (null: it doesn't exist there). A commit records it twice: `before`
 *                   (live before the commit) and `after` (live right after).
 *   revertOps     — the inverse ops that take each touched entity back to `before`,
 *                   as a NEW draft. An entity that changed since the commit (live no
 *                   longer equals its `after`) is a conflict: listed, and left out.
 *
 * Only draft targets are ever touched, so observed state — terminators, router
 * status, posture results — is never part of a commit record or a revert.
 */

import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import type { AccessTest } from '../../../shared/services/mock-data.service';
import { describeTest } from '../access-tests';
import { opEntities, type DraftOp, type DraftTarget } from './policy-draft';

export const COLLECTION = {
  servicePolicy: 'policies',
  edgeRouterPolicy: 'edgeRouterPolicies',
  serviceEdgeRouterPolicy: 'serviceEdgeRouterPolicies',
  postureCheck: 'postureChecks',
  service: 'services',
  identity: 'identities',
  accessTest: 'accessTests',
} as const satisfies Record<DraftTarget, keyof TrifectaWorld>;

type Entity = { id: string; [k: string]: unknown };

export interface EntityState {
  target: DraftTarget;
  id: string;
  /** null: it doesn't exist (created by the commit, or deleted by it). */
  entity: Entity | null;
}

export type ReviewEvent = 'submitted' | 'withdrawn' | 'approved' | 'changesRequested';

export interface CommitRecord {
  id: string;
  /** ISO time of the commit. */
  at: string;
  /** 'outside': a change made to live outside the builder (see applyLiveChange). */
  author: 'you' | 'outside';
  /** Who made it, as History shows it: "You", "Terraform", "Dana (admin)". */
  actor: string;
  /** describeOps at commit time: "Updated users-gitlab: …". */
  changeLines: string[];
  ops: DraftOp[];
  /** Every entity the ops touched, as it was before the commit. */
  before: EntityState[];
  /** The same entities right after it — what a revert checks for later changes. */
  after: EntityState[];
  /** Set when this commit was a revert: the commit it reverted. */
  revertOf?: string;
  /** Observed state the network changed (e.g. hosts binding) — not config: no ops, nothing to revert. */
  observed?: true;
  /** A review step (submitted, withdrawn, approved, changes requested) — not a commit: nothing to revert. */
  review?: ReviewEvent;
  /** A commit made under required review: who approved it. */
  approvedBy?: string;
}

export function entityIn(world: TrifectaWorld, target: DraftTarget, id: string): Entity | null {
  const items = (world[COLLECTION[target]] ?? []) as unknown as readonly Entity[];
  return items.find((e) => e.id === id) ?? null;
}

/** Each touched entity once, in first-touched order, as it is in `world`. */
export function touchedStates(world: TrifectaWorld, ops: readonly DraftOp[]): EntityState[] {
  const seen = new Set<string>();
  const out: EntityState[] = [];
  for (const { target, id } of ops.flatMap(opEntities)) {
    if (seen.has(`${target}:${id}`)) continue;
    seen.add(`${target}:${id}`);
    out.push({ target, id, entity: structuredClone(entityIn(world, target, id)) });
  }
  return out;
}

/** How a revert names an entity: its name, or an access test's sentence. */
export function entityLabel(target: DraftTarget, entity: Entity | null, id: string, world: TrifectaWorld): string {
  if (!entity) return id;
  if (target === 'accessTest') return describeTest(entity as unknown as AccessTest, world);
  return typeof entity['name'] === 'string' ? (entity['name'] as string) : id;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Builds an op for `target` (service-policy ops omit it). */
const opFor = (target: DraftTarget, op: Record<string, unknown>): DraftOp =>
  (target === 'servicePolicy' ? op : { ...op, target }) as DraftOp;

export interface RevertPlan {
  ops: DraftOp[];
  /** "users-gitlab" — touched by the commit and changed since; not reverted. */
  conflicts: string[];
}

/** The inverse of `commit` against `live`: each untouched-since entity back to `before`. */
export function revertOps(commit: CommitRecord, live: TrifectaWorld): RevertPlan {
  const ops: DraftOp[] = [];
  const conflicts: string[] = [];
  // An identity's attributes go back by bulk tagging: identities needing the same
  // add / remove share one op, placed where the first of them came.
  const tags = new Map<string, Extract<DraftOp, { kind: 'tag' }>>();
  const tag = (id: string, add: string[], remove: string[]) => {
    const key = JSON.stringify([add, remove]);
    const op = tags.get(key);
    if (op) op.identityIds.push(id);
    else {
      const created: Extract<DraftOp, { kind: 'tag' }> = { kind: 'tag', target: 'identityAttributes', identityIds: [id], add, remove };
      tags.set(key, created);
      ops.push(created);
    }
  };
  for (const b of commit.before) {
    const a = commit.after.find((x) => x.target === b.target && x.id === b.id);
    const now = entityIn(live, b.target, b.id);
    if (!same(now, a?.entity)) {
      conflicts.push(entityLabel(b.target, b.entity ?? a?.entity ?? now, b.id, live));
      continue;
    }
    if (!b.entity && now) ops.push(opFor(b.target, { kind: 'delete', policyId: b.id }));
    else if (b.entity && !now) ops.push(opFor(b.target, { kind: 'create', policy: structuredClone(b.entity) }));
    else if (b.entity && now) {
      // Only the fields that differ — an update-only target accepts no others.
      const keys = new Set([...Object.keys(b.entity), ...Object.keys(now)].filter((k) => k !== 'id'));
      if (b.target === 'identity' && keys.has('attributes') && !same(b.entity['attributes'], now['attributes'])) {
        const was = (b.entity['attributes'] as string[] | undefined) ?? [];
        const is = (now['attributes'] as string[] | undefined) ?? [];
        const [add, remove] = [was.filter((a) => !is.includes(a)), is.filter((a) => !was.includes(a))];
        if (add.length || remove.length) tag(b.id, add, remove); // order alone isn't a change
        keys.delete('attributes');
      }
      const patch = Object.fromEntries([...keys].filter((k) => !same(b.entity![k], now[k])).map((k) => [k, structuredClone(b.entity![k])]));
      if (Object.keys(patch).length) ops.push(opFor(b.target, { kind: 'update', policyId: b.id, patch }));
    }
  }
  return { ops, conflicts };
}
