/**
 * SERVICE VIEW layout — pure, headless, deterministic. No Angular, no UI.
 *
 * For one service, lays out who may host it (Bind) and who may dial it (Dial) as
 * three fixed lanes: Bind groups (x=0) → service (x=1) ← Dial groups (x=2).
 *
 * Each matching policy's identityRoles are SPLIT, never mixed:
 *   • '@refs'  → one 'named' group. Direct refs are unioned regardless of the
 *                policy's semantic (as Ziti does).
 *   • '#terms' → one 'rule' group, matched under the policy's semantic.
 * Role matching goes through entityMatchesRoles — never reimplemented here — which
 * applies the same split, so the union of a lane's groups is exactly the trifecta
 * resolver's authorized set for that lane.
 */

import { entityMatchesRoles } from '../authorization/authorization-resolver';
import { indexFor, type WorldIndex } from '../authorization/world-index';
import { hostingFor, type Hosting } from './hosting';
import { postureFor, requiredChecks, type Posture } from './posture';
import {
  enumerateForService,
  resolve,
  type TrifectaStatus,
  type TrifectaWorld,
} from '../authorization/trifecta-resolver';
import type { Identity, Policy } from '../../shared/services/mock-data.service';

export type GroupKind = 'named' | 'rule';
export type Lane = 'bind' | 'dial';

export interface NamedRef {
  /** Resolved identity id, or the raw ref when it names no identity. */
  id: string;
  name: string;
}

export interface Group {
  id: string;
  policyId: string;
  policyName: string;
  kind: GroupKind;
  lane: Lane;
  x: number;
  y: number;
  /** kind 'named' only — the identities the policy's @refs name. */
  named?: NamedRef[];
  /** kind 'rule' only — the policy's # terms and the semantic they're matched under. */
  rule?: { semantic: Policy['semantic']; terms: string[] };
  memberIds: string[];
  /** Member names, in memberIds order. */
  memberNames: string[];
  memberCount: number;
  /** The policy reaches this service only through '#all' — it applies to every service. */
  appliesToAll: boolean;
  /** How the policy's serviceRoles reach THIS service — where the canvas edge lands. */
  serviceMatch: ServiceMatch;
  /** Other services the same policy covers, in world order. */
  otherServiceIds: string[];
  /** Members bucketed by this lane's trifecta status (Dial: status, Bind: bindStatus).
   *  Sums to memberCount. */
  status: StatusCounts;
  /** The posture checks the policy requires, in world.postureChecks order. */
  checks: { id: string; name: string }[];
  /** On this service: `blocked` — members with an online route whose posture (this
   *  lane's track) isn't satisfied; `bypassed` — members who skip one of this
   *  policy's checks through another granting policy they satisfy that doesn't require it. */
  posture: { blocked: number; bypassed: number };
  /** labelGroup(g, true) — the aria-label source. Visible text is labelGroup(g, false). */
  label: GroupLabel;
}

/**
 * How a policy's serviceRoles cover one service, by precedence:
 *   • 'named'      — an @ref names it (terms: the matching @refs);
 *   • 'attributes' — its non-#all terms match (terms: those the service satisfies);
 *   • 'all'        — only '#all' reaches it (terms: ['#all']).
 */
export interface ServiceMatch {
  via: 'named' | 'attributes' | 'all';
  terms: string[];
}

export interface StatusCounts {
  /** AUTHORIZED_REACHABLE */
  reachable: number;
  /** BLOCKED_ROUTERS_OFFLINE */
  routersOffline: number;
  /** AUTHORIZED_NO_ROUTER */
  noSharedRouter: number;
  /** NOT_AUTHORIZED — 0 whenever the layout and resolver agree (conservation). */
  notAuthorized: number;
}

export interface GroupLabel {
  /** Plain language, service-independent: "any identity with #admins", or with the
   *  direction prefix "Can dial: any identity with #admins". */
  summary: string;
  /** Status phrases: "3 authorized", "all with an online route" — or the breakdown. */
  counts: LabelCount[];
  /** summary + counts joined with " · ". */
  text: string;
}

