/**
 * Commit history and revert: every commit records what it touched; a revert is a NEW
 * draft of inverse ops (tested and committed like any other), leaving out entities
 * changed since.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/history.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import type { Policy } from '../../../shared/services/mock-data.service';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { DraftReviewComponent } from '../draft-review.component';
import { requirementWarnings } from './loosening';
import { applyDraft } from './policy-draft';
import { PolicyDraftStore } from './policy-draft.store';
import { DraftChecks } from './draft-checks';

const ALL_OF = { semantic: 'AllOf', identityRoles: ['#users', '#laptops'] } as const;

describe('commit history and revert', () => {
  let store: PolicyDraftStore;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(PolicyDraftStore);
  });

  const commitUpdate = (id: string, patch: Partial<Policy>) => {
    store.upsertUpdate(id, patch);
    store.commit();
  };
  const reviewText = () => {
    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-004');
    TestBed.inject(DraftChecks).flush(); // the review computation, run to completion now
    fixture.detectChanges();
    return fixture;
  };

  it('a commit records id, time, author, change lines, ops and the touched entities before', () => {
    const live = store.live();
    commitUpdate('pol-002', { ...ALL_OF, identityRoles: [...ALL_OF.identityRoles] });
    const [c] = store.history();
    expect(c).toMatchObject({ id: 'c-1', author: 'you', ops: [{ kind: 'update', policyId: 'pol-002' }] });
    expect(Date.parse(c.at)).not.toBeNaN();
    expect(c.changeLines).toHaveLength(1);
    expect(c.changeLines[0]).toContain('users-gitlab');
    expect(c.before).toEqual([{ target: 'servicePolicy', id: 'pol-002', entity: live.policies.find((p) => p.id === 'pol-002') }]);
  });

  it('commit the users-gitlab all-of edit, revert it: live equals the state before the first commit', () => {
    const original = JSON.stringify(store.live());
    commitUpdate('pol-002', { ...ALL_OF, identityRoles: [...ALL_OF.identityRoles] });
    expect(JSON.stringify(store.live())).not.toBe(original);

    expect(store.startRevert('c-1')).toEqual([]);
    // Not committed: a draft, to review.
    expect(store.ops()).toEqual([{ kind: 'update', policyId: 'pol-002', patch: { semantic: 'AnyOf', identityRoles: ['#users'] } }]);
    expect(store.reverting()).toEqual({ commitId: 'c-1', conflicts: [], expired: [] });
    store.commit();

    expect(JSON.stringify(store.live())).toBe(original);
    expect(store.history().map((c) => [c.id, c.revertOf])).toEqual([['c-2', 'c-1'], ['c-1', undefined]]);
    expect(store.reverting()).toBeNull();
  });

  it('reverting a create deletes it, and a delete re-creates it', () => {
    store.createForService('dial', 'svc-004');
    store.deletePolicy('pol-005');
    store.commit();
    store.startRevert('c-1');
    expect(store.ops().map((o) => o.kind)).toEqual(['delete', 'create']);
    store.commit();
    const ids = store.live().policies.map((p) => p.id);
    expect(ids).not.toContain('pol-draft-1');
    expect(ids).toContain('pol-005');
  });

  it('a later edit to users-gitlab makes it a conflict, left out of the revert', () => {
    store.upsertUpdate('pol-002', { ...ALL_OF, identityRoles: [...ALL_OF.identityRoles] });
    store.upsertUpdate('pol-005', { name: 'git-servers-host-2' });
    store.commit();
    commitUpdate('pol-002', { name: 'users-gitlab-renamed' });

    expect(store.startRevert('c-1')).toEqual(['users-gitlab']);
    expect(store.ops()).toEqual([{ kind: 'update', policyId: 'pol-005', patch: { name: 'git-servers-host' } }]);
    const el = reviewText().nativeElement as HTMLElement;
    expect(el.querySelector('.dr-conflict')!.textContent).toContain('Changed since: users-gitlab — not reverted');
    expect(el.textContent).toContain('This draft reverts commit c-1.');
  });

  it('nothing left to revert: an empty draft, the conflict listed', () => {
    commitUpdate('pol-002', { name: 'a' });
    commitUpdate('pol-002', { name: 'b' });
    expect(store.startRevert('c-1')).toEqual(['users-gitlab']);
    expect(store.ops()).toEqual([]);
  });

  it('a pending draft must be committed or discarded first', () => {
    commitUpdate('pol-002', { name: 'a' });
    store.upsertUpdate('pol-005', { name: 'x' });
    expect(() => store.startRevert('c-1')).toThrow('Commit or discard the current draft first');
  });

  it('a revert draft still goes through tests: reverting a fix a test now depends on is blocked', () => {
    // c-1, the fix: alice gets git-repo through her own policy.
    store.addOp({
      kind: 'create',
      policy: {
        id: 'pol-alice-git', name: 'alice-git', createdAt: '2026-10-09T00:00:00Z', status: 'active', type: 'dial',
        semantic: 'AnyOf', identityRoles: ['@id-001'], serviceRoles: ['@svc-004'], postureCheckRoles: [],
      },
    });
    store.commit();
    // c-2: users-gitlab no longer covers alice — her test now depends on the fix.
    commitUpdate('pol-002', { identityRoles: ['#nobody'] });

    store.startRevert('c-1');
    const fixture = reviewText();
    const el = fixture.nativeElement as HTMLElement;
    const commit = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Commit'))!;
    expect(commit.disabled).toBe(true);
    expect(el.querySelector('.dr-blocked')!.textContent).toContain('laptop-alice must connect to git-repo');
    expect(el.querySelector('.dr-test-fail')!.textContent).toContain('alice-git deleted in this draft');
    fixture.componentInstance.commit();
    expect(store.live().policies.some((p) => p.id === 'pol-alice-git')).toBe(true);
  });
});

describe('"Changes a requirement used by N policies"', () => {
  it('a check whose definition changes warns for the policies requiring it', () => {
    const seed = buildSeedWorld();
    const draft = applyDraft(seed, [{ kind: 'update', target: 'postureCheck', policyId: 'pc-001', patch: { timeoutSeconds: 60 } }]);
    expect(requirementWarnings(seed, draft)).toEqual(['Changes a requirement used by 1 policy: admins-dev-access (require-mfa)']);
  });

  it('a rename alone is not a definition change', () => {
    const seed = buildSeedWorld();
    const draft = applyDraft(seed, [{ kind: 'update', target: 'postureCheck', policyId: 'pc-001', patch: { name: 'mfa' } }]);
    expect(requirementWarnings(seed, draft)).toEqual([]);
  });
});
