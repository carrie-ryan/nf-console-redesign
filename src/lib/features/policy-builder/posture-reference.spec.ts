/**
 * Posture checks are REFERENCE-ONLY in the builder: the policy editor picks existing
 * checks (by name or attribute) and links to Posture Checks for a new one; shield chips
 * and the posture panel open a read-only summary with "Edit in Posture Checks". The
 * round trip keeps the draft and the service, and a check created there is pickable on
 * return. The engine still knows the 'postureCheck' target; no builder UI makes those ops.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/posture-reference.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MockDataService } from '../../shared/services/mock-data.service';
import { CreatePostureCheckComponent } from '../posture-checks/create-posture-check.component';
import { PostureChecksComponent } from '../posture-checks/posture-checks.component';
import { targetOf } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { PolicyBuilderComponent } from './policy-builder.component';
import { PolicyEditorComponent } from './policy-editor.component';

const GIT_REPO = 'svc-004';
const USERS_GITLAB = 'pol-002'; // dial, no posture checks
const ADMINS = 'pol-001'; // requires #mfa-required (require-mfa)
const REQUIRE_MFA = 'pc-001';

const clean = (el: Element | null | undefined) => el?.textContent!.replace(/\s+/g, ' ').trim() ?? null;

const ROUTES = [
  { path: 'policy-builder', component: PolicyBuilderComponent },
  { path: 'posture-checks', component: PostureChecksComponent },
  { path: 'posture-checks/new', component: CreatePostureCheckComponent },
  { path: 'posture-checks/:id/edit', component: CreatePostureCheckComponent },
];

describe('posture checks are reference-only in the builder', () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (s: string) => s.replace(/["\\]/g, '\\$&');
  });

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(ROUTES, withComponentInputBinding())] }));

  /** The policy editor on one policy, with the posture picker. */
  const editor = (policyId: string) => {
    const fixture = TestBed.createComponent(PolicyEditorComponent);
    fixture.componentRef.setInput('policyId', policyId);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#pe-posture-pick')!;
    const type = (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const enter = () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };
    const options = () => [...el.querySelectorAll<HTMLElement>('[role=option]')].map((o) => clean(o));
    return { fixture, el, input, type, enter, options, cmp: fixture.componentInstance };
  };

  const roles = (policyId: string) => TestBed.inject(PolicyDraftStore).draftWorld().policies.find((p) => p.id === policyId)!.postureCheckRoles;

  it('the posture section picks existing checks only — no "New check" — and links to Posture Checks', () => {
    const e = editor(USERS_GITLAB);
    const section = e.el.querySelector('section[aria-labelledby="pe-posture-h"]')!;
    expect([...section.querySelectorAll('button')].map((b) => clean(b))).not.toContain('New check');
    expect(section.querySelector('#pe-posture-terms, #pe-posture-named')).toBeNull(); // no free-text attribute rule
    const link = section.querySelector<HTMLAnchorElement>('.pe-new-check-link')!;
    expect(clean(section.querySelector('.pe-new-check-hint'))).toBe('Need a new check? Create it in Posture Checks');
    expect(link.getAttribute('href')).toMatch(/^\/posture-checks\?returnTo=/);
    expect(link.getAttribute('target')).toBeNull(); // same tab

    // Free text matches nothing and adds nothing.
    e.type('no-such-check');
    e.enter();
    expect(roles(USERS_GITLAB)).toEqual([]);
  });

  it('picking an existing check adds the right role: @name for a check, #attribute for an attribute', () => {
    const e = editor(USERS_GITLAB);
    e.type('require');
    expect(e.options()[0]).toContain('require-mfa');
    e.enter();
    expect(roles(USERS_GITLAB)).toEqual(['@require-mfa']);

    // By attribute: a check found through its attribute still adds the check…
    e.type('corp-devices');
    expect(e.options().some((o) => o!.includes('corp-os-check'))).toBe(true);
    // …and the attribute itself is an option ("1 posture check"), adding the #role.
    const attr = [...e.el.querySelectorAll<HTMLElement>('[role=option]')].find((o) => clean(o)!.startsWith('#corp-devices'))!;
    attr.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    attr.click();
    e.fixture.detectChanges();
    expect(roles(USERS_GITLAB)).toEqual(['@require-mfa', '#corp-devices']);
    expect([...e.el.querySelectorAll('section[aria-labelledby="pe-posture-h"] .tag-chip')].map((c) => clean(c))).toEqual(['require-mfa', '#corp-devices']);
  });

  it('shield chips and the posture panel open a read-only summary: no create, edit or delete', () => {
    const fixture = TestBed.createComponent(PolicyBuilderComponent);
    fixture.componentRef.setInput('service', GIT_REPO);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('app-service-view-group .check-chip')!.click();
    fixture.detectChanges();
    const summary = el.querySelector('app-posture-check-summary')!;
    expect(summary).not.toBeNull();
    expect(clean(summary.querySelector('.pe-title'))).toBe('require-mfa');
    expect(clean(summary.querySelector('.pcs-type'))).toBe('MFA');
    expect([...summary.querySelectorAll('.pcs-setting')].map((r) => `${clean(r.querySelector('dt'))} ${clean(r.querySelector('dd'))}`)).toEqual([
      'Timeout 1800 s',
      'Prompt on wake on',
      'Prompt on unlock off',
    ]);
    expect(clean(summary.querySelector('.pcs-usage'))).toBe('Used by 1 policy: admins-dev-access');
    // Read-only: no field, no draft action — only Close, and the link to its page.
    expect(summary.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect([...summary.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? clean(b))).toEqual(['Close posture check']);
    const edit = summary.querySelector<HTMLAnchorElement>('.pcs-edit')!;
    expect(clean(edit)).toBe('Edit in Posture Checks');
    expect(edit.getAttribute('href')).toMatch(new RegExp(`^/posture-checks/${REQUIRE_MFA}/edit\\?returnTo=`));

    // The posture panel's chip opens the same summary.
    fixture.componentInstance.openPosture({ groupId: 'dial:pol-001:rule', serviceId: GIT_REPO });
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('app-posture-panel .pp-chip')!.click();
    fixture.detectChanges();
    expect(el.querySelector('app-posture-check-summary')).not.toBeNull();

    // And the editor's required-check names.
    fixture.componentInstance.edit(ADMINS);
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('app-policy-editor .pe-check-link')!.click();
    fixture.detectChanges();
    expect(clean(el.querySelector('app-posture-check-summary .pe-title'))).toBe('require-mfa');

    // Nothing the builder offered made a posture-check op.
    expect(TestBed.inject(PolicyDraftStore).ops().filter((op) => targetOf(op) === 'postureCheck')).toEqual([]);
  });

  it('the round trip keeps the draft and the service, and a check created there is pickable on return', async () => {
    const harness = await RouterTestingHarness.create();
    const store = TestBed.inject(PolicyDraftStore);
    const router = TestBed.inject(Router);
    const builderUrl = `/policy-builder?service=${GIT_REPO}&with=svc-005`;
    const builder = await harness.navigateByUrl(builderUrl, PolicyBuilderComponent);
    store.upsertUpdate(USERS_GITLAB, { name: 'users-gitlab-2' });
    builder.edit(USERS_GITLAB);
    harness.detectChanges();
    const ops = store.ops();

    // "Create it in Posture Checks" — same tab, carrying the way back.
    harness.routeNativeElement!.querySelector<HTMLAnchorElement>('.pe-new-check-link')!.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(router.url.split('?')[0]).toBe('/posture-checks');
    expect(new URLSearchParams(router.url.split('?')[1]).get('returnTo')).toBe(builderUrl);
    const list = harness.routeNativeElement!;
    expect(clean(list.querySelector('.pc-return'))).toContain('Back to Policy Builder');

    // New → create a check there (as its form would) → Save, back on the list.
    list.querySelector<HTMLAnchorElement>('a[href^="/posture-checks/new"]')!.click();
    await harness.fixture.whenStable();
    const create = harness.routeDebugElement!.componentInstance as CreatePostureCheckComponent;
    create.name = 'disk-encrypted';
    create.checkType = 'MFA';
    create.attributes.set(['#encrypted']);
    create.save();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(router.url.split('?')[0]).toBe('/posture-checks');
    expect(TestBed.inject(MockDataService).postureChecks().some((c) => c.name === 'disk-encrypted')).toBe(true);

    // Back to the builder: the same service (and ?with=), the same draft.
    harness.routeNativeElement!.querySelector<HTMLAnchorElement>('.pc-return-link')!.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(router.url).toBe(builderUrl);
    const back = harness.routeDebugElement!.componentInstance as PolicyBuilderComponent;
    expect(back.selectedId()).toBe(GIT_REPO);
    expect(back.withIds()).toEqual(['svc-005']);
    expect(store.ops()).toEqual(ops);

    // The new check is in the picker.
    back.edit(USERS_GITLAB);
    harness.detectChanges();
    const input = harness.routeNativeElement!.querySelector<HTMLInputElement>('#pe-posture-pick')!;
    input.value = 'disk';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    harness.detectChanges();
    expect(roles(USERS_GITLAB)).toEqual(['@disk-encrypted']);
  });

  it('Posture Checks ignores a returnTo that is not the builder', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/posture-checks?returnTo=https://evil.example/', PostureChecksComponent);
    expect(harness.routeNativeElement!.querySelector('.pc-return')).toBeNull();
  });
});