/** A status bucket the router-gap panel can explain (Dial and Bind alike). */
export type RouterGapKind = 'noSharedRouter' | 'routersOffline';

export interface LabelCount {
  text: string;
  /** Presentation hint: ok = online route, warn = routers offline, bad = no shared router / not authorized. */
  tone: 'neutral' | 'ok' | 'warn' | 'bad';
  /** Set on the two router-gap phrases, which the view makes clickable. */
  gap?: RouterGapKind;
  /** Set on the posture phrases, which open the posture panel. */
  posture?: 'blocked' | 'bypassed';
}

export interface LaneLayout {
  groups: Group[];
  /** Full plain-language sentence — the lane's aria-label. */
  summary: string;
  /** Size of the union of the lane's group memberIds. */
  total: number;
  /** Policies on this lane and service with no identity roles at all — they form no
   *  group (nothing to match), but the editor still needs a node to reopen them. */
  emptyPolicies: { policyId: string; policyName: string }[];
}

export type VerdictReason =
  | 'no host'
  | 'no host with an online route'
  | 'no dialers'
  | 'no dialer with an online route'
  /** Every reachable host fails its Bind posture checks. */
  | 'no host passes posture'
  /** Policies and routes are fine, but no authorized host has a live terminator —
   *  a runtime state, not a policy gap. */
  | 'no host serving yet'
  /** Hosts are serving, but every reachable dialer fails its Dial posture checks. */
  | 'no dialer passes posture';

/** Runtime reasons are amber (nothing to fix in policy); the rest are red. */
export const RUNTIME_REASONS: ReadonlySet<VerdictReason> = new Set(['no host serving yet']);

/** Can anyone actually connect? A connection needs a reachable host AND a reachable dialer. */
export interface ServiceVerdict {
  /** Distinct Bind members whose bindStatus is AUTHORIZED_REACHABLE. */
  hostsReachable: number;
  /** Bind-authorized hosts (hostingFor's authorizedHostIds). */
  hostsAuthorized: number;
  /** Authorized hosts with a terminator on an online router (hostingFor's servingHosts). */
  hostsServing: number;
  /** Distinct Dial members whose status is AUTHORIZED_REACHABLE and whose Dial posture
   *  is satisfied — 0 unless a host is reachable AND hostingFor has an active host. */
  canConnect: number;
  /** Reachable dialers excluded because their Dial posture isn't satisfied. */
  blockedByPosture: number;
  /** The Dial lane total (distinct Dial members). */
  dialTotal: number;
  /** Why canConnect is 0; null otherwise. */
  reason: VerdictReason | null;
  /** 'ok' when people can connect; 'warn' for a runtime reason; 'bad' for a policy or
   *  route gap; 'neutral' when nothing is set up. */
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
  /** "17 of 18 can connect · 1 blocked by posture · 2 of 9 hosts serving" or
   *  "No one can connect · no host". */
  text: string;
  /** Nothing set up yet: no Bind and no Dial members. The service view shows
   *  "Not set up yet" in neutral grey in place of `text`. */
  notSetUp: boolean;
}

export const NOT_SET_UP = 'Not set up yet';

/** No one can connect ONLY because no host has bound the service yet — how to say so. */
export interface HostWaiting {
  /** 'ready': a draft made hosts ready (they bind once it's live) — neutral blue.
   *  'waiting': live is waiting for a host to bind — amber. */
  kind: 'ready' | 'waiting';
  text: string;
  /** The tooltip. */
  title: string;
}

export const READY_TEXT = 'Ready · hosts start serving after you commit';
export const WAITING_TEXT = 'Waiting for a host to start serving';

/**
 * Null unless the service's only problem is that no host serves it ('no host serving
 * yet'). Then: 'ready' when `world` is a draft that made more hosts reachable than live
 * has; otherwise 'waiting' (live, or a draft that leaves its hosts as live has them).
 */
