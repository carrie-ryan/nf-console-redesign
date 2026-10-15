/**
 * ACCESS TESTS — rules the network must keep, evaluated against a world (live, or a
 * draft before commit). Pure and headless.
 *
 *   mustNotDial / mustNotHost — authorization only (dial / bind .authorized): a
 *       matching identity that is authorized fails the test even with no route and
 *       no posture pass. Routes and posture can change without a policy edit;
 *       authorization is what the policy says.
 *   mustConnect — the full verdict path: authorized, an online route, Dial posture
 *       satisfied, and the service has a reachable, active host. Every matching
 *       identity must connect; a test that matches no identity fails.
 *
 * `who` matches an identity by name, OR by having any of the attributes.
 *
 * Given live too (a draft is being evaluated), a mustConnect reason says what in the
 * draft caused it, when the draft did: "blocked by posture — fails require-mfa, added
 * to users-gitlab in this draft"; "not authorized to dial — users-gitlab deleted in
 * this draft". Reasons come as parts, so checks and policies can link to their editors.
 */

import { entityMatchesRoles } from '../authorization/authorization-resolver';
import { resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import { indexFor } from '../authorization/world-index';
import type { AccessTest, Identity } from '../../shared/services/mock-data.service';
import { postureFor } from './posture';
import { layoutServiceView } from './service-view.layout';

/** Where a reason's check or policy name leads: its editor. */
export type ReasonLink =
  | { kind: 'check'; id: string }
  /** focus 'expires': open the editor on its Expires control. */
  | { kind: 'policy'; id: string; focus?: 'expires' }
  | { kind: 'routerPolicy'; target: 'edgeRouterPolicy' | 'serviceEdgeRouterPolicy'; id: string };

/** A run of reason text; a linked part names something in the draft world. */
export interface ReasonPart {
  text: string;
  link?: ReasonLink;
}

export interface Offender {
  identityId: string;
  name: string;
  /** Why it breaks the test: "may host via …" / "not authorized to dial" / "blocked by posture — fails …" */
  reason: string;
  /** The same text, in parts (joined, they are `reason`). */
  parts: ReasonPart[];
}

export interface TestResult {
  test: AccessTest;
  /** "anyone with #kiosks must not host api-prod" */
  text: string;
  pass: boolean;
  /** The identities that break it, world.identities order. */
  offenders: Offender[];
  /** Set when the test fails without offenders (no such service, matches no one). */
  problem: string | null;
}

const VERB: Record<AccessTest['kind'], string> = {
  mustNotDial: 'must not dial',
  mustNotHost: 'must not host',
  mustConnect: 'must connect to',
};

/** "laptop-alice or anyone with #kiosks" */
export function describeWho(who: AccessTest['who']): string {
  const names = who.names ?? [];
  const attrs = who.attributes ?? [];
  const parts = [
    ...(names.length ? [names.join(', ')] : []),
    ...(attrs.length ? [`anyone with ${attrs.join(' or ')}`] : []),
  ];
  return parts.join(' or ') || 'no one';
}

/** "anyone with #kiosks must not host api-prod" */
export function describeTest(test: AccessTest, world: TrifectaWorld): string {
  const service = indexFor(world).service(test.serviceId)?.name ?? test.serviceId;
  return `${describeWho(test.who)} ${VERB[test.kind]} ${service}`;
}

export function whoMatches(who: AccessTest['who'], identity: Identity): boolean {
  return !!(who.names?.includes(identity.name) || who.attributes?.some((a) => identity.attributes?.includes(a)));
}

const ROUTE_REASON: Record<string, string> = {
  AUTHORIZED_NO_ROUTER: 'no shared router',
  BLOCKED_ROUTERS_OFFLINE: 'routers offline',
};

const IN_DRAFT = ' in this draft';

const offender = (i: Identity, parts: ReasonPart[]): Offender => ({
  identityId: i.id,
  name: i.name,
  reason: parts.map((p) => p.text).join(''),
  parts,
});

/** a; b; c — parts lists joined. */
function joinParts(lists: ReasonPart[][], sep = '; '): ReasonPart[] {
  return lists.flatMap((l, n) => (n ? [{ text: sep }, ...l] : l));
}

/** Why one identity can't connect — the first failing step of the verdict path; null: it can. */
interface ConnectFailure {
  kind: 'dial' | 'route' | 'posture' | 'host';
  text: string;
}

function connectFailure(identityId: string, serviceId: string, world: TrifectaWorld, hostReason: string | null): ConnectFailure | null {
  const pair = resolve(identityId, serviceId, world);
  if (!pair.dial.authorized) return { kind: 'dial', text: 'not authorized to dial' };
  if (ROUTE_REASON[pair.status]) return { kind: 'route', text: ROUTE_REASON[pair.status] };
  if (!postureFor(identityId, serviceId, 'dial', world).satisfied) return { kind: 'posture', text: 'blocked by posture' };
  return hostReason ? { kind: 'host', text: hostReason } : null;
}

/** The host-side verdict reason for a service (dialer posture is per identity, not here). */
function hostReasonOf(serviceId: string, world: TrifectaWorld): string | null {
  const reason = layoutServiceView(serviceId, world).serviceVerdict.reason;
  return reason === 'no dialer passes posture' ? null : reason;
}

/**
 * What the draft did to these live entities, one entry each: "users-gitlab deleted in
 * this draft" (plain: it's gone) or "<users-gitlab> changed in this draft" (a link).
 * Unchanged ones are left out.
 */
function changedInDraft(
  ids: readonly string[],
  kind: 'policy' | 'edgeRouterPolicy' | 'serviceEdgeRouterPolicy',
  live: TrifectaWorld,
  draft: TrifectaWorld,
): ReasonPart[][] {
  const collection = (w: TrifectaWorld): readonly { id: string; name: string }[] =>
    kind === 'policy' ? w.policies : kind === 'edgeRouterPolicy' ? w.edgeRouterPolicies : w.serviceEdgeRouterPolicies;
  const link = (id: string): ReasonLink => (kind === 'policy' ? { kind: 'policy', id } : { kind: 'routerPolicy', target: kind, id });
  const out: ReasonPart[][] = [];
  for (const id of ids) {
    const before = collection(live).find((x) => x.id === id);
    const after = collection(draft).find((x) => x.id === id);
    if (!before) continue;
    if (!after) out.push([{ text: `${before.name} deleted${IN_DRAFT}` }]);
    else if (JSON.stringify(before) !== JSON.stringify(after)) out.push([{ text: after.name, link: link(id) }, { text: ` changed${IN_DRAFT}` }]);
  }
  return out;
}

/**
 * "fails <require-mfa>, added to <users-gitlab> in this draft; fails <corp-os-check>" —
 * each failing Dial check, with the draft edit that made it required, if any. With no
 * check-level cause and posture satisfied in live, the live routes the draft took away.
 */
function postureParts(i: Identity, serviceId: string, world: TrifectaWorld, live: TrifectaWorld | null): ReasonPart[] {
  const posture = postureFor(i.id, serviceId, 'dial', world);
  const checkName = (id: string) => (world.postureChecks ?? []).find((c) => c.id === id)?.name ?? id;
  const policyName = (id: string) => world.policies.find((p) => p.id === id)?.name ?? id;
  const failing = [...new Set(posture.grantingPolicies.flatMap((g) => g.failingCheckIds))];

  let caused = false;
  const perCheck = failing.map((checkId): ReasonPart[] => {
    const parts: ReasonPart[] = [{ text: checkName(checkId), link: { kind: 'check', id: checkId } }];
    if (!live) return parts;
    const causes: ReasonPart[][] = [];
    for (const g of posture.grantingPolicies.filter((x) => x.failingCheckIds.includes(checkId))) {
      const before = live.policies.find((p) => p.id === g.policyId);
      const name = { text: policyName(g.policyId), link: { kind: 'policy', id: g.policyId } as ReasonLink };
      if (!before) causes.push([{ text: 'required by new policy ' }, name]);
      else if (!postureFor(i.id, serviceId, 'dial', live).grantingPolicies.find((x) => x.policyId === g.policyId)?.requiredCheckIds.includes(checkId))
        causes.push([{ text: 'added to ' }, name, { text: IN_DRAFT }]);
    }
    const liveCheck = (live.postureChecks ?? []).find((c) => c.id === checkId);
    const draftCheck = (world.postureChecks ?? []).find((c) => c.id === checkId);
    if (!causes.length && liveCheck && JSON.stringify(liveCheck) !== JSON.stringify(draftCheck)) causes.push([{ text: `changed${IN_DRAFT}` }]);
    if (causes.length) caused = true;
    return causes.length ? [...parts, { text: ', ' }, ...joinParts(causes, ', ')] : parts;
  });

  const parts: ReasonPart[] = [{ text: 'blocked by posture' }];
  if (perCheck.length) parts.push({ text: ' — fails ' }, ...joinParts(perCheck));
  if (!caused && live && hasPair(i.id, serviceId, live) && postureFor(i.id, serviceId, 'dial', live).satisfied) {
    const gone = changedInDraft(resolve(i.id, serviceId, live).dial.viaPolicies, 'policy', live, world);
    if (gone.length) parts.push({ text: perCheck.length ? '; ' : ' — ' }, ...joinParts(gone));
  }
  return parts;
}

const hasPair = (identityId: string, serviceId: string, w: TrifectaWorld) =>
  !!indexFor(w).identity(identityId) && !!indexFor(w).service(serviceId);

/** The draft edits behind a dial, route or host failure that live didn't have. */
function causeOf(
  failure: ConnectFailure,
  i: Identity,
  serviceId: string,
  world: TrifectaWorld,
  live: TrifectaWorld,
  liveFailure: ConnectFailure | null,
): ReasonPart[][] {
  if (!hasPair(i.id, serviceId, live) || liveFailure?.kind === failure.kind) return [];
  const before = resolve(i.id, serviceId, live);
  switch (failure.kind) {
    case 'dial':
      return changedInDraft(before.dial.viaPolicies, 'policy', live, world);
    case 'route': {
      const liveService = live.services.find((s) => s.id === serviceId)!;
      const erps = live.edgeRouterPolicies.filter((p) => entityMatchesRoles(p.identityRoles, p.semantic, i.attributes ?? [], i.name, i.id));
      const serps = live.serviceEdgeRouterPolicies.filter((p) =>
        entityMatchesRoles(p.serviceRoles, p.semantic, liveService.attributes ?? [], liveService.name, liveService.id),
      );
      return [
        ...changedInDraft(erps.map((p) => p.id), 'edgeRouterPolicy', live, world),
        ...changedInDraft(serps.map((p) => p.id), 'serviceEdgeRouterPolicy', live, world),
      ];
    }
    case 'host': {
      const liveService = live.services.find((s) => s.id === serviceId)!;
      const binds = live.policies.filter(
        (p) => p.type === 'bind' && entityMatchesRoles(p.serviceRoles, p.semantic, liveService.attributes ?? [], liveService.name, liveService.id),
      );
      return changedInDraft(binds.map((p) => p.id), 'policy', live, world);
    }
    default:
      return [];
  }
}

/** Evaluate against `world`; with `live`, mustConnect reasons name the draft edits behind them. */
export function evaluateTest(test: AccessTest, world: TrifectaWorld, live: TrifectaWorld | null = null): TestResult {
  const text = describeTest(test, world);
  const fail = (problem: string): TestResult => ({ test, text, pass: false, offenders: [], problem });
  const ix = indexFor(world);
  if (!ix.service(test.serviceId)) return fail(`No service ${test.serviceId}`);

  const who = world.identities.filter((i) => whoMatches(test.who, i));
  const offenders: Offender[] = [];

  if (test.kind === 'mustNotDial' || test.kind === 'mustNotHost') {
    const track = test.kind === 'mustNotDial' ? 'dial' : 'bind';
    for (const i of who) {
      const pair = resolve(i.id, test.serviceId, world);
      if (!pair[track].authorized) continue;
      const via = pair[track].viaPolicies.map((id): ReasonPart[] => [
        { text: ix.policy(id)?.name ?? id, link: { kind: 'policy', id } },
      ]);
      offenders.push(offender(i, [{ text: `may ${track === 'dial' ? 'dial' : 'host'} via ` }, ...joinParts(via, ', ')]));
    }
    return { test, text, pass: offenders.length === 0, offenders, problem: null };
  }

  if (!who.length) return fail('Matches no identity');
  const hostReason = hostReasonOf(test.serviceId, world);
  const liveHostReason = live && indexFor(live).service(test.serviceId) ? hostReasonOf(test.serviceId, live) : null;
  for (const i of who) {
    const failure = connectFailure(i.id, test.serviceId, world, hostReason);
    if (!failure) continue;
    if (failure.kind === 'posture') {
      offenders.push(offender(i, postureParts(i, test.serviceId, world, live)));
      continue;
    }
    const liveFailure = live && hasPair(i.id, test.serviceId, live) ? connectFailure(i.id, test.serviceId, live, liveHostReason) : null;
    const causes = live ? causeOf(failure, i, test.serviceId, world, live, liveFailure) : [];
    offenders.push(offender(i, [{ text: failure.text }, ...(causes.length ? [{ text: ' — ' }, ...joinParts(causes)] : [])]));
  }
  return { test, text, pass: offenders.length === 0, offenders, problem: null };
}

/** Every test in the world, in its order — see evaluateTest for `live`. */
export function evaluateTests(world: TrifectaWorld, live: TrifectaWorld | null = null): TestResult[] {
  return (world.accessTests ?? []).map((t) => evaluateTest(t, world, live));
}
