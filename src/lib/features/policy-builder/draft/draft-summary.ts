/**
 * DRAFT SUMMARY — plain-language text for the review panel. Pure.
 *
 * describeOps: one line per op, each described against the world just before it.
 *              Bulk tagging reads "Added #kiosks to 120 identities" / "Removed #users
 *              from bob@corp.com" (one identity: by name).
 *              Router-policy ops read as "router access" (ERP: identities →
 *              routers) and "service routing" (SERP: services → routers).
 *              A service policy's expiry fields add "users-gitlab expires in 8 h" /
 *              "bob@corp.com via users-gitlab expires in 8 h" (alone when nothing
 *              else changed).
 * effectRows:  one row per diff.services entry (current service first), with
 *              verdict deltas and the newly authorized / no-longer-authorized
 *              dialers split by status. Counts come from the diff only.
 */

import type { Policy } from '../../../shared/services/mock-data.service';
import type { TrifectaStatus, TrifectaWorld } from '../../authorization/trifecta-resolver';
import type { DraftDiff, VerdictFields } from './draft-diff';
import { applyDraft, isServicePolicyOp, type DraftOp, type IdentityAttributesOp } from './policy-draft';
import { describeConfigOp } from './config-effects';
import { expiryLines } from '../expiry';

// ─── ops ──────────────────────────────────────────────────────────────────────

const RULE_NOUN: Record<Policy['type'], string> = { dial: 'dial rule', bind: 'host rule' };
const ROUTER_NOUN = { edgeRouterPolicy: 'router access', serviceEdgeRouterPolicy: 'service routing' } as const;

type Show = (role: string) => string;
const asIs: Show = (r) => r;

/** @refs written by id, shown by name where one resolves (services, routers). */
const byName =
  (entities: readonly { id: string; name: string }[]): Show =>
  (role) => {
    if (!role.startsWith('@')) return role;
    const hit = entities.find((e) => e.id === role.slice(1));
    return hit ? `@${hit.name}` : role;
  };

/** "@a, all of #x, #y" — @refs, then the # rule under the semantic. Empty → ''. */
function rolesText(roles: readonly string[], semantic: Policy['semantic'], show: Show): string {
  const refs = roles.filter((r) => r.startsWith('@')).map(show);
  const terms = roles.filter((r) => r.startsWith('#'));
  const rule = terms.length > 1 ? `${semantic === 'AllOf' ? 'all of' : 'any of'} ${terms.join(', ')}` : terms.join('');
  return [...refs, ...(rule ? [rule] : [])].join(', ');
}

/** The services a service-policy create targets, by bare name when they're @refs. */
function serviceTarget(p: Policy, world: TrifectaWorld): string {
  const show = byName(world.services);
  const roles = p.serviceRoles.map((r) => (r.startsWith('@') ? show(r).slice(1) : r));
  return roles.length ? roles.join(', ') : 'no services';
}

function roleChanges(before: readonly string[], after: readonly string[], show: Show, noun = ''): string[] {
  const added = after.filter((r) => !before.includes(r)).map((r) => `added ${noun}${show(r)}`);
  const removed = before.filter((r) => !after.includes(r)).map((r) => `removed ${noun}${show(r)}`);
  return [...removed, ...added];
}

/** Common fields first (name, semantic), then each role side. */
function updateParts(
  before: { name: string; semantic: Policy['semantic'] } & Record<string, unknown>,
  after: typeof before,
  sides: [key: string, show: Show, noun: string][],
): string {
  const parts: string[] = [];
  if (after.name !== before.name) parts.push(`renamed to ${after.name}`);
  if (after.semantic !== before.semantic) parts.push(`match ${after.semantic === 'AllOf' ? 'all of' : 'any of'}`);
  for (const [key, show, noun] of sides) {
    parts.push(...roleChanges(before[key] as string[], after[key] as string[], show, noun));
  }
  return parts.length ? parts.join('; ') : 'no changes';
}

/** "Added #kiosks to 120 identities; removed #temp from 120 identities". */
function describeTag(op: IdentityAttributesOp, world: TrifectaWorld): string {
  const n = op.identityIds.length;
  const who = n === 1 ? (world.identities.find((i) => i.id === op.identityIds[0])?.name ?? op.identityIds[0]) : `${n.toLocaleString('en-US')} identities`;
  const parts = [
    ...(op.add.length ? [`Added ${op.add.join(', ')} to ${who}`] : []),
    ...(op.remove.length ? [`${op.add.length ? 'removed' : 'Removed'} ${op.remove.join(', ')} from ${who}`] : []),
  ];
  return parts.join('; ');
}

/** The op's line with its expiry lines: on their own when nothing else changed. */
const withExpiry = (line: string, expiry: string[], nothingElse: boolean) =>
  !expiry.length ? line : nothingElse ? expiry.join('; ') : [line, ...expiry].join('; ');

