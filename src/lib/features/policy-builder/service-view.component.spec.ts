/**
 * ServiceViewComponent empty states: a blank service is neutral ("Not set up yet",
 * dashed empty lanes); dialers without a host get the yellow warning and the red verdict.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/service-view.component.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { COMPACT_AFTER, ServiceViewComponent } from './service-view.component';
import { layoutServiceView } from './service-view.layout';
import { buildScaleWorld } from '../authorization/scale-world';
import { MockDataService } from '../../shared/services/mock-data.service';

const APP_API_PROD = 'svc-002';

describe('ServiceViewComponent — empty states', () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver; the view only uses it to re-measure edges.
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  });

  beforeEach(() => TestBed.configureTestingModule({ imports: [ServiceViewComponent], providers: [provideRouter([])] }));

  const render = () => {
    const fixture = TestBed.createComponent(ServiceViewComponent);
    fixture.componentRef.setInput('serviceId', APP_API_PROD);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = (s: string) => el.querySelector(s);
    return { fixture, q };
  };

  it('blank service: neutral Bind and Dial empty states, "Not set up yet" in grey', () => {
    const { q } = render();
    expect(q('.lane-bind .no-host')).toBeNull();
    expect(q('.lane-bind .empty')!.textContent).toContain('Hosts: no one');
    expect(q('.lane-dial .empty')!.textContent).toContain('Can dial: no one');
    const verdict = q('.verdict')!;
    expect(verdict.textContent!.trim()).toBe('Not set up yet');
    expect([verdict.classList.contains('verdict-blank'), verdict.classList.contains('verdict-none')]).toEqual([true, false]);
  });

  it('dialers without a host: the yellow warning, and the red "no host" verdict', () => {
    TestBed.inject(PolicyDraftStore).addOp({ kind: 'create', policy: {
      id: 'pol-draft-t', name: 'users-dial-api', createdAt: '2026-10-01T00:00:00Z', status: 'active', type: 'dial',
      semantic: 'AnyOf', identityRoles: ['#users'], serviceRoles: ['@svc-002'], postureCheckRoles: [] } });
    const { q } = render();
    expect(q('.lane-bind .no-host')!.textContent).toContain('No identity is authorized to host this service');
    const verdict = q('.verdict')!;
    expect(verdict.textContent!.trim()).toBe('No one can connect · no host');
    expect([verdict.classList.contains('verdict-blank'), verdict.classList.contains('verdict-none')]).toEqual([false, true]);
  });
});

describe('ServiceViewComponent — draft-marked groups say "after this draft"', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ServiceViewComponent], providers: [provideRouter([])] }));

  it('a new rule\'s status chips and aria-label say "after this draft"; a live group\'s don\'t', () => {
    TestBed.inject(PolicyDraftStore).addOp({ kind: 'create', policy: {
      id: 'pol-draft-1', name: 'new-dial-rule-1', createdAt: '2026-10-08T00:00:00Z', status: 'active', type: 'dial',
      semantic: 'AnyOf', identityRoles: ['#admins'], serviceRoles: ['@svc-004'], postureCheckRoles: ['#edr-required'] } });
    const fixture = TestBed.createComponent(ServiceViewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-004');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const group = (id: string) => el.querySelector(`app-service-view-group[data-group-id="${id}"]`)!;

    const drafted = group('dial:pol-draft-1:rule');
    expect(drafted.getAttribute('aria-label')).toContain('after this draft');
    const titles = [...drafted.querySelectorAll('.status [title]')].map((e) => e.getAttribute('title'));
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((t) => t!.endsWith(' after this draft'))).toBe(true);

    const live = group('dial:pol-002:rule');
    expect(live.getAttribute('aria-label')).not.toContain('after this draft');
    expect(live.querySelectorAll('.status [title]').length).toBe(0);
  });
});


describe('ServiceViewComponent — at scale (a lane with more than 8 groups)', () => {
  beforeAll(() => {
    // jsdom has no CSS.escape; the edge measurement uses it for attribute chips.
    (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (s: string) => s.replace(/["\\]/g, '\\$&');
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  });

  /** A small scale world in the mock data; the first service with a compact Dial lane. */
  const setup = () => {
    TestBed.configureTestingModule({ imports: [ServiceViewComponent], providers: [provideRouter([])] });
    const w = buildScaleWorld(1, { identities: 400, services: 20 });
    const data = TestBed.inject(MockDataService);
    data.identities.set([...w.identities]);
    data.services.set([...w.services]);
    data.edgeRouters.set([...w.edgeRouters]);
    data.policies.set([...w.policies]);
    data.edgeRouterPolicies.set([...w.edgeRouterPolicies]);
    data.serviceEdgeRouterPolicies.set([...w.serviceEdgeRouterPolicies]);
    data.terminators.set([...(w.terminators ?? [])]);
    data.postureChecks.set([...(w.postureChecks ?? [])]);
    data.postureResults.set([...(w.postureResults ?? [])]);
    const live = TestBed.inject(PolicyDraftStore).live();
    const serviceId = live.services.map((s) => s.id).find((id) => layoutServiceView(id, live).dial.groups.length > COMPACT_AFTER)!;
    const fixture = TestBed.createComponent(ServiceViewComponent);
    fixture.componentRef.setInput('serviceId', serviceId);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, cmp: fixture.componentInstance, view: layoutServiceView(serviceId, live) };
  };

  beforeEach(() => localStorage.clear());

  it('a compact lane: one row per group, no group nodes, no edges at rest; the header total is unchanged', () => {
    const { el, view } = setup();
    expect(el.querySelectorAll('.lane-dial .c-row')).toHaveLength(view.dial.groups.length);
    expect(el.querySelectorAll('.lane-dial app-service-view-group')).toHaveLength(0);
    expect(el.querySelector('.lane-dial .c-count')!.textContent!.trim()).toBe(`${view.dial.groups.length} groups`);
    expect(el.querySelectorAll('path.edge')).toHaveLength(0);
    expect(el.querySelector('.lane-dial .lane-total')!.textContent).toBe(`${view.dial.total} identities can dial`);
    // A row: name, kind tag, summary and member count, and its aria-label says it expands.
    const row = el.querySelector('.lane-dial .c-row')!;
    expect(row.querySelector('.c-name')!.textContent).toMatch(/policy/);
    expect(row.querySelector('.c-tag')!.textContent).toMatch(/^(named|any of|all of)$/);
    expect(row.querySelector('.c-members')!.textContent).toMatch(/members?$/);
    expect(row.getAttribute('aria-label')).toMatch(/ — expand$/);
  });

  it('policies with a problem come first; a policy\'s groups stay adjacent', () => {
    const { cmp } = setup();
    const rows = cmp.compactRows().dial;
    const policies = [...new Set(rows.map((r) => r.policyId))];
    // Adjacent: each policy's rows form one run.
    const runs = rows.filter((r, i) => i === 0 || rows[i - 1].policyId !== r.policyId).map((r) => r.policyId);
    expect(runs).toEqual(policies);
    const hasProblem = policies.map((p) => rows.some((r) => r.policyId === p && r.problem));
    expect(hasProblem.some(Boolean)).toBe(true);
    expect(hasProblem).toEqual([...hasProblem].sort((a, b) => Number(b) - Number(a))); // trues, then falses
  });

  it('the filter narrows by policy name, attribute or member name', () => {
    const { fixture, el, cmp, view } = setup();
    const g = view.dial.groups.find((x) => x.kind === 'rule')!;
    const type = (text: string) => {
      const input = el.querySelector<HTMLInputElement>('.lane-dial .c-filter-input')!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      return [...el.querySelectorAll('.lane-dial .c-row')].map((r) => r.getAttribute('data-group-id'));
    };
    expect(type(g.policyName)).toContain(g.id);
    expect(type(g.rule!.terms[0])).toContain(g.id);
    // A member name (any case): exactly the groups with that member, in row order.
    const member = g.memberNames[0];
    const withMember = new Set(view.dial.groups.filter((x) => x.memberNames.includes(member)).map((x) => x.id));
    expect(type(member.toUpperCase())).toEqual(cmp.compactRows().dial.filter((r) => withMember.has(r.id)).map((r) => r.id));
    expect(type('no-such-thing')).toEqual([]);
    expect(el.querySelector('.lane-dial .c-none')!.textContent).toContain('No groups match');
    expect(el.querySelector('.lane-dial .c-count')!.textContent!.trim()).toBe(`0 of ${view.dial.groups.length} groups`);
  });

  it('a row expands in place to the full group node, several at once, and collapses back', () => {
    const { fixture, el } = setup();
    const [a, b] = [...el.querySelectorAll<HTMLElement>('.lane-dial .c-row')].map((r) => r.getAttribute('data-group-id')!);
    const click = (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      fixture.detectChanges();
    };
    click(`.c-row[data-group-id="${a}"]`);
    click(`.c-row[data-group-id="${b}"]`);
    expect([...el.querySelectorAll('.lane-dial .c-open app-service-view-group')].map((n) => n.getAttribute('data-group-id'))).toEqual([a, b]);
    click(`.c-open[data-open-id="${a}"] .c-collapse`);
    expect(el.querySelector(`.c-row[data-group-id="${a}"]`)).not.toBeNull();
    expect(el.querySelectorAll('.lane-dial .c-open')).toHaveLength(1);
  });

  it('edges are drawn only for an isolation: a hovered or focused row, or the policy in the editor', async () => {
    const { fixture, cmp } = setup();
    await fixture.whenStable();
    expect(cmp.edges().length).toBeGreaterThan(0); // measured…
    expect(cmp.shownEdges()).toEqual([]); // …but hidden at rest
    const row = cmp.compactRows().dial[0];
    cmp.focusIn({ kind: 'group', id: row.id });
    expect(cmp.shownEdges().map((e) => e.groupId)).toEqual(cmp.edges().filter((e) => e.groupId === row.id).map((e) => e.groupId));
    expect(cmp.shownEdges().length).toBeGreaterThan(0);
    cmp.spot.set(null);
    fixture.componentRef.setInput('selectedPolicyId', row.policyId);
    expect(cmp.shownEdges().every((e) => e.policyId === row.policyId)).toBe(true);
    expect(cmp.shownEdges().length).toBeGreaterThan(0);
  });

  it('the hint shows once per browser, and a hovered policy retires it', () => {
    let { fixture, el, cmp } = setup();
    expect(el.querySelector('.hover-hint')!.textContent).toContain('Hover a policy to see its connections');
    expect(localStorage.getItem('nf.policyBuilder.hoverHintShown')).toBe('1');
    cmp.focusIn({ kind: 'group', id: cmp.compactRows().dial[0].id });
    fixture.detectChanges();
    expect(el.querySelector('.hover-hint')).toBeNull();
    TestBed.resetTestingModule();
    ({ fixture, el } = setup());
    expect(el.querySelector('.hover-hint')).toBeNull(); // shown before
  });

  it('below the threshold nothing changes: the seed service has nodes, edges and no hint', () => {
    TestBed.configureTestingModule({ imports: [ServiceViewComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ServiceViewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-004');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.compact()).toBe(false);
    expect(el.querySelectorAll('.c-row, .c-filter, .hover-hint')).toHaveLength(0);
    expect(el.querySelectorAll('app-service-view-group').length).toBeGreaterThan(0);
  });
});

describe('ServiceViewComponent — "+N more" opens the member drawer, never expands inline', () => {
  it('users-gitlab on git-repo: the click emits openMembers; the node still lists 3 names', () => {
    TestBed.configureTestingModule({ imports: [ServiceViewComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ServiceViewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-004');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const opened: string[] = [];
    fixture.componentInstance.openMembers.subscribe((id) => opened.push(id));
    const node = el.querySelector('app-service-view-group[data-group-id="dial:pol-002:rule"]')!;
    const more = node.querySelector<HTMLButtonElement>('.more')!;
    expect(more.textContent!.trim()).toBe('+13 more');
    more.click();
    fixture.detectChanges();
    expect(opened).toEqual(['dial:pol-002:rule']);
    expect(node.querySelectorAll('.members .member-link')).toHaveLength(3);
    expect(node.querySelector('.more')!.textContent!.trim()).toBe('+13 more');
  });
});
