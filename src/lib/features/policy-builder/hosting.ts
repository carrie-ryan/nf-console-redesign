/**
 * Hosting for one service — who MAY host it (Bind policies) versus who IS hosting it
 * (terminators). Pure and headless, like the trifecta resolver it builds on.
 *
 *   authorized  — identities whose Bind is authorized (bind.authorized)
 *   serving     — authorized identities with at least one VALID terminator on the
 *                 service (see validateTerminators) on an ONLINE router
 *   active      — serving hosts whose Bind posture is satisfied (posture.ts), at the
 *                 best precedence among those; the strategy only
 *                 picks among these ('failed' hosts get traffic only when no
 *                 'required' or 'default' terminator is left)
 *   blocked     — serving hosts that fail Bind posture: not active, not standby
 *   idle        — authorized, not serving (no terminator, or only on offline routers)
 *
 * validateTerminators checks the other direction: a terminator only exists for a
 * Bind-authorized identity, on a router both it and the service can use. A seed or
 * draft world that breaks that holds an impossible terminator, and is flagged.
 */

import { resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import type { Terminator, TerminatorStrategy } from '../../shared/services/mock-data.service';
import { postureFor } from './posture';
import { indexFor, type WorldIndex } from '../authorization/world-index';
import type { ReasonPart } from './access-tests';

export type Precedence = Terminator['precedence'];

/** Best first. */
const PRECEDENCE_RANK: Record<Precedence, number> = { required: 0, default: 1, failed: 2 };

export const DEFAULT_TERMINATOR_STRATEGY: TerminatorStrategy = 'smartrouting';

export interface ServingHost {
  identityId: string;
  /** In world.terminators order. */
  terminatorIds: string[];
  /** The best precedence among its terminators. */
  precedence: Precedence;
}

export interface Hosting {
  strategy: TerminatorStrategy;
  /** world.identities order. */
  authorizedHostIds: string[];
  /** Authorized hosts with a terminator on an online router, world.identities order. */
  servingHosts: ServingHost[];
  activeHostIds: string[];
  /** Serving hosts that fail their Bind posture — neither active nor standby. */
  blockedHostIds: string[];
  idleAuthorizedHostIds: string[];
}

const bestOf = (ps: readonly Precedence[]): Precedence =>
  ps.reduce((best, p) => (PRECEDENCE_RANK[p] < PRECEDENCE_RANK[best] ? p : best));

export function hostingFor(serviceId: string, world: TrifectaWorld): Hosting {
  const ix = indexFor(world);
  const service = ix.service(serviceId);
  if (!service) throw new Error(`hostingFor: unknown service '${serviceId}'`);

  // Bind-authorized = selected by a Bind policy of the service (resolve's leg 1),
  // read from the index; world.identities order.
  const selected = new Set<string>();
  for (const p of ix.policiesForService(serviceId)) {
    if (p.type === 'bind') for (const id of ix.identityIdsMatching(p.identityRoles, p.semantic)) selected.add(id);
  }
  const authorizedHostIds = world.identities.filter((i) => selected.has(i.id)).map((i) => i.id);
  const authorized = new Set(authorizedHostIds);

  // Invalid terminators (orphaned, or on a router the pair doesn't share — see
  // validateTerminators) and ones on offline routers carry no traffic, so they
  // make no one a serving host. terminatorIds lists only the ones that count.
  const byHost = new Map<string, Terminator[]>();
  for (const t of world.terminators ?? []) {
    if (t.serviceId !== serviceId || !authorized.has(t.identityId) || !ix.isOnline(t.routerId)) continue;
    if (!resolve(t.identityId, serviceId, world).routers.common.includes(t.routerId)) continue;
    byHost.set(t.identityId, [...(byHost.get(t.identityId) ?? []), t]);
  }

  const servingHosts: ServingHost[] = authorizedHostIds
    .filter((id) => byHost.has(id))
    .map((identityId) => {
      const ts = byHost.get(identityId)!;
      return { identityId, terminatorIds: ts.map((t) => t.id), precedence: bestOf(ts.map((t) => t.precedence)) };
    });

  // A host failing its Bind posture can't take traffic, whatever its terminators.
  const eligible = servingHosts.filter((h) => postureFor(h.identityId, serviceId, 'bind', world).satisfied);
  const top = eligible.length ? bestOf(eligible.map((h) => h.precedence)) : null;

  return {
    strategy: service.terminatorStrategy ?? DEFAULT_TERMINATOR_STRATEGY,
    authorizedHostIds,
    servingHosts,
    activeHostIds: eligible.filter((h) => h.precedence === top).map((h) => h.identityId),
    blockedHostIds: servingHosts.filter((h) => !eligible.includes(h)).map((h) => h.identityId),
    idleAuthorizedHostIds: authorizedHostIds.filter((id) => !byHost.has(id)),
  };
}

/**
 * The Bind policies behind the active hosts — each active host's bind.viaPolicies,
 * unioned, in world.policies order. More than one means traffic is shared across
 * hosts that different policies authorize.
 */
export function activeHostPolicyIds(serviceId: string, world: TrifectaWorld, hosting = hostingFor(serviceId, world)): string[] {
  const via = new Set(hosting.activeHostIds.flatMap((id) => resolve(id, serviceId, world).bind.viaPolicies));
  return world.policies.filter((p) => via.has(p.id)).map((p) => p.id);
}

// ─── draft effects ────────────────────────────────────────────────────────────

export interface HostingChange {
  serviceId: string;
  serviceName: string;
  /** Hosts serving in live that the draft stops (their terminators no longer count). */
  stoppedHostNames: string[];
  /** Active hosts left in the draft; empty when none would serve. */
  remainingHostNames: string[];
  /** "server-build-01 is serving git-repo now; this change stops it. Traffic moves to server-stage-01." */
  text: string;
}

const joinNames = (names: readonly string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** Every service, in live order, where the draft stops a host that is serving now. */
/** `serviceIds` limits the services looked at (the draft checks pass the diff's scope:
 *  hosting can only change where the diff can); omitted, every service. */
export function hostingChanges(live: TrifectaWorld, draft: TrifectaWorld, serviceIds?: readonly string[]): HostingChange[] {
  const nameOf = (id: string) => indexFor(live).identity(id)?.name ?? id;
  const only = serviceIds ? new Set(serviceIds) : null;
  const out: HostingChange[] = [];
  for (const service of live.services) {
    if (only && !only.has(service.id)) continue;
    if (!indexFor(draft).service(service.id)) continue;
    const before = hostingFor(service.id, live);
    if (!before.servingHosts.length) continue;
    const after = hostingFor(service.id, draft);
    const still = new Set(after.servingHosts.map((h) => h.identityId));
    const stopped = before.servingHosts.filter((h) => !still.has(h.identityId)).map((h) => nameOf(h.identityId));
    if (!stopped.length) continue;
    const remaining = after.activeHostIds.map(nameOf);
    const one = stopped.length === 1;
    const text =
      `${joinNames(stopped)} ${one ? 'is' : 'are'} serving ${service.name} now; this change stops ${one ? 'it' : 'them'}. ` +
      (remaining.length ? `Traffic moves to ${joinNames(remaining)}.` : `No host would be left serving ${service.name}.`);
    out.push({ serviceId: service.id, serviceName: service.name, stoppedHostNames: stopped, remainingHostNames: remaining, text });
  }
  return out;
}

// ─── validation ───────────────────────────────────────────────────────────────

export type TerminatorProblem =
  | 'unknownService'
  | 'unknownIdentity'
  | 'unknownRouter'
  /** The identity isn't (or is no longer) Bind-authorized for the service. */
  | 'orphaned'
  /** The router isn't one both the identity (ERPs) and the service (SERPs) can use. */
  | 'routerNotShared';

export interface TerminatorIssue {
  terminatorId: string;
  problem: TerminatorProblem;
}

/**
 * Every terminator in the world that couldn't exist: unknown references, a host
 * without Bind authorization, or a router outside the host/service common set.
 * One issue per terminator — the first problem found, in the order above.
 */
export function validateTerminators(world: TrifectaWorld): TerminatorIssue[] {
  const ix = indexFor(world);
  const issues: TerminatorIssue[] = [];
  for (const t of world.terminators ?? []) {
    const problem = terminatorProblem(t, world, ix);
    if (problem) issues.push({ terminatorId: t.id, problem });
  }
  return issues;
}

function terminatorProblem(t: Terminator, world: TrifectaWorld, ix: WorldIndex): TerminatorProblem | null {
  if (!ix.service(t.serviceId)) return 'unknownService';
  if (!ix.identity(t.identityId)) return 'unknownIdentity';
  if (!ix.router(t.routerId)) return 'unknownRouter';
  const pair = resolve(t.identityId, t.serviceId, world);
  if (!pair.bind.authorized) return 'orphaned';
  if (!pair.routers.common.includes(t.routerId)) return 'routerNotShared';
  return null;
}

// ─── broad host rules ─────────────────────────────────────────────────────────

/** More authorized hosts than this — reached, or added at once — is warned about. */
export const BROAD_HOSTS = 3;

export interface BroadHostWarning {
  serviceId: string;
  serviceName: string;
  /** Bind-authorized identities, live and draft. */
  before: number;
  after: number;
  /** The draft Bind policies that add the new hosts (changed or new ones first). */
  policies: { id: string; name: string }[];
  /** "This makes 31 identities hosts of gitlab-internal; traffic is shared … Granted by <servers-gitlab>." */
  parts: ReasonPart[];
}

/** Bind-authorized identity ids of a service — the authorizedHostIds of hostingFor,
 *  without the terminator and posture work. */
function authorizedHosts(serviceId: string, world: TrifectaWorld): ReadonlySet<string> {
  const ix = indexFor(world);
  const out = new Set<string>();
  if (!ix.service(serviceId)) return out;
  for (const p of ix.policiesForService(serviceId)) {
    if (p.type === 'bind') for (const id of ix.identityIdsMatching(p.identityRoles, p.semantic)) out.add(id);
  }
  return out;
}

const sameRule = (a: TrifectaWorld['policies'][number], b: TrifectaWorld['policies'][number] | undefined) =>
  !!b && a.type === b.type && a.semantic === b.semantic &&
  a.identityRoles.join('\n') === b.identityRoles.join('\n') && a.serviceRoles.join('\n') === b.serviceRoles.join('\n');

/**
 * Services whose authorized host count the draft grows past BROAD_HOSTS, or by more
 * than BROAD_HOSTS: every host that serves a service shares its traffic, so a broad
 * Bind rule is worth a second look. A warning, never a block. `serviceIds` limits the
 * services looked at (the draft's reach); omitted, every service. Draft order.
 */
export function broadHostWarnings(live: TrifectaWorld, draft: TrifectaWorld, serviceIds?: readonly string[]): BroadHostWarning[] {
  if (live === draft) return [];
  const only = serviceIds ? new Set(serviceIds) : null;
  const liveIx = indexFor(live);
  const draftIx = indexFor(draft);
  const out: BroadHostWarning[] = [];
  for (const service of draft.services) {
    if (only && !only.has(service.id)) continue;
    const after = authorizedHosts(service.id, draft);
    if (!after.size) continue;
    const beforeIds = authorizedHosts(service.id, live);
    const before = beforeIds.size;
    if (!(after.size > before && (before <= BROAD_HOSTS ? after.size > BROAD_HOSTS : after.size - before > BROAD_HOSTS))) continue;
    // The Bind policies granting the new hosts — the ones this draft made or changed, if any.
    const added = [...after].filter((id) => !beforeIds.has(id));
    const granting = draftIx
      .policiesForService(service.id)
      .filter((p) => p.type === 'bind' && added.some((id) => draftIx.identityIdsMatching(p.identityRoles, p.semantic).has(id)));
    const changed = granting.filter((p) => !sameRule(p, liveIx.policy(p.id)));
    const policies = (changed.length ? changed : granting).map((p) => ({ id: p.id, name: p.name }));
    const n = after.size;
    const parts: ReasonPart[] = [
      { text: `This makes ${n.toLocaleString('en-US')} ${n === 1 ? 'identity a host' : 'identities hosts'} of ${service.name}; traffic is shared across every host that serves it.` },
    ];
    if (policies.length) {
      parts.push({ text: ' Granted by ' });
      policies.forEach((p, i) => {
        if (i) parts.push({ text: i === policies.length - 1 ? ' and ' : ', ' });
        parts.push({ text: p.name, link: { kind: 'policy', id: p.id } });
      });
      parts.push({ text: '.' });
    }
    out.push({ serviceId: service.id, serviceName: service.name, before, after: n, policies, parts });
  }
  return out;
}
