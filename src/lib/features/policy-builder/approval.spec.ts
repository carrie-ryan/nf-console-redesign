/**
 * Approval before commit (demo: "Require review before commit") and the revert warning
 * for time-limited access whose expiry passed.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/approval.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApprovalStore, LOCK_MESSAGE } from './draft/approval.store';
import { DraftChecks } from './draft/draft-checks';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { DraftReviewComponent } from './draft-review.component';
import { DemoControls } from './demo-controls';
import { HistoryPanelComponent } from './history-panel.component';
import { PolicyBuilderComponent } from './policy-builder.component';
import type { ReasonLink } from './access-tests';
import { formatDate } from '@angular/common';

const NOW = new Date('2026-10-14T10:42:00Z'); // shown in local time
const HOUR = 3_600_000;
const USERS_GITLAB = 'pol-002';
const GIT_REPO = 'svc-004';

const clean = (el: Element | null | undefined) => el?.textContent!.replace(/\s+/g, ' ').trim() ?? null;

describe('approval before commit', () => {
  let store: PolicyDraftStore;
  let approval: ApprovalStore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    store = TestBed.inject(PolicyDraftStore);
    approval = TestBed.inject(ApprovalStore);
  });
  afterEach(() => vi.useRealTimers());

  /** The page on git-repo; `html` is its text, re-rendered. */
  const page = () => {
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    fixture.componentRef.setInput('service', GIT_REPO);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, b: fixture.componentInstance, el, render: () => fixture.detectChanges() };
  };

  /** The review panel, with its checks done. */
  const review = () => {
    TestBed.inject(DraftChecks).flush();
    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', GIT_REPO);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (sel: string) => el.querySelector<HTMLButtonElement>(sel);
    return { fixture, c: fixture.componentInstance, el, button, render: () => fixture.detectChanges() };
  };

  const edit = () => store.upsertUpdate(USERS_GITLAB, { name: 'users-gitlab-2' });

  it('review off behaves as today: Commit, no gate, no approval in History', () => {
    edit();
    const r = review();
    expect(clean(r.el.querySelector('.dr-actions .btn-primary'))).toBe('Commit 1 change');
    expect(r.button('.dr-submit')).toBeNull();
    r.el.querySelector<HTMLButtonElement>('.dr-actions .btn-primary')!.click();
    expect(store.ops()).toEqual([]);
    expect(store.history()[0]).toMatchObject({ actor: 'You' });
    expect(store.history()[0].approvedBy).toBeUndefined();
  });

  describe('with review required', () => {
    beforeEach(() => approval.setRequired(true));

    it("the author's Commit becomes Submit for review; commit itself is gated", () => {
      edit();
      const r = review();
      expect(clean(r.button('.dr-submit'))).toBe('Submit for review');
      expect(r.button('.dr-commit')).toBeNull();
      expect(() => store.commit()).toThrow(/Review is required/);
    });

    it('submitting locks the draft — store, canvas, editors, assist — with the banner; Withdraw unlocks it', () => {
      edit();
      const p = page();
      const r = review();
      r.button('.dr-submit')!.click();
      p.render();

      expect(approval.submitted()).toBe(true);
      expect(() => store.upsertUpdate(USERS_GITLAB, { name: 'x' })).toThrow(LOCK_MESSAGE);
      expect(() => store.discard()).toThrow(LOCK_MESSAGE);
      expect(clean(p.el.querySelector('.draft-submitted'))).toBe(`Submitted for review · You · ${formatDate(NOW, 'HH:mm', 'en-US')} · Withdraw`);
      p.b.edit(USERS_GITLAB);
      expect(p.b.editingId()).toBeNull();
      expect(p.el.querySelector('.add-rule')).toBeNull();
      expect(p.el.querySelector<HTMLButtonElement>('.ap-fab')!.disabled).toBe(true);
      expect(store.history()[0]).toMatchObject({ actor: 'You', review: 'submitted', changeLines: ['Submitted 1 change for review'] });

      p.el.querySelector<HTMLButtonElement>('.draft-withdraw')!.click();
      p.render();
      expect(approval.submission()).toBeNull();
      expect(store.lock()).toBeNull();
      expect(p.el.querySelector('.draft-submitted')).toBeNull();
      expect(p.el.querySelector('.add-rule')).not.toBeNull();
      edit(); // unlocked
    });

    it("the submitter can't approve", () => {
      edit();
      approval.submit();
      const r = review();
      expect(r.button('.dr-approve')!.disabled).toBe(true);
      expect(clean(r.el.querySelector('#dr-approve-blocked'))).toBe('You submitted this draft — someone else has to approve it');
      expect(r.button('.dr-request')).toBeNull();
      expect(() => approval.approve()).toThrow(/someone else/);
    });

    it("request changes unlocks the draft for the author and shows Dana's note in the draft bar", () => {
      edit();
      approval.submit();
      approval.viewer.set('reviewer');
      const r = review();
      r.el.querySelector<HTMLTextAreaElement>('#dr-review-note')!.value = 'Name it for the team, please';
      r.el.querySelector('#dr-review-note')!.dispatchEvent(new Event('input'));
      r.button('.dr-request')!.click();

      expect(store.lock()).toBeNull();
      expect(store.history()[0]).toMatchObject({ actor: 'Dana', review: 'changesRequested', changeLines: ['Requested changes: Name it for the team, please'] });
      approval.viewer.set('author');
      const p = page();
      expect(clean(p.el.querySelector('.draft-changes'))).toBe('Changes requested by Dana: “Name it for the team, please”');
      store.upsertUpdate(USERS_GITLAB, { name: 'gitlab-team' }); // editable again; the note stays
      p.render();
      expect(p.el.querySelector('.draft-changes')).not.toBeNull();
    });

    it('approve: "Approved by Dana · Commit"; the commit records the approval', () => {
      edit();
      approval.submit();
      approval.viewer.set('reviewer');
      const r = review();
      expect(r.button('.dr-approve')!.disabled).toBe(false);
      r.button('.dr-approve')!.click();
      expect(store.history()[0]).toMatchObject({ actor: 'Dana', review: 'approved', changeLines: ['Approved 1 change'] });

      approval.viewer.set('author');
      const p = page();
      expect(clean(p.el.querySelector('.draft-approved'))).toBe('Approved by Dana · Commit');
      p.el.querySelector<HTMLButtonElement>('.draft-commit-approved')!.click();
      expect(store.ops()).toEqual([]);
      expect(store.history()[0]).toMatchObject({ actor: 'You', approvedBy: 'Dana', changeLines: ['Updated users-gitlab: renamed to users-gitlab-2'] });

      const h = TestBed.createComponent(HistoryPanelComponent);
      h.detectChanges();
      const items = (h.nativeElement as HTMLElement).querySelectorAll('.hp-commit');
      expect(clean(items[0].querySelector('.hp-approval'))).toBe('Committed by You · approved by Dana');
      expect([...items].map((li) => clean(li.querySelector('.hp-summary')))).toEqual([
        'You · Updated users-gitlab: renamed to users-gitlab-2',
        'Dana · Approved 1 change',
        'You · Submitted 1 change for review',
      ]);
      expect(items[1].querySelector('.hp-revert')).toBeNull(); // review steps: nothing to revert
    });

    it('any change to the draft cancels the approval', () => {
      edit();
      approval.submit();
      approval.viewer.set('reviewer');
      approval.approve();
      expect(approval.approved()).not.toBeNull();
      store.upsertUpdate(USERS_GITLAB, { name: 'users-gitlab-3' });
      expect(approval.approved()).toBeNull();
      expect(() => store.commit()).toThrow(/Review is required/);
      store.upsertUpdate(USERS_GITLAB, { name: 'users-gitlab-2' }); // same content, still a new draft to review
      expect(approval.approved()).toBeNull();
    });

    it('a conflict blocks approve — and a new conflict cancels an approval', () => {
      const demo = TestBed.inject(DemoControls);
      edit();
      approval.submit();
      demo.run('adminEdit'); // Dana (admin) edits users-gitlab in live
      approval.viewer.set('reviewer');
      const r = review();
      expect(r.button('.dr-approve')!.disabled).toBe(true);
      expect(clean(r.el.querySelector('#dr-approve-blocked'))).toMatch(/resolve the conflicts first/);
      expect(() => approval.approve()).toThrow(/conflicts/);

      // Approved first, then a conflict: the approval lapses.
      approval.viewer.set('author');
      approval.withdraw();
      store.reapply(store.conflicts()[0].key, { identityRoles: 'theirs' });
      approval.submit();
      approval.viewer.set('reviewer');
      approval.approve();
      expect(approval.approved()).not.toBeNull();
      demo.run('adminEdit');
      expect(approval.approved()).toBeNull();
    });

    it('failing access tests block approve', () => {
      store.deletePolicy(USERS_GITLAB); // laptop-alice must connect to git-repo — fails
      approval.submit();
      approval.viewer.set('reviewer');
      const r = review();
      expect(r.button('.dr-approve')!.disabled).toBe(true);
      expect(r.c.approveBlocked()).toBe('Access tests fail — request changes instead');
    });
  });
});