function describeOp(op: DraftOp, world: TrifectaWorld, next: TrifectaWorld, nowMs: number): string {
  if (op.kind === 'tag') return describeTag(op, world);
  const config = describeConfigOp(op, world, next);
  if (config !== null) return config;
  if (op.target === 'postureCheck' || op.target === 'service' || op.target === 'identity' || op.target === 'accessTest') {
    return 'Unsupported change';
  }
  const svc = byName(world.services);
  const er = byName(world.edgeRouters);
  const find = <T extends { id: string }>(xs: readonly T[], id: string) => xs.find((x) => x.id === id)!;

  if (isServicePolicyOp(op)) {
    switch (op.kind) {
      case 'create': {
        const line = `Created ${RULE_NOUN[op.policy.type]} for ${serviceTarget(op.policy, world)}: ${
          rolesText(op.policy.identityRoles, op.policy.semantic, asIs) || 'no identities yet'
        }`;
        return withExpiry(line, expiryLines(undefined, find(next.policies, op.policy.id), next, nowMs), false);
      }
      case 'update': {
        const before = find(world.policies, op.policyId);
        const after = find(next.policies, op.policyId);
        const parts = updateParts(before as never, after as never, [
          ['identityRoles', asIs, ''],
          ['serviceRoles', svc, 'service '],
          ['postureCheckRoles', asIs, 'posture check '],
        ]);
        return withExpiry(`Updated ${before.name}: ${parts}`, expiryLines(before, after, next, nowMs), parts === 'no changes');
      }
      case 'delete': {
        const p = find(world.policies, op.policyId);
        return `Deleted ${p.name} (${RULE_NOUN[p.type]})`;
      }
    }
  }

  const noun = ROUTER_NOUN[op.target];
  const isErp = op.target === 'edgeRouterPolicy';
  type RouterPolicy = { id: string; name: string };
  const coll = (w: TrifectaWorld): readonly RouterPolicy[] => (isErp ? w.edgeRouterPolicies : w.serviceEdgeRouterPolicies);
  // ERP: identities → routers; SERP: services → routers.
  const [fromKey, fromShow, fromNoun, empty] = isErp
    ? (['identityRoles', asIs, '', 'no identities'] as const)
    : (['serviceRoles', svc, 'service ', 'no services'] as const);

  switch (op.kind) {
    case 'create': {
      const p = op.policy as unknown as Record<string, string[]> & { semantic: Policy['semantic'] };
      const from = rolesText(p[fromKey], p.semantic, fromShow) || empty;
      const to = rolesText(p['edgeRouterRoles'], p.semantic, er) || 'no routers';
      return `Created ${noun}: ${from} → ${to}`;
    }
    case 'update': {
      const before = find(coll(world), op.policyId);
      const after = find(coll(next), op.policyId);
      return `Updated ${before.name} (${noun}): ${updateParts(before as never, after as never, [
        [fromKey, fromShow, fromNoun],
        ['edgeRouterRoles', er, 'router '],
      ])}`;
    }
    case 'delete':
      return `Deleted ${find(coll(world), op.policyId).name} (${noun})`;
  }
}

/** One readable line per op. Throws if the ops don't apply (as applyDraft would).
 *  Expiry times read relative to `nowMs` ("expires in 8 h"). */
export function describeOps(live: TrifectaWorld, ops: readonly DraftOp[], nowMs = Date.now()): string[] {
  const lines: string[] = [];
  let world = live;
  for (const op of ops) {
    const next = applyDraft(world, [op]);
    lines.push(describeOp(op, world, next, nowMs));
    world = next;
  }
  return lines;
}

// ─── effects ──────────────────────────────────────────────────────────────────

export interface Delta {
  before: number;
  after: number;
  delta: number;
}

export interface EffectRow {
  serviceId: string;
  serviceName: string;
  isCurrent: boolean;
  dialers: Delta;
  canConnect: Delta;
  hostsOnline: Delta;
  /** Dialers with an online route that posture keeps out. */
  blocked: Delta;
  /** "+15 blocked by posture" / "−1 blocked by posture"; null when unchanged. */
  postureLine: string | null;
  /** Configuration edits that reach this service (posture checks, strategy, hosting defaults). */
  configLines: string[];
  /** Posture loosening warnings: "Admins can now connect with X instead of Y". */
  looseningLines: string[];
  /** Set only when the reason changed; null stands for "can connect". */
  reason: { before: VerdictFields['reason']; after: VerdictFields['reason'] } | null;
  /** "+6 authorized · 0 can connect (6 no shared router)"; null if none. */
  newDialers: string | null;
  /** "−5 no longer authorized"; null if none. */
  lostDialers: string | null;
  /** Already-authorized dialers / hosts whose route changed: "18 dialers gained an
   *  online route · still no host, so no one can connect". */
  routeLines: string[];
}

const delta = (before: number, after: number): Delta => ({ before, after, delta: after - before });

