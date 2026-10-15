/**
 * RouterPolicyEditorComponent: a fix under review (a new suggestion, or an existing
 * policy with entries added) reaches the draft only on "Add to draft"; an existing
 * policy is edited and deleted with its target.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/router-policy-editor.component.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import type { EdgeRouterPolicy } from '../../shared/services/mock-data.service';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { RouterPolicyEditorComponent, type RouterTarget } from './router-policy-editor.component';

const suggestion: EdgeRouterPolicy = {
  id: 'rp-draft-1', name: 'kiosks-public-routers', createdAt: '2026-10-08T00:00:00Z', status: 'active',
  semantic: 'AnyOf', identityRoles: ['#kiosks'], edgeRouterRoles: ['#public'],
};

describe('RouterPolicyEditorComponent', () => {
  let store: PolicyDraftStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RouterPolicyEditorComponent] });
    store = TestBed.inject(PolicyDraftStore);
  });

  const render = (target: RouterTarget, policyId: string, pending: EdgeRouterPolicy | null = null) => {
    const fixture = TestBed.createComponent(RouterPolicyEditorComponent);
    fixture.componentRef.setInput('target', target);
    fixture.componentRef.setInput('policyId', policyId);
    fixture.componentRef.setInput('pending', pending);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (text: string) => {
      [...el.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent!).includes(text))!.click();
      fixture.detectChanges();
    };
    return { fixture, el, click };
  };

  it('a new suggestion: its live counts, nothing in the draft until Add to draft', () => {
    const { el, click } = render('edgeRouterPolicy', suggestion.id, suggestion);
    expect(el.querySelector('h2')!.textContent).toContain('New edge router policy');
    expect((el.querySelector('#rpe-name') as HTMLInputElement).value).toBe('kiosks-public-routers');
    expect(el.textContent).toContain('6 identities match');
    expect(el.textContent).toContain('3 routers match');
    expect(el.textContent).toContain('Applies to both sides. Named entries are always included.');
    expect(el.textContent).not.toContain('Delete policy');
    click('Add to draft');
    expect(store.ops()).toEqual([{ kind: 'create', target: 'edgeRouterPolicy', policy: suggestion }]);
    expect(el.querySelector('h2')!.textContent).toContain('Edit edge router policy');
    expect(el.textContent).toContain('Delete policy');
  });

  it('a new suggestion: edits stay local; Cancel leaves the draft untouched', () => {
    const { fixture, el, click } = render('edgeRouterPolicy', suggestion.id, suggestion);
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    const name = el.querySelector('#rpe-name') as HTMLInputElement;
    name.value = 'kiosk-routers';
    name.dispatchEvent(new Event('input'));
    click('Remove #public');
    expect(store.ops()).toEqual([]);
    expect(el.textContent).toContain('0 routers match');
    click('Cancel');
    expect([closed, store.ops()]).toEqual([true, []]);
  });

  it('an existing policy with a fix under review: the added entry is highlighted; Add to draft is one update', () => {
    const serp = store.live().serviceEdgeRouterPolicies.find((p) => p.id === 'serp-003')!;
    const fixture = TestBed.createComponent(RouterPolicyEditorComponent);
    fixture.componentRef.setInput('target', 'serviceEdgeRouterPolicy');
    fixture.componentRef.setInput('policyId', 'serp-003');
    fixture.componentRef.setInput('pending', { ...serp, serviceRoles: ['@svc-004', '@svc-007'] });
    fixture.componentRef.setInput('pendingKind', 'update');
    fixture.componentRef.setInput('highlight', ['@svc-007']);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h2')!.textContent).toContain('Edit service edge router policy');
    expect([...el.querySelectorAll('.tag-chip.added')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'no-serp-svc (added by this fix)',
    ]);
    expect(store.ops()).toEqual([]);
    [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Add to draft'))!.click();
    fixture.detectChanges();
    expect(store.ops()).toEqual([{
      kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: 'serp-003', patch: { serviceRoles: ['@svc-004', '@svc-007'] },
    }]);
    expect(el.querySelectorAll('.tag-chip.added')).toHaveLength(0);
  });

  it('existing SERP: Services and Routers sides; an edit is an update, Delete a delete, both with the target', () => {
    const { el, click } = render('serviceEdgeRouterPolicy', 'serp-003');
    expect([...el.querySelectorAll('h3')].map((h) => h.textContent!.trim())).toEqual(['Services', 'Routers']);
    expect(el.textContent).toContain('1 service matches: git-repo');
    click('Remove git-repo');
    expect(store.ops()).toEqual([{ kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: 'serp-003', patch: { serviceRoles: [] } }]);
    click('Delete policy');
    expect(store.ops()).toEqual([{ kind: 'delete', target: 'serviceEdgeRouterPolicy', policyId: 'serp-003' }]);
  });
});
