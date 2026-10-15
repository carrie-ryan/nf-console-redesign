/**
 * Tagging identities: one bulk-tagging op (target 'identityAttributes') per action,
 * reviewed, tested, scoped and conflict-checked like any other op. Entry points: the
 * member drawer's selection mode, the identity lens's attribute chips, and an attribute
 * rule matching nobody ("No identity has #x · Tag identities").
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/identity-tagging.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { evaluateTests } from './access-tests';
import { affectedPairs, affectedServices } from './draft/affected-services';
import { diffWorlds } from './draft/draft-diff';
import { describeOps } from './draft/draft-summary';
import { revertOps } from './draft/history';
import { adminEditOps } from './draft/live-changes';
import { applyDraft, type DraftOp, type IdentityAttributesOp } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { broadHostWarnings } from './hosting';
import { postureFor } from './posture';
import { IdentityViewComponent } from './identity-view.component';
import { MemberDrawerComponent } from './member-drawer.component';
import { PolicyBuilderComponent } from './policy-builder.component';
import { PolicyEditorComponent } from './policy-editor.component';

const API_PROD = 'svc-005'; // #apis — servers-bind-api binds AllOf #servers
const GIT_REPO = 'svc-004';
const KIOSKS = ['id-005', 'id-017', 'id-018']; // kiosk-lobby, kiosk-reception, kiosk-cafeteria
const BOB = 'id-015'; // bob@corp.com: #admins, #users
const REQUIRE_MFA = 'pc-001';

const tag = (identityIds: string[], add: string[], remove: string[] = []): IdentityAttributesOp => ({
  kind: 'tag',
  target: 'identityAttributes',
  identityIds,
  add,
  remove,
});

/** The scoped diff equals the full one, and affectedServices / affectedPairs cover every change. */
function expectScopedEqualsFull(live: TrifectaWorld, ops: DraftOp[]) {
  const draft = applyDraft(live, ops);
  const full = diffWorlds({ ...live }, draft, { scope: 'all' });
  expect(diffWorlds(live, draft)).toEqual(full);
  const services = new Set(affectedServices(ops, live, draft));
  const pairs = affectedPairs(ops, live, draft);
  for (const c of full.pairChanges) {
    expect(services.has(c.serviceId)).toBe(true);
    const ids = pairs.get(c.serviceId);
    expect(ids === 'all' || !!ids?.has(c.identityId)).toBe(true);
  }
  return { draft, full };
}

const clean = (el: Element | null) => el?.textContent!.replace(/\s+/g, ' ').trim() ?? null;

