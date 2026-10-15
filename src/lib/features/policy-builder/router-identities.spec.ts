/**
 * Router identities: a tunneler-enabled edge router has an identity of its own
 * (type 'router', linked by routerId) and a SYSTEM edge router policy granting it its
 * own router. It can be a named host, and it reaches a service through its own router
 * when the service's SERP covers that router. System policies are Ziti's: the draft
 * refuses any op on them and the editor opens read-only. The pickers mark router
 * identities and can filter to them; member lists and the identity lens show the icon.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/router-identities.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { resolve } from '../authorization/trifecta-resolver';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { applyDraft, type DraftOp } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { routerGap, routersFor } from './draft/router-gap';
import { layoutServiceView } from './service-view.layout';
import { RouterPolicyEditorComponent } from './router-policy-editor.component';
import { SearchPickerComponent, entityItems } from './search-picker.component';
import { ServiceViewComponent } from './service-view.component';
import { IdentityViewComponent } from './identity-view.component';
import { memberDrawer } from './member-drawer.model';

const ROUTER_ID = 'id-077'; // edge-public-us-east-1's identity
const ROUTER_NAME = 'edge-public-us-east-1';
const SYSTEM_ERP = 'rp-sys-er-001';
const GIT_REPO = 'svc-004'; // serp-003: #public → er-001, er-002, er-003
const OFFLINE_SVC = 'svc-006'; // serp-005: @er-002 only
const GIT_SERVERS_HOST = 'pol-005'; // Bind, AnyOf [@server-stage-01] → #git

const clean = (el: Element | null) => el?.textContent!.replace(/\s+/g, ' ').trim() ?? null;

describe('router identities — seed', () => {
  const data = new MockDataService();

  it('er-001 and er-003 run tunnelers; each has a router identity and a system ERP for its own router', () => {
    expect(data.edgeRouters().filter((r) => r.tunnelerEnabled).map((r) => r.id)).toEqual(['er-001', 'er-003']);
    const ids = data.identities().filter((i) => i.routerId);
    expect(ids.map((i) => [i.id, i.name, i.type, i.attributes, i.routerId])).toEqual([
      ['id-077', 'edge-public-us-east-1', 'router', [], 'er-001'],
      ['id-078', 'edge-eu-west-1', 'router', [], 'er-003'],
    ]);
    // Named after its router.
    for (const i of ids) expect(i.name).toBe(data.edgeRouters().find((r) => r.id === i.routerId)!.name);
    expect(data.edgeRouterPolicies().filter((p) => p.isSystem).map((p) => [p.id, p.identityRoles, p.edgeRouterRoles])).toEqual([
      ['rp-sys-er-001', ['@id-077'], ['@er-001']],
      ['rp-sys-er-003', ['@id-078'], ['@er-003']],
    ]);
  });

  it('a router identity has exactly its own router, via its system ERP', () => {
    const world = buildSeedWorld();
    const identity = world.identities.find((i) => i.id === ROUTER_ID)!;
    expect(routersFor(identity, world.edgeRouterPolicies, (p) => p.identityRoles, world.edgeRouters)).toEqual([
      { id: 'er-001', name: ROUTER_NAME, isOnline: true, via: ['edge-router-er-001-system'], viaIds: [SYSTEM_ERP], viaSystem: [true] },
    ]);
  });
});

describe('router identities — as a named host', () => {
  let store: PolicyDraftStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    store = TestBed.inject(PolicyDraftStore);
  });

  const addAsHost = () => {
    const p = store.live().policies.find((x) => x.id === GIT_SERVERS_HOST)!;
    store.upsertUpdate(GIT_SERVERS_HOST, { identityRoles: [...p.identityRoles, `@${ROUTER_NAME}`] });
  };

  it("hosts through its own router where the service's SERP covers it — and not where it doesn't", () => {
    addAsHost();
    const world = store.draftWorld();
    const bind = layoutServiceView(GIT_REPO, world).bind.groups.find((g) => g.policyId === GIT_SERVERS_HOST)!;
    expect(bind.memberIds).toContain(ROUTER_ID);

    // git-repo routes through #public, er-001 among them: reachable via the system ERP.
    const onGit = resolve(ROUTER_ID, GIT_REPO, world);
    expect(onGit.bindStatus).toBe('AUTHORIZED_REACHABLE');
    expect(onGit.bindStatus).not.toBe(resolve(ROUTER_ID, GIT_REPO, store.live()).bindStatus); // it wasn't a host before

    // offline-svc routes through er-002 only: no shared router.
    expect(resolve(ROUTER_ID, OFFLINE_SVC, world).bindStatus).toBe('AUTHORIZED_NO_ROUTER');
  });

  it('a gap fix never extends a system ERP — even one granting exactly the router needed', () => {
    // offline-svc now routes only via er-001; edge-eu-west-1 (er-003 only) hosts it.
    store.upsertUpdate('serp-005', { edgeRouterRoles: ['@er-001'] }, 'serviceEdgeRouterPolicy');
    const p = store.live().policies.find((x) => x.id === GIT_SERVERS_HOST)!;
    store.upsertUpdate(GIT_SERVERS_HOST, { identityRoles: [...p.identityRoles, '@edge-eu-west-1'] });
    const world = store.draftWorld();
    expect(resolve('id-078', OFFLINE_SVC, world).bindStatus).toBe('AUTHORIZED_NO_ROUTER');

    const group = layoutServiceView(OFFLINE_SVC, world).bind.groups.find((g) => g.memberIds.includes('id-078'))!;
    const gap = routerGap(world, OFFLINE_SVC, group.id, 'noSharedRouter')!;
    const ops = gap.fixes.flatMap((f) => [f, ...(f.alternative ? [f.alternative] : [])]).flatMap((f) => f.ops);
    expect(ops.length).toBeGreaterThan(0);
    // rp-sys-er-001 grants exactly {er-001} under AnyOf — the shape an extend fix looks for.
    for (const op of ops) if (op.kind === 'update' || op.kind === 'delete') expect(op.policyId).not.toMatch(/^rp-sys-/);
  });

  it('on the canvas, its member entry shows the router icon', () => {
    addAsHost();
    const fixture = TestBed.createComponent(ServiceViewComponent);
    fixture.componentRef.setInput('serviceId', GIT_REPO);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const link = [...el.querySelectorAll('.member-link')].find((a) => a.textContent!.trim() === ROUTER_NAME)!;
    expect(link.previousElementSibling?.classList.contains('member-router')).toBe(true);
    // Nobody else on the canvas has one (the legend card shows its sample too).
    expect(el.querySelectorAll('.lane .member-router')).toHaveLength(1);
    expect(el.querySelector('.lg-entry[data-entry="card-router"] .member-router')).not.toBeNull();
  });

  it('the member drawer and the identity lens mark it as a router', () => {
    addAsHost();
    const world = store.draftWorld();
    const group = layoutServiceView(GIT_REPO, world).bind.groups.find((g) => g.policyId === GIT_SERVERS_HOST)!;
    const rows = memberDrawer(world, group.id, [GIT_REPO])!.rows;
    expect(rows.filter((r) => r.router).map((r) => r.id)).toEqual([ROUTER_ID]);

    const fixture = TestBed.createComponent(IdentityViewComponent);
    fixture.componentRef.setInput('identityId', ROUTER_ID);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.iv-avatar i')!.classList.contains('fa-tower-broadcast')).toBe(true);
    expect(clean(el.querySelector('.iv-router-tag'))).toBe('router');
    expect(clean(el.querySelector('.iv-router-list'))).toContain('via edge-router-er-001-system system');
  });
});

describe('system policies reject draft ops', () => {
  const live = buildSeedWorld();
  const erp = live.edgeRouterPolicies.find((p) => p.id === SYSTEM_ERP)!;

  it.each<[string, DraftOp]>([
    ['update', { kind: 'update', target: 'edgeRouterPolicy', policyId: SYSTEM_ERP, patch: { edgeRouterRoles: ['#public'] } }],
    ['delete', { kind: 'delete', target: 'edgeRouterPolicy', policyId: SYSTEM_ERP }],
  ])('%s', (_, op) => {
    expect(() => applyDraft(live, [op])).toThrow(/edge-router-er-001-system is a system .* created by Ziti/);
  });

  it("a draft can't create one, or make one", () => {
    const created = { ...erp, id: 'rp-sys-fake', name: 'fake-system' };
    expect(() => applyDraft(live, [{ kind: 'create', target: 'edgeRouterPolicy', policy: created }])).toThrow(/can't create a system/);
    expect(() =>
      applyDraft(live, [{ kind: 'update', target: 'edgeRouterPolicy', policyId: 'rp-001', patch: { isSystem: true } }]),
    ).toThrow(/system one/);
  });

  it('the store refuses them and keeps the draft as it was', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(PolicyDraftStore);
    expect(() => store.upsertUpdate(SYSTEM_ERP, { name: 'mine' }, 'edgeRouterPolicy')).toThrow(/system/);
    expect(() => store.deletePolicy(SYSTEM_ERP, 'edgeRouterPolicy')).toThrow(/system/);
    expect(store.ops()).toEqual([]);
  });

  it('the editor opens read-only: "Created by Ziti for this router", no pickers, no remove, no delete', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(RouterPolicyEditorComponent);
    fixture.componentRef.setInput('target', 'edgeRouterPolicy');
    fixture.componentRef.setInput('policyId', SYSTEM_ERP);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(clean(el.querySelector('.pe-title'))).toBe('System edge router policy');
    expect(clean(el.querySelector('.pe-subtitle'))).toBe('rp-sys-er-001 · system');
    expect(el.querySelector('.pe-subtitle .fa-lock')).not.toBeNull();
    expect(clean(el.querySelector('.rpe-system'))).toContain(`Created by Ziti for this router (${ROUTER_NAME}).`);
    expect(el.querySelector<HTMLInputElement>('#rpe-name')!.readOnly).toBe(true);
    expect([...el.querySelectorAll<HTMLInputElement>('input[type=radio]')].every((r) => r.disabled)).toBe(true);
    expect(el.querySelector('app-search-picker')).toBeNull();
    expect(el.querySelector('.tag-chip-x')).toBeNull();
    expect(el.querySelector('.pe-delete')).toBeNull();
    // Its chips are still shown: the router identity (router icon) and the router.
    expect([...el.querySelectorAll('.tag-chip')].map((c) => clean(c))).toEqual([ROUTER_NAME, ROUTER_NAME]);
    expect(el.querySelector('.tag-chip .fa-tower-broadcast')).not.toBeNull();
    // Both attribute rules are empty: read-only, they say "none".
    expect([...el.querySelectorAll('.rpe-none')].map((n) => n.textContent)).toEqual(['none', 'none']);
  });
});

describe('identity pickers and router identities', () => {
  const world = buildSeedWorld();
  // Linked to a router — not the edge gateways that are merely typed 'router'.
  const routers = world.identities.filter((i) => i.routerId).map((i) => i.name);

  it('marks router identities, and "router" finds them', () => {
    const items = entityItems(world.identities, 'name');
    expect(items.filter((it) => it.kind === 'router').map((it) => it.label)).toEqual(routers);
    expect(routers).toEqual([ROUTER_NAME, 'edge-eu-west-1']);
    expect(items.find((it) => it.label === 'edge-gw-plant-01')!.kind).toBeUndefined();
  });

  it('shows the icon and tag; "Routers only" narrows the list to them and keeps it open', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(SearchPickerComponent);
    fixture.componentRef.setInput('items', entityItems(world.identities, 'name'));
    fixture.componentRef.setInput('inputId', 'p');
    fixture.componentRef.setInput('noun', 'identities');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input')!;
    input.dispatchEvent(new Event('focus'));
    input.value = 'edge';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const option = [...el.querySelectorAll('.sp-option')].find((o) => o.querySelector('.sp-label')!.textContent === ROUTER_NAME)!;
    expect(option.querySelector('.sp-kind.fa-tower-broadcast')).not.toBeNull();
    expect(clean(option.querySelector('.sp-tag'))).toBe('router');

    // Focus moving to the toggle keeps the list open.
    const toggle = el.querySelector<HTMLButtonElement>('.sp-filter')!;
    input.dispatchEvent(new FocusEvent('blur', { relatedTarget: toggle }));
    fixture.detectChanges();
    expect(el.querySelector('.sp-pop')).not.toBeNull();

    input.value = '';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('.sp-filter')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.sp-filter')!.getAttribute('aria-pressed')).toBe('true');
    expect([...el.querySelectorAll('.sp-label')].map((l) => l.textContent)).toEqual(routers);

    el.querySelector<HTMLButtonElement>('.sp-filter')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.sp-option').length).toBeGreaterThan(routers.length);
  });

  it('a list with no router identities has no filter', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(SearchPickerComponent);
    fixture.componentRef.setInput('items', entityItems(world.services, 'id'));
    fixture.componentRef.setInput('inputId', 'p');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('input')!.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el.querySelector('.sp-pop')).not.toBeNull();
    expect(el.querySelector('.sp-filter')).toBeNull();
  });
});
