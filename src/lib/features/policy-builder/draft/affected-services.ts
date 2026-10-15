/**
 * AFFECTED SERVICES — the services a draft's edits can possibly change, so the diff
 * resolves pairs and lays out only those. Always the union over BOTH worlds (the
 * entity as it was, and as the draft leaves it):
 *
 *   service policy  — services its serviceRoles select, in either world;
 *   SERP            — services its serviceRoles select, in either world;
 *   ERP             — services the identities it selects (in either world) are Dial-
 *                     or Bind-authorized for, in either world (their routers change,
 *                     and only an authorized pair's status reads routers);
 *   posture check   — services of the policies requiring it, in either world (a
 *                     rename can change '@name' matches, so both versions count);
 *   service         — that service (its terminator strategy);
 *   identity attributes — per tagged identity: the services of every service policy
 *                     whose match for it flips between the worlds (either version);
 *                     and, if an ERP's match for it flips (its routers change), every
 *                     service it is authorized for in either world;
 *   identity hosting defaults, access tests — none (config lines only).
 *
 * Observed state (terminators, router status, posture results) is never drafted, so
 * it never widens the scope. A guard spec checks scoped == full diff on random drafts.
 *
 * affectedPairs narrows further: per affected service, the identities whose
 * resolution can change (every other pair keeps its live result):
 *   service policy — the identities its identityRoles select, in either world;
 *   ERP            — the identities it selects, in either world;
 *   SERP, posture-check definition, service strategy — 'all' on its services;
 *   identity hosting defaults — that identity, on the services it may dial or host;
 *   identity attributes — that identity, on the services above.
 *
 * Bulk tagging touches each listed identity as 'identityAttributes'; touchedBetween
 * tells an attribute change ('identityAttributes') from a hosting one ('identity').
 */

import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { indexFor } from '../../authorization/world-index';
import type { Identity, Policy } from '../../../shared/services/mock-data.service';
import { entityMatchesRoles } from '../../authorization/authorization-resolver';
import { opEntities, type DraftOp, type DraftTarget } from './policy-draft';

export interface Touched {
  /** 'identityAttributes': an identity whose attributes changed. */
  target: DraftTarget | 'identityAttributes';
  id: string;
}

/** What `ops` touch, by these rules' targets: tagged identities as 'identityAttributes'. */
function touchedBy(ops: readonly DraftOp[]): Touched[] {
  return ops.flatMap((op): Touched[] =>
    op.kind === 'tag' ? op.identityIds.map((id) => ({ target: 'identityAttributes', id })) : opEntities(op),
  );
}

/** Services a service policy authorizes any of `who` for, in either world. */
function authorizedServices(who: ReadonlySet<string>, worlds: readonly TrifectaWorld[]): Set<string> {
  const out = new Set<string>();
  for (const w of worlds) {
    const ix = indexFor(w);
    for (const p of w.policies) {
      const members = ix.identityIdsMatching(p.identityRoles, p.semantic);
      const [small, large] = members.size < who.size ? [members, who] : [who, members];
      for (const id of small) {
        if (large.has(id)) {
          for (const s of ix.serviceIdsMatching(p.serviceRoles, p.semantic)) out.add(s);
          break;
        }
      }
    }
  }
  return out;
}

