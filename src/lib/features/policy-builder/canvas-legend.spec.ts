/**
 * The canvas legend card: present-only listing ("Show all" for everything), hover /
 * focus isolating what carries an entry, the "Show on canvas" layers (hidden everywhere,
 * persisted), the collapsed state (persisted), where the card sits — and, with several
 * services, the service card's "⋯" menu.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/canvas-legend.spec.ts`
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CANVAS_KEY } from './canvas-layers';
import { LEGEND_ENTRIES } from './canvas-legend';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { PolicyBuilderComponent } from './policy-builder.component';
import { ServiceViewComponent } from './service-view.component';

const GIT_REPO = 'svc-004';
const APP_API_PROD = 'svc-002'; // blank: no Bind, no Dial
const FOUR = ['svc-005', 'svc-006', 'svc-007']; // with git-repo: green, amber and red edges

describe('canvas legend', () => {
  beforeAll(() => {
    (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (s: string) => s.replace(/["\\]/g, '\\$&');
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [ServiceViewComponent], providers: [provideRouter([])] });
  });

  const render = (serviceId = GIT_REPO, withIds: string[] = []) => {
    const fixture: ComponentFixture<ServiceViewComponent> = TestBed.createComponent(ServiceViewComponent);
    fixture.componentRef.setInput('serviceId', serviceId);
    fixture.componentRef.setInput('withIds', withIds);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const listed = () => [...el.querySelectorAll<HTMLElement>('.lg-entry')].map((e) => e.dataset['entry']);
    const entry = (id: string) => el.querySelector<HTMLElement>(`.lg-entry[data-entry="${id}"]`)!;
    const toggle = (layer: string) => {
      el.querySelector<HTMLInputElement>(`.lg-switch[data-layer="${layer}"] input`)!.click();
      fixture.detectChanges();
    };
    return { fixture, cmp: fixture.componentInstance, el, listed, entry, toggle, render: () => fixture.detectChanges() };
  };

  /** A fresh page (a new module), as after a reload — localStorage is kept. */
  const reload = (serviceId = GIT_REPO) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [ServiceViewComponent], providers: [provideRouter([])] });
    return render(serviceId);
  };

  const saved = () => JSON.parse(localStorage.getItem(CANVAS_KEY) ?? '{}');

  it('lists only entries present on the canvas, by section; "Show all" lists every one', () => {
    const v = render();
    const present = v.listed();
    // git-repo alone: green edges, a rule and named groups, a container, a posture check
    // with blocked and bypassed members, a serving host, the attribute chip, routing…
    expect(present).toEqual(expect.arrayContaining(['line-ok', 'verdict-ok', 'card-rule', 'card-named', 'card-box', 'card-check',
      'card-blocked', 'card-bypass', 'host-serving', 'host-edit', 'svc-attr', 'svc-hosting', 'svc-routing']));
    // …and nothing it doesn't have: no amber/red edges, no draft marks, no menu (one service), no expiry.
    for (const absent of ['line-warn', 'line-bad', 'draft-new', 'draft-edited', 'draft-live', 'svc-menu', 'svc-remove', 'card-expiry', 'verdict-blank']) {
      expect(present).not.toContain(absent);
    }
    expect([...v.el.querySelectorAll('.lg-h')].map((h) => h.textContent!.trim())).toEqual(
      ['Lines', 'Verdict', 'Policy cards', 'Hosts', 'Service card', 'Show on canvas'],
    );

    // A draft adds its marks.
    TestBed.inject(PolicyDraftStore).upsertUpdate('pol-002', { name: 'users-gitlab-2' });
    v.render();
    expect(v.listed()).toContain('draft-edited');

    v.el.querySelector<HTMLButtonElement>('.lg-all')!.click();
    v.render();
    expect(v.listed()).toEqual(LEGEND_ENTRIES.map((e) => e.id));
    expect(v.entry('line-bad').classList).toContain('lg-off'); // listed, not on the canvas
    expect(v.entry('line-ok').classList).not.toContain('lg-off');
  });

  it("a blank service's legend: its verdict and routing band only", () => {
    const v = render(APP_API_PROD);
    expect(v.listed()).toEqual(['verdict-blank', 'svc-routing']);
  });

  it('several services: the line styles and service-card entries they bring', () => {
    const v = render(GIT_REPO, FOUR);
    expect(v.listed()).toEqual(expect.arrayContaining(['line-ok', 'line-warn', 'line-bad', 'verdict-bad', 'svc-outage', 'svc-norouting', 'svc-menu', 'svc-remove']));
  });

  it('hovering or focusing an entry isolates what carries it — the rest fades', async () => {
    const v = render(GIT_REPO, FOUR);
    // Faded itself, or inside a policy container that fades as a whole.
    const faded = () =>
      new Set(
        [...v.el.querySelectorAll('app-service-view-group')]
          .filter((g) => g.classList.contains('faded') || g.closest('.policy-box.faded'))
          .map((g) => g.getAttribute('data-group-id')),
      );
    const all = [...v.el.querySelectorAll('app-service-view-group')].map((g) => g.getAttribute('data-group-id'));

    // Focus: at once. "No shared router" keeps exactly its edges, their groups and services.
    v.entry('line-bad').dispatchEvent(new FocusEvent('focus'));
    v.render();
    const bad = v.cmp.multi().edges.filter((e) => e.statusCounts.noSharedRouter > 0);
    expect(bad.length).toBeGreaterThan(0);
    const iso = v.cmp.isolation()!;
    expect([...iso.edges].sort()).toEqual(bad.map((e) => `${e.groupId}|${e.serviceId}`).sort());
    const keptGroups = new Set(bad.map((e) => e.groupId));
    expect(faded()).toEqual(new Set(all.filter((id) => !keptGroups.has(id!))));
    expect(v.el.querySelector('.svc-card[data-service-id="svc-007"]')!.classList).not.toContain('faded');
    expect(v.el.querySelector('.svc-card[data-service-id="svc-004"]')!.classList).toContain('faded');
    v.entry('line-bad').dispatchEvent(new FocusEvent('blur'));
    v.render();
    expect(v.cmp.isolation()).toBeNull();

    // Hover (after the canvas's usual short delay): a group-level mark keeps the cards that show it.
    v.entry('card-check').dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise((r) => setTimeout(r, 120));
    v.render();
    const withChecks = all.filter((id) => v.el.querySelector(`app-service-view-group[data-group-id="${id}"] .check-chip`));
    expect(withChecks.length).toBeGreaterThan(0);
    expect(faded()).toEqual(new Set(all.filter((id) => !withChecks.includes(id))));
    v.entry('card-check').dispatchEvent(new MouseEvent('mouseleave'));
    v.render();
    expect(faded().size).toBe(0);
  });

  it('a layer turned off hides it everywhere on the canvas — counts stay — and stays off after a reload', () => {
    TestBed.inject(PolicyDraftStore).upsertUpdate('pol-002', { expiresAt: new Date(Date.now() + 5 * 3_600_000).toISOString() });
    let v = render();
    const count = (sel: string) => v.el.querySelectorAll(sel).length;
    const verdict = v.el.querySelector('.verdict')!.textContent!.trim();
    expect([count('.lane .check-chip'), count('.lane .bypass-chip'), count('.lane .host-mark'), count('.lane .host-edit'), count('.lane app-expiry-pill')]).not.toContain(0);

    v.toggle('posture');
    expect([count('.lane .check-chip'), count('.lane .bypass-chip')]).toEqual([0, 0]);
    expect([...v.el.querySelectorAll('.status')].map((s) => s.textContent)).not.toContainEqual(expect.stringMatching(/blocked by posture/));
    expect(v.el.querySelector('.verdict')!.textContent!.trim()).toBe(verdict); // the verdict still counts it
    expect(v.listed()).not.toContain('card-check');

    v.toggle('hosts');
    expect([count('.lane .host-mark'), count('.lane .host-edit')]).toEqual([0, 0]);
    v.toggle('expiry');
    expect(count('.lane app-expiry-pill')).toBe(0);
    expect(saved()).toMatchObject({ posture: false, hosts: false, expiry: false });

    v = reload();
    expect([count('.lane .check-chip'), count('.lane .host-mark'), count('.lane app-expiry-pill')]).toEqual([0, 0, 0]);
    expect(v.el.querySelector<HTMLInputElement>('.lg-switch[data-layer="posture"] input')!.checked).toBe(false);
    v.toggle('posture');
    expect(count('.lane .check-chip')).toBeGreaterThan(0);
  });

  it('edges at rest: on by default here, off hides them until something is isolated; the choice persists', async () => {
    let v = render();
    await v.fixture.whenStable();
    expect(v.cmp.shownEdges().length).toBe(v.cmp.edges().length);
    v.toggle('edges');
    expect(v.cmp.shownEdges()).toEqual([]);
    v.cmp.focusIn({ kind: 'group', id: 'dial:pol-002:rule' });
    expect(v.cmp.shownEdges().map((e) => e.groupId)).toEqual(['dial:pol-002:rule']);
    expect(saved()).toMatchObject({ edgesFull: false, edgesCompact: false });
    v = reload();
    await v.fixture.whenStable();
    expect(v.cmp.edgesAtRest()).toBe(false);
  });

  it('× collapses the card to a "Legend" button in the same place; the state persists', () => {
    let v = render();
    v.el.querySelector<HTMLButtonElement>('.lg-x')!.click();
    v.render();
    expect(v.el.querySelector('.lg')).toBeNull();
    expect(v.el.querySelector('.lg-dock .lg-open')!.textContent!.trim()).toBe('Legend');
    expect(saved()).toMatchObject({ legendOpen: false });

    v = reload();
    expect(v.el.querySelector('.lg')).toBeNull();
    v.el.querySelector<HTMLButtonElement>('.lg-open')!.click();
    v.render();
    expect(v.el.querySelector('.lg')).not.toBeNull();
    expect(saved()).toMatchObject({ legendOpen: true });
  });

  it('several services: View details and Export sit in a "⋯" menu beside ×; one service keeps the links', () => {
    let v = render(GIT_REPO, FOUR);
    expect(v.el.querySelectorAll('.svc-more-btn, .svc-export')).toHaveLength(0);
    expect(v.el.querySelectorAll('.lane-service .svc-menu-btn')).toHaveLength(4);
    const details: string[] = [];
    v.cmp.serviceDetails.subscribe((id) => details.push(id));
    const card = v.el.querySelector('[data-service-id="svc-006"]')!;
    const btn = card.querySelector<HTMLButtonElement>('.svc-menu-btn')!;
    expect(card.querySelector('.svc-remove')).not.toBeNull();
    btn.click();
    v.render();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect([...card.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent!.trim())).toEqual(['View details', 'Export access report']);
    card.querySelector<HTMLButtonElement>('.svc-menu-details')!.click();
    v.render();
    expect(details).toEqual(['svc-006']); // not also the card's own click
    expect(card.querySelector('.svc-menu')).toBeNull();

    v = reload();
    expect(v.el.querySelectorAll('.lane-service .svc-menu-btn')).toHaveLength(0);
    expect(v.el.querySelector('.svc-more-btn')!.textContent!.trim()).toBe('View details');
    expect(v.el.querySelector('.svc-export')).not.toBeNull();
  });
});

describe('canvas legend — where it sits on the page', () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  });

  it('pinned inside the canvas card, after the draft bar, and under the assistant: it never covers either', () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.inject(PolicyDraftStore).upsertUpdate('pol-002', { name: 'users-gitlab-2' }); // a draft bar with actions
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    fixture.componentRef.setInput('service', GIT_REPO);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const dock = el.querySelector<HTMLElement>('.lg-dock')!;
    const bar = el.querySelector<HTMLElement>('.draft-bar')!;
    const fab = el.querySelector<HTMLElement>('.ap-fab')!;

    // Sticky in the canvas card: it can rise no higher than the card's top, which is below the bar.
    const card = dock.closest('.section-card')!;
    expect(card).not.toBeNull();
    expect(card.contains(bar)).toBe(false);
    expect(bar.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const dockStyle = getComputedStyle(dock);
    expect(dockStyle.position).toBe('sticky');
    // Below the assistant's launcher and panel (fixed, z-index 60).
    expect(Number(dockStyle.zIndex)).toBeLessThan(Number(getComputedStyle(fab).zIndex));
    expect(getComputedStyle(fab).position).toBe('fixed');
  });
});
