/**
 * Simulated binding (demo) and the no-terminator wording. After a commit, hosts it
 * made ready bind (one terminator each) BIND_DELAY_MS later by the demo clock; hosts
 * that lose their authorization unbind. Recorded in History under "Ziti". While no host
 * has bound, the verdict reads "Ready · hosts start serving after you commit" in a draft
 * and "Waiting for a host to start serving" in live.
 *
 * In the seed, no edge router policy covers #kiosks and gitlab-internal has no dial
 * rule, so the commit below also gives kiosks the #public routers and lets #users dial
 * — a host rule alone would leave them with no route, and "N of N" needs dialers.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/binding-simulator.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { BIND_DELAY_MS, BindingSimulator, ZITI_ACTOR } from './binding-simulator';
import { DemoControls } from './demo-controls';
import type { DraftOp } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { hostingFor, validateTerminators } from './hosting';
import { ServiceViewComponent } from './service-view.component';
import { READY_TEXT, WAITING_TEXT, hostWaiting, verdictFor } from './service-view.layout';

const GITLAB = 'svc-001'; // gitlab-internal
const KIOSKS = ['id-005', 'id-017', 'id-018', 'id-058', 'id-059', 'id-062'];

const HOST_RULE: DraftOp = {
  kind: 'create',
  policy: { id: 'pol-kiosk-host', name: 'kiosks-host-gitlab', createdAt: '', status: 'active', type: 'bind', semantic: 'AnyOf', identityRoles: ['#kiosks'], serviceRoles: [`@${GITLAB}`], postureCheckRoles: [] },
};
const KIOSK_ROUTERS: DraftOp = {
  kind: 'create',
  target: 'edgeRouterPolicy',
  policy: { id: 'rp-kiosks', name: 'kiosks-public-routers', createdAt: '', status: 'active', semantic: 'AllOf', identityRoles: ['#kiosks'], edgeRouterRoles: ['#public'] },
};
const USERS_DIAL: DraftOp = {
  kind: 'create',
  policy: { id: 'pol-users-gitlab-int', name: 'users-dial-gitlab', createdAt: '', status: 'active', type: 'dial', semantic: 'AnyOf', identityRoles: ['#users'], serviceRoles: [`@${GITLAB}`], postureCheckRoles: [] },
};

const clean = (el: Element | null) => el?.textContent!.replace(/\s+/g, ' ').trim() ?? null;

describe('simulated binding', () => {
  let store: PolicyDraftStore;
  let sim: BindingSimulator;
  let data: MockDataService;
  const terminators = () => data.terminators().filter((t) => t.serviceId === GITLAB);

  /** The gitlab-internal node: its verdict line (text, classes, tooltip) and hosting line. */
  const node = () => {
    const fixture = TestBed.createComponent(ServiceViewComponent);
    fixture.componentRef.setInput('serviceId', GITLAB);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const verdict = el.querySelector('.verdict')!;
    return { verdict: clean(verdict), classes: verdict.className, title: verdict.getAttribute('title'), hosting: clean(el.querySelector('.hosting')) };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    store = TestBed.inject(PolicyDraftStore);
    sim = TestBed.inject(BindingSimulator);
    data = TestBed.inject(MockDataService);
    for (const op of [HOST_RULE, KIOSK_ROUTERS, USERS_DIAL]) store.addOp(op);
  });
  afterEach(() => vi.useRealTimers());

  it('in the draft: "Ready · hosts start serving after you commit", in neutral blue', () => {
    expect(verdictFor(GITLAB, store.draftWorld()).reason).toBe('no host serving yet');
    const n = node();
    expect(n.verdict).toBe(READY_TEXT);
    expect(n.classes).toContain('verdict-ready');
    expect(n.classes).not.toContain('verdict-warn');
  });

  it('after the commit, 6 kiosks bind gitlab-internal 3 s later; History says "Ziti"', () => {
    store.commit();
    expect(terminators()).toEqual([]);
    expect(node().verdict).toBe(WAITING_TEXT);

    vi.advanceTimersByTime(BIND_DELAY_MS - 1);
    expect(terminators()).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(terminators().map((t) => [t.identityId, t.routerId, t.precedence])).toEqual(KIOSKS.map((id) => [id, 'er-001', 'default']));
    expect(validateTerminators(store.live())).toEqual([]);
    expect(store.history()[0]).toMatchObject({ actor: ZITI_ACTOR, observed: true, changeLines: ['6 hosts started serving gitlab-internal'] });

    const v = verdictFor(GITLAB, store.live());
    expect(v.reason).toBeNull();
    expect(v.text).toBe(`${v.dialTotal} of ${v.dialTotal} can connect · 6 of 6 hosts serving`);
    const n = node();
    expect(n.verdict).toBe(`${v.dialTotal} of ${v.dialTotal} can connect`);
    expect(n.hosting).toBe('6 active · 6 authorized');
  });

  it('with "Hosts bind after commit" off, it stays "Waiting for a host to start serving" (amber, with why)', () => {
    sim.enabled.set(false);
    store.commit();
    vi.advanceTimersByTime(BIND_DELAY_MS * 10);
    expect(terminators()).toEqual([]);
    const n = node();
    expect(n.verdict).toBe(WAITING_TEXT);
    expect(n.classes).toContain('verdict-warn');
    expect(n.title).toBe('6 hosts are authorized and reachable; none has bound this service yet.');
    expect(store.history().map((c) => c.actor)).toEqual(['You']);
  });

  it('deleting the rule unbinds them: their terminators go, "6 hosts stopped serving"', () => {
    store.commit();
    vi.advanceTimersByTime(BIND_DELAY_MS);
    expect(terminators()).toHaveLength(6);

    store.deletePolicy(HOST_RULE.kind === 'create' ? HOST_RULE.policy.id : '');
    store.commit();
    vi.advanceTimersByTime(BIND_DELAY_MS);
    expect(terminators()).toEqual([]);
    expect(store.history()[0]).toMatchObject({ actor: ZITI_ACTOR, changeLines: ['6 hosts stopped serving gitlab-internal'] });
    expect(verdictFor(GITLAB, store.live()).reason).toBe('no host');
  });

  it('advancing the demo clock runs a binding that has come due', () => {
    store.commit();
    TestBed.inject(DemoControls).run('clock'); // +1 h, no real time passing
    expect(terminators()).toHaveLength(6);
  });

  it("only hosts the commit made ready bind: the seed's idle hosts stay idle", () => {
    store.discard();
    const before = hostingFor('svc-004', store.live()).servingHosts.length; // git-repo: 2 of 9 serving
    store.upsertUpdate('pol-002', { name: 'users-gitlab-2' }); // touches git-repo, readies no host
    store.commit();
    vi.advanceTimersByTime(BIND_DELAY_MS);
    expect(hostingFor('svc-004', store.live()).servingHosts.length).toBe(before);
    expect(store.history().map((c) => c.actor)).toEqual(['You']);
  });

  it("observed History entries can't be reverted", () => {
    store.commit();
    vi.advanceTimersByTime(BIND_DELAY_MS);
    expect(store.history()[0].observed).toBe(true);
    expect(store.history()[0].ops).toEqual([]);
  });
});

describe('hostWaiting', () => {
  it("a draft that leaves a waiting service's hosts as they are reads as live: waiting", () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(PolicyDraftStore);
    for (const op of [HOST_RULE, KIOSK_ROUTERS, USERS_DIAL]) store.addOp(op);
    store.commit(); // no simulator: nobody binds
    store.upsertUpdate('pol-users-gitlab-int', { name: 'renamed' });
    expect(hostWaiting(GITLAB, store.draftWorld(), store.live())!.kind).toBe('waiting');
    expect(hostWaiting('svc-004', store.draftWorld(), store.live())).toBeNull(); // git-repo is serving
  });
});
