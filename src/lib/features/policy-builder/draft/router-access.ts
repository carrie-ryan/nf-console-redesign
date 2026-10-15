/**
 * ROUTER ACCESS — the router policies behind one subject, for the Routing / Routers
 * panel. Pure; reads the (draft) world it's given.
 *
 * A subject is either side of the router trifecta:
 *   service  — a service: the SERVICE edge router policies whose service side matches it.
 *   group    — a group on the canvas: the EDGE router policies whose identity side
 *              matches any of its members (the routers they get).
 *   identity — one identity (the identity lens): likewise, for it alone.
 *
 * Each covering policy is listed with its routers and how it matches the subject.
 * Two ways to add more, both pending policies the router-policy editor reviews before
 * they reach the draft (as a router-policy create or update):
 *   extend — an existing policy not yet covering the whole subject, with the subject's
 *            roles added to its entity side;
 *   create — a new policy whose entity side is the subject's roles, routers to pick.
 *
 * What an extension adds (never narrowing what the policy already matches):
 *   SERP  @<service id> — @refs are unioned whatever the semantic.
 *   ERP   @refs (a named group, an identity): the missing ones, whatever the semantic.
 *         A rule group's # terms: only to an AnyOf ERP, and only when the rule is one
 *         term or itself any-of — an all-of ERP would AND them with its own terms, and
 *         an any-of ERP would OR an all-of rule's terms apart. Other ERPs aren't offered.
 * System policies (a router identity's own ERP, created by Ziti) are listed read-only
 * and never extended.
 */

import type { EdgeRouterPolicy, Policy, ServiceEdgeRouterPolicy } from '../../../shared/services/mock-data.service';
import { entityMatchesRoles } from '../../authorization/authorization-resolver';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { layoutServiceView, type Group } from '../service-view.layout';
import type { RouterPolicy, RouterTarget } from '../router-policy-editor.component';
import { freshId } from './router-gap';

export type RoutingSubject =
  | { kind: 'service'; serviceId: string }
  | { kind: 'group'; serviceId: string; groupId: string }
  | { kind: 'identity'; identityId: string };

export interface RoutingPolicyRow {
  id: string;
  name: string;
  /** Created by Ziti: read-only. */
  system: boolean;
  /** The routers it makes eligible / grants, in world order. */
  routers: { id: string; name: string; isOnline: boolean }[];
  /** How it matches the subject: "by name (@svc-004)", "by #apis", "all services (#all)". */
  how: string;
  /** Groups: "all 16 members" / "3 of 16 members". */
  covers: string | null;
}

/** An existing policy the subject can be added to, and the policy as that would leave it. */
export interface Extension {
  id: string;
  name: string;
  /** The roles added to its entity side. */
  added: string[];
  pending: RouterPolicy;
  /** "3 routers" — the picker row's note. */
  note: string;
  /** Its router rule as shown: "#public", or a named router's name for "@er-002". */
  routerRule: string[];
  /** The routers it matches, by name (searchable). */
  routerNames: string[];
}

export interface RouterAccess {
  target: RouterTarget;
  title: string;
  subtitle: string;
  /** "service edge router policy" / "edge router policy". */
  noun: string;
  /** "service edge router policies" / "edge router policies". */
  nounMany: string;
  policies: RoutingPolicyRow[];
  /** "No service edge router policy covers reports-svc yet." */
  empty: string;
  extensions: Extension[];
  /** Why some policies aren't offered as extensions (null when every one is). */
  extendNote: string | null;
  /** The new policy "New … policy" opens the editor on. */
  create: RouterPolicy;
  /** The console's list: /policies on this tab (`?tab=`). */
  listTab: 'edge-router' | 'service-edge-router';
  listLabel: string;
}

type Matchable = { id: string; name: string; attributes?: readonly string[] };
const matches = (roles: readonly string[], semantic: Policy['semantic'], e: Matchable) =>
  entityMatchesRoles(roles, semantic, e.attributes ?? [], e.name, e.id);

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function routersOf(p: RouterPolicy, world: TrifectaWorld): RoutingPolicyRow['routers'] {
  return world.edgeRouters
    .filter((r) => matches(p.edgeRouterRoles, p.semantic, r))
    .map((r) => ({ id: r.id, name: r.name, isOnline: r.isOnline }));
}

