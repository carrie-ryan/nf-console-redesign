/**
 * TIME-LIMITED ACCESS (prototype of NetFoundry-side scheduling). Pure.
 *
 * Ziti has no native expiry. A service policy may carry `expiresAt` (the scheduler
 * deletes it then) and `expiringEntries` (each named identity entry is removed from
 * identityRoles at its own time). Setting or changing either is a normal draft update.
 *
 *   EXPIRY_PRESETS   the editor's choices (1 h … 1 week; "date" picks one)
 *   untilText        "7 h 59 m" / "1 day 4 h" / "less than a minute"
 *   expiryPill       "expires in 7 h 59 m", amber (`soon`) under an hour
 *   dueExpiryOps     the ops the scheduler applies once `now` has passed them
 *   afterExpiry      the world once the given policies' expiries have all run
 *   expiryLines      review lines for the expiry fields an update/create sets
 */

import type { ExpiringEntry, Identity, Policy } from '../../shared/services/mock-data.service';
import { entityMatchesRoles } from '../authorization/authorization-resolver';
import type { TrifectaWorld } from '../authorization/trifecta-resolver';
import { applyDraft, type DraftOp } from './draft/policy-draft';
import { evaluateTest } from './access-tests';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The scheduler's actor in History. */
export const EXPIRY_ACTOR = 'Expiry';
/** Under this, a countdown turns amber. */
export const SOON_MS = HOUR;

export type ExpiryChoice = 'never' | '1h' | '8h' | '1d' | '1w' | 'date';

export const EXPIRY_PRESETS: readonly { id: Exclude<ExpiryChoice, 'never' | 'date'>; label: string; ms: number }[] = [
  { id: '1h', label: '1 hour', ms: HOUR },
  { id: '8h', label: '8 hours', ms: 8 * HOUR },
  { id: '1d', label: '1 day', ms: DAY },
  { id: '1w', label: '1 week', ms: 7 * DAY },
];

/** A preset's expiry time from `now`, as stored. */
export const presetTime = (id: Exclude<ExpiryChoice, 'never' | 'date'>, now: Date) =>
  new Date(now.getTime() + EXPIRY_PRESETS.find((p) => p.id === id)!.ms).toISOString();

const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "7 h 59 m", "8 h", "45 m", "1 day 4 h", "less than a minute" — rounded to the minute. */
export function untilText(ms: number): string {
  // Under an hour stays under an hour (59 m 59 s reads "59 m", never "1 h").
  const mins = ms < HOUR ? Math.min(59, Math.round(ms / MINUTE)) : Math.round(ms / MINUTE);
  if (mins < 1) return 'less than a minute';
  const d = Math.floor(mins / (24 * 60));
  const h = Math.floor((mins % (24 * 60)) / 60);
  const m = mins % 60;
  if (d) return [unit(d, 'day', 'days'), ...(h ? [`${h} h`] : [])].join(' ');
  return [...(h ? [`${h} h`] : []), ...(m || !h ? [`${m} m`] : [])].join(' ');
}

/** "Oct 14, 6:00 PM" — the exact time, for tooltips and the date field's note. */
export const expiryDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export interface ExpiryPill {
  /** "expires in 7 h 59 m" / "expired". */
  text: string;
  /** Under an hour left: amber. */
  soon: boolean;
  /** "Expires Oct 14, 6:00 PM". */
  title: string;
}

export function expiryPill(iso: string, nowMs: number): ExpiryPill {
  const left = Date.parse(iso) - nowMs;
  return {
    text: left <= 0 ? 'expiring now' : `expires in ${untilText(left)}`,
    soon: left < SOON_MS,
    title: `Expires ${expiryDate(iso)} — removed by the NetFoundry scheduler (Ziti has no native expiry)`,
  };
}

