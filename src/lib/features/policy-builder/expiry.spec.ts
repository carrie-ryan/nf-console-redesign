/**
 * Time-limited access (prototype of NetFoundry-side scheduling; Ziti has no native
 * expiry). A service policy's expiresAt deletes it; a named entry's removes only that
 * entry. The scheduler applies each to live as actor "Expiry" — History, the live-change
 * notice, conflicts, and (through the binding simulation) hosts that stop serving.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/expiry.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { BIND_DELAY_MS, ZITI_ACTOR } from './binding-simulator';
import { DemoClock } from './demo-clock';
import { DemoControls } from './demo-controls';
import { describeOps } from './draft/draft-summary';
import { applyDraft } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { DraftReviewComponent } from './draft-review.component';
import { EXPIRY_ACTOR, expiryTestWarnings, untilText } from './expiry';
import { ExpiryScheduler } from './expiry-scheduler';
import { PolicyEditorComponent } from './policy-editor.component';
import { ServiceViewComponent } from './service-view.component';

const NOW = new Date('2026-10-14T10:00:00Z');
const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const USERS_GITLAB = 'pol-002'; // dial git-repo: #users
const SERVERS_BIND_API = 'pol-003'; // bind api-prod: #servers (all of, with #corp-devices)
const API_PROD = 'svc-005';
const GIT_REPO = 'svc-004';

const clean = (el: Element | null | undefined) => el?.textContent!.replace(/\s+/g, ' ').trim() ?? null;

describe('time-limited access', () => {
  let store: PolicyDraftStore;
  let data: MockDataService;
  let demo: DemoControls;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    store = TestBed.inject(PolicyDraftStore);
    data = TestBed.inject(MockDataService);
    demo = TestBed.inject(DemoControls);
  });
  afterEach(() => vi.useRealTimers());

  const policy = (id: string) => store.live().policies.find((p) => p.id === id);

  describe('model', () => {
    it('setting either field is a normal draft update; an entry must name a role the policy has', () => {
      store.upsertUpdate(USERS_GITLAB, { expiresAt: at(8 * HOUR) });
      expect(store.ops()).toEqual([{ kind: 'update', policyId: USERS_GITLAB, patch: { expiresAt: at(8 * HOUR) } }]);
      expect(() => store.upsertUpdate(USERS_GITLAB, { expiringEntries: [{ role: '@bob@corp.com', expiresAt: at(HOUR) }] })).toThrow(
        /isn't in its identity roles/,
      );
      expect(() => store.upsertUpdate(USERS_GITLAB, { expiresAt: 'tomorrow' })).toThrow(/invalid expiresAt/);
      store.upsertUpdate(USERS_GITLAB, { expiresAt: undefined }); // back to live: the update goes
      expect(store.ops()).toEqual([]);
    });

    it('untilText rounds to the minute', () => {
      expect(untilText(8 * HOUR - 5_000)).toBe('8 h');
      expect(untilText(8 * HOUR - 60_000)).toBe('7 h 59 m');
      expect(untilText(45 * 60_000)).toBe('45 m');
      expect(untilText(26 * HOUR)).toBe('1 day 2 h');
      expect(untilText(10_000)).toBe('less than a minute');
    });
  });

  describe('expiry', () => {
    /** users-gitlab with two named entries: bob (in 30 min) and laptop-alice (in 8 h). */
    function commitEntries(): void {
      const roles = [...policy(USERS_GITLAB)!.identityRoles, '@bob@corp.com', '@server-prod-01'];
      store.upsertUpdate(USERS_GITLAB, {
        identityRoles: roles,
        expiringEntries: [
          { role: '@bob@corp.com', expiresAt: at(30 * 60_000) },
          { role: '@server-prod-01', expiresAt: at(8 * HOUR) },
        ],
      });
      store.commit();
    }

    it('an entry expiring after "Advance clock" removes only that entry, as actor Expiry', () => {
      commitEntries();
      demo.run('clock'); // +1 h: bob's entry is due, server-prod-01's isn't

      const p = policy(USERS_GITLAB)!;
      expect(p.identityRoles).toEqual(['#users', '@server-prod-01']);
      expect(p.expiringEntries).toEqual([{ role: '@server-prod-01', expiresAt: at(8 * HOUR) }]);
      expect(store.history()[0]).toMatchObject({ actor: EXPIRY_ACTOR, changeLines: ['Updated users-gitlab: removed @bob@corp.com'] });
      expect(store.lastLiveChange()).toMatchObject({ actor: EXPIRY_ACTOR, entities: [{ id: USERS_GITLAB, name: 'users-gitlab' }] });
    });

    it('the scheduler also runs on its own once the time passes (demo clock)', () => {
      TestBed.inject(ExpiryScheduler);
      commitEntries();
      TestBed.tick(); // arms the timer for the next expiry
      vi.advanceTimersByTime(30 * 60_000);
      expect(policy(USERS_GITLAB)!.identityRoles).not.toContain('@bob@corp.com');
      expect(store.history()[0].actor).toBe(EXPIRY_ACTOR);
    });

    it('with a draft open: the live-change notice, and a conflict on a policy the draft edits', () => {
      commitEntries();
      store.upsertUpdate(USERS_GITLAB, { name: 'users-gitlab-renamed' });
      demo.run('clock');
      expect(store.liveSinceDraft().map((c) => c.actor)).toEqual([EXPIRY_ACTOR]);
      expect(store.conflicts().map((c) => c.id)).toEqual([USERS_GITLAB]);
    });

    it('a policy expiry deletes it, and its hosts stop serving (binding simulation)', () => {
      const serving = () => data.terminators().filter((t) => t.serviceId === API_PROD);
      expect(serving()).toHaveLength(3);
      store.upsertUpdate(SERVERS_BIND_API, { expiresAt: at(HOUR) });
      store.commit();

      demo.run('clock');
      expect(policy(SERVERS_BIND_API)).toBeUndefined();
      expect(store.history()[0]).toMatchObject({ actor: EXPIRY_ACTOR, changeLines: ['Deleted servers-bind-api (host rule)'] });
      expect(serving()).toHaveLength(3); // unbinding lands BIND_DELAY_MS later

      vi.advanceTimersByTime(BIND_DELAY_MS);
      expect(serving()).toEqual([]);
      expect(store.history()[0]).toMatchObject({ actor: ZITI_ACTOR, changeLines: ['3 hosts stopped serving api-prod'] });
    });
  });

  describe('review', () => {
    it('change lines state the expiry', () => {
      const ops = [
        {
          kind: 'update' as const,
          policyId: USERS_GITLAB,
          patch: { identityRoles: ['#users', '@bob@corp.com'], expiringEntries: [{ role: '@bob@corp.com', expiresAt: at(8 * HOUR) }] },
        },
      ];
      expect(describeOps(store.live(), ops, NOW.getTime())).toEqual([
        'Updated users-gitlab: added @bob@corp.com; bob@corp.com via users-gitlab expires in 8 h',
      ]);
      expect(describeOps(store.live(), [{ kind: 'update', policyId: USERS_GITLAB, patch: { expiresAt: at(8 * HOUR) } }], NOW.getTime())).toEqual([
        'users-gitlab expires in 8 h',
      ]);
    });

    it("warns when the removal at expiry would fail an access test: laptop-alice's must-connect", () => {
      store.upsertUpdate(USERS_GITLAB, { expiresAt: at(8 * HOUR) });
      const warnings = expiryTestWarnings(store.live(), store.draftWorld(), NOW.getTime());
      expect(warnings.map((w) => w.testId)).toEqual(['at-002']);
      expect(warnings[0].text).toBe('When users-gitlab expires (in 8 h), this test will fail: laptop-alice must connect to git-repo.');

      const fixture = TestBed.createComponent(DraftReviewComponent);
      fixture.componentRef.setInput('serviceId', GIT_REPO);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(clean(el.querySelector('.dr-expiry'))).toBe(warnings[0].text);
      expect(clean(el.querySelector('.dr-changes li'))).toBe('users-gitlab expires in 8 h');
    });

    it('no warning when nothing an access test needs expires', () => {
      store.upsertUpdate(SERVERS_BIND_API, { expiresAt: at(8 * HOUR) });
      // at-001 (#kiosks must not host api-prod) still passes once it's gone.
      expect(expiryTestWarnings(store.live(), store.draftWorld(), NOW.getTime())).toEqual([]);
    });
  });

  describe('editor', () => {
    const editor = (policyId: string) => {
      const fixture = TestBed.createComponent(PolicyEditorComponent);
      fixture.componentRef.setInput('policyId', policyId);
      fixture.detectChanges();
      return { fixture, el: fixture.nativeElement as HTMLElement };
    };

    it('"Expires" sets the policy expiry from now; "Never" clears it', () => {
      const { fixture, el } = editor(USERS_GITLAB);
      const select = el.querySelector<HTMLSelectElement>('#pe-expires')!;
      expect([...select.options].map((o) => o.text.trim())).toEqual(['Never', 'In 1 hour', 'In 8 hours', 'In 1 day', 'In 1 week', 'On a date…']);
      select.value = '8h';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(store.draftWorld().policies.find((p) => p.id === USERS_GITLAB)!.expiresAt).toBe(at(8 * HOUR));
      expect(clean(el.querySelector('.pe-expiry app-expiry-pill'))).toBe('expires in 8 h');
      expect(select.value).toBe('8h');

      select.value = 'never';
      select.dispatchEvent(new Event('change'));
      expect(store.ops()).toEqual([]);
    });

    it("a named chip's clock button sets that entry's expiry; removing the chip drops it", () => {
      store.upsertUpdate(USERS_GITLAB, { identityRoles: ['#users', '@bob@corp.com'] });
      const { fixture, el } = editor(USERS_GITLAB);
      el.querySelector<HTMLButtonElement>('.pe-entry-clock')!.click();
      fixture.detectChanges();
      const opt = [...el.querySelectorAll<HTMLButtonElement>('.pe-entry-opt')].find((b) => b.textContent!.trim() === '1 hour')!;
      opt.click();
      fixture.detectChanges();
      const p = () => store.draftWorld().policies.find((x) => x.id === USERS_GITLAB)!;
      expect(p().expiringEntries).toEqual([{ role: '@bob@corp.com', expiresAt: at(HOUR) }]);
      expect(clean(el.querySelector('.tag-chip app-expiry-pill'))).toBe('1 h');

      el.querySelector<HTMLButtonElement>('[aria-label="Remove bob@corp.com"]')!.click();
      expect(p().identityRoles).toEqual(['#users']);
      expect(p().expiringEntries).toBeUndefined();
    });
  });

  describe('canvas', () => {
    it('a countdown pill on the group, amber under 1 h, ticking with the demo clock', () => {
      store.upsertUpdate(USERS_GITLAB, { expiresAt: at(8 * HOUR) });
      store.commit();
      const fixture = TestBed.createComponent(ServiceViewComponent);
      fixture.componentRef.setInput('serviceId', GIT_REPO);
      fixture.detectChanges();
      const pill = () => (fixture.nativeElement as HTMLElement).querySelector('[data-group-id] app-expiry-pill, .policy-box app-expiry-pill')!;
      vi.advanceTimersByTime(60_000);
      TestBed.inject(DemoClock).refresh();
      fixture.detectChanges();
      expect(clean(pill())).toBe('expires in 7 h 59 m');
      expect(pill().classList).not.toContain('soon');

      TestBed.inject(DemoClock).advance(7 * HOUR);
      fixture.detectChanges();
      expect(clean(pill())).toBe('expires in 59 m');
      expect(pill().classList).toContain('soon');
    });

    it("a named entry's pill sits next to the member", () => {
      store.upsertUpdate(USERS_GITLAB, {
        identityRoles: ['#users', '@bob@corp.com'],
        expiringEntries: [{ role: '@bob@corp.com', expiresAt: at(2 * HOUR) }],
      });
      const fixture = TestBed.createComponent(ServiceViewComponent);
      fixture.componentRef.setInput('serviceId', GIT_REPO);
      fixture.detectChanges();
      const pill = (fixture.nativeElement as HTMLElement).querySelector('.member-expiry');
      expect(clean(pill)).toBe('expires in 2 h');
      expect(clean(pill?.previousElementSibling)).toBe('bob@corp.com');
    });
  });

  it('applyDraft keeps expiring entries valid as roles change', () => {
    const live = store.live();
    const withEntry = applyDraft(live, [
      { kind: 'update', policyId: USERS_GITLAB, patch: { identityRoles: ['#users', '@bob@corp.com'], expiringEntries: [{ role: '@bob@corp.com', expiresAt: at(HOUR) }] } },
    ]);
    expect(() => applyDraft(withEntry, [{ kind: 'update', policyId: USERS_GITLAB, patch: { identityRoles: ['#users'] } }])).toThrow(
      /expiring entry for @bob@corp.com/,
    );
  });
});

