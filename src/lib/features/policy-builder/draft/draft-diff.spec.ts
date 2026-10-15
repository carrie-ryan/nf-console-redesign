/**
 * Proves policy-draft.ts and draft-diff.ts on the MockDataService seed world.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/draft-diff.spec.ts`
 */

import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { resolve, type TrifectaWorld } from '../../authorization/trifecta-resolver';
import type { Policy } from '../../../shared/services/mock-data.service';
import { applyDraft, type DraftOp, type PolicyPatch } from './policy-draft';
import { diffWorlds, type DraftDiff } from './draft-diff';

const kioskDial: Policy = {
  id: 'pol-draft-kiosk',
  name: 'kiosk-git-repo',
  createdAt: '2026-10-06T00:00:00Z',
  status: 'active',
  type: 'dial',
  semantic: 'AnyOf',
  identityRoles: ['@kiosk-lobby'],
  serviceRoles: ['@svc-004'],
  postureCheckRoles: [],
};

const CASES: Record<string, DraftOp[]> = {
  'delete pol-004': [{ kind: 'delete', policyId: 'pol-004' }],
  'update pol-002 identityRoles': [
    { kind: 'update', policyId: 'pol-002', patch: { identityRoles: ['#users', '#kiosks'] } },
  ],
  'create kiosk dial': [{ kind: 'create', policy: kioskDial }],
};

const diffFor = (live: TrifectaWorld, ops: DraftOp[]) => {
  const draft = applyDraft(live, ops);
  return { draft, diff: diffWorlds(live, draft) };
};

describe('applyDraft', () => {
  it('is pure: the input world is deep-equal before and after, for every case', () => {
    const live = buildSeedWorld();
    const snapshot = structuredClone(live);
    for (const ops of [[], ...Object.values(CASES)]) {
      const opsSnapshot = structuredClone(ops);
      applyDraft(live, ops);
      expect(live).toEqual(snapshot);
      expect(ops).toEqual(opsSnapshot);
    }
  });

  it('empty ops → a world equal to the input', () => {
    const live = buildSeedWorld();
    expect(applyDraft(live, [])).toEqual(live);
  });

  it('applies ops in order', () => {
    const live = buildSeedWorld();
    const draft = applyDraft(live, [
      { kind: 'create', policy: kioskDial },
      { kind: 'update', policyId: kioskDial.id, patch: { name: 'renamed' } },
      { kind: 'delete', policyId: 'pol-001' },
    ]);
    expect(draft.policies.map((p) => p.id)).toEqual(['pol-002', 'pol-003', 'pol-004', 'pol-005', 'pol-006', kioskDial.id]);
    expect(draft.policies.at(-1)!.name).toBe('renamed');
  });

  it('a patch never changes the id', () => {
    const live = buildSeedWorld();
    const patch = { id: 'pol-999', name: 'x' } as PolicyPatch; // id smuggled past the type
    const draft = applyDraft(live, [{ kind: 'update', policyId: 'pol-002', patch }]);
    expect(draft.policies.map((p) => p.id)).toContain('pol-002');
    expect(draft.policies.map((p) => p.id)).not.toContain('pol-999');
  });

  describe('errors', () => {
    const live = buildSeedWorld();
    it('update of a missing id', () => {
      expect(() => applyDraft(live, [{ kind: 'update', policyId: 'nope', patch: {} }])).toThrow(/no policy with id 'nope'/);
    });
    it('delete of a missing id', () => {
      expect(() => applyDraft(live, [{ kind: 'delete', policyId: 'nope' }])).toThrow(/no policy with id 'nope'/);
    });
    it('delete of an id an earlier op already deleted', () => {
      const del: DraftOp = { kind: 'delete', policyId: 'pol-001' };
      expect(() => applyDraft(live, [del, del])).toThrow(/no policy with id 'pol-001'/);
    });
    it('create with a duplicate id', () => {
      const dup = { ...kioskDial, id: 'pol-001' };
      expect(() => applyDraft(live, [{ kind: 'create', policy: dup }])).toThrow(/duplicate policy id 'pol-001'/);
    });
    it('invalid type, on create and update', () => {
      const bad = { ...kioskDial, type: 'both' } as unknown as Policy;
      expect(() => applyDraft(live, [{ kind: 'create', policy: bad }])).toThrow(/invalid type 'both'/);
      expect(() =>
        applyDraft(live, [{ kind: 'update', policyId: 'pol-002', patch: { type: 'both' as Policy['type'] } }]),
      ).toThrow(/invalid type 'both'/);
    });
    it('invalid semantic, on create and update', () => {
      const bad = { ...kioskDial, semantic: 'OneOf' } as unknown as Policy;
      expect(() => applyDraft(live, [{ kind: 'create', policy: bad }])).toThrow(/invalid semantic 'OneOf'/);
      expect(() =>
        applyDraft(live, [{ kind: 'update', policyId: 'pol-002', patch: { semantic: 'OneOf' as Policy['semantic'] } }]),
      ).toThrow(/invalid semantic 'OneOf'/);
    });
  });
});