/** Does `role` (a named '@' entry) name `identity`? */
const names = (role: string, identity: Pick<Identity, 'id' | 'name' | 'attributes'>) =>
  entityMatchesRoles([role], 'AnyOf', identity.attributes ?? [], identity.name, identity.id);

/** The expiry of `identity`'s named entry in `policy`, if it has one. */
export function entryExpiry(policy: Policy, identity: Pick<Identity, 'id' | 'name' | 'attributes'>): string | null {
  return policy.expiringEntries?.find((e) => names(e.role, identity))?.expiresAt ?? null;
}

/** Per policy with any expiry: its own, and its entries' by identity id. */
export interface PolicyExpiry {
  at: string | null;
  entries: ReadonlyMap<string, string>;
}

export function expiryIndex(world: TrifectaWorld): ReadonlyMap<string, PolicyExpiry> {
  const out = new Map<string, PolicyExpiry>();
  for (const p of world.policies) {
    if (!p.expiresAt && !p.expiringEntries?.length) continue;
    const entries = new Map<string, string>();
    for (const e of p.expiringEntries ?? []) {
      for (const i of world.identities) if (names(e.role, i)) entries.set(i.id, e.expiresAt);
    }
    out.set(p.id, { at: p.expiresAt ?? null, entries });
  }
  return out;
}

/** The entries left once `gone` are removed — undefined when none are (the field goes). */
const remaining = (entries: readonly ExpiringEntry[], gone: readonly ExpiringEntry[]) => {
  const left = entries.filter((e) => !gone.includes(e));
  return left.length ? left : undefined;
};

/** The ops that run `policy`'s expiries `due` decides: a delete, or one update removing entries. */
function expiryOps(policy: Policy, due: (iso: string) => boolean): DraftOp[] {
  if (policy.expiresAt && due(policy.expiresAt)) return [{ kind: 'delete', policyId: policy.id }];
  const gone = (policy.expiringEntries ?? []).filter((e) => due(e.expiresAt));
  if (!gone.length) return [];
  const roles = new Set(gone.map((e) => e.role));
  return [
    {
      kind: 'update',
      policyId: policy.id,
      patch: {
        identityRoles: policy.identityRoles.filter((r) => !roles.has(r)),
        expiringEntries: remaining(policy.expiringEntries ?? [], gone),
      },
    },
  ];
}

/** What the scheduler applies at `nowMs`: every expiry at or before it. */
export function dueExpiryOps(world: TrifectaWorld, nowMs: number): DraftOp[] {
  return world.policies.flatMap((p) => expiryOps(p, (iso) => Date.parse(iso) <= nowMs));
}

/** The next expiry after `nowMs` (ms), or null. */
export function nextExpiry(world: TrifectaWorld, nowMs: number): number | null {
  let next: number | null = null;
  for (const p of world.policies) {
    for (const iso of [p.expiresAt, ...(p.expiringEntries ?? []).map((e) => e.expiresAt)]) {
      const t = iso ? Date.parse(iso) : NaN;
      if (t > nowMs && (next === null || t < next)) next = t;
    }
  }
  return next;
}

/** `world` once every expiry of `policyIds` has run (whenever it's due). */
export function afterExpiry(world: TrifectaWorld, policyIds: readonly string[]): TrifectaWorld {
  const ids = new Set(policyIds);
  const ops = world.policies.filter((p) => ids.has(p.id)).flatMap((p) => expiryOps(p, () => true));
  return ops.length ? applyDraft(world, ops) : world;
}

const expiryKey = (p: Policy | undefined) =>
  JSON.stringify([p?.expiresAt ?? null, [...(p?.expiringEntries ?? [])].sort((a, b) => a.role.localeCompare(b.role))]);

/** Policies whose expiry the draft sets or changes (and which still expire). */
export function draftExpiryPolicyIds(live: TrifectaWorld, draft: TrifectaWorld): string[] {
  const before = new Map(live.policies.map((p) => [p.id, p]));
  return draft.policies
    .filter((p) => (p.expiresAt || p.expiringEntries?.length) && expiryKey(p) !== expiryKey(before.get(p.id)))
    .map((p) => p.id);
}

