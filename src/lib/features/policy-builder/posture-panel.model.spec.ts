import { describe, expect, it } from 'vitest';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import type { TrifectaWorld } from '../authorization/trifecta-resolver';
import { diffWorlds } from './draft/draft-diff';
import { describeOps, effectRows } from './draft/draft-summary';
import { applyDraft } from './draft/policy-draft';
import { hostingFor } from './hosting';
import { posturePanel, previewFromDiff, previewText } from './posture-panel.model';
import { layoutServiceView } from './service-view.layout';
import { buildScaleWorld } from '../authorization/scale-world';

const seed = buildSeedWorld();
const ADMINS = 'dial:pol-001:rule';

describe('posturePanel: admins-dev-access on git-repo', () => {
  const p = posturePanel(seed, 'svc-004', ADMINS)!;

  it('the group requires require-mfa, and its node counts 1 blocked, 1 bypassed', () => {
    expect(p.checkNames).toEqual(['require-mfa']);
    expect(p.group.checks).toEqual([{ id: 'pc-001', name: 'require-mfa' }]);
    expect(p.group.posture).toEqual({ blocked: 1, bypassed: 1 });
  });

  it('carol is blocked: admins-dev-access is her only grant, and the failure is her device\'s', () => {
    expect(p.blocked).toEqual([{
      identityId: 'id-016',
      name: 'carol@corp.com',
      grants: [{ policyId: 'pol-001', policyName: 'admins-dev-access', failingCheckNames: ['require-mfa'] }],
      deviceLines: ['Device must pass require-mfa; not a policy fix'],
    }]);
  });

  it('bob bypasses require-mfa through users-gitlab', () => {
    expect(p.bypasses).toEqual([{
      identityId: 'id-015', checkId: 'pc-001', viaPolicyId: 'pol-002',
      text: 'bob@corp.com skips require-mfa on git-repo through users-gitlab, which has no posture checks.',
    }]);
  });

  it('the fix adds #mfa-required to users-gitlab; preview: git-repo 17 → 1 can connect, 1 → 17 blocked', () => {
    expect(p.fixes).toHaveLength(1);
    const [f] = p.fixes;
    expect(f.title).toBe('Add require-mfa to users-gitlab');
    expect(f.role).toBe('#mfa-required');
    expect(f.ops).toEqual([{ kind: 'update', policyId: 'pol-002', patch: { postureCheckRoles: ['#mfa-required'] } }]);
    const after = applyDraft(seed, f.ops);
    expect(previewFromDiff(seed, diffWorlds(seed, after)).map(previewText)).toEqual(['git-repo: can connect 17 → 1 · blocked by posture 1 → 17']);
    expect(describeOps(seed, f.ops)).toEqual(['Updated users-gitlab: added posture check #mfa-required']);
  });

  it('applied: the bypass is gone, bob is blocked too, and the review row says "+16 blocked by posture"', () => {
    const after = applyDraft(seed, p.fixes[0].ops);
    const again = posturePanel(after, 'svc-004', ADMINS)!;
    expect(again.bypasses).toEqual([]);
    expect(again.blocked.map((m) => m.name)).toEqual(['bob@corp.com', 'carol@corp.com']);
    const [row] = effectRows(diffWorlds(seed, after), seed, 'svc-004');
    expect(row).toMatchObject({ serviceName: 'git-repo', blocked: { before: 1, after: 17, delta: 16 }, postureLine: '+16 blocked by posture' });
  });

  it('blocked members are grouped by identical failing checks and reason, largest first', () => {
    expect(p.blockedGroups.map((g) => [g.text, g.members.map((m) => m.name), g.deviceLines])).toEqual([
      ['1 dialer fails require-mfa · device', ['carol@corp.com'], ['Device must pass require-mfa; not a policy fix']],
    ]);
    const after = applyDraft(seed, p.fixes[0].ops);
    const again = posturePanel(after, 'svc-004', ADMINS)!;
    expect(again.blockedGroups.map((g) => [g.text, g.members.map((m) => m.name)])).toEqual([
      ['2 dialers fail require-mfa · device', ['bob@corp.com', 'carol@corp.com']],
    ]);
  });

  it('every blocked member is in exactly one group, and members of a group fail the same checks', () => {
    const w = buildScaleWorld(1, { identities: 400, services: 20 });
    for (const s of w.services) {
      for (const g of [...layoutServiceView(s.id, w).bind.groups, ...layoutServiceView(s.id, w).dial.groups]) {
        if (!g.posture.blocked) continue;
        const pp = posturePanel(w, s.id, g.id)!;
        expect(pp.blockedGroups.flatMap((x) => x.members)).toHaveLength(pp.blocked.length);
        expect(pp.blockedGroups.map((x) => x.members.length)).toEqual(pp.blockedGroups.map((x) => x.members.length).sort((a, b) => b - a));
        for (const x of pp.blockedGroups) {
          for (const m of x.members) {
            expect([...new Set(m.grants.flatMap((gr) => gr.failingCheckNames))].sort()).toEqual([...x.checkNames].sort());
          }
        }
      }
    }
  });

  it('a group without bypasses or blocked members has nothing to fix', () => {
    const users = posturePanel(seed, 'svc-004', 'dial:pol-002:rule')!;
    expect(users).toMatchObject({ checkNames: [], blocked: [], blockedGroups: [], bypasses: [], fixes: [] });
  });
});

describe('hosting: a serving host that fails Bind posture is blocked, not active or standby', () => {
  // git-repo-hosts requires corp-os-check by name; server-build-01 passes it (it is #servers),
  // so take its result away.
  const world: TrifectaWorld = {
    ...applyDraft(seed, [{ kind: 'update', policyId: 'pol-004', patch: { postureCheckRoles: ['@corp-os-check'] } }]),
    postureResults: seed.postureResults!.filter((r) => r.identityId !== 'id-014'),
  };

  it('server-build-01 → blocked; server-stage-01 stays active', () => {
    const h = hostingFor('svc-004', world);
    expect(h.blockedHostIds).toEqual(['id-014']);
    expect(h.activeHostIds).toEqual(['id-013']);
    expect(h.servingHosts.map((s) => s.identityId)).toEqual(['id-013', 'id-014']);
  });

  it('its group counts it as blocked by posture', () => {
    const named = layoutServiceView('svc-004', world).bind.groups.find((g) => g.id === 'bind:pol-004:named')!;
    expect(named.posture).toEqual({ blocked: 1, bypassed: 0 });
    expect(named.label.counts.map((c) => c.text)).toContain('1 blocked by posture');
  });
});
