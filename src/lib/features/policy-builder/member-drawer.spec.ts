/**
 * Member drawer: each member's status per canvas service (the canvas's own buckets),
 * search and status chips, and a virtualised list — only the rows in view render.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/member-drawer.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { buildScaleWorld } from '../authorization/scale-world';
import { MockDataService } from '../../shared/services/mock-data.service';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { MemberDrawerComponent, ROW_HEIGHT } from './member-drawer.component';
import { filterCounts, filterMembers, memberDrawer } from './member-drawer.model';
import { layoutServiceView } from './service-view.layout';
import { hostingFor } from './hosting';

const seed = buildSeedWorld();

describe('memberDrawer (model)', () => {
  it('admins-dev-access on git-repo: carol is blocked by posture, the rest reachable', () => {
    const d = memberDrawer(seed, 'dial:pol-001:rule', ['svc-004'])!;
    expect(d.services).toEqual([{ id: 'svc-004', name: 'git-repo' }]);
    expect(d.rows.map((r) => [r.name, r.statuses])).toEqual([
      ['alice@corp.com', ['reachable']],
      ['bob@corp.com', ['reachable']],
      ['carol@corp.com', ['blocked']],
    ]);
    expect(filterCounts(d.rows)).toMatchObject({ blocked: 1, noSharedRouter: 0 });
  });

  it('Bind groups: exactly the active hosts are "serving"', () => {
    const active = new Set(hostingFor('svc-004', seed).activeHostIds);
    const serving = layoutServiceView('svc-004', seed)
      .bind.groups.flatMap((g) => memberDrawer(seed, g.id, ['svc-004'])!.rows)
      .filter((r) => r.statuses[0] === 'serving')
      .map((r) => r.id);
    expect(new Set(serving)).toEqual(active);
    expect(active.size).toBeGreaterThan(0);
  });

  it('several services: one status per service the group reaches, in canvas order', () => {
    const d = memberDrawer(seed, 'dial:pol-001:rule', ['svc-004', 'svc-002', 'svc-005'])!;
    expect(d.services.map((s) => s.id)).toEqual(['svc-004', 'svc-005']); // api-prod (svc-002) isn't reached
    expect(d.rows.every((r) => r.statuses.length === 2)).toBe(true);
  });

  it('search by name or attribute (any case); chips match a status on any service', () => {
    const d = memberDrawer(seed, 'dial:pol-002:rule', ['svc-004', 'svc-006', 'svc-007'])!;
    expect(filterMembers(d.rows, 'ALICE', new Set()).map((r) => r.name)).toEqual(['laptop-alice']);
    const attr = d.rows[0].attributes[0];
    expect(filterMembers(d.rows, attr, new Set()).every((r) => r.attributes.includes(attr))).toBe(true);
    const offline = filterMembers(d.rows, '', new Set(['routersOffline']));
    expect(offline.length).toBe(filterCounts(d.rows).routersOffline);
    expect(offline.every((r) => r.statuses.includes('routersOffline'))).toBe(true);
  });

  it('a group not on the canvas: null', () => {
    expect(memberDrawer(seed, 'dial:nope:rule', ['svc-004'])).toBeNull();
  });
});

describe('MemberDrawerComponent', () => {
  it('renders only the rows in view; scrolling moves the window; names link to the identity lens', () => {
    TestBed.configureTestingModule({ imports: [MemberDrawerComponent], providers: [provideRouter([])] });
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
    const svc = live.services[0].id;
    const view = layoutServiceView(svc, live);
    const big = [...view.bind.groups, ...view.dial.groups].sort((a, b) => b.memberCount - a.memberCount)[0];
    expect(big.memberCount).toBeGreaterThan(100);

    const fixture = TestBed.createComponent(MemberDrawerComponent);
    fixture.componentRef.setInput('groupId', big.id);
    fixture.componentRef.setInput('serviceIds', [svc]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => [...el.querySelectorAll('.md-row .md-name')].map((a) => a.textContent);
    const first = names();
    expect(first.length).toBeLessThan(40); // 600 px of 52 px rows, plus overscan
    expect(el.querySelector('.md-count')!.textContent!.trim()).toBe(`${big.memberCount} members`);
    expect(el.querySelector('.md-rows')!.getAttribute('style')).toContain(`height: ${big.memberCount * ROW_HEIGHT}px`);
    expect(el.querySelector('.md-name')!.getAttribute('href')).toContain(`identity=${big.memberIds[0]}`);

    fixture.componentInstance.scrollTop.set(50 * ROW_HEIGHT);
    fixture.detectChanges();
    expect(names()[0]).toBe(big.memberNames[50 - 8]); // the window starts OVERSCAN rows above
    expect(names()).not.toEqual(first);

    const input = el.querySelector<HTMLInputElement>('.md-search-input')!;
    input.value = big.memberNames[7];
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(names()).toContain(big.memberNames[7]);
    expect(el.querySelector('.md-count')!.textContent).toContain(`of ${big.memberCount} members`);
  });
});