describe('time-limited access: warnings and reverts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });
  afterEach(() => vi.useRealTimers());

  it('the warning names the removal that breaks the test, not an earlier one', () => {
    const store = TestBed.inject(PolicyDraftStore);
    store.upsertUpdate(USERS_GITLAB, {
      identityRoles: ['#users', '@carol@corp.com'],
      expiresAt: at(8 * HOUR),
      expiringEntries: [{ role: '@carol@corp.com', expiresAt: at(2 * HOUR) }],
    });
    expect(expiryTestWarnings(store.live(), store.draftWorld(), NOW.getTime()).map((w) => w.text)).toEqual([
      'When users-gitlab expires (in 8 h), this test will fail: laptop-alice must connect to git-repo.',
    ]);
  });

  it('a countdown under an hour never reads "1 h"', () => {
    expect(untilText(HOUR - 1_000)).toBe('59 m');
  });

  it("reverting an expiry puts the policy back without its past expiry", () => {
    const store = TestBed.inject(PolicyDraftStore);
    const demo = TestBed.inject(DemoControls);
    store.upsertUpdate(USERS_GITLAB, { expiresAt: at(HOUR) });
    store.commit();
    demo.run('clock');
    expect(store.live().policies.some((p) => p.id === USERS_GITLAB)).toBe(false);

    store.startRevert(store.history()[0].id);
    store.commit();
    const back = store.live().policies.find((p) => p.id === USERS_GITLAB)!;
    expect(back.expiresAt).toBeUndefined();
    demo.run('clock');
    expect(store.live().policies.some((p) => p.id === USERS_GITLAB)).toBe(true);
  });
});