export function hostWaiting(serviceId: string, world: TrifectaWorld, live: TrifectaWorld): HostWaiting | null {
  const v = verdictFor(serviceId, world);
  if (v.reason !== 'no host serving yet') return null;
  const n = v.hostsReachable;
  const hosts = `${n.toLocaleString('en-US')} ${n === 1 ? 'host' : 'hosts'}`;
  const was = world === live || !indexFor(live).service(serviceId) ? null : verdictFor(serviceId, live);
  const fromDraft = !!was && !(was.reason === 'no host serving yet' && was.hostsReachable >= n);
  return fromDraft
    ? { kind: 'ready', text: READY_TEXT, title: `${hosts} will be authorized and reachable; they start serving once this change is live.` }
    : {
        kind: 'waiting',
        text: WAITING_TEXT,
        title: `${hosts} ${n === 1 ? 'is' : 'are'} authorized and reachable; none has bound this service yet.`,
      };
}

export interface ServiceViewLayout {
  /** attributes: the service's own, shown as chips that edges can end at. */
  service: { id: string; name: string; attributes: string[]; x: number; y: number };
  bind: LaneLayout;
  dial: LaneLayout;
  serviceVerdict: ServiceVerdict;
  routers: { eligible: { id: string; name: string; isOnline: boolean }[]; onlineCount: number };
  /** group → service */
  edges: { from: string; to: string }[];
}

const LANE_X: Record<Lane, number> = { bind: 0, dial: 2 };
const SERVICE_X = 1;
const LANE_PREFIX: Record<Lane, string> = { bind: 'Hosts', dial: 'Can dial' };

type Matchable = { id: string; name: string; attributes?: readonly string[] };

const matches = (roles: readonly string[], semantic: Policy['semantic'], e: Matchable) =>
  entityMatchesRoles(roles, semantic, e.attributes ?? [], e.name, e.id);

// ─── groups ───────────────────────────────────────────────────────────────────

/** A group before its service-specific status, posture and label are attached. */
type GroupCore = Omit<Group, 'status' | 'label' | 'posture' | 'checks'>;

/** True when `p` covers `service` only via '#all': drop the '#all' term and it no
 *  longer matches. A policy that also names the service (or matches another term)
 *  is the service's own. */
export function coversOnlyViaAll(p: Policy, service: Matchable): boolean {
  if (!p.serviceRoles.includes('#all') || !matches(p.serviceRoles, p.semantic, service)) return false;
  return !matches(p.serviceRoles.filter((r) => r !== '#all'), p.semantic, service);
}

/** How `p` covers `service` (which it must match) — see ServiceMatch. Each term is
 *  tested alone with the same matcher, so '#all' and @id / @name refs behave as Ziti. */
export function serviceMatchFor(p: Policy, service: Matchable): ServiceMatch {
  const satisfied = (t: string) => matches([t], 'AnyOf', service);
  const refs = p.serviceRoles.filter((r) => r.startsWith('@') && satisfied(r));
  if (refs.length) return { via: 'named', terms: refs };
  const terms = p.serviceRoles.filter((r) => r.startsWith('#') && r !== '#all');
  if (terms.length && matches(terms, p.semantic, service)) return { via: 'attributes', terms: terms.filter(satisfied) };
  return { via: 'all', terms: ['#all'] };
}

/** The coverage sentence a group's aria-label ends with: "Covers offline-svc via
 *  #git; also covers git-repo, no-serp-svc." `names` resolves otherServiceIds. */
export function describeCoverage(
  g: Pick<Group, 'serviceMatch' | 'otherServiceIds'>,
  serviceName: string,
  names: ReadonlyMap<string, string>,
): string {
  const how = g.serviceMatch.via === 'named' ? 'by name' : `via ${g.serviceMatch.terms.join(', ')}`;
  const others = g.otherServiceIds.map((id) => names.get(id) ?? id);
  return `Covers ${serviceName} ${how}${others.length ? `; also covers ${others.join(', ')}` : ''}.`;
}

