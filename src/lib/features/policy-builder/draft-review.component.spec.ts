/**
 * DraftReviewComponent: review → one-click commit, and live moving underneath the
 * draft (a conflict) blocking commit and keeping the draft.
 */

import { TestBed } from '@angular/core/testing';
import { MockDataService } from '../../shared/services/mock-data.service';
import { DraftReviewComponent } from './draft-review.component';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { DraftChecks } from './draft/draft-checks';

describe('DraftReviewComponent', () => {
  let store: PolicyDraftStore;
  let data: MockDataService;

  const render = () => {
    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-004');
    TestBed.inject(DraftChecks).flush(); // the review's checks, run to completion now
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (text: string) => {
      const btn = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes(text))!;
      btn.click();
      fixture.detectChanges();
    };
    return { fixture, el, click };
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DraftReviewComponent] });
    store = TestBed.inject(PolicyDraftStore);
    data = TestBed.inject(MockDataService);
    store.upsertUpdate('pol-002', { semantic: 'AllOf', identityRoles: ['#users', '#laptops'] });
  });

  it('lists the change and its effects; one Commit click writes it to live', () => {
    const { fixture, el, click } = render();
    let committed: number | undefined;
    fixture.componentInstance.committed.subscribe((n) => (committed = n));

    expect(el.textContent).toContain('Updated users-gitlab: match all of; added #laptops');
    expect(el.textContent).toContain('This draft also affects 2 other services.');
    expect(el.querySelectorAll('.dr-row')).toHaveLength(3);

    expect(el.querySelectorAll('button.btn-primary')).toHaveLength(1);
    click('Commit 1 change');
    expect(committed).toBe(1);
    expect(store.ops()).toEqual([]);
    expect(data.policies().find((p) => p.id === 'pol-002')!.identityRoles).toEqual(['#users', '#laptops']);
  });

  it('live moving underneath the draft blocks commit: a conflict card, the draft kept', () => {
    const { fixture, el } = render();
    // Live moves underneath the draft: the updated policy disappears.
    data.policies.update((ps) => ps.filter((p) => p.id !== 'pol-002'));
    const ops = store.ops();
    fixture.detectChanges();

    expect(el.querySelector('.dr-cf-title')!.textContent).toBe('users-gitlab changed in live since you started editing it');
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.includes(text))!;
    expect(button('Commit 1 change').disabled).toBe(true);
    expect(button('Reapply').disabled).toBe(true); // gone from live: only dropping applies
    expect(() => store.commit()).toThrow(/users-gitlab changed in live/);
    expect(store.ops()).toBe(ops);
    expect(data.policies().some((p) => p.id === 'pol-002')).toBe(false);
  });
});
