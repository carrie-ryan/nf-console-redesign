import { describe, expect, it } from 'vitest';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import type { TrifectaWorld } from '../authorization/trifecta-resolver';
import { applyDraft } from './draft/policy-draft';
import { postureFor } from './posture';

const seed = buildSeedWorld();
const idOf = (name: string) => seed.identities.find((i) => i.name === name)!.id;
const checkNames = (ids: readonly string[]) => ids.map((id) => seed.postureChecks!.find((c) => c.id === id)!.name);

describe('postureFor — seed, Dial track', () => {
  it('bob → git-repo: satisfied via users-gitlab; require-mfa (admins-dev-access) is bypassed', () => {
    const p = postureFor(idOf('bob@corp.com'), 'svc-004', 'dial', seed);
    expect(p.grantingPolicies).toEqual([
      { policyId: 'pol-001', requiredCheckIds: ['pc-001'], failingCheckIds: ['pc-001'], satisfied: false },
      { policyId: 'pol-002', requiredCheckIds: [], failingCheckIds: [], satisfied: true },
    ]);
    expect(p.satisfied).toBe(true);
    expect(checkNames(p.bypassedChecks)).toEqual(['require-mfa']);
  });

  it('bob → api-prod: admins-dev-access is the only grant, and bob fails require-mfa', () => {
    const p = postureFor(idOf('bob@corp.com'), 'svc-005', 'dial', seed);
    expect(p.grantingPolicies).toEqual([{ policyId: 'pol-001', requiredCheckIds: ['pc-001'], failingCheckIds: ['pc-001'], satisfied: false }]);
    expect(p.satisfied).toBe(false);
    expect(p.bypassedChecks).toEqual([]);
  });

  it('alice → api-prod: passes require-mfa; nothing bypassed', () => {
    const p = postureFor(idOf('alice@corp.com'), 'svc-005', 'dial', seed);
    expect(p.grantingPolicies).toEqual([{ policyId: 'pol-001', requiredCheckIds: ['pc-001'], failingCheckIds: [], satisfied: true }]);
    expect(p).toMatchObject({ satisfied: true, bypassedChecks: [] });
  });

  it('carol fails too: not satisfied on git-repo (admins-dev-access is her only grant)', () => {
    expect(postureFor(idOf('carol@corp.com'), 'svc-004', 'dial', seed).satisfied).toBe(false);
  });

  it('a policy with no checks always satisfies — even with no posture results at all', () => {
    const bare: TrifectaWorld = { ...seed, postureChecks: undefined, postureResults: undefined };
    for (const w of [seed, bare]) {
      const p = postureFor(idOf('laptop-alice'), 'svc-004', 'dial', w);
      expect(p.grantingPolicies).toEqual([{ policyId: 'pol-002', requiredCheckIds: [], failingCheckIds: [], satisfied: true }]);
      expect(p.satisfied).toBe(true);
    }
  });

  it('not authorized → no granting policies, not satisfied', () => {
    expect(postureFor(idOf('laptop-alice'), 'svc-005', 'dial', seed)).toEqual({
      grantingPolicies: [], satisfied: false, bypassedChecks: [],
    });
  });
});

describe('postureFor — Bind track resolves the same way', () => {
  const bastion = idOf('infra-bastion-01');

  it('servers-bind-api requires corp-os-check (#corp-devices): server-prod-01 passes it', () => {
    const p = postureFor(idOf('server-prod-01'), 'svc-005', 'bind', seed);
    expect(p.grantingPolicies).toEqual([{ policyId: 'pol-003', requiredCheckIds: ['pc-002'], failingCheckIds: [], satisfied: true }]);
    expect(p).toMatchObject({ satisfied: true, bypassedChecks: [] });
  });

  it('every #servers identity passes corp-os-check except infra-bastion-01, which serves nothing', () => {
    const servers = seed.identities.filter((i) => i.attributes?.includes('#servers'));
    const failing = servers.filter((i) => !postureFor(i.id, 'svc-005', 'bind', seed).satisfied).map((i) => i.name);
    expect(failing).toEqual(['infra-bastion-01']);
    expect(seed.terminators!.some((t) => t.identityId === bastion)).toBe(false);
  });

  it('a second, check-free Bind grant satisfies infra-bastion-01 and bypasses corp-os-check', () => {
    const w = applyDraft(seed, [{ kind: 'create', policy: {
      id: 'pol-x', name: 'bastion-hosts-api', createdAt: '2025-04-01T00:00:00Z', status: 'active', type: 'bind',
      semantic: 'AnyOf', identityRoles: ['@infra-bastion-01'], serviceRoles: ['@svc-005'], postureCheckRoles: [] } }]);
    expect(postureFor(bastion, 'svc-005', 'bind', seed).satisfied).toBe(false);
    const p = postureFor(bastion, 'svc-005', 'bind', w);
    expect(p.grantingPolicies.map((g) => [g.policyId, g.satisfied])).toEqual([['pol-003', false], ['pol-x', true]]);
    expect(p.satisfied).toBe(true);
    expect(checkNames(p.bypassedChecks)).toEqual(['corp-os-check']);
  });

  it('the Dial grants never leak into Bind: bob → git-repo has no Bind grant', () => {
    expect(postureFor(idOf('bob@corp.com'), 'svc-004', 'bind', seed).grantingPolicies).toEqual([]);
  });
});
