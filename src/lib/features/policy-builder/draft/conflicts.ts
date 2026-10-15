/**
 * COMMIT-TIME CONFLICTS — live moving underneath the draft. Pure and headless.
 *
 * When a draft op first touches an entity, the store records that entity's live state
 * as its BASELINE (null: it didn't exist). Later, any touched entity whose live state
 * no longer equals its baseline is a conflict — someone changed it outside this draft —
 * and commit is blocked until each is resolved:
 *
 *   reapply — rebase: my edited fields on top of the current live entity (fields both
 *             sides changed take the value the user picks), with live as the new baseline;
 *   drop    — the entity's ops leave the draft.
 *
 * Bulk tagging (kind 'tag') touches many identities, and is a delta (add / remove), not
 * a value: reapplying keeps it as it is — it applies to the latest just as well — and
 * dropping takes just that identity out of it. Its 'attributes' never clash.
 */

import { expiryDate } from '../expiry';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { entityIn, entityLabel, type EntityState } from './history';
import { opEntities, tagAttributes, type DraftOp, type DraftTarget } from './policy-draft';

type Entity = { id: string; [k: string]: unknown };

/** '<target>:<id>' — one baseline per touched entity. */
export const entityKey = (target: DraftTarget, id: string) => `${target}:${id}`;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The baselines for `ops`: kept from `prev` for entities already touched, live's state
 *  for newly touched ones; entities no longer touched drop out. */
export function nextBaselines(
  prev: ReadonlyMap<string, EntityState>,
  live: TrifectaWorld,
  ops: readonly DraftOp[],
): Map<string, EntityState> {
  const out = new Map<string, EntityState>();
  for (const { target, id } of ops.flatMap(opEntities)) {
    const key = entityKey(target, id);
    if (out.has(key)) continue;
    out.set(key, prev.get(key) ?? { target, id, entity: structuredClone(entityIn(live, target, id)) });
  }
  return out;
}

export interface FieldChange {
  field: string;
  /** "Identities" */
  label: string;
  from: unknown;
  to: unknown;
}

export interface EntityConflict {
  key: string;
  target: DraftTarget;
  id: string;
  /** "users-gitlab" */
  name: string;
  /** "users-gitlab changed in live since you started editing it" */
  text: string;
  /** Their change: baseline → live, per field ('exists' when it was created or deleted). */
  theirs: FieldChange[];
  /** My change: baseline → mine, per field; a delete is one 'exists' change to false. */
  mine: FieldChange[];
  /** Fields both sides changed, to different values: the user picks. */
  clashes: { field: string; label: string; theirs: unknown; mine: unknown }[];
  /** Reapplying needs the entity in live and my change to be an update or a delete. */
  canReapply: boolean;
}

const LABELS: Record<string, string> = {
  name: 'Name',
  semantic: 'Match',
  identityRoles: 'Identities',
  serviceRoles: 'Services',
  postureCheckRoles: 'Posture checks',
  edgeRouterRoles: 'Routers',
  terminatorStrategy: 'Strategy',
  hostingPrecedence: 'Hosting precedence',
  hostingCost: 'Hosting cost',
  expiresAt: 'Expires',
  expiringEntries: 'Expiring identities',
  exists: 'Exists',
};
export const fieldLabel = (field: string) => LABELS[field] ?? field;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const isEntry = (x: unknown): x is { role: string; expiresAt: string } =>
  typeof x === 'object' && x !== null && 'role' in x && 'expiresAt' in x;

