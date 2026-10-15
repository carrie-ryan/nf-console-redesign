/**
 * Policies page tabs: service policies, edge router policies and service edge router
 * policies from live, with search and an attribute filter; Edit opens a policy in the
 * policy builder's editor, in the draft.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policies/policies.component.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { PoliciesComponent } from './policies.component';
import { PolicyBuilderComponent } from '../policy-builder/policy-builder.component';
import { PolicyDraftStore } from '../policy-builder/draft/policy-draft.store';

const text = (el: Element | null) => el?.textContent!.replace(/\s+/g, ' ').trim() ?? '';

describe('PoliciesComponent — tabs', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  const page = (tab?: string) => {
    const fixture = TestBed.createComponent(PoliciesComponent);
    fixture.componentRef.setInput('tab', tab);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => [...el.querySelectorAll('tbody .truncated-value')].map(text);
    return { fixture, el, names };
  };

  /** The builder, as the URL Edit navigated to would open it. */
  const builderAt = (queryParams: Record<string, string | null>) => {
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    for (const [k, v] of Object.entries(queryParams)) if (v) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  };

  const openRowMenu = (fixture: ReturnType<typeof page>['fixture'], name: string) => {
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click();
    fixture.detectChanges();
    return el.querySelector('.dropdown-menu .dropdown-item') as HTMLButtonElement;
  };

  it('three tabs, deep-linkable; each lists its live policies', () => {
    const svc = page();
    expect([...svc.el.querySelectorAll('[role="tab"]')].map(text)).toEqual([
      'Service Policies', 'Edge Router Policies', 'Service Edge Router Policies',
    ]);
    expect(text(svc.el.querySelector('.tab-btn--active'))).toBe('Service Policies');
    expect(svc.names()).toContain('users-gitlab');

    const erp = page('edge-router');
    expect(text(erp.el.querySelector('.tab-btn--active'))).toBe('Edge Router Policies');
    expect(erp.names()).toEqual([
      'users-public-routers', 'edge-us-east', 'servers-public-routers', 'admins-public-routers',
      'edge-router-er-001-system', 'edge-router-er-003-system',
    ]);
    expect([...erp.el.querySelectorAll('thead th')].map(text)).toEqual(['Name', 'Semantic', 'Identity roles', 'Router roles', 'Created At', '']);

    const serp = page('service-edge-router');
    expect(serp.names()).toContain('git-repo-public-routers');
    expect([...serp.el.querySelectorAll('thead th')].map(text)).toEqual(['Name', 'Semantic', 'Service roles', 'Router roles', '']);
  });

  it('search by name and filter by attribute (either side)', () => {
    const { fixture, el, names } = page('service-edge-router');
    const input = el.querySelector('.filter-input') as HTMLInputElement;
    input.value = 'git';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(names()).toEqual(['git-repo-public-routers']);
    expect(text(el.querySelector('.pagination-info'))).toBe('1 of 6');

    input.value = '';
    input.dispatchEvent(new Event('input'));
    const select = el.querySelector('.filter-select') as HTMLSelectElement;
    select.value = '#hq';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(names()).toEqual(['postgres-hq-router']);
  });

  it('system ERPs carry the lock; their row offers View, which opens the editor read-only', () => {
    const { fixture, el } = page('edge-router');
    const rows = [...el.querySelectorAll('tbody tr')];
    const locked = rows.filter((r) => r.querySelector('.system-tag')).map((r) => text(r.querySelector('.truncated-value')));
    expect(locked).toEqual(['edge-router-er-001-system', 'edge-router-er-003-system']);

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const item = openRowMenu(fixture, 'edge-router-er-001-system');
    expect(text(item)).toBe('View');
    item.click();
    const [, extras] = navigate.mock.calls[0] as [unknown, { queryParams: Record<string, string | null> }];
    // Its router identity dials and hosts nothing: no service fits, so the builder's service list.
    expect(extras.queryParams).toEqual({ service: null, erp: 'rp-sys-er-001' });

    const builder = builderAt(extras.queryParams);
    const editor = (builder.nativeElement as HTMLElement).querySelector('app-router-policy-editor')!;
    expect(text(editor.querySelector('h2'))).toBe('System edge router policy');
    expect(editor.querySelector('.pe-delete')).toBeNull();
  });

  it('a SERP created in the builder and committed is listed in its tab; Edit opens it in the builder editor, in the draft', () => {
    // Create it in the builder: Edit routing → New service edge router policy → #public → Add to draft → commit.
    const b = builderAt({ service: 'svc-008' });
    const bel = b.nativeElement as HTMLElement;
    const click = (label: string) => {
      [...bel.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? text(x)).includes(label))!.click();
      b.detectChanges();
    };
    click('Edit routing for reports-svc');
    click('New service edge router policy');
    const terms = bel.querySelector('#rpe-router-terms') as HTMLInputElement;
    terms.value = '#public';
    terms.dispatchEvent(new Event('input'));
    terms.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    b.detectChanges();
    click('Add to draft');
    const store = TestBed.inject(PolicyDraftStore);
    store.commit();
    expect(store.ops()).toEqual([]);
    b.destroy();

    const { fixture, names } = page('service-edge-router');
    expect(names()).toContain('reports-svc-routing');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const item = openRowMenu(fixture, 'reports-svc-routing');
    expect(text(item)).toBe('Edit');
    item.click();
    const [commands, extras] = navigate.mock.calls[0] as [unknown, { queryParams: Record<string, string | null> }];
    expect(commands).toEqual(['/policy-builder']);
    expect(extras.queryParams).toEqual({ service: 'svc-008', serp: 'serp-draft-1' });

    const builder = builderAt(extras.queryParams);
    const el = builder.nativeElement as HTMLElement;
    const editor = el.querySelector('app-router-policy-editor')!;
    expect(text(editor.querySelector('h2'))).toBe('Edit service edge router policy');
    expect((editor.querySelector('#rpe-name') as HTMLInputElement).value).toBe('reports-svc-routing');
    // Edits go to the draft.
    [...editor.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Remove #public')!.click();
    builder.detectChanges();
    expect(store.ops()).toEqual([
      { kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: 'serp-draft-1', patch: { edgeRouterRoles: [] } },
    ]);
  });

  it('an ERP opens on a service its identities may dial or host', () => {
    const { fixture } = page('edge-router');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    openRowMenu(fixture, 'users-public-routers').click();
    expect(navigate.mock.calls[0][1]).toEqual({ queryParams: { service: 'svc-004', erp: 'rp-001' } });
  });

  it('a service policy still opens on the services it covers', () => {
    const { fixture } = page();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    openRowMenu(fixture, 'users-gitlab').click();
    expect(navigate.mock.calls[0][1]).toEqual({ queryParams: { service: 'svc-004', with: 'svc-006,svc-007', policy: 'pol-002' } });
  });
});