/** How a policy's entity side matches these entities: by name, by its terms, or #all. */
function how(roles: readonly string[], semantic: Policy['semantic'], entities: readonly Matchable[], everyone: string): string {
  const named = roles.filter((r) => r.startsWith('@') && entities.some((e) => r === `@${e.id}` || r === `@${e.name}`));
  const terms = roles.filter((r) => r.startsWith('#') && r !== '#all');
  const byTerms = terms.filter((t) => entities.some((e) => (e.attributes ?? []).includes(t)));
  const parts: string[] = [];
  if (named.length) parts.push(`by name (${named.join(', ')})`);
  if (byTerms.length) {
    parts.push(semantic === 'AllOf' && terms.length > 1 ? `by all of ${terms.join(', ')}` : `by ${byTerms.join(', ')}`);
  }
  if (!parts.length && roles.includes('#all')) parts.push(`${everyone} (#all)`);
  return parts.join(' · ');
}

/** A picker row's router facts: the count, the rule (named routers by name), the names. */
function routerFacts(p: RouterPolicy, world: TrifectaWorld): Pick<Extension, 'note' | 'routerRule' | 'routerNames'> {
  const routers = routersOf(p, world);
  const named = (role: string) => world.edgeRouters.find((r) => role === `@${r.id}` || role === `@${r.name}`)?.name ?? role;
  return {
    note: plural(routers.length, 'router', 'routers'),
    routerRule: p.edgeRouterRoles.map((r) => (r.startsWith('@') ? named(r) : r)),
    routerNames: routers.map((r) => r.name),
  };
}