describe('revert warning for expired access', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });
  afterEach(() => vi.useRealTimers());

  it('a revert restoring an expired policy warns that it will no longer expire, linking to its Expires control', () => {
    const store = TestBed.inject(PolicyDraftStore);
    store.upsertUpdate(USERS_GITLAB, { expiresAt: new Date(NOW.getTime() + HOUR).toISOString() });
    store.commit();
    TestBed.inject(DemoControls).run('clock'); // users-gitlab expires: deleted by Expiry
    store.startRevert(store.history()[0].id);

    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', GIT_REPO);
    const links: ReasonLink[] = [];
    fixture.componentInstance.openLink.subscribe((l) => links.push(l));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const when = new Date(NOW.getTime() + HOUR).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    expect(clean(el.querySelector('.dr-restore'))).toBe(
      `users-gitlab: Restores access that was time-limited (expired ${when}); it will no longer expire.`,
    );
    el.querySelector<HTMLButtonElement>('.dr-restore .dr-link')!.click();
    expect(links).toEqual([{ kind: 'policy', id: USERS_GITLAB, focus: 'expires' }]);

    // Setting a new expiry ends the warning.
    store.upsertUpdate(USERS_GITLAB, { expiresAt: new Date(NOW.getTime() + 3 * HOUR).toISOString() });
    fixture.detectChanges();
    expect(el.querySelector('.dr-restore')).toBeNull();
  });

  it("the link opens the policy's editor on its Expires control", async () => {
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    fixture.componentRef.setInput('service', GIT_REPO);
    fixture.detectChanges();
    fixture.componentInstance.openReasonLink({ kind: 'policy', id: USERS_GITLAB, focus: 'expires' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement?.id).toBe('pe-expires');
  });
});