function core(
  lane: Lane,
  p: Policy,
  kind: GroupKind,
  members: readonly Identity[],
  service: Matchable,
  ix: WorldIndex,
): Omit<GroupCore, 'named' | 'rule'> {
  return {
    id: `${lane}:${p.id}:${kind}`,
    policyId: p.id,
    policyName: p.name,
    kind,
    lane,
    x: LANE_X[lane],
    y: 0,
    memberIds: members.map((i) => i.id),
    memberNames: members.map((i) => i.name),
    memberCount: members.length,
    appliesToAll: coversOnlyViaAll(p, service),
    serviceMatch: serviceMatchFor(p, service),
    otherServiceIds: ix.servicesMatching(p.serviceRoles, p.semantic).filter((s) => s.id !== service.id).map((s) => s.id),
  };
}

function namedGroup(lane: Lane, p: Policy, refs: string[], ix: WorldIndex, service: Matchable): GroupCore {
  const named = refs.map((ref) => {
    const hit = ix.identitiesMatching([ref], 'AnyOf')[0];
    return hit ? { id: hit.id, name: hit.name } : { id: ref.slice(1), name: ref.slice(1) };
  });
  // @refs are unioned whatever the policy semantic says.
  const members = ix.identitiesMatching(refs, 'AnyOf');
  return { ...core(lane, p, 'named', members, service, ix), named };
}

function ruleGroup(lane: Lane, p: Policy, terms: string[], ix: WorldIndex, service: Matchable): GroupCore {
  const members = ix.identitiesMatching(terms, p.semantic);
  return { ...core(lane, p, 'rule', members, service, ix), rule: { semantic: p.semantic, terms } };
}

function laneGroups(
  lane: Lane,
  policies: readonly Policy[],
  world: TrifectaWorld,
  statusOf: ReadonlyMap<string, TrifectaStatus>,
  service: Matchable,
): Group[] {
  const ix = indexFor(world);
  const postureOf = memoPosture(service.id, lane, world);
  // By policy name; a policy's groups stay together, named before rule.
  const cores: GroupCore[] = [];
  const sorted = [...policies].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const p of sorted) {
    const refs = p.identityRoles.filter((r) => r.startsWith('@'));
    const terms = p.identityRoles.filter((r) => r.startsWith('#'));
    if (refs.length) cores.push(namedGroup(lane, p, refs, ix, service));
    if (terms.length) cores.push(ruleGroup(lane, p, terms, ix, service));
  }
  return cores.map((c, y) => {
    const policy = ix.policy(c.policyId)!;
    const checks = ix.requiredChecks(policy).map((k) => ({ id: k.id, name: k.name }));
    const checkIds = new Set(checks.map((k) => k.id));
    const posture = {
      blocked: c.memberIds.filter((id) => statusOf.get(id) === 'AUTHORIZED_REACHABLE' && !postureOf(id).satisfied).length,
      bypassed: c.memberIds.filter((id) => postureOf(id).bypassedChecks.some((k) => checkIds.has(k))).length,
    };
    const g = { ...c, y, checks, posture, status: countStatuses(c.memberIds, statusOf) };
    return { ...g, label: labelGroup(g, true) };
  });
}

/** postureFor on one service and track, computed once per identity. */
function memoPosture(serviceId: string, track: Lane, world: TrifectaWorld): (id: string) => Posture {
  const cache = new Map<string, Posture>();
  return (id) => {
    if (!cache.has(id)) cache.set(id, postureFor(id, serviceId, track, world));
    return cache.get(id)!;
  };
}

/** Bucket a group's members by their trifecta status (for its lane) on this service. */
function countStatuses(memberIds: readonly string[], statusOf: ReadonlyMap<string, TrifectaStatus>): StatusCounts {
  const counts: StatusCounts = { reachable: 0, routersOffline: 0, noSharedRouter: 0, notAuthorized: 0 };
  for (const id of memberIds) {
    switch (statusOf.get(id)) {
      case 'AUTHORIZED_REACHABLE': counts.reachable++; break;
      case 'BLOCKED_ROUTERS_OFFLINE': counts.routersOffline++; break;
      case 'AUTHORIZED_NO_ROUTER': counts.noSharedRouter++; break;
      default: counts.notAuthorized++;
    }
  }
  return counts;
}

