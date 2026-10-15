/**
 * The editor's attribute rule can't exclude: a term starting with "!", "-" or "not "
 * adds no chip, and an inline note says why — with "Add test", which opens the access
 * test form filled in with a must-not test for that attribute.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/policy-editor.exclusion.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PolicyEditorComponent } from './policy-editor.component';
import { PolicyBuilderComponent } from './policy-builder.component';
import { PolicyDraftStore } from './draft/policy-draft.store';
import type { TestPrefill } from './access-tests-panel.component';

const NOTE = "Ziti can't exclude. Use a narrower attribute, or add a must-not test. Add test";

/** Types `text` into an input and presses Enter. */
function enter(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

const clean = (el: Element | null) => el?.textContent!.replace(/\s+/g, ' ').trim() ?? null;

describe('PolicyEditorComponent — exclusions in an attribute rule', () => {
  const setup = (policyId: string) => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] }); // the posture section links to Posture Checks
    const fixture = TestBed.createComponent(PolicyEditorComponent);
    fixture.componentRef.setInput('policyId', policyId);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(PolicyDraftStore);
    const tests: TestPrefill[] = [];
    fixture.componentInstance.addTest.subscribe((t) => tests.push(t));
    const type = (side: string, text: string) => {
      enter(el.querySelector<HTMLInputElement>(`#pe-${side}-terms`)!, text);
      fixture.detectChanges();
    };
    return { fixture, el, store, tests, type };
  };

  it.each(['!kiosks', '-kiosks', 'not kiosks', '#!kiosks'])('"%s" adds no chip; the note explains, and Add test asks for a mustNotDial test', (text) => {
    const { fixture, el, store, tests, type } = setup('pol-002'); // users-gitlab, Dial
    type('identity', text);
    expect(store.ops()).toEqual([]);
    expect([...el.querySelectorAll('.tag-chip')].some((c) => c.textContent!.includes('kiosks'))).toBe(false);
    expect(clean(el.querySelector('.pe-exclude'))).toBe(NOTE);

    el.querySelector<HTMLButtonElement>('.pe-exclude-test')!.click();
    expect(tests).toEqual([{ kind: 'mustNotDial', attributes: ['#kiosks'] }]);
    fixture.detectChanges();
    expect(el.querySelector('.pe-exclude')).toBeNull();
  });

  it('a Bind policy asks for mustNotHost; a real attribute clears the note and is added', () => {
    const { fixture, el, store, tests, type } = setup('pol-003'); // servers-bind-api, Bind
    type('identity', 'not kiosks');
    el.querySelector<HTMLButtonElement>('.pe-exclude-test')!.click();
    expect(tests).toEqual([{ kind: 'mustNotHost', attributes: ['#kiosks'] }]);

    type('identity', '-kiosks');
    expect(el.querySelector('.pe-exclude')).not.toBeNull();
    type('identity', 'prod');
    fixture.detectChanges();
    expect(el.querySelector('.pe-exclude')).toBeNull();
    expect(store.ops()).toEqual([{ kind: 'update', policyId: 'pol-003', patch: { identityRoles: ['#servers', '#prod'] } }]);
  });

  it('on the service side the note has no test to offer', () => {
    const { el, type } = setup('pol-002');
    type('service', '!git');
    expect(clean(el.querySelector('.pe-exclude'))).toBe("Ziti can't exclude. Use a narrower attribute.");
    expect(el.querySelector('.pe-exclude-test')).toBeNull();
  });

  it("in the builder, Add test opens the tests panel's form prefilled", () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    fixture.componentRef.setInput('service', 'svc-004');
    fixture.detectChanges();
    const b = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    b.edit('pol-002');
    fixture.detectChanges();
    enter(el.querySelector<HTMLInputElement>('#pe-identity-terms')!, '!kiosks');
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.pe-exclude-test')!.click();
    fixture.detectChanges();

    expect(b.testsOpen()).toBe(true);
    const form = el.querySelector('.at-form')!;
    expect(form.getAttribute('aria-label')).toBe('New test');
    expect([...form.querySelectorAll('.tag-chip')].map((c) => clean(c))).toEqual(['#kiosks']);
    expect(form.querySelector<HTMLSelectElement>('#at-kind')!.value).toBe('mustNotDial');
    expect(form.querySelector<HTMLSelectElement>('#at-service')!.value).toBe('svc-004');
    expect(TestBed.inject(PolicyDraftStore).ops()).toEqual([]); // nothing in the draft until it's added
  });
});
