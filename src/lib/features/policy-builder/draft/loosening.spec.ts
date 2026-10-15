/**
 * The bypass rule (any satisfied granting policy without the check bypasses it) and
 * the review panel's loosening warning, on the seed plus one draft Dial rule:
 * new-dial-rule-1 — #admins → git-repo, requiring crowdstrike-healthy (#edr-required).
 */

import { describe, expect, it } from 'vitest';
import type { Policy } from '../../../shared/services/mock-data.service';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { bypassesFor, postureFor } from '../posture';
import { diffWorlds } from './draft-diff';
import { effectRows } from './draft-summary';
import { loosenings } from './loosening';
import { applyDraft, type DraftOp } from './policy-draft';

const seed = buildSeedWorld();
const rule = (patch: Partial<Policy> = {}): Policy => ({
  id: 'pol-draft-1', name: 'new-dial-rule-1', createdAt: '2026-10-08T00:00:00Z', status: 'active', type: 'dial',
  semantic: 'AnyOf', identityRoles: ['#admins'], serviceRoles: ['@svc-004'], postureCheckRoles: ['#edr-required'], ...patch,
});
const withRule = (patch: Partial<Policy> = {}): DraftOp[] => [{ kind: 'create', policy: rule(patch) }];
const checkName = (id: string) => seed.postureChecks!.find((c) => c.id === id)!.name;

describe('bypass rule: another satisfied granting policy without the check', () => {
  // alice passes both require-mfa and crowdstrike-healthy.
  const world: TrifectaWorld = {
    ...applyDraft(seed, withRule()),
    postureResults: [...seed.postureResults!.filter((r) => r.identityId !== 'id-004'), { identityId: 'id-004', passedCheckIds: ['pc-001', 'pc-003'] }],
  };

  it('alice → git-repo: require-mfa bypassed via new-dial-rule-1 (one check each)', () => {
    const p = postureFor('id-004', 'svc-004', 'dial', world);
    expect(p.grantingPolicies.map((g) => [g.policyId, g.requiredCheckIds, g.satisfied])).toEqual([
      ['pol-001', ['pc-001'], true],
      ['pol-draft-1', ['pc-003'], true],
    ]);
    const viaMfa = bypassesFor(p, 'id-004').find((b) => b.checkId === 'pc-001')!;
    expect(viaMfa).toEqual({ identityId: 'id-004', checkId: 'pc-001', viaPolicyId: 'pol-draft-1', viaCheckIds: ['pc-003'] });
    // Symmetric: admins-dev-access is a way in without crowdstrike-healthy, too.
    expect(p.bypassedChecks.map(checkName)).toEqual(['require-mfa', 'crowdstrike-healthy']);
  });

  it('a policy she fails bypasses nothing (seed results: alice lacks crowdstrike-healthy)', () => {
    const p = postureFor('id-004', 'svc-004', 'dial', applyDraft(seed, withRule()));
    expect(p.bypassedChecks.map(checkName)).toEqual(['crowdstrike-healthy']);
  });

  it('the seed bypass still holds: bob skips require-mfa through users-gitlab', () => {
    expect(postureFor('id-015', 'svc-004', 'dial', seed).bypassedChecks.map(checkName)).toEqual(['require-mfa']);
  });
});

describe('loosening warning', () => {
  it('new-dial-rule-1: "Admins can now connect with crowdstrike-healthy instead of require-mfa"', () => {
    const draft = applyDraft(seed, withRule());
    const [l, ...rest] = loosenings(seed, draft);
    expect(rest).toEqual([]);
    expect(l.text).toBe('Admins can now connect with crowdstrike-healthy instead of require-mfa');
    // bob already had a way in with no checks (users-gitlab), so the rule loosens nothing for him.
    expect(l).toMatchObject({ serviceId: 'svc-004', policyId: 'pol-draft-1', identityIds: ['id-004', 'id-016'] });
    const [row] = effectRows(diffWorlds(seed, draft), seed, 'svc-004');
    expect(row.looseningLines).toEqual([l.text]);
  });

  it('fewer checks: none at all', () => {
    const [l] = loosenings(seed, applyDraft(seed, withRule({ postureCheckRoles: [] })));
    expect(l.text).toBe('Admins can now connect with no posture checks instead of require-mfa');
  });

  it('editing admins-dev-access itself to a different check loosens it too', () => {
    const draft = applyDraft(seed, [{ kind: 'update', policyId: 'pol-001', patch: { postureCheckRoles: ['#edr-required'] } }]);
    const texts = loosenings(seed, draft).map((l) => [l.serviceId, l.text]);
    expect(texts).toContainEqual(['svc-004', 'Admins can now connect with crowdstrike-healthy instead of require-mfa']);
    expect(texts).toContainEqual(['svc-005', 'Admins can now connect with crowdstrike-healthy instead of require-mfa']);
  });

  it('no warning when the new route is stricter, or the identities had no route before', () => {
    expect(loosenings(seed, applyDraft(seed, withRule({ postureCheckRoles: ['#mfa-required', '#edr-required'] })))).toEqual([]);
    expect(loosenings(seed, applyDraft(seed, withRule({ identityRoles: ['#kiosks'] })))).toEqual([]);
    // A rename changes the policy but not its route.
    expect(loosenings(seed, applyDraft(seed, [{ kind: 'update', policyId: 'pol-001', patch: { name: 'admins' } }]))).toEqual([]);
  });

  it("names the identities when the rule isn't a single #term", () => {
    const [l] = loosenings(seed, applyDraft(seed, withRule({ identityRoles: ['@alice@corp.com', '@carol@corp.com'] })));
    expect(l.text).toBe('alice@corp.com, carol@corp.com can now connect with crowdstrike-healthy instead of require-mfa');
  });
});