/** The services one identity's attribute change can affect (see the rules above). */
function attributeServices(id: string, live: TrifectaWorld, draft: TrifectaWorld): Set<string> {
  const out = new Set<string>();
  const before = indexFor(live).identity(id);
  const after = indexFor(draft).identity(id);
  const matches = (i: Identity | undefined, p: { identityRoles: string[]; semantic: Policy['semantic'] } | undefined) =>
    !!i && !!p && entityMatchesRoles(p.identityRoles, p.semantic, i.attributes ?? [], i.name, i.id);
  const flips = <P extends { id: string; identityRoles: string[]; semantic: Policy['semantic'] }>(a: readonly P[], b: readonly P[]) => {
    const bById = new Map(b.map((p) => [p.id, p]));
    const aById = new Map(a.map((p) => [p.id, p]));
    return [...new Set([...aById.keys(), ...bById.keys()])].filter((pid) => matches(before, aById.get(pid)) !== matches(after, bById.get(pid)));
  };
  for (const pid of flips(live.policies, draft.policies)) {
    for (const w of [live, draft]) {
      const p = indexFor(w).policy(pid);
      if (p) for (const s of indexFor(w).serviceIdsMatching(p.serviceRoles, p.semantic)) out.add(s);
    }
  }
  if (flips(live.edgeRouterPolicies, draft.edgeRouterPolicies).length) {
    for (const s of authorizedServices(new Set([id]), [live, draft])) out.add(s);
  }
  return out;
}

type Entity = { id: string };

const COLLECTION: Record<DraftTarget, keyof TrifectaWorld> = {
  servicePolicy: 'policies',
  edgeRouterPolicy: 'edgeRouterPolicies',
  serviceEdgeRouterPolicy: 'serviceEdgeRouterPolicies',
  postureCheck: 'postureChecks',
  service: 'services',
  identity: 'identities',
  accessTest: 'accessTests',
};

const items = (w: TrifectaWorld, target: DraftTarget) => (w[COLLECTION[target]] ?? []) as readonly Entity[];
const byId = <T extends Entity>(xs: readonly T[], id: string): T | undefined => xs.find((x) => x.id === id);

/** The service ids `ops` can affect between live and draft, live order. */
export function affectedServices(ops: readonly DraftOp[], live: TrifectaWorld, draft: TrifectaWorld): string[] {
  return affectedFor(touchedBy(ops), live, draft);
}

/**
 * Every entity that differs between two worlds — what ops would have touched,
 * derived from the worlds alone (applyDraft keeps untouched collections, and the
 * untouched entities in a touched one, by reference).
 */