describe('diffWorlds (seed world)', () => {
  it('empty ops → empty diff', () => {
    const live = buildSeedWorld();
    expect(diffFor(live, []).diff).toEqual<DraftDiff>({ pairChanges: [], services: [], affectedServiceIds: [], configChanges: [], loosenings: [] });
  });

  it('delete pol-004 → git-repo keeps only server-stage-01 (git-servers-host); 8 bind pairs lose authorization, 1 serving host', () => {
    const { diff } = diffFor(buildSeedWorld(), CASES['delete pol-004']);

    expect(diff.services).toEqual([
      {
        serviceId: 'svc-004',
        // server-build-01 was one of the two serving hosts; its terminators are orphaned.
        verdictBefore: { canConnect: 17, dialTotal: 18, hostsReachable: 9, hostsServing: 2, blockedByPosture: 1, reason: null },
        verdictAfter: { canConnect: 17, dialTotal: 18, hostsReachable: 1, hostsServing: 1, blockedByPosture: 1, reason: null },
        changed: true,
      },
    ]);

    const lost = diff.pairChanges.filter((c) => c.track === 'bind' && c.after === 'NOT_AUTHORIZED');
    expect(lost.length).toBe(8);
    expect(lost.every((c) => c.serviceId === 'svc-004' && c.before !== 'NOT_AUTHORIZED')).toBe(true);
    // Deleting a Bind policy touches nothing else.
    expect(diff.pairChanges).toEqual(lost);
    expect(diff.affectedServiceIds).toEqual(['svc-004']);
  });

  it('update pol-002 identityRoles → git-repo, offline-svc and no-serp-svc are affected', () => {
    const { diff } = diffFor(buildSeedWorld(), CASES['update pol-002 identityRoles']);
    console.log('[draft-diff] update pol-002 identityRoles → [#users, #kiosks]\n' + JSON.stringify(diff, null, 2));
    expect(diff.affectedServiceIds).toEqual(expect.arrayContaining(['svc-004', 'svc-006', 'svc-007']));
    // A Dial edit never moves the Bind track.
    expect(diff.pairChanges.every((c) => c.track === 'dial')).toBe(true);

    // Every affected service is listed — including the two whose "no host with an
    // online route" text hides the dialTotal move.
    expect(diff.services.map((s) => s.serviceId)).toEqual(diff.affectedServiceIds);
    const noHost = { canConnect: 0, hostsReachable: 0, hostsServing: 0, blockedByPosture: 0, reason: 'no host with an online route' } as const;
    for (const id of ['svc-006', 'svc-007']) {
      expect(diff.services.find((s) => s.serviceId === id)).toEqual({
        serviceId: id,
        verdictBefore: { ...noHost, dialTotal: 18 },
        verdictAfter: { ...noHost, dialTotal: 24 },
        changed: true,
      });
    }
    expect(diff.services.find((s) => s.serviceId === 'svc-004')).toMatchObject({
      verdictBefore: { canConnect: 17, dialTotal: 18 },
      verdictAfter: { canConnect: 17, dialTotal: 24 },
      changed: true,
    });
  });

  it('create Dial [@kiosk-lobby] for @svc-004 → exactly one pair change', () => {
    const { diff } = diffFor(buildSeedWorld(), CASES['create kiosk dial']);
    expect(diff.pairChanges).toHaveLength(1);
    expect(diff.pairChanges[0]).toMatchObject({
      identityId: 'id-005', // kiosk-lobby
      serviceId: 'svc-004', // git-repo
      track: 'dial',
      before: 'NOT_AUTHORIZED',
    });
  });

  it('every pairChange.after equals resolve() on the draft world (and before on live)', () => {
    const live = buildSeedWorld();
    for (const ops of Object.values(CASES)) {
      const { draft, diff } = diffFor(live, ops);
      expect(diff.pairChanges.length).toBeGreaterThan(0);
      for (const c of diff.pairChanges) {
        const after = resolve(c.identityId, c.serviceId, draft);
        const before = resolve(c.identityId, c.serviceId, live);
        expect(c.after).toBe(c.track === 'dial' ? after.status : after.bindStatus);
        expect(c.before).toBe(c.track === 'dial' ? before.status : before.bindStatus);
      }
    }
  });
});
