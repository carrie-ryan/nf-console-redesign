/**
 * Search picker: search by name or attribute (names first), at most 50 results with
 * "Showing 50 of N — keep typing", chosen entries marked and not addable, keyboard
 * navigation, Enter to add, Escape to close; free text where allowed. And the editors
 * use it: no native suggestion lists left.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/search-picker.spec.ts`
 */

import { provideRouter } from '@angular/router';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { PolicyEditorComponent } from './policy-editor.component';
import { RouterPolicyEditorComponent } from './router-policy-editor.component';
import {
  PICKER_LIMIT,
  SearchPickerComponent,
  attributeItems,
  entityItems,
  searchItems,
  type PickerItem,
} from './search-picker.component';

/** "server" is in 271 names or 406 attribute lists: 542 people. */
const SERVER_HITS = 542;

const people = Array.from({ length: 812 }, (_, i) => ({
  id: `id-${i}`,
  name: i % 3 === 0 ? `server-${i}` : `laptop-${i}`,
  attributes: i % 2 ? ['#servers'] : ['#laptops', '#eu'],
}));

describe('picker items and search', () => {
  it('entities emit their named role; attributes carry how many have them', () => {
    expect(entityItems(people, 'name')[0]).toMatchObject({ value: '@server-0', label: 'server-0', attributes: ['#laptops', '#eu'] });
    expect(entityItems(people, 'id')[1].value).toBe('@id-1');
    expect(entityItems(people, 'name')).toBe(entityItems(people, 'name')); // cached per collection
    expect(attributeItems(people, { one: 'identity', many: 'identities' }).map((a) => [a.label, a.meta])).toEqual([
      ['#eu', '406 identities'],
      ['#laptops', '406 identities'],
      ['#servers', '406 identities'],
    ]);
  });

  it('names starting with the query first, then names containing it, then attribute matches; at most 50', () => {
    const items = entityItems(people, 'name');
    const r = searchItems(items, 'server');
    expect(r.total).toBe(SERVER_HITS);
    expect(r.shown).toHaveLength(PICKER_LIMIT);
    expect(r.shown.every((it) => it.label.startsWith('server-'))).toBe(true);
    const tail = searchItems(items, 'servers');
    expect(tail.shown[0].label).toBe('laptop-1'); // only the attribute matches
    expect(searchItems(items, 'LAPTOP-7').shown[0].label).toBe('laptop-7'); // any case
    expect(searchItems(items, 'zzz')).toEqual({ shown: [], total: 0 });
  });
});

@Component({
  standalone: true,
  imports: [SearchPickerComponent],
  template: `<div class="wrap"><app-search-picker inputId="p" [items]="items()" [selected]="selected()" noun="identities"
    [allowFree]="free()" (picked)="picked.push($event)" /></div>`,
})
class Host {
  readonly items = signal<readonly PickerItem[]>(entityItems(people, 'name'));
  readonly selected = signal<ReadonlySet<string>>(new Set(['@server-0']));
  readonly free = signal(false);
  readonly picked: string[] = [];
}

