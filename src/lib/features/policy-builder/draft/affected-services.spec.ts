/**
 * Guard for the scoped diff: on the small seed, random drafts across every target
 * must give EXACTLY the full diff. The scoped diff runs against one warm live world
 * (its live-side cache filling as it goes); the reference is a full diff on a fresh
 * copy of live, so a stale cache would show up too.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/affected-services.spec.ts`
 */

import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { affectedPairs, affectedServices } from './affected-services';
import { buildScaleWorld } from '../../authorization/scale-world';
import { diffWorlds } from './draft-diff';
import { applyDraft, type DraftOp } from './policy-draft';
import { opGenerator, randomDraft } from './random-drafts.testing';

/** Scoped (services and pairs) vs full diff for one draft, plus the scopes' coverage. */
const checkDraft = (live: TrifectaWorld, ops: DraftOp[], draft: TrifectaWorld) => {
  const scoped = diffWorlds(live, draft);
  const full = diffWorlds({ ...live }, draft, { scope: 'all' }); // fresh live side; every service, every pair
  expect(scoped).toEqual(full);
  // Every service with a pair or verdict change is in affectedServices(ops)…
  const scope = new Set(affectedServices(ops, live, draft));
  const moved = new Set([...full.pairChanges.map((c) => c.serviceId), ...full.services.filter((s) => s.changed).map((s) => s.serviceId)]);
  for (const id of moved) expect(scope.has(id), `${id} missing from affectedServices(${JSON.stringify(ops)})`).toBe(true);
  // …and every changed pair is in affectedPairs(ops).
  const pairs = affectedPairs(ops, live, draft);
  for (const c of full.pairChanges) {
    const ids = pairs.get(c.serviceId);
    expect(ids === 'all' || !!ids?.has(c.identityId), `${c.identityId} on ${c.serviceId} missing from affectedPairs(${JSON.stringify(ops)})`).toBe(true);
  }
  return scope.size;
};

describe('scoped diff == full diff', () => {
  const live = buildSeedWorld();
  const check = (ops: DraftOp[], draft: TrifectaWorld) => checkDraft(live, ops, draft);

  it('200 random single ops across all targets', () => {
    const gen = opGenerator(42);
    const sizes: number[] = [];
    for (let i = 0; i < 200; i++) {
      const { ops, draft } = randomDraft(gen, live, 1);
      sizes.push(check(ops, draft));
    }
    // The scope really narrows: most single ops reach fewer than all services.
    expect(sizes.filter((n) => n < live.services.length).length).toBeGreaterThan(100);
  });

  it('50 random 3-op drafts', () => {
    const gen = opGenerator(7);
    for (let i = 0; i < 50; i++) {
      const { ops, draft } = randomDraft(gen, live, 3);
      check(ops, draft);
    }
  });

  it('affectedPairs: a named policy re-resolves only its identities', () => {
    const ops: DraftOp[] = [{ kind: 'update', policyId: 'pol-005', patch: { identityRoles: ['@server-stage-01', '@laptop-alice'] } }];
    const pairs = affectedPairs(ops, live, applyDraft(live, ops));
    expect([...pairs.keys()]).toEqual(['svc-004', 'svc-006', 'svc-007']);
    expect([...(pairs.get('svc-004') as Set<string>)].sort()).toEqual(['id-001', 'id-013'].sort());
  });

  it('affectedServices: each rule, on the seed', () => {
    const svc = (ops: DraftOp[]) => affectedServices(ops, live, applyDraft(live, ops));
    // users-gitlab (#git services): git-repo, offline-svc, no-serp-svc.
    expect(svc([{ kind: 'update', policyId: 'pol-002', patch: { name: 'x' } }])).toEqual(['svc-004', 'svc-006', 'svc-007']);
    expect(svc([{ kind: 'update', target: 'service', policyId: 'svc-005', patch: { terminatorStrategy: 'random' } }])).toEqual(['svc-005']);
    expect(svc([{ kind: 'update', target: 'identity', policyId: 'id-001', patch: { hostingCost: 5 } }])).toEqual([]);
    // require-mfa: admins-dev-access's services.
    const mfa = svc([{ kind: 'update', target: 'postureCheck', policyId: 'pc-001', patch: { timeoutSeconds: 60 } }]);
    expect(mfa).toContain('svc-004');
    expect(mfa).toContain('svc-005');
  });
});

describe('scoped diff == full diff — 500 × 50 scale world', () => {
  const live = buildScaleWorld(1, { identities: 500, services: 50 });

  it('25 random single ops and 6 random 3-op drafts', () => {
    const gen = opGenerator(11);
    for (let i = 0; i < 25; i++) {
      const { ops, draft } = randomDraft(gen, live, 1);
      checkDraft(live, ops, draft);
    }
    for (let i = 0; i < 6; i++) {
      const { ops, draft } = randomDraft(gen, live, 3);
      checkDraft(live, ops, draft);
    }
  }, 300_000);
});