/** A field value for display: lists comma-joined, times as dates, nothing as "—". */
export function valueText(v: unknown): string {
  if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return '—';
  if (Array.isArray(v)) return v.map((x) => (isEntry(x) ? `${x.role.slice(1)} (${expiryDate(x.expiresAt)})` : x)).join(', ');
  if (typeof v === 'string' && ISO_TIME.test(v)) return expiryDate(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function fieldChanges(from: Entity | null, to: Entity | null): FieldChange[] {
  if (!from || !to) return from === to ? [] : [{ field: 'exists', label: fieldLabel('exists'), from: !!from, to: !!to }];
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter((k) => k !== 'id');
  return keys.filter((k) => !same(from[k], to[k])).map((k) => ({ field: k, label: fieldLabel(k), from: from[k], to: to[k] }));
}

const touches = (op: DraftOp, target: DraftTarget, id: string) => opEntities(op).some((e) => e.target === target && e.id === id);
const opsFor = (ops: readonly DraftOp[], target: DraftTarget, id: string) => ops.filter((op) => touches(op, target, id));

/** My change to one entity, from its baseline: what the draft's ops do to it. */
function myChanges(baseline: Entity | null, ops: readonly DraftOp[]): FieldChange[] {
  if (ops.some((op) => op.kind === 'delete')) return baseline ? [{ field: 'exists', label: fieldLabel('exists'), from: true, to: false }] : [];
  const created = ops.find((op) => op.kind === 'create');
  let mine: Entity | null = created && created.kind === 'create' ? (created.policy as unknown as Entity) : baseline;
  for (const op of ops) {
    if (op.kind === 'update') mine = { ...(mine ?? { id: op.policyId }), ...(op.patch as Record<string, unknown>) };
    else if (op.kind === 'tag' && mine) mine = { ...mine, attributes: tagAttributes((mine['attributes'] as string[] | undefined) ?? [], op) };
  }
  return fieldChanges(baseline, mine);
}

/** Every touched entity whose live state left its baseline — first-touched order. */
export function entityConflicts(
  baselines: ReadonlyMap<string, EntityState>,
  live: TrifectaWorld,
  ops: readonly DraftOp[],
): EntityConflict[] {
  const out: EntityConflict[] = [];
  for (const [key, b] of baselines) {
    const now = entityIn(live, b.target, b.id) as Entity | null;
    if (same(now, b.entity)) continue;
    const entityOps = opsFor(ops, b.target, b.id);
    const theirs = fieldChanges(b.entity as Entity | null, now);
    const mine = myChanges(b.entity as Entity | null, entityOps);
    const tagged = entityOps.some((op) => op.kind === 'tag');
    const clashes = mine
      .filter((m) => m.field !== 'exists' && !(tagged && m.field === 'attributes'))
      .flatMap((m) => {
        const t = theirs.find((x) => x.field === m.field);
        return t && !same(t.to, m.to) ? [{ field: m.field, label: m.label, theirs: t.to, mine: m.to }] : [];
      });
    const name = entityLabel(b.target, (b.entity ?? now) as Entity | null, b.id, live);
    out.push({
      key,
      target: b.target,
      id: b.id,
      name,
      text: `${name} changed in live since you started editing it`,
      theirs,
      mine,
      clashes,
      canReapply: !!now && entityOps.every((op) => op.kind !== 'create'),
    });
  }
  return out;
}

/** Builds an op for `target` (service-policy ops omit it). */
const opFor = (target: DraftTarget, op: Record<string, unknown>): DraftOp =>
  (target === 'servicePolicy' ? op : { ...op, target }) as DraftOp;

/**
 * The draft with one conflicted entity rebased on live: its ops become one update of
 * my changed fields over the current live entity (a delete stays a delete). Fields both
 * sides changed take `picks[field]` — 'theirs' leaves live's value. Fields equal to live
 * drop out; nothing left, and the entity leaves the draft. The entity keeps its place.
 */
export function reapplyOps(
  c: EntityConflict,
  live: TrifectaWorld,
  ops: readonly DraftOp[],
  picks: Readonly<Record<string, 'theirs' | 'mine'>> = {},
): DraftOp[] {
  const missing = c.clashes.filter((x) => !picks[x.field]).map((x) => x.label);
  if (missing.length) throw new Error(`Pick a value for ${missing.join(', ')}`);
  if (!c.canReapply) throw new Error(`${c.name} can't be reapplied — drop the change instead`);
  const now = entityIn(live, c.target, c.id) as Entity;
  // Bulk tagging stays as it is (a delta, and other identities' too); the rest is rebuilt.
  const entityOps: readonly DraftOp[] = opsFor(ops, c.target, c.id).filter((op) => op.kind !== 'tag');
  const tagged = entityOps.length !== opsFor(ops, c.target, c.id).length;
  let next: DraftOp | null;
  if (entityOps.some((op) => op.kind === 'delete')) {
    next = opFor(c.target, { kind: 'delete', policyId: c.id });
  } else {
    const patch: Record<string, unknown> = {};
    for (const m of c.mine) {
      if (m.field === 'exists' || picks[m.field] === 'theirs' || (tagged && m.field === 'attributes')) continue;
      if (!same(m.to, now[m.field])) patch[m.field] = structuredClone(m.to);
    }
    next = Object.keys(patch).length ? opFor(c.target, { kind: 'update', policyId: c.id, patch }) : null;
  }
  const at = ops.findIndex((op) => entityOps.includes(op));
  const rebuilt = ops.flatMap((op, i) => (i === at && next ? [next] : entityOps.includes(op) ? [] : [op]));
  // Only tag ops touched it: nothing to rebuild, so a reapplied update goes last.
  return at < 0 && next ? [...rebuilt, next] : rebuilt;
}

/** The draft without one entity's ops — and without that identity in any bulk tagging
 *  (a tag op left with no identity goes too). */
export function dropOps(c: Pick<EntityConflict, 'target' | 'id'>, ops: readonly DraftOp[]): DraftOp[] {
  return ops.flatMap((op): DraftOp[] => {
    if (op.kind === 'tag') {
      if (c.target !== 'identity' || !op.identityIds.includes(c.id)) return [op];
      const identityIds = op.identityIds.filter((id) => id !== c.id);
      return identityIds.length ? [{ ...op, identityIds }] : [];
    }
    return touches(op, c.target, c.id) ? [] : [op];
  });
}