describe('identityAttributes ops — the model', () => {
  const live = buildSeedWorld();

  it('adds and removes on each listed identity, leaving the rest by reference', () => {
    const w = applyDraft(live, [tag([...KIOSKS, BOB], ['#servers'], ['#users'])]);
    for (const id of KIOSKS) expect(w.identities.find((i) => i.id === id)!.attributes).toEqual(['#kiosks', '#servers']);
    expect(w.identities.find((i) => i.id === BOB)!.attributes).toEqual(['#admins', '#servers']);
    const untouched = live.identities.find((i) => i.id === 'id-001')!;
    expect(w.identities.find((i) => i.id === 'id-001')).toBe(untouched);
    expect(w.policies).toBe(live.policies);
  });

  it.each<[string, IdentityAttributesOp, RegExp]>([
    ['no identities', tag([], ['#x']), /at least one identity/],
    ['nothing to do', tag(KIOSKS, []), /attribute to add or remove/],
    ['an unknown identity', tag(['id-999'], ['#x']), /no identity with id 'id-999'/],
    ['a bad attribute', tag(KIOSKS, ['kiosks']), /invalid attribute 'kiosks'/],
    ['add and remove the same', tag(KIOSKS, ['#x'], ['#x']), /both add and remove #x/],
  ])('rejects %s', (_, op, msg) => {
    expect(() => applyDraft(live, [op])).toThrow(msg);
  });

  it('reads "Added #kiosks to 120 identities" / "Removed #users from bob@corp.com"', () => {
    const many = live.identities.slice(0, 120).map((i) => i.id);
    expect(describeOps(live, [tag(many.slice(0, 86), ['#kiosks'])])).toEqual(['Added #kiosks to 86 identities']);
    expect(describeOps(live, [tag([BOB], [], ['#users'])])).toEqual(['Removed #users from bob@corp.com']);
    expect(describeOps(live, [tag(KIOSKS, ['#servers'], ['#kiosks'])])).toEqual(['Added #servers to 3 identities; removed #kiosks from 3 identities']);
  });
});

describe('tagging — effects, checks and the scoped diff', () => {
  const live = buildSeedWorld();

  it('tagging 3 kiosks with #servers makes them hosts of api-prod and fails the mustNotHost test', () => {
    const ops = [tag(KIOSKS, ['#servers'])];
    const { draft, full } = expectScopedEqualsFull(live, ops);
    for (const id of KIOSKS) {
      expect(resolve(id, API_PROD, live).bind.authorized).toBe(false);
      expect(resolve(id, API_PROD, draft).bind.authorized).toBe(true);
    }
    expect(full.pairChanges.filter((c) => c.serviceId === API_PROD && c.track === 'bind').map((c) => c.identityId).sort()).toEqual(KIOSKS);

    // at-001: anyone with #kiosks must not host api-prod — passes in live, fails now.
    const test = (w: TrifectaWorld) => evaluateTests(w, live).find((r) => r.test.id === 'at-001')!;
    expect(test(live).pass).toBe(true);
    expect(test(draft).pass).toBe(false);

    // Three new hosts on api-prod is not past BROAD_HOSTS (3)…
    expect(broadHostWarnings(live, draft).filter((w) => w.serviceId === API_PROD)).toEqual([]);
    // …all six #kiosks identities is.
    const six = live.identities.filter((i) => i.attributes.includes('#kiosks')).map((i) => i.id);
    expect(six).toHaveLength(6);
    const broad = broadHostWarnings(live, expectScopedEqualsFull(live, [tag(six, ['#servers'])]).draft);
    expect(broad.map((w) => w.serviceId)).toContain(API_PROD);
  });

  it("removing #users from bob removes his git-repo bypass of require-mfa", () => {
    const before = postureFor(BOB, GIT_REPO, 'dial', live);
    expect(before.bypassedChecks).toEqual([REQUIRE_MFA]);
    const { draft } = expectScopedEqualsFull(live, [tag([BOB], [], ['#users'])]);
    const after = postureFor(BOB, GIT_REPO, 'dial', draft);
    expect(after.bypassedChecks).toEqual([]);
    expect(after.satisfied).toBe(false); // now only admins-dev-access grants it — and he fails MFA
  });

  it('the scope is narrow: an attribute no rule uses touches no service', () => {
    const ops = [tag(KIOSKS, ['#nothing-uses-this'])];
    const draft = applyDraft(live, ops);
    expect(affectedServices(ops, live, draft)).toEqual([]);
    expect(affectedPairs(ops, live, draft).size).toBe(0);
    expectScopedEqualsFull(live, ops);
  });
});

describe('tagging — store, conflicts and history', () => {
  let store: PolicyDraftStore;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(PolicyDraftStore);
  });

  it('a live change to a tagged identity is a conflict; dropping it takes just that identity out of the op', () => {
    store.addOp(tag([...KIOSKS, BOB], ['#servers']));
    // Someone outside edits bob's attributes in live.
    store.applyLiveChange([tag([BOB], ['#contractors'])], 'Dana (admin)');
    const [c, ...rest] = store.conflicts();
    expect(rest).toEqual([]);
    expect(c.key).toBe(`identity:${BOB}`);
    expect(c.clashes).toEqual([]); // tagging is a delta: no field to pick
    store.dropChange(c.key);
    expect(store.ops()).toEqual([tag(KIOSKS, ['#servers'])]);
  });

  it('reapplying keeps the tag op as it is, on top of the latest', () => {
    store.addOp(tag([BOB], ['#servers']));
    store.applyLiveChange([tag([BOB], ['#contractors'])], 'Dana (admin)');
    store.reapply(`identity:${BOB}`);
    expect(store.conflicts()).toEqual([]);
    expect(store.ops()).toEqual([tag([BOB], ['#servers'])]);
    expect(store.draftWorld().identities.find((i) => i.id === BOB)!.attributes).toEqual(['#admins', '#users', '#contractors', '#servers']);
  });

  it('a committed bulk tag reverts as bulk tagging', () => {
    store.addOp(tag(KIOSKS, ['#servers'], ['#kiosks']));
    store.commit();
    const plan = revertOps(store.history()[0], store.live());
    expect(plan).toEqual({ ops: [tag(KIOSKS, ['#kiosks'], ['#servers'])], conflicts: [] });
    store.startRevert(store.history()[0].id);
    store.commit();
    expect(store.live().identities.find((i) => i.id === KIOSKS[0])!.attributes).toEqual(['#kiosks']);
  });

  it('live changes still work alongside (the demo admin)', () => {
    store.addOp(tag(KIOSKS, ['#servers']));
    store.applyLiveChange(adminEditOps(store.live()), 'Dana (admin)');
    expect(store.conflicts()).toEqual([]);
  });
});

