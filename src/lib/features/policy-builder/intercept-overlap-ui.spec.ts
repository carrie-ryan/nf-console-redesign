/**
 * Intercept overlaps in the UI: the review's warning (new conflicts only, one per
 * service pair, naming the Dial policy), the editor's box while editing that Dial rule,
 * the service node's badge and panel, and the identity lens markers.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/intercept-overlap-ui.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DraftReviewComponent } from './draft-review.component';
import { DraftChecks } from './draft/draft-checks';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { IdentityViewComponent } from './identity-view.component';
import { PolicyEditorComponent } from './policy-editor.component';
import { ServiceViewComponent } from './service-view.component';
import type { ReasonLink } from './access-tests';

const WARNING =
  'alice@corp.com, bob@corp.com and carol@corp.com can now dial both api-prod and reports-svc, whose intercepts overlap on ' +
  "api-prod.corp.internal:443/tcp. Their tunnellers can't tell which service a connection means.";

describe('intercept overlaps in the UI', () => {
  let store: PolicyDraftStore;

  beforeEach(() => {
    // jsdom has no ResizeObserver; the service view only uses it to re-measure edges.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    TestBed.configureTestingModule({
      imports: [DraftReviewComponent, PolicyEditorComponent, ServiceViewComponent, IdentityViewComponent],
      providers: [provideRouter([])],
    });
    store = TestBed.inject(PolicyDraftStore);
    store.addOp({ kind: 'create', policy: {
      id: 'pol-admins-reports', name: 'admins-reports', createdAt: '2026-10-09T00:00:00Z', status: 'active', type: 'dial',
      semantic: 'AnyOf', identityRoles: ['#admins'], serviceRoles: ['@svc-008'], postureCheckRoles: [] } });
  });

  const review = () => {
    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-008');
    TestBed.inject(DraftChecks).flush();
    fixture.detectChanges();
    return fixture;
  };
  const serviceView = () => {
    const fixture = TestBed.createComponent(ServiceViewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-008');
    fixture.detectChanges();
    return fixture;
  };
  const lens = () => {
    const fixture = TestBed.createComponent(IdentityViewComponent);
    fixture.componentRef.setInput('identityId', 'id-004'); // alice@corp.com
    fixture.detectChanges();
    return fixture;
  };

  it('review: exactly one warning, naming the three admins and linking the policy; commit stays open', () => {
    const fixture = review();
    const el = fixture.nativeElement as HTMLElement;
    const warns = el.querySelectorAll('.dr-overlap');
    expect(warns).toHaveLength(1);
    expect(warns[0].closest('section')!.querySelector('h3')!.textContent).toBe('Warnings');
    expect(warns[0].textContent).toBe(`${WARNING} Granted by admins-reports.`);
    const links: ReasonLink[] = [];
    fixture.componentInstance.openLink.subscribe((l) => links.push(l));
    warns[0].querySelector<HTMLButtonElement>('.tr-link')!.click();
    expect(links).toEqual([{ kind: 'policy', id: 'pol-admins-reports' }]);
    expect([...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Commit'))!.disabled).toBe(false);
  });

  it('editor: the same warning while editing the Dial rule', () => {
    const fixture = TestBed.createComponent(PolicyEditorComponent);
    fixture.componentRef.setInput('policyId', 'pol-admins-reports');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.pe-overlap li')!.textContent).toBe(WARNING);
  });

  it('service node: an amber badge opening the identities, other service, address and policies', () => {
    const fixture = serviceView();
    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector<HTMLButtonElement>('.overlap-badge')!;
    expect(badge.textContent!.trim()).toBe('Overlaps with api-prod · 3 identities');
    badge.click();
    fixture.detectChanges();
    const panel = el.querySelector('.overlap-panel')!;
    expect([...panel.querySelectorAll('.overlap-ids li')].map((li) => li.textContent)).toEqual(['alice@corp.com', 'bob@corp.com', 'carol@corp.com']);
    const facts = [...panel.querySelectorAll('.overlap-facts div')].map((d) =>
      [...d.children].map((x) => x.textContent!.replace(/\s+/g, ' ').trim()).join(': '),
    );
    expect(facts).toEqual([
      'Other service: api-prod',
      'Shared: api-prod.corp.internal:443/tcp',
      'reports-svc via: admins-reports',
      'api-prod via: admins-dev-access',
    ]);
    let edited: string | undefined;
    fixture.componentInstance.editPolicy.subscribe((id) => (edited = id));
    panel.querySelector<HTMLButtonElement>('.r-via-link')!.click();
    expect(edited).toBe('pol-admins-reports');
  });

  it("alice's lens marks both services", () => {
    const el = lens().nativeElement as HTMLElement;
    const marked = [...el.querySelectorAll('.iv-row')]
      .filter((r) => r.querySelector('.iv-overlap'))
      .map((r) => `${r.querySelector('.iv-svc')!.textContent} ${r.querySelector('.iv-overlap')!.textContent!.trim()}`);
    expect(marked).toEqual(['api-prod overlaps with reports-svc', 'reports-svc overlaps with api-prod']);
  });

  it('removing the policy clears the warning, the badge and the markers', () => {
    store.deletePolicy('pol-admins-reports');
    expect(store.ops()).toEqual([]);
    expect((review().nativeElement as HTMLElement).querySelector('.dr-overlap')).toBeNull();
    expect((serviceView().nativeElement as HTMLElement).querySelector('.overlap-badge')).toBeNull();
    expect((lens().nativeElement as HTMLElement).querySelector('.iv-overlap')).toBeNull();
  });
});