/** "+6", "−5" (true minus), "±0". */
export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Newly authorized dialers by status. A reachable dialer only "can connect" when
 *  the service has a reachable host afterwards (as in the verdict). */
function newDialersText(statuses: TrifectaStatus[], hostReachable: boolean): string | null {
  if (!statuses.length) return null;
  const n = (s: TrifectaStatus) => statuses.filter((x) => x === s).length;
  const reachable = n('AUTHORIZED_REACHABLE');
  const can = hostReachable ? reachable : 0;
  const why = [
    [n('AUTHORIZED_NO_ROUTER'), 'no shared router'],
    [n('BLOCKED_ROUTERS_OFFLINE'), 'routers offline'],
    [hostReachable ? 0 : reachable, 'no host online'],
  ]
    .filter(([c]) => (c as number) > 0)
    .map(([c, t]) => `${c} ${t}`);
  return `+${statuses.length} authorized · ${can} can connect${why.length ? ` (${why.join(', ')})` : ''}`;
}

const TRACK_NOUN = { dial: ['dialer', 'dialers'], bind: ['host', 'hosts'] } as const;

/** "1 dialer" / "18 hosts". */
export const trackCount = (n: number, track: 'dial' | 'bind') => plural(n, TRACK_NOUN[track][0], TRACK_NOUN[track][1]);

/** Dialers can only connect through a reachable, serving host: when there is none
 *  afterwards, "still no host, so no one can connect" (or "but now …" if there was
 *  one before). A reachable host with no terminator gets the runtime reason as is. */
export function noHostNote(before: Pick<VerdictFields, 'hostsReachable'>, after: VerdictFields): string | null {
  if (after.reason === 'no host serving yet') return `${after.reason}, so no one can connect`;
  if (after.hostsReachable > 0 || !after.reason) return null;
  return `${before.hostsReachable === 0 ? 'still' : 'but now'} ${after.reason}, so no one can connect`;
}

/** Route changes among pairs authorized both before and after, per track. */
function routeLines(changes: DraftDiff['pairChanges'], before: VerdictFields, after: VerdictFields): string[] {
  const lines: string[] = [];
  const kept = changes.filter((c) => c.before !== 'NOT_AUTHORIZED' && c.after !== 'NOT_AUTHORIZED');
  for (const track of ['dial', 'bind'] as const) {
    const onTrack = kept.filter((c) => c.track === track);
    const gained = onTrack.filter((c) => c.after === 'AUTHORIZED_REACHABLE').length;
    const lost = onTrack.filter((c) => c.before === 'AUTHORIZED_REACHABLE').length;
    if (gained) {
      const note = track === 'dial' ? noHostNote(before, after) : null;
      lines.push(`${trackCount(gained, track)} gained an online route${note ? ` · ${note}` : ''}`);
    }
    if (lost) lines.push(`${trackCount(lost, track)} lost ${lost === 1 ? 'its' : 'their'} online route`);
  }
  return lines;
}

export function effectRows(diff: DraftDiff, live: TrifectaWorld, currentServiceId: string): EffectRow[] {
  const rows = diff.services.map((s): EffectRow => {
    const dial = diff.pairChanges.filter((c) => c.serviceId === s.serviceId && c.track === 'dial');
    const gained = dial.filter((c) => c.before === 'NOT_AUTHORIZED').map((c) => c.after);
    const lost = dial.filter((c) => c.after === 'NOT_AUTHORIZED').length;
    const b = s.verdictBefore;
    const a = s.verdictAfter;
    return {
      serviceId: s.serviceId,
      serviceName: live.services.find((x) => x.id === s.serviceId)?.name ?? s.serviceId,
      isCurrent: s.serviceId === currentServiceId,
      dialers: delta(b.dialTotal, a.dialTotal),
      canConnect: delta(b.canConnect, a.canConnect),
      hostsOnline: delta(b.hostsReachable, a.hostsReachable),
      blocked: delta(b.blockedByPosture, a.blockedByPosture),
      configLines: diff.configChanges.find((c) => c.serviceId === s.serviceId)?.lines ?? [],
      looseningLines: diff.loosenings.filter((l) => l.serviceId === s.serviceId).map((l) => l.text),
      postureLine:
        a.blockedByPosture === b.blockedByPosture ? null : `${signed(a.blockedByPosture - b.blockedByPosture)} blocked by posture`,
      reason: b.reason === a.reason ? null : { before: b.reason, after: a.reason },
      newDialers: newDialersText(gained, a.hostsReachable > 0),
      lostDialers: lost ? `−${plural(lost, 'dialer', 'dialers')} no longer authorized` : null,
      routeLines: routeLines(
        diff.pairChanges.filter((c) => c.serviceId === s.serviceId),
        b,
        a,
      ),
    };
  });
  // Current service first; the rest keep diff (live-world) order.
  return [...rows.filter((r) => r.isCurrent), ...rows.filter((r) => !r.isCurrent)];
}