export interface ExpiryTestWarning {
  policyIds: string[];
  testId: string;
  /** "When users-gitlab expires (in 8 h), this test will fail: laptop-alice must connect to git-repo." */
  text: string;
}

/** One scheduled removal: a policy's own expiry, or one named entry's. */
interface ExpiryEvent {
  at: number;
  policy: Policy;
  entry: ExpiringEntry | null;
}

/**
 * Access tests the draft passes but that would fail once the expiries it sets have
 * run — evaluated on the world after each removal in time order, so each warning
 * names the removal that breaks it.
 */
export function expiryTestWarnings(live: TrifectaWorld, draft: TrifectaWorld, nowMs: number): ExpiryTestWarning[] {
  const ids = draftExpiryPolicyIds(live, draft);
  if (!ids.length || !draft.accessTests?.length) return [];
  const chosen = new Set(ids);
  const events: ExpiryEvent[] = draft.policies
    .filter((p) => chosen.has(p.id))
    .flatMap((p) => [
      ...(p.expiresAt ? [{ at: Date.parse(p.expiresAt), policy: p, entry: null }] : []),
      ...(p.expiringEntries ?? []).map((e) => ({ at: Date.parse(e.expiresAt), policy: p, entry: e })),
    ])
    .sort((a, b) => a.at - b.at);
  const label = (role: string) => draft.identities.find((i) => names(role, i))?.name ?? role.slice(1);

  let pending = draft.accessTests.filter((t) => evaluateTest(t, draft, live).pass);
  const out: ExpiryTestWarning[] = [];
  let world = draft;
  for (const ev of events) {
    if (!pending.length) break;
    const p = world.policies.find((x) => x.id === ev.policy.id);
    if (!p) continue; // already deleted by an earlier expiry
    const op: DraftOp = ev.entry
      ? {
          kind: 'update',
          policyId: p.id,
          patch: {
            identityRoles: p.identityRoles.filter((r) => r !== ev.entry!.role),
            expiringEntries: remaining(p.expiringEntries ?? [], (p.expiringEntries ?? []).filter((e) => e.role === ev.entry!.role)),
          },
        }
      : { kind: 'delete', policyId: p.id };
    const next = applyDraft(world, [op]);
    const what = ev.entry ? `${label(ev.entry.role)}'s access via ${p.name} expires` : `${p.name} expires`;
    const failing = pending.map((t) => evaluateTest(t, next, world)).filter((r) => !r.pass);
    for (const r of failing) {
      out.push({ policyIds: [p.id], testId: r.test.id, text: `When ${what} (in ${untilText(ev.at - nowMs)}), this test will fail: ${r.text}.` });
    }
    pending = pending.filter((t) => !failing.some((r) => r.test.id === t.id));
    world = next;
  }
  return out;
}

/** "Expires in 8 h" / "no longer expires" lines for what an op sets on `before` → `after`. */
export function expiryLines(before: Policy | undefined, after: Policy, world: TrifectaWorld, nowMs: number): string[] {
  const lines: string[] = [];
  const at = (iso: string) => `expires in ${untilText(Date.parse(iso) - nowMs)}`;
  if (after.expiresAt !== before?.expiresAt) {
    lines.push(after.expiresAt ? `${after.name} ${at(after.expiresAt)}` : `${after.name} no longer expires`);
  }
  const was = new Map((before?.expiringEntries ?? []).map((e) => [e.role, e.expiresAt]));
  const now = new Map((after.expiringEntries ?? []).map((e) => [e.role, e.expiresAt]));
  const label = (role: string) => {
    const hit = world.identities.find((i) => names(role, i));
    return hit?.name ?? role.slice(1);
  };
  for (const [role, iso] of now) if (was.get(role) !== iso) lines.push(`${label(role)} via ${after.name} ${at(iso)}`);
  // An entry whose role is still there but no longer expires (a removed role says so itself).
  for (const role of was.keys()) {
    if (!now.has(role) && after.identityRoles.includes(role)) lines.push(`${label(role)} via ${after.name} no longer expires`);
  }
  return lines;
}