describe('SearchPickerComponent', () => {
  const setup = (free = false) => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.free.set(free);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#p')!;
    const type = (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const key = (k: string) => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };
    const options = () => [...el.querySelectorAll<HTMLElement>('[role=option]')];
    return { fixture, el, input, type, key, options, host: fixture.componentInstance };
  };

  it('typing lists matches with their attributes, at most 50: "Showing 50 of 542 identities — keep typing"', () => {
    const { el, input, type, options } = setup();
    type('server');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(options()).toHaveLength(50);
    expect(options()[0].querySelector('.sp-label')!.textContent).toBe('server-0');
    expect(options()[0].querySelector('.sp-attrs')!.textContent).toBe('#laptops #eu');
    expect(el.querySelector('.sp-status')!.textContent).toBe(`Showing 50 of ${SERVER_HITS} identities — keep typing`);
    type('server-81');
    expect(el.querySelector('.sp-status')).toBeNull(); // all shown
  });

  it('already-chosen entries are marked and not added again', () => {
    const { type, options, host } = setup();
    type('server-0');
    const chosen = options()[0];
    expect(chosen.getAttribute('aria-disabled')).toBe('true');
    expect(chosen.textContent).toContain('added');
    chosen.click();
    expect(host.picked).toEqual([]);
  });

  it('arrow keys move the highlight, Enter adds it, Escape closes', () => {
    const { input, type, key, options, host } = setup();
    type('laptop-1');
    expect(options()[0].getAttribute('aria-selected')).toBe('true'); // the first result is ready for Enter
    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1].id);
    key('Enter');
    expect(host.picked).toEqual(['@laptop-10']);
    expect(input.value).toBe(''); // ready for the next
    key('ArrowUp'); // wraps to the last
    expect(options().at(-1)!.getAttribute('aria-selected')).toBe('true');
    key('Escape');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(options()).toHaveLength(0);
  });

  it('free text: Enter adds what was typed unless a result is highlighted; leaving the field keeps it too', () => {
    const { type, key, host, input, fixture } = setup(true);
    fixture.componentInstance.items.set(attributeItems(people, { one: 'identity', many: 'identities' }));
    fixture.detectChanges();
    type('#new-team');
    key('Enter');
    type('#eu');
    key('Enter'); // an exact match is highlighted
    type('#late');
    input.dispatchEvent(new Event('blur'));
    expect(host.picked).toEqual(['#new-team', '#eu', '#late']);
  });
});

describe('the editors use the picker', () => {
  it('policy editor: searching identities and pressing Enter adds the named role; no datalists remain', () => {
    TestBed.configureTestingModule({ imports: [PolicyEditorComponent], providers: [provideRouter([])] });
    const store = TestBed.inject(PolicyDraftStore);
    const fixture = TestBed.createComponent(PolicyEditorComponent);
    fixture.componentRef.setInput('policyId', 'pol-002');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('datalist, [list]')).toHaveLength(0);
    const input = el.querySelector<HTMLInputElement>('#pe-identity-named')!;
    input.value = 'carol';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[role=option] .sp-label')!.textContent).toBe('carol@corp.com');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    fixture.detectChanges();
    expect(store.draftWorld().policies.find((p) => p.id === 'pol-002')!.identityRoles).toContain('@carol@corp.com');
    // An attribute typed into the rule picker gets its '#'.
    const terms = el.querySelector<HTMLInputElement>('#pe-identity-terms')!;
    terms.value = 'contractors';
    terms.dispatchEvent(new Event('input'));
    terms.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    fixture.detectChanges();
    expect(store.draftWorld().policies.find((p) => p.id === 'pol-002')!.identityRoles).toContain('#contractors');
  });

  it('router policy editor: routers are picked by @id, and shown with their attributes', () => {
    TestBed.configureTestingModule({ imports: [RouterPolicyEditorComponent] });
    const store = TestBed.inject(PolicyDraftStore);
    const erp = store.live().edgeRouterPolicies[0];
    const fixture = TestBed.createComponent(RouterPolicyEditorComponent);
    fixture.componentRef.setInput('target', 'edgeRouterPolicy');
    fixture.componentRef.setInput('policyId', erp.id);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('datalist, [list]')).toHaveLength(0);
    const router = store.live().edgeRouters.find((r) => !erp.edgeRouterRoles.includes(`@${r.id}`))!;
    const input = el.querySelector<HTMLInputElement>('#rpe-router-named')!;
    input.value = router.name;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const first = el.querySelector('[role=option]')!;
    expect(first.querySelector('.sp-label')!.textContent).toBe(router.name);
    expect(first.querySelector('.sp-attrs')?.textContent ?? '').toBe(router.attributes.join(' '));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    fixture.detectChanges();
    expect(store.draftWorld().edgeRouterPolicies.find((p) => p.id === erp.id)!.edgeRouterRoles).toContain(`@${router.id}`);
  });
});
