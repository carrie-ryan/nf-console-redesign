import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MockDataService, type Policy } from '../../shared/services/mock-data.service';
import { entityMatchesRoles } from '../authorization/authorization-resolver';
import { MAX_SERVICES } from '../policy-builder/multi-service.layout';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { TruncatedCellComponent } from '../../shared/components/truncated-cell/truncated-cell.component';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

export type PoliciesTab = 'service' | 'edge-router' | 'service-edge-router';

export const POLICY_TABS: readonly { id: PoliciesTab; label: string }[] = [
  { id: 'service', label: 'Service Policies' },
  { id: 'edge-router', label: 'Edge Router Policies' },
  { id: 'service-edge-router', label: 'Service Edge Router Policies' },
];

/** One router policy as a row: its entity side (identities or services) and its routers. */
export interface RouterRow {
  id: string;
  name: string;
  semantic: Policy['semantic'];
  /** Identity roles (ERP) or service roles (SERP). */
  entityRoles: string[];
  routerRoles: string[];
  /** Created by Ziti for a router identity: read-only. */
  system: boolean;
  createdAt: string | null;
}

type Matchable = { id: string; name: string; attributes?: readonly string[] };
const matches = (roles: readonly string[], semantic: Policy['semantic'], e: Matchable) =>
  entityMatchesRoles(roles, semantic, e.attributes ?? [], e.name, e.id);

/** Search by name; the attribute filter keeps rows naming that role on either side. */
const filterRows = <T extends { name: string }>(rows: readonly T[], q: string, attr: string, roles: (r: T) => readonly string[]) => {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => (!needle || r.name.toLowerCase().includes(needle)) && (!attr || roles(r).includes(attr)));
};

/**
 * /policies — three tabs, deep-linkable as `?tab=service|edge-router|service-edge-router`:
 * service policies, edge router policies and service edge router policies, each from
 * live (what the builder commits shows up here; draft content never does). Each tab
 * has a name search and an attribute filter (the roles its policies use, either side).
 *
 * Edit opens the policy in the policy builder, in the draft: a service policy on the
 * services it covers; a router policy in the router-policy editor (`?erp=` / `?serp=`)
 * on a service it concerns — a SERP's first service, an ERP's first service its
 * identities may dial or host — or on the service list when there is none. A system
 * ERP is marked with a lock and opens read-only ("View").
 */
@Component({
  selector: 'app-policies',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent, TruncatedCellComponent],
  templateUrl: './policies.component.html',
  styleUrl: './policies.component.css'
})
export class PoliciesComponent {
  readonly data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);
  readonly openMenuId = signal<string | null>(null);
  private readonly router = inject(Router);

  readonly tabs = POLICY_TABS;

  /** `?tab=` — unknown values show service policies. */
  readonly tab = input<string>();
  readonly activeTab = computed<PoliciesTab>(() => POLICY_TABS.find((t) => t.id === this.tab())?.id ?? 'service');

  /** Search and attribute filter — reset per tab. */
  readonly search = linkedSignal({ source: this.activeTab, computation: () => '' });
  readonly attribute = linkedSignal({ source: this.activeTab, computation: () => '' });

  setTab(id: PoliciesTab): void {
    this.closeMenu();
    this.router.navigate([], { queryParams: { tab: id === 'service' ? null : id }, queryParamsHandling: 'merge' });
  }

  readonly edgeRows = computed<RouterRow[]>(() =>
    this.data.edgeRouterPolicies().map((p) => ({
      id: p.id, name: p.name, semantic: p.semantic, entityRoles: p.identityRoles, routerRoles: p.edgeRouterRoles,
      system: !!p.isSystem, createdAt: p.createdAt,
    })),
  );

  readonly serviceEdgeRows = computed<RouterRow[]>(() =>
    this.data.serviceEdgeRouterPolicies().map((p) => ({
      id: p.id, name: p.name, semantic: p.semantic, entityRoles: p.serviceRoles, routerRoles: p.edgeRouterRoles,
      system: false, createdAt: null,
    })),
  );

  private readonly routerRows = computed(() => (this.activeTab() === 'edge-router' ? this.edgeRows() : this.serviceEdgeRows()));

  /** The attributes the tab's policies use, either side, sorted. */
  readonly attributeOptions = computed(() => {
    const roles =
      this.activeTab() === 'service'
        ? this.data.policies().flatMap((p) => [...p.identityRoles, ...p.serviceRoles])
        : this.routerRows().flatMap((r) => [...r.entityRoles, ...r.routerRoles]);
    return [...new Set(roles.filter((r) => r.startsWith('#')))].sort();
  });

  readonly servicePolicies = computed(() =>
    filterRows(this.data.policies(), this.search(), this.attribute(), (p) => [...p.identityRoles, ...p.serviceRoles]),
  );

  readonly shownRouterRows = computed(() =>
    filterRows(this.routerRows(), this.search(), this.attribute(), (r) => [...r.entityRoles, ...r.routerRoles]),
  );

  /** "3 of 12" while filtering, else "12". */
  readonly countText = computed(() => {
    const [shown, total] =
      this.activeTab() === 'service'
        ? [this.servicePolicies().length, this.data.policies().length]
        : [this.shownRouterRows().length, this.routerRows().length];
    return shown === total ? `${total}` : `${shown} of ${total}`;
  });

  readonly filtering = computed(() => !!(this.search().trim() || this.attribute()));

  clearFilters(): void {
    this.search.set('');
    this.attribute.set('');
  }

  toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.update(current => current === id ? null : id);
  }

  closeMenu(): void {
    this.openMenuId.set(null);
  }

  private coveredServices(roles: readonly string[], semantic: Policy['semantic']): string[] {
    return this.data.services().filter((s) => matches(roles, semantic, s)).map((s) => s.id);
  }

  /** Opens the policy on its policy-builder canvas, in the editor: the first service
   *  it covers in focus, the next ones (up to the canvas limit) beside it. A policy
   *  covering no service opens the builder's service list. */
  edit(policy: Policy): void {
    this.closeMenu();
    const covered = this.coveredServices(policy.serviceRoles, policy.semantic);
    if (!covered.length) {
      this.router.navigate(['/policy-builder']);
      return;
    }
    const others = covered.slice(1, MAX_SERVICES);
    this.router.navigate(['/policy-builder'], {
      queryParams: { service: covered[0], with: others.length ? others.join(',') : null, policy: policy.id },
    });
  }

  /** A router policy in the builder's router-policy editor, on a service it concerns. */
  editRouter(row: RouterRow): void {
    this.closeMenu();
    const erp = this.activeTab() === 'edge-router';
    const service = erp ? this.erpService(row) : this.coveredServices(row.entityRoles, row.semantic)[0];
    this.router.navigate(['/policy-builder'], {
      queryParams: { service: service ?? null, [erp ? 'erp' : 'serp']: row.id },
    });
  }

  /** The first service (world order) one of the ERP's identities may dial or host. */
  private erpService(row: RouterRow): string | undefined {
    const ids = this.data.identities().filter((i) => matches(row.entityRoles, row.semantic, i));
    if (!ids.length) return undefined;
    const granting = this.data.policies().filter((p) => ids.some((i) => matches(p.identityRoles, p.semantic, i)));
    return this.data.services().find((s) => granting.some((p) => matches(p.serviceRoles, p.semantic, s)))?.id;
  }
}