/**
 * Ops with every expiry at or before `nowMs` dropped from the service policies they
 * create or update — a revert of an expiry would otherwise put back access that
 * expires again at once. (An entry's role stays; only its expiry goes.)
 */
export function dropPastExpiries(ops: readonly DraftOp[], nowMs: number): DraftOp[] {
  const past = (iso: string | undefined) => !!iso && Date.parse(iso) <= nowMs;
  const clean = <T extends { expiresAt?: string; expiringEntries?: ExpiringEntry[] }>(p: T): T => {
    const out = { ...p };
    if ('expiresAt' in out && past(out.expiresAt)) out.expiresAt = undefined;
    if (out.expiringEntries) {
      const left = out.expiringEntries.filter((e) => !past(e.expiresAt));
      out.expiringEntries = left.length ? left : undefined;
    }
    return out;
  };
  return ops.map((op) => {
    if ((op.target ?? 'servicePolicy') !== 'servicePolicy') return op;
    if (op.kind === 'create') return { ...op, policy: clean(op.policy as Policy) } as DraftOp;
    if (op.kind === 'update') return { ...op, patch: clean(op.patch as Partial<Policy>) } as DraftOp;
    return op;
  });
}

/** Time-limited access a revert puts back after its expiry passed: the whole policy
 *  (role null) or one named entry. Its expiry is dropped (dropPastExpiries). */
export interface ExpiredRestore {
  policyId: string;
  policyName: string;
  /** The named entry ('@name'); null for the policy's own expiry. */
  role: string | null;
  /** The entry's identity by name ("carol@corp.com"); null for the policy. */
  identityName: string | null;
  /** When it expired (ISO). */
  expiredAt: string;
}

/** What dropPastExpiries would drop from `ops`, described for the review. */
export function expiredRestores(ops: readonly DraftOp[], live: TrifectaWorld, nowMs: number): ExpiredRestore[] {
  const past = (iso: string | undefined): iso is string => !!iso && Date.parse(iso) <= nowMs;
  const out: ExpiredRestore[] = [];
  for (const op of ops) {
    if ((op.target ?? 'servicePolicy') !== 'servicePolicy' || (op.kind !== 'create' && op.kind !== 'update')) continue;
    const fields = (op.kind === 'create' ? op.policy : op.patch) as Partial<Policy>;
    const id = op.kind === 'create' ? op.policy.id : op.policyId;
    const name = fields.name ?? live.policies.find((p) => p.id === id)?.name ?? id;
    if (past(fields.expiresAt)) out.push({ policyId: id, policyName: name, role: null, identityName: null, expiredAt: fields.expiresAt });
    for (const e of fields.expiringEntries ?? []) {
      if (!past(e.expiresAt)) continue;
      const who = live.identities.find((i) => names(e.role, i))?.name ?? e.role.slice(1);
      out.push({ policyId: id, policyName: name, role: e.role, identityName: who, expiredAt: e.expiresAt });
    }
  }
  return out;
}

/**
 * The restores that still apply to `draft`: the policy is there and still has no
 * expiry of its own (or the entry is there with none) — setting a new one ends the warning.
 */
export function openExpiredRestores(restores: readonly ExpiredRestore[], draft: TrifectaWorld): ExpiredRestore[] {
  return restores.filter((r) => {
    const p = draft.policies.find((x) => x.id === r.policyId);
    if (!p) return false;
    if (r.role === null) return !p.expiresAt;
    return p.identityRoles.includes(r.role) && !p.expiringEntries?.some((e) => e.role === r.role) && !p.expiresAt;
  });
}