describe('tagging — entry points', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('member drawer: search, "Select all N matching", Add attribute → one op for those it changes', () => {
    const store = TestBed.inject(PolicyDraftStore);
    const fixture = TestBed.createComponent(MemberDrawerComponent); // no group: every identity
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const d = fixture.componentInstance;
    const click = (sel: string) => {
      el.querySelector<HTMLButtonElement>(sel)!.click();
      fixture.detectChanges();
    };
    expect(clean(el.querySelector('.rg-title'))).toBe('Identities');

    click('.md-select-toggle');
    expect(el.querySelectorAll('.md-check').length).toBeGreaterThan(0);
    d.search('kiosk-');
    fixture.detectChanges();
    expect(clean(el.querySelector('.md-select-all'))).toBe('Select all 3 matching');
    click('.md-select-all');
    expect(clean(el.querySelector('.md-sel-n'))).toBe('3 selected');

    click('.md-tag-add');
    d.pickAttribute('servers');
    fixture.detectChanges();
    expect(clean(el.querySelector('.md-apply'))).toBe('Add #servers to 3 identities');
    click('.md-apply');
    expect(store.ops()).toEqual([tag(KIOSKS, ['#servers'])]);
    expect(clean(el.querySelector('.md-tag-result'))).toBe('Added #servers to 3 identities — in the draft.');
    expect(clean(el.querySelector('.md-sel-n'))).toBe('0 selected');
  });

  it('member drawer: remove skips the selected who lack it', () => {
    const store = TestBed.inject(PolicyDraftStore);
    const fixture = TestBed.createComponent(MemberDrawerComponent);
    fixture.detectChanges();
    const d = fixture.componentInstance;
    d.toggleSelecting();
    d.toggleRow(BOB);
    d.toggleRow('id-004'); // alice@corp.com: no #users
    d.setAction('remove');
    d.pickAttribute('#users');
    fixture.detectChanges();
    expect(d.applyLabel()).toBe('Remove #users from 1 identity');
    expect(d.skipNote()).toBe("1 of the 2 selected don't have #users");
    d.applyTag();
    expect(store.ops()).toEqual([tag([BOB], [], ['#users'])]);
  });

  it('identity lens: × removes, the picker adds — each one op; draft changes are marked', () => {
    const store = TestBed.inject(PolicyDraftStore);
    const fixture = TestBed.createComponent(IdentityViewComponent);
    fixture.componentRef.setInput('identityId', BOB);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('[aria-label="Remove #users from bob@corp.com"]')!.click();
    fixture.detectChanges();
    expect(store.ops()).toEqual([tag([BOB], [], ['#users'])]);
    expect(clean(el.querySelector('.iv-attr-removed'))).toBe('#users (removed in the draft)');

    const input = el.querySelector<HTMLInputElement>('#iv-attr-add')!;
    input.value = 'contractors';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(store.ops()).toEqual([tag([BOB], [], ['#users']), tag([BOB], ['#contractors'])]);
    const added = [...el.querySelectorAll('.tag-chip.added')].map((c) => clean(c));
    expect(added).toEqual(['#contractors (added in the draft)']);
  });

  it('an attribute rule matching nobody: "No identity has #x · Tag identities" opens the drawer with "Add #x" ready', () => {
    const store = TestBed.inject(PolicyDraftStore);
    store.upsertUpdate('pol-002', { identityRoles: ['#vendors'] });
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    fixture.componentRef.setInput('service', GIT_REPO);
    fixture.detectChanges();
    const b = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    b.edit('pol-002');
    fixture.detectChanges();
    expect(clean(el.querySelector('.pe-untagged'))).toBe('No identity has #vendors · Tag identities');
    el.querySelector<HTMLButtonElement>('.pe-tag-ids')!.click();
    fixture.detectChanges();

    expect(b.tagging()).toBe('#vendors');
    const drawer = el.querySelector('app-member-drawer')!;
    expect(drawer.querySelector('.md-select-toggle')!.getAttribute('aria-pressed')).toBe('true');
    expect(drawer.querySelector('.md-tag-add')!.getAttribute('aria-pressed')).toBe('true');
    expect(clean(drawer.querySelector('.md-tag-attr .tag-chip'))).toBe('#vendors');
    expect(clean(drawer.querySelector('.md-tag-hint'))).toBe('Select the identities to tag below.');

    // Tag two, and the rule matches them.
    drawer.querySelector<HTMLInputElement>('[aria-label="Select laptop-alice"]')!.click();
    drawer.querySelector<HTMLInputElement>('[aria-label="Select phone-bob"]')!.click();
    fixture.detectChanges();
    drawer.querySelector<HTMLButtonElement>('.md-apply')!.click();
    fixture.detectChanges();
    expect(store.ops().at(-1)).toEqual(tag(['id-001', 'id-003'], ['#vendors']));
    expect(resolve('id-001', GIT_REPO, store.draftWorld()).dial.authorized).toBe(true);
  });

  it('no note when the rule matches someone, or for #all', () => {
    const store = TestBed.inject(PolicyDraftStore);
    store.upsertUpdate('pol-002', { identityRoles: ['#users', '#vendors'] }); // AnyOf: #users matches
    const fixture = TestBed.createComponent(PolicyEditorComponent);
    fixture.componentRef.setInput('policyId', 'pol-002');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.pe-untagged')).toBeNull();
  });
});