// ─── summary ──────────────────────────────────────────────────────────────────

/** "N blocked by posture" / "N bypassed" — each only when non-zero. */
export function postureCounts(p: Group['posture']): LabelCount[] {
  const out: LabelCount[] = [];
  if (p.blocked) out.push({ text: `${p.blocked} blocked by posture`, tone: 'bad', posture: 'blocked' });
  if (p.bypassed) out.push({ text: `${p.bypassed} bypassed`, tone: 'warn', posture: 'bypassed' });
  return out;
}

/** One group in plain language — the piece a lane summary joins with ", OR ". */
export function describeGroup(g: Pick<Group, 'kind' | 'named' | 'rule'>): string {
  if (g.kind === 'named') return g.named!.map((n) => n.name).join(', ');
  const { semantic, terms } = g.rule!;
  if (terms.includes('#all')) return 'any identity';
  if (terms.length === 1) return `any identity with ${terms[0]}`;
  return `any identity matching ${semantic === 'AllOf' ? 'all' : 'any'} of ${terms.join(', ')}`;
}

/**
 * The ONE label function for a group node. `withPrefix` adds the lane direction
 * ("Hosts:" / "Can dial:") — on for the aria-label, off for the visible text. The
 * summary depends only on the policy (identical on every service); only the counts
 * vary. Counts: "N authorized · all with an online route" when every member has
 * one, else the breakdown (online route always; offline / no-router when non-zero).
 */
export function labelGroup(g: Omit<Group, 'label'>, withPrefix: boolean): GroupLabel {
  const description = describeGroup(g);
  const summary = withPrefix ? `${LANE_PREFIX[g.lane]}: ${description}` : description;
  const s = g.status;
  const authorized = s.reachable + s.routersOffline + s.noSharedRouter;
  const counts: LabelCount[] = [{ text: `${authorized} authorized`, tone: 'neutral' }];
  if (authorized > 0 && s.reachable === authorized && s.notAuthorized === 0) {
    counts.push({ text: 'all with an online route', tone: 'ok' });
  } else {
    counts.push({ text: `${s.reachable} with an online route`, tone: s.reachable ? 'ok' : 'neutral' });
    if (s.routersOffline) {
      counts.push({ text: `${s.routersOffline} with routers offline`, tone: 'warn', gap: 'routersOffline' });
    }
    if (s.noSharedRouter) {
      counts.push({ text: `${s.noSharedRouter} with no shared router`, tone: 'bad', gap: 'noSharedRouter' });
    }
    if (s.notAuthorized) counts.push({ text: `${s.notAuthorized} not authorized`, tone: 'bad' });
  }
  counts.push(...postureCounts(g.posture));
  return { summary, counts, text: [summary, ...counts.map((c) => c.text)].join(' · ') };
}

/** Distinct lane members whose status is AUTHORIZED_REACHABLE. */
/** A lane's members for the verdict: distinct ids, and each one's status on its track. */
interface VerdictLane {
  ids: readonly string[];
  status: (id: string) => TrifectaStatus | undefined;
}

const reachableIds = (lane: VerdictLane) => lane.ids.filter((id) => lane.status(id) === 'AUTHORIZED_REACHABLE');

/**
 * Reason precedence when no one can connect: no host → no host with an online
 * route → no dialers → no dialer with an online route → no host passes posture →
 * no host serving yet → no dialer passes posture.
 * ("No dialers" is checked before "no dialer with an online route", which it would
 * otherwise always satisfy. Posture and the runtime reason come after the routes:
 * they only matter once the policies and routes would let someone connect.)
 */
