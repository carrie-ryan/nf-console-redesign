/**
 * Random draft ops across every target, for property specs (scoped diff, draft
 * checks). Reproducible: same seed, same ops. Testing only — never imported by the app.
 */

import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { applyDraft, type DraftOp } from './policy-draft';

/** mulberry32 — reproducible randomness. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function opGenerator(seed: number) {
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const some = <T>(xs: readonly T[], max = 3): T[] => [...new Set(Array.from({ length: 1 + Math.floor(rand() * max) }, () => pick(xs)))];
  let n = 0;

  return (w: TrifectaWorld): DraftOp => {
    n++;
    const identityRoles = [
      ...new Set(w.identities.flatMap((i) => i.attributes)),
      ...w.identities.slice(0, 12).map((i) => `@${i.name}`),
      '#all',
      '#nobody',
    ];
    const serviceRoles = [...new Set(w.services.flatMap((s) => s.attributes ?? [])), ...w.services.map((s) => `@${s.id}`), '#all'];
    const routerRoles = [...new Set(w.edgeRouters.flatMap((r) => r.attributes)), ...w.edgeRouters.map((r) => `@${r.id}`), '#all'];
    const checkRoles = [...new Set((w.postureChecks ?? []).flatMap((c) => c.attributes)), ...(w.postureChecks ?? []).map((c) => `@${c.name}`), '#new-check'];
    const semantic = () => pick(['AnyOf', 'AllOf'] as const);
    const kind = () => pick(['create', 'update', 'update', 'delete'] as const);

    switch (pick(['servicePolicy', 'servicePolicy', 'edgeRouterPolicy', 'serviceEdgeRouterPolicy', 'postureCheck', 'service', 'identity', 'identityAttributes', 'identityAttributes', 'accessTest'] as const)) {
      case 'servicePolicy': {
        const k = kind();
        if (k === 'create' || !w.policies.length) {
          return { kind: 'create', policy: { id: `rp-${n}`, name: `random-${n}`, createdAt: '', status: 'active', type: pick(['dial', 'bind'] as const), semantic: semantic(), identityRoles: some(identityRoles), serviceRoles: some(serviceRoles, 2), postureCheckRoles: rand() < 0.4 ? some(checkRoles, 1) : [] } };
        }
        const p = pick(w.policies);
        if (k === 'delete') return { kind: 'delete', policyId: p.id };
        const patch = pick([
          { identityRoles: some(identityRoles) },
          { serviceRoles: some(serviceRoles, 2) },
          { semantic: semantic() },
          { type: pick(['dial', 'bind'] as const) },
          { postureCheckRoles: rand() < 0.5 ? [] : some(checkRoles, 2) },
        ]);
        return { kind: 'update', policyId: p.id, patch };
      }
      case 'edgeRouterPolicy': {
        const k = kind();
        if (k === 'create' || !w.edgeRouterPolicies.length) {
          return { kind: 'create', target: 'edgeRouterPolicy', policy: { id: `re-${n}`, name: `erp-${n}`, createdAt: '', status: 'active', semantic: semantic(), identityRoles: some(identityRoles), edgeRouterRoles: some(routerRoles, 2) } };
        }
        const p = pick(w.edgeRouterPolicies);
        if (k === 'delete') return { kind: 'delete', target: 'edgeRouterPolicy', policyId: p.id };
        return { kind: 'update', target: 'edgeRouterPolicy', policyId: p.id, patch: pick([{ identityRoles: some(identityRoles) }, { edgeRouterRoles: some(routerRoles, 2) }, { semantic: semantic() }]) };
      }
      case 'serviceEdgeRouterPolicy': {
        const k = kind();
        if (k === 'create' || !w.serviceEdgeRouterPolicies.length) {
          return { kind: 'create', target: 'serviceEdgeRouterPolicy', policy: { id: `rs-${n}`, name: `serp-${n}`, semantic: semantic(), serviceRoles: some(serviceRoles, 2), edgeRouterRoles: some(routerRoles, 2) } };
        }
        const p = pick(w.serviceEdgeRouterPolicies);
        if (k === 'delete') return { kind: 'delete', target: 'serviceEdgeRouterPolicy', policyId: p.id };
        return { kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: p.id, patch: pick([{ serviceRoles: some(serviceRoles, 2) }, { edgeRouterRoles: some(routerRoles, 2) }, { semantic: semantic() }]) };
      }
      case 'postureCheck': {
        const checks = w.postureChecks ?? [];
        const k = kind();
        if (k === 'create' || !checks.length) {
          return { kind: 'create', target: 'postureCheck', policy: { id: `rc-${n}`, name: `check-${n}`, createdAt: '', status: 'active', type: 'MFA', attributes: some(checkRoles.filter((r) => r.startsWith('#')), 2) } };
        }
        const c = pick(checks);
        if (k === 'delete') return { kind: 'delete', target: 'postureCheck', policyId: c.id };
        return { kind: 'update', target: 'postureCheck', policyId: c.id, patch: pick([{ attributes: rand() < 0.3 ? [] : some(checkRoles.filter((r) => r.startsWith('#')), 2) }, { name: `renamed-${n}` }, { timeoutSeconds: 60 }]) };
      }
      case 'service':
        return { kind: 'update', target: 'service', policyId: pick(w.services).id, patch: { terminatorStrategy: pick(['smartrouting', 'weighted', 'random'] as const) } };
      case 'identity':
        return { kind: 'update', target: 'identity', policyId: pick(w.identities).id, patch: pick([{ hostingCost: Math.floor(rand() * 10) }, { hostingPrecedence: pick(['default', 'required', 'failed'] as const) }]) };
      case 'identityAttributes': {
        // Bulk tagging: a few identities or a large batch; existing attributes (so rules
        // start or stop matching), or a new one.
        const attrs = [...new Set(w.identities.flatMap((i) => i.attributes)), '#tagged'];
        const ids = rand() < 0.3 ? w.identities.filter(() => rand() < 0.25).map((i) => i.id) : some(w.identities.map((i) => i.id), 4);
        const add = rand() < 0.7 ? some(attrs, 2) : [];
        const remove = some(attrs, 2).filter((a) => !add.includes(a));
        return { kind: 'tag', target: 'identityAttributes', identityIds: ids, add, remove: add.length && rand() < 0.5 ? [] : remove };
      }
      case 'accessTest': {
        const tests = w.accessTests ?? [];
        const k = kind();
        if (k === 'create' || !tests.length) {
          return { kind: 'create', target: 'accessTest', policy: { id: `rt-${n}`, kind: pick(['mustNotDial', 'mustNotHost', 'mustConnect'] as const), who: { attributes: some(identityRoles.filter((r) => r.startsWith('#')), 1) }, serviceId: pick(w.services).id, note: '' } };
        }
        const t = pick(tests);
        if (k === 'delete') return { kind: 'delete', target: 'accessTest', policyId: t.id };
        return { kind: 'update', target: 'accessTest', policyId: t.id, patch: { serviceId: pick(w.services).id } };
      }
    }
  };
}

/** n valid ops, each generated against the world the previous ones leave. */
export function randomDraft(gen: (w: TrifectaWorld) => DraftOp, live: TrifectaWorld, n: number): { ops: DraftOp[]; draft: TrifectaWorld } {
  const ops: DraftOp[] = [];
  let world = live;
  while (ops.length < n) {
    const op = gen(world);
    try {
      world = applyDraft(world, [op]);
      ops.push(op);
    } catch {
      // An op the rules reject (e.g. a role list emptied): draw another.
    }
  }
  return { ops, draft: world };
}
