/**
 * Side-panel lifetime: a new focused service closes the open panel (the draft review
 * excepted); secondary services coming and going leave it.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/policy-builder.component.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PolicyBuilderComponent } from './policy-builder.component';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { LIVE_FLASH_MS } from './service-view.component';

describe('PolicyBuilderComponent — side panels and the focused service', () => {
  const setup = () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    const set = (name: string, value: string | undefined) => {
      fixture.componentRef.setInput(name, value);
      fixture.detectChanges();
    };
    set('service', 'svc-005');
    return { fixture, b: fixture.componentInstance, set };
  };

  it('changing the focused service closes the Tests panel and the editor', () => {
    const { b, set } = setup();
    b.openTests();
    set('service', 'svc-001');
    expect(b.panelOpen()).toBe(false);

    b.edit('pol-003');
    expect(b.editingId()).toBe('pol-003');
    set('service', 'svc-004');
    expect(b.panelOpen()).toBe(false);

    b.openGap({ groupId: 'x', kind: 'noSharedRouter' });
    b.openPosture({ groupId: 'x', serviceId: 'svc-004' });
    set('service', undefined); // Change service → the list
    expect(b.posture()).toBeNull();
  });

  it('adding or removing a secondary service leaves it open', () => {
    const { b, set } = setup();
    b.openTests();
    set('with', 'svc-004');
    expect(b.testsOpen()).toBe(true);
    set('with', undefined);
    expect(b.testsOpen()).toBe(true);
  });

  it('the draft review stays: it is about the whole draft', () => {
    const { b, set } = setup();
    TestBed.inject(PolicyDraftStore).deletePolicy('pol-002');
    b.openReview();
    set('service', 'svc-004');
    expect(b.reviewing()).toBe(true);
  });
});

describe('PolicyBuilderComponent — draft bar messages', () => {
  const setup = () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    fixture.componentRef.setInput('service', 'svc-004');
    fixture.detectChanges();
    const store = TestBed.inject(PolicyDraftStore);
    const bar = () => {
      fixture.detectChanges();
      return (fixture.nativeElement as HTMLElement).querySelector('.draft-bar')!.textContent!.replace(/\s+/g, ' ').trim();
    };
    return { fixture, b: fixture.componentInstance, store, bar };
  };

  afterEach(() => vi.useRealTimers());

  it('commit → add op → discard shows the discard message, not the commit message; Undo restores the ops', () => {
    const { b, store, bar } = setup();
    store.upsertUpdate('pol-002', { name: 'users-gitlab-2' });
    store.commit();
    b.onCommitted(1);
    expect(bar()).toContain('Committed 1 change to live.');

    store.upsertUpdate('pol-005', { name: 'git-servers-host-2' });
    store.upsertUpdate('pol-004', { name: 'git-repo-hosts-2' });
    const ops = store.ops();
    expect(bar()).toContain('Draft · 2 changes');

    b.discard();
    expect(bar()).toContain('Discarded 2 changes · Undo');
    expect(bar()).not.toContain('Committed');

    b.undoDiscard();
    expect(store.ops()).toBe(ops);
    expect(bar()).toContain('Draft · 2 changes');

    // Discarded again, the commit message never comes back.
    b.discard();
    b.dismissMessage();
    expect(bar()).toContain('No changes in draft');
  });

  it('Undo restores a revert draft with its link to the commit', () => {
    const { b, store } = setup();
    store.upsertUpdate('pol-002', { name: 'a' });
    store.commit();
    store.startRevert('c-1');
    const reverting = store.reverting();
    b.discard();
    expect(store.reverting()).toBeNull();
    b.undoDiscard();
    expect(store.reverting()).toEqual(reverting);
    expect(store.ops()).toHaveLength(1);
  });

  it('the commit message: gone after 6 s, or at the next draft change — never shown again', () => {
    vi.useFakeTimers();
    const { b, store, bar } = setup();
    b.onCommitted(2);
    vi.advanceTimersByTime(5999);
    expect(bar()).toContain('Committed 2 changes to live.');
    vi.advanceTimersByTime(1);
    expect(bar()).toContain('No changes in draft');

    b.onCommitted(1);
    store.upsertUpdate('pol-002', { name: 'x' });
    expect(bar()).not.toContain('Committed');
    store.discard(); // emptied directly: the message stays gone
    expect(bar()).toContain('No changes in draft');
  });

  it('the discard message: 8 s, or until the next draft change', () => {
    vi.useFakeTimers();
    const { b, store, bar } = setup();
    store.upsertUpdate('pol-002', { name: 'x' });
    b.discard();
    vi.advanceTimersByTime(7999);
    expect(bar()).toContain('Discarded 1 change · Undo');
    vi.advanceTimersByTime(1);
    expect(bar()).toContain('No changes in draft');

    store.upsertUpdate('pol-002', { name: 'y' });
    b.discard();
    store.upsertUpdate('pol-005', { name: 'z' });
    expect(bar()).toContain('Draft · 1 change');
    store.discard();
    expect(bar()).toContain('No changes in draft');
  });
});

describe('PolicyBuilderComponent — live changes from outside the builder (Demo panel)', () => {
  const USERS_GITLAB = 'pol-002';

  const setup = () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    fixture.componentRef.setInput('service', 'svc-004'); // git-repo
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(PolicyDraftStore);
    const render = () => fixture.detectChanges();
    const text = (sel: string) => {
      render();
      return el.querySelector(sel)?.textContent!.replace(/\s+/g, ' ').trim() ?? null;
    };
    /** Opens the Demo panel (if closed) and runs one scenario. */
    const runScenario = (id: string) => {
      if (!el.querySelector('#demo-panel')) {
        el.querySelector<HTMLButtonElement>('.demo-btn')!.click();
        render();
      }
      el.querySelector<HTMLButtonElement>(`.demo-run[data-scenario="${id}"]`)!.click();
      render();
    };
    /** The cards marked "changed in live": policy names, and "service:<name>". */
    const liveCards = () => {
      render();
      const names = new Set<string>();
      for (const g of el.querySelectorAll('app-service-view-group.live-changed')) {
        const name = g.querySelector('.node-policy') ?? g.closest('.policy-box')!.querySelector('.policy-box-name');
        names.add(name!.textContent!.trim());
      }
      for (const chip of el.querySelectorAll('.svc-live')) {
        names.add(`service:${chip.closest('.service')!.querySelector('.svc-name')!.textContent!.trim()}`);
      }
      return [...names].sort();
    };
    const commits = () => {
      render();
      return [...el.querySelectorAll('.hp-commit')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim());
    };
    return { fixture, el, b: fixture.componentInstance, store, render, text, runScenario, liveCards, commits };
  };

  afterEach(() => vi.useRealTimers());

  it('the Demo button opens the panel with the three scenarios; Escape closes it', () => {
    const { el, render } = setup();
    const btn = el.querySelector<HTMLButtonElement>('.page-header .demo-btn')!;
    expect(btn.textContent!.trim()).toBe('Demo');
    btn.click();
    render();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect([...el.querySelectorAll('.demo-run .demo-run-label')].map((l) => l.textContent)).toEqual([
      'Another admin edits users-gitlab',
      'Terraform run',
      'Advance clock 1 hour',
    ]);
    // …and the binding toggle, on by default.
    expect(el.querySelector('.demo-toggle .demo-run-label')!.textContent).toBe('Hosts bind after commit');
    expect(el.querySelector<HTMLInputElement>('.demo-bind-toggle')!.checked).toBe(true);
    el.querySelector('#demo-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    render();
    expect(el.querySelector('#demo-panel')).toBeNull();
  });

  it('each scenario updates live and History with its actor', () => {
    const { b, store, runScenario, commits } = setup();
    const gitlab = () => store.live().policies.find((p) => p.id === USERS_GITLAB)!;

    runScenario('adminEdit');
    expect(gitlab().identityRoles).toEqual(['#users', '#vendors']);

    runScenario('terraform');
    expect(store.live().edgeRouterPolicies.find((p) => p.id === 'rp-003')!.edgeRouterRoles).toEqual(['#public', '@er-004']);
    expect(store.live().serviceEdgeRouterPolicies.find((p) => p.id === 'serp-003')!.edgeRouterRoles).toEqual(['#public', '@er-004']);

    expect(store.history().map((c) => [c.author, c.actor])).toEqual([
      ['outside', 'Terraform'],
      ['outside', 'Dana (admin)'],
    ]);

    b.openHistory();
    const [terraform, admin] = commits();
    expect(terraform).toContain('Terraform · 2 changes');
    expect(terraform).toContain('Updated servers-public-routers');
    expect(terraform).toContain('Updated git-repo-public-routers');
    expect(admin).toContain('Dana (admin) · Updated users-gitlab');

    // My own commit says "You".
    store.upsertUpdate('pol-005', { name: 'git-servers-host-2' });
    store.commit();
    expect(commits()[0]).toContain('You · Updated');
  });

  it('Advance clock 1 hour moves the demo clock; the next change is stamped with it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 10, 42));
    const { el, store, runScenario, text } = setup();
    runScenario('clock');
    expect(text('.demo-clock')).toContain('Demo time 11:42 +1 h');
    expect(text('.demo-last')).toContain('Clock advanced to 11:42');
    runScenario('adminEdit');
    expect(new Date(store.history()[0].at).getHours()).toBe(11);
    expect(el.querySelector('.demo-last')!.textContent).toContain('users-gitlab changed in live · Dana (admin)');
  });

  it('with a draft touching users-gitlab, the admin scenario marks its card, notes it on the bar and raises the conflict at once', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 10, 42));
    const { b, el, store, render, text, runScenario, liveCards } = setup();
    store.upsertUpdate(USERS_GITLAB, { semantic: 'AllOf' });
    expect(liveCards()).toEqual([]);
    expect(el.querySelector('.draft-live')).toBeNull();

    runScenario('adminEdit');
    expect(liveCards()).toEqual(['users-gitlab']);
    // Two status chips: on their own line under the name, never beside it.
    const card = el.querySelector('app-service-view-group.live-changed')!;
    expect(card.querySelector('.node-hdr .node-mark, .node-hdr .node-live')).toBeNull();
    expect([...card.querySelectorAll('.node-marks > span')].map((c) => c.textContent!.trim())).toEqual(['edited', 'changed in live']);
    expect(text('.draft-live')).toBe('users-gitlab changed in live · Dana (admin) · 10:42 conflicts with your draft Review');
    expect(store.conflicts().map((c) => c.name)).toEqual(['users-gitlab']);

    // The notice opens the review, which shows the conflict straight away.
    el.querySelector<HTMLButtonElement>('.draft-live')!.click();
    render();
    expect(b.reviewing()).toBe(true);
    expect(text('.dr-cf-title')).toBe('users-gitlab changed in live since you started editing it');

    // No flash with a draft open: the mark says it.
    expect(el.querySelector('.live-flash')).toBeNull();

    // The draft goes, and the marks and notice with it.
    b.discard();
    expect(liveCards()).toEqual([]);
    expect(el.querySelector('.draft-live')).toBeNull();
  });

  it('the Terraform scenario on entities the draft does not touch marks only their cards — no conflict', () => {
    const { el, store, text, runScenario, liveCards } = setup();
    store.upsertUpdate(USERS_GITLAB, { semantic: 'AllOf' });

    runScenario('terraform');
    // servers-public-routers reaches the #servers hosts' groups; git-repo-public-routers the git-repo node.
    expect(liveCards()).toEqual(['git-repo-hosts', 'git-servers-host', 'service:git-repo']);
    expect(store.conflicts()).toEqual([]);
    expect(text('.draft-live')).toMatch(/^servers-public-routers, git-repo-public-routers changed in live · Terraform · \d\d:\d\d Review$/);
    expect(el.querySelector('.draft-live-tag')).toBeNull();

    // A second change: the latest one, and a count of those before it.
    runScenario('adminEdit');
    expect(text('.draft-live')).toContain('users-gitlab changed in live · Dana (admin)');
    expect(text('.draft-live')).toContain('+1 earlier');
    expect(liveCards()).toEqual(['git-repo-hosts', 'git-servers-host', 'service:git-repo', 'users-gitlab']);
  });

  it('with no draft, the canvas updates, briefly highlights what changed, and History records it', () => {
    vi.useFakeTimers();
    const { el, store, runScenario, liveCards, render } = setup();
    runScenario('terraform');
    render();
    // No "changed in live" marks without a draft — a flash instead.
    expect(liveCards()).toEqual([]);
    expect(el.querySelector('.draft-live')).toBeNull();
    const flashing = () =>
      [...el.querySelectorAll('.live-flash')]
        .map((n) => n.getAttribute('data-service-id') ?? n.getAttribute('data-group-id'))
        .sort();
    expect(flashing()).toContain('svc-004');
    expect(flashing().length).toBeGreaterThan(1);
    expect(el.querySelector('.sr-only[role=status]')!.textContent).toContain('changed in live · Terraform');
    // The canvas shows the HQ router in git-repo's routing band (2 of 3 before).
    expect(el.querySelector('[data-service-id="svc-004"] .routers-line')!.textContent).toContain('3 of 4 routers online');
    expect(store.history()[0].actor).toBe('Terraform');

    vi.advanceTimersByTime(LIVE_FLASH_MS);
    render();
    expect(flashing()).toEqual([]);
  });
});