function verdictOf(
  serviceId: string,
  world: TrifectaWorld,
  bind: VerdictLane,
  dial: VerdictLane,
  hosting: Hosting,
  passes: (id: string, track: 'dial' | 'bind') => boolean = (id, track) => postureFor(id, serviceId, track, world).satisfied,
): ServiceVerdict {
  const reachableHosts = reachableIds(bind);
  const reachableDialers = reachableIds(dial);
  const hostsReachable = reachableHosts.length;
  const dialReachable = reachableDialers.length;
  const hostsPassing = reachableHosts.filter((id) => passes(id, 'bind')).length;
  const dialPassing = reachableDialers.filter((id) => passes(id, 'dial')).length;
  const blockedByPosture = dialReachable - dialPassing;
  const hostsAuthorized = hosting.authorizedHostIds.length;
  const hostsServing = hosting.servingHosts.length;
  const canConnect = hostsReachable > 0 && hosting.activeHostIds.length > 0 ? dialPassing : 0;
  const dialTotal = dial.ids.length;
  const notSetUp = bind.ids.length === 0 && dialTotal === 0;

  let reason: VerdictReason | null = null;
  if (canConnect === 0) {
    if (bind.ids.length === 0) reason = 'no host';
    else if (hostsReachable === 0) reason = 'no host with an online route';
    else if (dialTotal === 0) reason = 'no dialers';
    else if (dialReachable === 0) reason = 'no dialer with an online route';
    else if (hostsPassing === 0) reason = 'no host passes posture';
    else if (hosting.activeHostIds.length === 0) reason = 'no host serving yet';
    else reason = 'no dialer passes posture';
  }

  const blocked = blockedByPosture ? ` · ${blockedByPosture} blocked by posture` : '';
  const text = reason
    ? `No one can connect · ${reason}`
    : `${canConnect} of ${dialTotal} can connect${blocked} · ${hostsServing} of ${hostsAuthorized} ${hostsAuthorized === 1 ? 'host' : 'hosts'} serving`;
  const tone = notSetUp ? 'neutral' : !reason ? 'ok' : RUNTIME_REASONS.has(reason) ? 'warn' : 'bad';
  return { hostsReachable, hostsAuthorized, hostsServing, canConnect, blockedByPosture, dialTotal, reason, tone, text, notSetUp };
}

function laneLayout(lane: Lane, groups: Group[], policies: readonly Policy[]): LaneLayout {
  const body = groups.length ? groups.map(describeGroup).join(', OR ') : 'no one';
  return {
    groups,
    summary: `${LANE_PREFIX[lane]}: ${body}`,
    total: new Set(groups.flatMap((g) => g.memberIds)).size,
    emptyPolicies: policies
      .filter((p) => p.type === lane && p.identityRoles.length === 0)
      .map((p) => ({ policyId: p.id, policyName: p.name })),
  };
}

/** Distinct members over a lane's groups. */
const laneMembers = (lane: LaneLayout) => [...new Set(lane.groups.flatMap((g) => g.memberIds))];

// ─── verdict without a layout ─────────────────────────────────────────────────

/**
 * A service's verdict from the world's index — no groups, no labels: a lane's
 * members are exactly the identities its policies' identity sides select (a group
 * is one policy's @refs or its terms, and together they are its identityRoles), so
 * the counts are the layout's. Cached per world. Equal to
 * layoutServiceView(serviceId, world).serviceVerdict (a spec checks every service).
 */
export function verdictFor(serviceId: string, world: TrifectaWorld): ServiceVerdict {
  return indexFor(world).memo(`verdict:${serviceId}`, () => countVerdict(serviceId, world));
}

/** A member's status on a service, per track. */
export type StatusLookup = (identityId: string, track: 'dial' | 'bind') => TrifectaStatus;

/**
 * verdictFor's count, uncached — with `statusOf` given, members' statuses come from
 * it (the draft diff passes merged results: re-resolved where the draft can change
 * them, live's elsewhere); otherwise from the world's routers.
 */
