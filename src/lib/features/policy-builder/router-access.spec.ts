/**
 * Router policies as first-class entry points: a service's routing line ("Edit
 * routing"), a group card's ⋯ → Routers, and the identity lens's "Routers" open one
 * panel (routerAccess) listing the router policies behind them; adding to an existing
 * policy or creating one goes through the router-policy editor into the draft.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/router-access.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { routerAccess } from './draft/router-access';
import { PolicyBuilderComponent } from './policy-builder.component';

const text = (el: Element | null) => el?.textContent!.replace(/\s+/g, ' ').trim() ?? '';

describe('routerAccess', () => {
  const world = () => TestBed.inject(PolicyDraftStore).live();

  it('a service with no routing: nothing listed, a new SERP prefilled with @service, every SERP extendable', () => {
    const a = routerAccess(world(), { kind: 'service', serviceId: 'svc-008' })!;
    expect(a.title).toBe('Routing');
    expect(a.subtitle).toBe('reports-svc · no routing yet');
    expect(a.policies).toEqual([]);
    expect(a.create).toEqual({
      id: 'serp-draft-1', name: 'reports-svc-routing', semantic: 'AllOf', serviceRoles: ['@svc-008'], edgeRouterRoles: [],
    });
    expect(a.extensions.map((x) => x.id).sort()).toEqual(['serp-001', 'serp-002', 'serp-003', 'serp-004', 'serp-005', 'serp-006']);
    expect(a.extensions.every((x) => x.added.join() === '@svc-008')).toBe(true);
    expect(a.listTab).toBe('service-edge-router');
  });

  it('a covered service: its SERPs, their routers, and how each matches it', () => {
    const a = routerAccess(world(), { kind: 'service', serviceId: 'svc-005' })!;
    expect(a.policies.map((p) => [p.name, p.how, p.routers.map((r) => r.name).join(', ')])).toEqual([
      ['apis-public-routers', 'by #apis', 'edge-public-us-east-1, edge-public-us-east-2, edge-eu-west-1'],
    ]);
    expect(a.extensions.some((x) => x.id === 'serp-004')).toBe(false);
  });

  it('a named group extends any non-system ERP with @names; a rule group never narrows an all-of ERP', () => {
    const named = routerAccess(world(), { kind: 'group', serviceId: 'svc-004', groupId: 'bind:pol-005:named' })!;
    expect(named.policies.map((p) => [p.name, p.how, p.covers])).toEqual([['servers-public-routers', 'by #servers', 'its one member']]);
    expect(named.extensions.map((x) => [x.id, x.added])).toEqual([
      ['rp-001', ['@server-stage-01']], ['rp-002', ['@server-stage-01']], ['rp-004', ['@server-stage-01']],
    ]);
    expect(named.create).toMatchObject({ identityRoles: ['@server-stage-01'] });

    const rule = routerAccess(world(), { kind: 'group', serviceId: 'svc-004', groupId: 'dial:pol-002:rule' })!;
    expect(rule.policies.map((p) => [p.name, p.covers])).toEqual([
      ['users-public-routers', 'all 16 members'], ['admins-public-routers', '1 of 16 members'],
    ]);
    expect(rule.extensions).toEqual([]);
    expect(rule.extendNote).toContain('would narrow them');
    expect(rule.create).toMatchObject({ name: 'users-routers', semantic: 'AnyOf', identityRoles: ['#users'], edgeRouterRoles: [] });
  });

  it('a router identity: its system ERP is listed (read-only) and never offered as an extension', () => {
    const a = routerAccess(world(), { kind: 'identity', identityId: 'id-077' })!;
    expect(a.policies.map((p) => [p.name, p.system])).toEqual([['edge-router-er-001-system', true]]);
    expect(a.extensions.some((x) => x.id.startsWith('rp-sys-'))).toBe(false);
  });
});

describe('Routing / Routers panels in the policy builder', () => {
  const setup = (service: string) => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    fixture.componentRef.setInput('service', service);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(PolicyDraftStore);
    const button = (label: string) =>
      [...el.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? text(b)).includes(label));
    const click = (label: string) => {
      const b = button(label);
      expect(b, label).toBeTruthy();
      b!.click();
      fixture.detectChanges();
    };
    const type = (selector: string, value: string, key: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      input.dispatchEvent(new KeyboardEvent('keydown', { key }));
      fixture.detectChanges();
    };
    const review = () => {
      fixture.componentInstance.openReview();
      fixture.detectChanges();
      return [...el.querySelectorAll('.dr-changes li')].map(text);
    };
    return { fixture, el, store, button, click, type, review };
  };

  it('a service with no dialers yet (no gap): Edit routing → New SERP, prefilled with @service → in the draft and review', () => {
    const { el, store, button, click, type, review } = setup('svc-008');
    expect(el.querySelector('.routers-setup')).toBeNull(); // no gap to set up
    click('Edit routing for reports-svc');
    const panel = el.querySelector('app-router-access-panel')!;
    expect(text(panel.querySelector('h2'))).toBe('Routing');
    expect(text(panel)).toContain('No service edge router policy covers reports-svc yet');
    expect(panel.querySelector('a.ra-all')!.getAttribute('href')).toBe('/policies?tab=service-edge-router');

    click('New service edge router policy');
    const editor = el.querySelector('app-router-policy-editor')!;
    expect(text(editor.querySelector('h2'))).toBe('New service edge router policy');
    expect(text(editor.querySelector('.pe-side'))).toContain('reports-svc');
    expect(button('Add to draft')!.disabled).toBe(true); // no routers yet
    expect(text(editor)).toContain('Pick routers to add it.');

    type('#rpe-router-terms', '#public', 'Enter');
    click('Add to draft');
    expect(store.ops()).toEqual([{
      kind: 'create', target: 'serviceEdgeRouterPolicy',
      policy: { id: 'serp-draft-1', name: 'reports-svc-routing', semantic: 'AllOf', serviceRoles: ['@svc-008'], edgeRouterRoles: ['#public'] },
    }]);
    expect(review()).toEqual([expect.stringMatching(/^Created service routing: @reports-svc → #public/)]);
  });

  it('Edit routing → add the service to an existing SERP: the picker, the editor with @service marked, one update', () => {
    const { el, store, click, type } = setup('svc-008');
    click('Edit routing for reports-svc');
    type('#ra-extend', 'git-repo-public', 'Enter');
    const editor = el.querySelector('app-router-policy-editor')!;
    expect(text(editor.querySelector('h2'))).toBe('Edit service edge router policy');
    expect([...editor.querySelectorAll('.tag-chip.added')].map(text)).toEqual(['reports-svc (added by this fix)']);
    expect(store.ops()).toEqual([]);
    click('Add to draft');
    expect(store.ops()).toEqual([
      { kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: 'serp-003', patch: { serviceRoles: ['@svc-004', '@svc-008'] } },
    ]);
  });

  it('the existing-policy picker shows each policy\'s router rule, and finds them by it ("#public")', () => {
    const { fixture, el, click } = setup('svc-008');
    click('Edit routing for reports-svc');
    const input = el.querySelector('#ra-extend') as HTMLInputElement;
    input.value = '#public';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const row = (o: Element) => ['.sp-label', '.sp-attrs', '.sp-meta'].map((c) => text(o.querySelector(c))).join(' · ');
    expect([...el.querySelectorAll('.sp-option')].map(row)).toEqual([
      'git-repo-public-routers · #public · 3 routers',
      'tod-share-3 | service-edge-router | 0d7b2e64-91c5-4a3e-b8f0-5c6e2a9d1f47 · #public · 3 routers',
      'legacy-services-public-routers · #public · 3 routers',
      'apis-public-routers · #public · 3 routers',
    ]);
    input.value = 'edge-public-us-east-2';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect([...el.querySelectorAll('.sp-option')].map((o) => text(o.querySelector('.sp-label')))).toContain('offline-svc-east-2');
  });

  it('a group card ⋯ → Routers → add these identities to an existing ERP → in the draft and review', () => {
    const { fixture, el, store, click, type, review } = setup('svc-004');
    const card = el.querySelector('app-service-view-group[data-group-id="bind:pol-005:named"]')!;
    (card.querySelector('.g-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (card.querySelector('.g-menu-routers') as HTMLButtonElement).click();
    fixture.detectChanges();
    const panel = el.querySelector('app-router-access-panel')!;
    expect(text(panel.querySelector('h2'))).toBe('Routers');
    expect(text(panel.querySelector('.ra-subtitle'))).toBe('git-servers-host · 1 member on git-repo');
    expect([...panel.querySelectorAll('.ra-policy')].map((p) => text(p.querySelector('.ra-name')))).toEqual(['servers-public-routers']);
    expect(panel.querySelector('a.ra-all')!.getAttribute('href')).toBe('/policies?tab=edge-router');
    expect(text(panel)).toContain('Add these identities to an existing policy');
    expect(text(panel)).toContain('New edge router policy');

    type('#ra-extend', 'users-public', 'Enter');
    click('Add to draft');
    expect(store.ops()).toEqual([
      { kind: 'update', target: 'edgeRouterPolicy', policyId: 'rp-001', patch: { identityRoles: ['#users', '@server-stage-01'] } },
    ]);
    expect(review()).toEqual([expect.stringMatching(/^Updated users-public-routers \(router access\): .*server-stage-01/)]);
  });

  it('the identity lens: Routers opens its ERPs; a system policy opens read-only', () => {
    const { fixture, el, click } = setup('svc-004');
    fixture.componentRef.setInput('identity', 'id-077');
    fixture.detectChanges();
    click('Routers for edge-public-us-east-1');
    const panel = el.querySelector('app-router-access-panel')!;
    expect(text(panel.querySelector('.ra-subtitle'))).toBe('edge-public-us-east-1');
    expect(text(panel)).toContain('Add this identity to an existing policy');
    click('View system policy edge-router-er-001-system');
    expect(text(el.querySelector('app-router-policy-editor h2'))).toBe('System edge router policy');
  });

  it('a draft submitted for review: no Edit routing, no Routers', () => {
    const { fixture, el, store, button } = setup('svc-004');
    store.setLock('submitted');
    fixture.detectChanges();
    expect(el.querySelector('.routers-edit')).toBeNull();
    expect(button('Edit routing')).toBeUndefined();
  });
});