export function touchedBetween(live: TrifectaWorld, draft: TrifectaWorld): Touched[] {
  const out: Touched[] = [];
  for (const target of Object.keys(COLLECTION) as DraftTarget[]) {
    const a = items(live, target);
    const b = items(draft, target);
    if (a === b) continue;
    const before = new Map(a.map((e) => [e.id, e]));
    const after = new Map(b.map((e) => [e.id, e]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const x = before.get(id);
      const y = after.get(id);
      if (x === y || JSON.stringify(x) === JSON.stringify(y)) continue;
      if (target === 'identity' && x && y) {
        // An attribute change and a hosting change are scoped differently.
        const { attributes: ax, ...restX } = x as Entity & { attributes?: unknown };
        const { attributes: ay, ...restY } = y as Entity & { attributes?: unknown };
        if (JSON.stringify(ax) !== JSON.stringify(ay)) out.push({ target: 'identityAttributes', id });
        if (JSON.stringify(restX) !== JSON.stringify(restY)) out.push({ target, id });
        continue;
      }
      out.push({ target, id });
    }
  }
  return out;
}

/** The services reachable from touched entities, by the rules above; live order. */
export function affectedFor(touched: readonly Touched[], live: TrifectaWorld, draft: TrifectaWorld): string[] {
  const hit = new Set<string>();
  const worlds = [live, draft];
  const add = (ids: Iterable<string>) => {
    for (const id of ids) hit.add(id);
  };
  const servicesOf = (w: TrifectaWorld, p: Pick<Policy, 'serviceRoles' | 'semantic'>) => indexFor(w).serviceIdsMatching(p.serviceRoles, p.semantic);

  for (const t of touched) {
    switch (t.target) {
      case 'servicePolicy':
      case 'serviceEdgeRouterPolicy':
        for (const w of worlds) {
          const p = byId(items(w, t.target) as readonly (Entity & Pick<Policy, 'serviceRoles' | 'semantic'>)[], t.id);
          if (p) add(servicesOf(w, p));
        }
        break;

      case 'edgeRouterPolicy': {
        // The identities it selects in either world…
        const who = new Set<string>();
        for (const w of worlds) {
          const p = byId(w.edgeRouterPolicies, t.id);
          if (p) for (const id of indexFor(w).identityIdsMatching(p.identityRoles, p.semantic)) who.add(id);
        }
        if (!who.size) break;
        // …and every service a service policy authorizes any of them for, in either world.
        for (const w of worlds) {
          const ix = indexFor(w);
          for (const p of w.policies) {
            const members = ix.identityIdsMatching(p.identityRoles, p.semantic);
            const [small, large] = members.size < who.size ? [members, who] : [who, members];
            for (const id of small) {
              if (large.has(id)) {
                add(servicesOf(w, p));
                break;
              }
            }
          }
        }
        break;
      }

      case 'postureCheck':
        for (const w of worlds) {
          const ix = indexFor(w);
          if (!byId(w.postureChecks ?? [], t.id)) continue;
          for (const p of w.policies) if (ix.requiredChecks(p).some((c) => c.id === t.id)) add(servicesOf(w, p));
        }
        break;

      case 'service':
        hit.add(t.id);
        break;

      case 'identityAttributes':
        add(attributeServices(t.id, live, draft));
        break;

      case 'identity':
      case 'accessTest':
        break;
    }
  }
  return live.services.filter((s) => hit.has(s.id)).map((s) => s.id);
}

/** Per affected service: the identities to re-resolve, or 'all'. */
export type PairScope = ReadonlyMap<string, ReadonlySet<string> | 'all'>;

/** affectedPairs for ops — see the rules above. */
export function affectedPairs(ops: readonly DraftOp[], live: TrifectaWorld, draft: TrifectaWorld): PairScope {
  return pairsFor(touchedBy(ops), live, draft);
}

/** affectedPairs for touched entities (e.g. from touchedBetween). */
export function pairsFor(touched: readonly Touched[], live: TrifectaWorld, draft: TrifectaWorld): PairScope {
  const scope = new Map<string, Set<string> | 'all'>();
  const worlds = [live, draft];
  const add = (serviceIds: Iterable<string>, ids: ReadonlySet<string> | 'all') => {
    for (const s of serviceIds) {
      const cur = scope.get(s);
      if (cur === 'all') continue;
      if (ids === 'all') scope.set(s, 'all');
      else scope.set(s, new Set([...(cur ?? []), ...ids]));
    }
  };
  const union = (sets: Iterable<ReadonlySet<string>>) => {
    const out = new Set<string>();
    for (const s of sets) for (const x of s) out.add(x);
    return out;
  };
  const authorizedIn = (who: ReadonlySet<string>) => authorizedServices(who, worlds);

  for (const t of touched) {
    switch (t.target) {
      case 'servicePolicy': {
        const versions = worlds.map((w) => ({ w, p: byId(w.policies, t.id) })).filter((v) => v.p);
        const services = union(versions.map(({ w, p }) => indexFor(w).serviceIdsMatching(p!.serviceRoles, p!.semantic)));
        add(services, union(versions.map(({ w, p }) => indexFor(w).identityIdsMatching(p!.identityRoles, p!.semantic))));
        break;
      }
      case 'edgeRouterPolicy': {
        const who = union(
          worlds.map((w) => byId(w.edgeRouterPolicies, t.id)).flatMap((p, i) => (p ? [indexFor(worlds[i]).identityIdsMatching(p.identityRoles, p.semantic)] : [])),
        );
        if (who.size) add(authorizedIn(who), who);
        break;
      }
      case 'serviceEdgeRouterPolicy':
      case 'postureCheck':
      case 'service':
        add(affectedFor([t], live, draft), 'all');
        break;
      case 'identity':
        add(authorizedIn(new Set([t.id])), new Set([t.id]));
        break;
      case 'identityAttributes':
        add(attributeServices(t.id, live, draft), new Set([t.id]));
        break;
      case 'accessTest':
        break;
    }
  }
  return scope;
}