export function countVerdict(serviceId: string, world: TrifectaWorld, statusOf?: StatusLookup): ServiceVerdict {
  const ix = indexFor(world);
  if (!ix.service(serviceId)) throw new Error(`verdictFor: unknown service '${serviceId}'`);
  // Per track: the service's policies with their selected identities and required checks.
  const lane = (type: Policy['type']) => {
    const policies = ix.policiesForService(serviceId).filter((p) => p.type === type);
    const grants = policies.map((p) => ({
      members: ix.identityIdsMatching(p.identityRoles, p.semantic),
      checks: ix.requiredChecks(p).map((c) => c.id),
    }));
    const ids = new Set<string>();
    for (const g of grants) for (const id of g.members) ids.add(id);
    return { ids: [...ids], grants };
  };
  const bind = lane('bind');
  const dial = lane('dial');

  // A member is authorized, so its status is the route's: resolve's legs 2 + 3.
  const serviceRouters = new Set(ix.serviceRouters(serviceId));
  const routeStatus = (id: string): TrifectaStatus => {
    const common = ix.identityRouters(id).filter((r) => serviceRouters.has(r));
    if (!common.length) return 'AUTHORIZED_NO_ROUTER';
    return common.some((r) => ix.isOnline(r)) ? 'AUTHORIZED_REACHABLE' : 'BLOCKED_ROUTERS_OFFLINE';
  };
  const status = (track: 'dial' | 'bind') => (statusOf ? (id: string) => statusOf(id, track) : routeStatus);
  // postureFor's "satisfied": some granting policy whose checks it all passes.
  const passes = (id: string, track: 'dial' | 'bind') => {
    const passed = ix.passedChecks(id);
    return (track === 'dial' ? dial : bind).grants.some((g) => g.members.has(id) && g.checks.every((c) => passed.has(c)));
  };
  return verdictOf(
    serviceId,
    world,
    { ids: bind.ids, status: status('bind') },
    { ids: dial.ids, status: status('dial') },
    hostingFor(serviceId, world),
    passes,
  );
}

// ─── layout ───────────────────────────────────────────────────────────────────

export function layoutServiceView(serviceId: string, world: TrifectaWorld): ServiceViewLayout {
  const ix = indexFor(world);
  const service = ix.service(serviceId);
  if (!service) throw new Error(`layoutServiceView: unknown service '${serviceId}'`);

  const forService = ix.policiesForService(serviceId);
  const pairs = enumerateForService(serviceId, world);
  const dialStatus = new Map(pairs.map((p) => [p.identityId, p.status]));
  const bindStatus = new Map(pairs.map((p) => [p.identityId, p.bindStatus]));
  const bindGroups = laneGroups('bind', forService.filter((p) => p.type === 'bind'), world, bindStatus, service);
  const dialGroups = laneGroups('dial', forService.filter((p) => p.type === 'dial'), world, dialStatus, service);

  // The routers SERPs grant the service: ER(service), edgeRouters order.
  const eligible = ix
    .serviceRouters(serviceId)
    .map((id) => ix.router(id)!)
    .map((r) => ({ id: r.id, name: r.name, isOnline: r.isOnline }));

  const tallest = Math.max(bindGroups.length, dialGroups.length, 1);
  const bind = laneLayout('bind', bindGroups, forService);
  const dial = laneLayout('dial', dialGroups, forService);

  return {
    service: { id: service.id, name: service.name, attributes: [...(service.attributes ?? [])], x: SERVICE_X, y: (tallest - 1) / 2 },
    bind,
    dial,
    serviceVerdict: verdictOf(
      serviceId,
      world,
      { ids: laneMembers(bind), status: (id) => bindStatus.get(id) },
      { ids: laneMembers(dial), status: (id) => dialStatus.get(id) },
      hostingFor(serviceId, world),
    ),
    routers: { eligible, onlineCount: eligible.filter((r) => r.isOnline).length },
    edges: [...bindGroups, ...dialGroups].map((g) => ({ from: g.id, to: service.id })),
  };
}