const slug = (roles: readonly string[]) => roles.map((r) => r.replace(/^[#@]/, '')).join('-');

// ─── a service ───────────────────────────────────────────────────────────────

function serviceAccess(world: TrifectaWorld, serviceId: string): RouterAccess | null {
  const service = world.services.find((s) => s.id === serviceId);
  if (!service) return null;
  const ref = `@${service.id}`;
  const covering = world.serviceEdgeRouterPolicies.filter((p) => matches(p.serviceRoles, p.semantic, service));
  const servicesOf = (p: ServiceEdgeRouterPolicy) => world.services.filter((s) => matches(p.serviceRoles, p.semantic, s)).length;
  const refsOnly = (p: ServiceEdgeRouterPolicy) => p.serviceRoles.every((r) => r.startsWith('@'));
  // The rest, as router-gap prefers them: @refs-only (a list, which one more @ref fits), then fewest services.
  const extensions = world.serviceEdgeRouterPolicies
    .filter((p) => !covering.includes(p))
    .map((p, order) => ({ p, order }))
    .sort((a, b) => Number(refsOnly(b.p)) - Number(refsOnly(a.p)) || servicesOf(a.p) - servicesOf(b.p) || a.order - b.order)
    .map(({ p }) => ({
      id: p.id,
      name: p.name,
      added: [ref],
      pending: { ...p, serviceRoles: [...p.serviceRoles, ref] },
      ...routerFacts(p, world),
    }));
  const create: ServiceEdgeRouterPolicy = {
    id: freshId('serp-draft-', world.serviceEdgeRouterPolicies),
    name: `${service.name}-routing`,
    semantic: 'AllOf',
    serviceRoles: [ref],
    edgeRouterRoles: [],
  };
  return {
    target: 'serviceEdgeRouterPolicy',
    title: 'Routing',
    subtitle: `${service.name} · ${covering.length ? plural(covering.length, 'service edge router policy', 'service edge router policies') : 'no routing yet'}`,
    noun: 'service edge router policy',
    nounMany: 'service edge router policies',
    policies: covering.map((p) => ({
      id: p.id,
      name: p.name,
      system: false,
      routers: routersOf(p, world),
      how: how(p.serviceRoles, p.semantic, [service], 'all services'),
      covers: null,
    })),
    empty: `No service edge router policy covers ${service.name} yet, so no router will carry its traffic.`,
    extensions,
    extendNote: null,
    create,
    listTab: 'service-edge-router',
    listLabel: 'All service edge router policies',
  };
}

// ─── identities: a group, or one identity ────────────────────────────────────

interface IdentitySubject {
  /** "users-gitlab" / "laptop-alice". */
  label: string;
  /** "16 members on git-repo" / "laptop-alice" — the subtitle's tail. */
  detail: string;
  identityIds: string[];
  /** Its identity roles: a rule's # terms, or @names. */
  roles: string[];
  semantic: Policy['semantic'];
  /** A new ERP's name: "users-routers". */
  newName: string;
}

function groupSubject(world: TrifectaWorld, serviceId: string, groupId: string): IdentitySubject | null {
  const view = layoutServiceView(serviceId, world);
  const g: Group | undefined = [...view.bind.groups, ...view.dial.groups].find((x) => x.id === groupId);
  if (!g) return null;
  const rule = g.kind === 'rule';
  const roles = rule ? [...g.rule!.terms] : g.named!.map((n) => `@${n.name}`);
  return {
    label: g.policyName,
    detail: `${plural(g.memberCount, 'member', 'members')} on ${view.service.name}`,
    identityIds: g.memberIds,
    roles,
    semantic: rule ? g.rule!.semantic : 'AnyOf',
    newName: `${rule ? slug(roles) : g.policyName}-routers`,
  };
}

function identitySubject(world: TrifectaWorld, identityId: string): IdentitySubject | null {
  const i = world.identities.find((x) => x.id === identityId);
  if (!i) return null;
  return { label: i.name, detail: i.name, identityIds: [i.id], roles: [`@${i.name}`], semantic: 'AnyOf', newName: `${i.name}-routers` };
}

/** The roles an extension adds to `p`, or null when adding them would change what it means. */
function erpAddition(p: EdgeRouterPolicy, s: IdentitySubject): string[] | null {
  const missing = s.roles.filter((r) => !p.identityRoles.includes(r));
  if (!missing.length) return null;
  if (s.roles.every((r) => r.startsWith('@'))) return missing;
  const orSafe = s.roles.length <= 1 || s.semantic === 'AnyOf';
  return p.semantic === 'AnyOf' && orSafe ? missing : null;
}

function identitiesAccess(world: TrifectaWorld, s: IdentitySubject, subjectKind: 'group' | 'identity'): RouterAccess {
  const members = world.identities.filter((i) => s.identityIds.includes(i.id));
  const total = members.length;
  const covered = (p: EdgeRouterPolicy) => members.filter((i) => matches(p.identityRoles, p.semantic, i)).length;
  const covering = world.edgeRouterPolicies.filter((p) => covered(p) > 0);

  const candidates = world.edgeRouterPolicies.filter((p) => !p.isSystem && covered(p) < total);
  const extensions: Extension[] = [];
  let refused = 0;
  for (const p of candidates) {
    const added = erpAddition(p, s);
    if (!added) {
      refused++;
      continue;
    }
    extensions.push({
      id: p.id,
      name: p.name,
      added,
      pending: { ...p, identityRoles: [...p.identityRoles, ...added] },
      ...routerFacts(p, world),
    });
  }

  const create: EdgeRouterPolicy = {
    id: freshId('rp-draft-', world.edgeRouterPolicies),
    name: s.newName,
    createdAt: new Date().toISOString(),
    status: 'active',
    semantic: s.semantic,
    identityRoles: [...s.roles],
    edgeRouterRoles: [],
  };
  const who = subjectKind === 'group' ? 'these identities' : s.label;
  return {
    target: 'edgeRouterPolicy',
    title: 'Routers',
    subtitle: subjectKind === 'group' ? `${s.label} · ${s.detail}` : s.detail,
    noun: 'edge router policy',
    nounMany: 'edge router policies',
    policies: covering.map((p) => {
      const n = covered(p);
      return {
        id: p.id,
        name: p.name,
        system: !!p.isSystem,
        routers: routersOf(p, world),
        how: how(p.identityRoles, p.semantic, members.filter((i) => matches(p.identityRoles, p.semantic, i)), 'all identities'),
        covers: subjectKind !== 'group' ? null : n < total ? `${n} of ${plural(total, 'member', 'members')}` : total === 1 ? 'its one member' : `all ${plural(total, 'member', 'members')}`,
      };
    }),
    empty: `No edge router policy gives ${who} a router yet, so ${subjectKind === 'group' ? 'they' : 'it'} can't reach any service.`,
    extensions,
    extendNote: refused
      ? `${plural(refused, 'all-of policy isn’t', 'all-of policies aren’t')} offered: adding ${s.roles.join(', ')} there would narrow ${refused === 1 ? 'it' : 'them'}. Create a new policy instead.`
      : null,
    create,
    listTab: 'edge-router',
    listLabel: 'All edge router policies',
  };
}

export function routerAccess(world: TrifectaWorld, subject: RoutingSubject): RouterAccess | null {
  if (subject.kind === 'service') return serviceAccess(world, subject.serviceId);
  const s = subject.kind === 'group' ? groupSubject(world, subject.serviceId, subject.groupId) : identitySubject(world, subject.identityId);
  return s ? identitiesAccess(world, s, subject.kind) : null;
}
