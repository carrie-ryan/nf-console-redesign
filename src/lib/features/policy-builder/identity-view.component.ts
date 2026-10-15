import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SearchPickerComponent, attributeItems } from './search-picker.component';
import type { TrifectaStatus } from '../authorization/trifecta-resolver';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { identityOverlaps } from './intercepts';
import { ExportReportButtonComponent } from './export-report-button.component';
import type { ReportScope } from './access-report';
import { explainDenied, groupByReason, layoutIdentityView, type Grant, type ReasonGroup } from './identity-view.layout';
import { expiryIndex } from './expiry';
import { ExpiryPillComponent } from './expiry-pill.component';

/** A reason group with at most this many services starts open. */
export const OPEN_UP_TO = 3;
/** Service names a closed group previews. */
const PREVIEW_NAMES = 3;

const STATUS_TEXT: Record<TrifectaStatus, string> = {
  AUTHORIZED_REACHABLE: 'online route',
  BLOCKED_ROUTERS_OFFLINE: 'routers offline',
  AUTHORIZED_NO_ROUTER: 'no shared router',
  NOT_AUTHORIZED: 'not authorized',
};

/**
 * IDENTITY LENS — one identity's services, from layoutIdentityView() on the draft
 * world: can connect / authorized but can't connect (with the reason) / can host.
 * Can't-connect services are grouped by reason ("no shared router · 37 services"),
 * each group expanding to its rows; small groups start open.
 * Service names link to the service view. "Why can't it reach…?" explains, via
 * explainDenied(), a service it isn't Dial-authorized for.
 *
 * Its attributes are editable chips: × removes one, the picker adds one (typed or
 * picked) — each a one-identity bulk-tagging draft op. Chips the draft added are
 * marked; attributes it removed stay visible, struck through.
 *
 * "Routers" opens the panel listing the edge router policies that give it routers.
 *
 * Time-limited access: a grant through a policy that expires — or through a named
 * entry for this identity that does — carries the same countdown pill as the canvas.
 */
@Component({
  selector: 'app-identity-view',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, ExportReportButtonComponent, SearchPickerComponent, ExpiryPillComponent],
  templateUrl: './identity-view.component.html',
  styleUrls: ['./tag-input.css', './identity-view.component.css'],
})
export class IdentityViewComponent {
  private readonly store = inject(PolicyDraftStore);

  readonly identityId = input.required<string>();
  /** Submitted for review: no "Routers" (the page keeps editors shut too). */
  readonly locked = input(false);
  /** "Routers": the edge router policies giving it routers. */
  readonly routers = output<void>();

  readonly exportScope = computed<ReportScope>(() => ({ kind: 'identities', ids: [this.identityId()] }));

  readonly layout = computed(() => layoutIdentityView(this.identityId(), this.store.draftWorld()));

  // ─── attributes ─────────────────────────────────────────────────────────
  /** Its attributes in live, to mark the draft's additions and show its removals. */
  private readonly liveAttributes = computed(
    () => this.store.live().identities.find((i) => i.id === this.identityId())?.attributes ?? [],
  );
  readonly removedInDraft = computed(() => {
    const now = this.layout().identity.attributes;
    return this.liveAttributes().filter((a) => !now.includes(a));
  });
  addedInDraft(attribute: string): boolean {
    return !this.liveAttributes().includes(attribute);
  }
  readonly attributeOptions = computed(() => attributeItems(this.store.draftWorld().identities, { one: 'identity', many: 'identities' }));
  readonly chosenAttributes = computed(() => new Set(this.layout().identity.attributes));
  readonly attributeError = linkedSignal<string, string | null>({ source: this.identityId, computation: () => null });

  addAttribute(value: string): void {
    const v = value.trim().replace(/^#*/, '');
    if (!v || this.chosenAttributes().has(`#${v}`)) return;
    this.tag({ add: [`#${v}`], remove: [] });
  }

  removeAttribute(attribute: string): void {
    this.tag({ add: [], remove: [attribute] });
  }

  private tag(change: { add: string[]; remove: string[] }): void {
    try {
      this.store.addOp({ kind: 'tag', target: 'identityAttributes', identityIds: [this.identityId()], ...change });
      this.attributeError.set(null);
    } catch (e) {
      this.attributeError.set(e instanceof Error ? e.message : String(e));
    }
  }

  /** Time-limited access, per policy with an expiry. */
  private readonly expiries = computed(() => expiryIndex(this.store.draftWorld()));

  /** When this grant goes: its policy's expiry, or — granted by name — its entry's. */
  grantExpiry(g: Grant): string | null {
    const e = this.expiries().get(g.policyId);
    if (!e) return null;
    return e.at ?? (g.by === 'name' ? (e.entries.get(this.identityId()) ?? null) : null);
  }

  /** Per service it may dial: the services whose intercepts overlap it. */
  readonly overlaps = computed(() => identityOverlaps(this.store.draftWorld(), this.identityId()));
  overlapsOf(serviceId: string): string[] {
    return this.overlaps().get(serviceId) ?? [];
  }

  readonly reasonGroups = computed(() => groupByReason(this.layout().cantConnect));

  /** The user's open/closed choice per reason; absent: open when small. Reset per identity. */
  private readonly reasonOpen = linkedSignal<string, Partial<Record<string, boolean>>>({ source: this.identityId, computation: () => ({}) });

  groupOpen(g: ReasonGroup): boolean {
    return this.reasonOpen()[g.reason] ?? g.rows.length <= OPEN_UP_TO;
  }

  toggleGroup(g: ReasonGroup): void {
    this.reasonOpen.update((o) => ({ ...o, [g.reason]: !this.groupOpen(g) }));
  }

  /** "git-repo, api-prod, +35 more". */
  preview(g: ReasonGroup): string {
    const more = g.rows.length - PREVIEW_NAMES;
    return g.rows.slice(0, PREVIEW_NAMES).map((r) => r.serviceName).join(', ') + (more > 0 ? `, +${more} more` : '');
  }

  /** The service picked in "Why can't it reach…?" — reset when it stops applying. */
  private readonly whyPick = signal<string | null>(null);
  readonly whyServiceId = computed(() => {
    const id = this.whyPick();
    return id && this.layout().notDialAuthorized.some((s) => s.id === id) ? id : null;
  });
  readonly why = computed(() => {
    const id = this.whyServiceId();
    return id ? explainDenied(this.identityId(), id, this.store.draftWorld()) : null;
  });

  statusText(status: TrifectaStatus): string {
    return STATUS_TEXT[status];
  }

  pickWhy(serviceId: string): void {
    this.whyPick.set(serviceId || null);
  }

  routerNames(routers: readonly { name: string; isOnline: boolean }[]): string {
    return routers.map((r) => (r.isOnline ? r.name : `${r.name} (offline)`)).join(', ');
  }
}
