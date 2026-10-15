/**
 * Commit-time conflicts: a touched entity's baseline is its live state when an op first
 * touched it; live moving away from it blocks commit until the change is reapplied on
 * the latest (picking where both sides changed the same field) or dropped.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/conflicts.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { DraftReviewComponent } from '../draft-review.component';
import { DraftChecks } from './draft-checks';
import { PolicyDraftStore } from './policy-draft.store';
import { adminEditOps } from './live-changes';

const USERS_GITLAB = 'pol-002'; // users-gitlab: AnyOf #users → #git
const KEY = `servicePolicy:${USERS_GITLAB}`;

describe('commit-time conflicts', () => {
  let store: PolicyDraftStore;
  const gitlab = () => store.draftWorld().policies.find((p) => p.id === USERS_GITLAB)!;
  const liveGitlab = () => store.live().policies.find((p) => p.id === USERS_GITLAB)!;
  /** Another admin adds #vendors to users-gitlab's identity roles, in live. */
  const adminEdit = () => store.applyLiveChange(adminEditOps(store.live()), 'Dana (admin)');

  const review = () => {
    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-004');
    TestBed.inject(DraftChecks).flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.includes(text))!;
    return { fixture, el, button };
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DraftReviewComponent] });
    store = TestBed.inject(PolicyDraftStore);
  });

  it('the first touch records the baseline; later edits keep it', () => {
    store.upsertUpdate(USERS_GITLAB, { semantic: 'AllOf' });
    store.upsertUpdate(USERS_GITLAB, { name: 'users-gitlab-2' });
    expect(store.baselines().get(KEY)!.entity).toEqual(liveGitlab());
    expect(store.conflicts()).toEqual([]);
  });

  it('an external change to a policy the draft edits blocks commit and shows the card', () => {
    store.upsertUpdate(USERS_GITLAB, { semantic: 'AllOf' });
    adminEdit();
    expect(liveGitlab().identityRoles).toEqual(['#users', '#vendors']);
    expect(store.history()[0]).toMatchObject({ author: 'outside', actor: 'Dana (admin)', changeLines: [expect.stringContaining('users-gitlab')] });

    const [c, ...rest] = store.conflicts();
    expect(rest).toEqual([]);
    expect(c.text).toBe('users-gitlab changed in live since you started editing it');
    expect(c.theirs).toEqual([{ field: 'identityRoles', label: 'Identities', from: ['#users'], to: ['#users', '#vendors'] }]);
    expect(c.mine).toEqual([{ field: 'semantic', label: 'Match', from: 'AnyOf', to: 'AllOf' }]);
    expect(c.clashes).toEqual([]);
    expect(() => store.commit()).toThrow(/users-gitlab changed in live/);

    const { el, button } = review();
    const card = el.querySelector('.dr-cf')!;
    expect(card.closest('section')!.querySelector('h3')!.textContent).toBe('Conflicts');
    expect(card.querySelector('.dr-cf-title')!.textContent).toBe(c.text);
    expect(card.textContent).toContain('#users → #users, #vendors');
    expect(card.textContent).toContain('AnyOf → AllOf');
    expect(button('Commit').disabled).toBe(true);
    expect(el.querySelector('#dr-blocked')!.textContent).toContain('users-gitlab');
  });

  it('reapplying a different field merges both; commit then goes through', () => {
    store.upsertUpdate(USERS_GITLAB, { name: 'users-git' });
    adminEdit();
    const { fixture, button } = review();
    button('Reapply my change on the latest').click();
    TestBed.inject(DraftChecks).flush(); // the diff, tests and warnings rerun on the rebased draft
    fixture.detectChanges();
    expect(store.conflicts()).toEqual([]);
    expect(store.ops()).toEqual([{ kind: 'update', policyId: USERS_GITLAB, patch: { name: 'users-git' } }]);
    expect(gitlab()).toMatchObject({ name: 'users-git', identityRoles: ['#users', '#vendors'] });
    expect(store.baselines().get(KEY)!.entity).toEqual(liveGitlab()); // the latest is the new baseline
    expect((fixture.nativeElement as HTMLElement).querySelector('.dr-cf')).toBeNull();
    expect(button('Commit').disabled).toBe(false);
    store.commit();
    expect(liveGitlab()).toMatchObject({ name: 'users-git', identityRoles: ['#users', '#vendors'] });
  });

  it('the same field asks: both values shown, reapply waits for a pick', () => {
    store.upsertUpdate(USERS_GITLAB, { identityRoles: ['#users', '#contractors'] });
    adminEdit();
    const [c] = store.conflicts();
    expect(c.clashes).toEqual([{ field: 'identityRoles', label: 'Identities', theirs: ['#users', '#vendors'], mine: ['#users', '#contractors'] }]);
    expect(() => store.reapply(KEY)).toThrow(/Pick a value for Identities/);

    const { fixture, el, button } = review();
    const pick = el.querySelector('.dr-cf-pick')!;
    expect(pick.querySelector('legend')!.textContent).toBe('Identities changed on both sides — keep which?');
    expect([...pick.querySelectorAll('label')].map((l) => l.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Theirs #users, #vendors',
      'Mine #users, #contractors',
    ]);
    expect(button('Reapply').disabled).toBe(true);
    const mine = pick.querySelectorAll<HTMLInputElement>('input[type=radio]')[1];
    mine.checked = true;
    mine.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(button('Reapply').disabled).toBe(false);
    button('Reapply').click();
    expect(store.conflicts()).toEqual([]);
    expect(gitlab().identityRoles).toEqual(['#users', '#contractors']);
  });

  it('keeping theirs on the only field leaves nothing of mine: the entity leaves the draft', () => {
    store.upsertUpdate(USERS_GITLAB, { identityRoles: ['#users', '#contractors'] });
    adminEdit();
    store.reapply(KEY, { identityRoles: 'theirs' });
    expect(store.ops()).toEqual([]);
    expect(store.conflicts()).toEqual([]);
  });

  it('dropping removes the op', () => {
    store.upsertUpdate('pol-001', { name: 'admins-dev' });
    store.upsertUpdate(USERS_GITLAB, { semantic: 'AllOf' });
    adminEdit();
    const { fixture, button } = review();
    button('Drop my change').click();
    TestBed.inject(DraftChecks).flush();
    fixture.detectChanges();
    expect(store.ops()).toEqual([{ kind: 'update', policyId: 'pol-001', patch: { name: 'admins-dev' } }]);
    expect(store.conflicts()).toEqual([]);
    expect(store.baselines().has(KEY)).toBe(false);
    expect(button('Commit').disabled).toBe(false);
  });

  it("an external change to an entity the draft doesn't touch is no conflict", () => {
    store.upsertUpdate('pol-001', { name: 'admins-dev' });
    adminEdit();
    expect(store.conflicts()).toEqual([]);
    store.commit();
    expect(store.live().policies.find((p) => p.id === 'pol-001')!.name).toBe('admins-dev');
  });

  it('my delete, reapplied on the latest, stays a delete', () => {
    store.upsertUpdate(USERS_GITLAB, { semantic: 'AllOf' });
    store.deletePolicy(USERS_GITLAB);
    expect(store.conflicts()).toEqual([]);
    adminEdit();
    const [c] = store.conflicts();
    expect(c.mine).toEqual([{ field: 'exists', label: 'Exists', from: true, to: false }]);
    store.reapply(KEY); // a delete stays a delete, on the latest
    expect(store.ops()).toEqual([{ kind: 'delete', policyId: USERS_GITLAB }]);
    expect(store.conflicts()).toEqual([]);
  });
});
