import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { routerAccess, type Extension, type RoutingSubject } from './draft/router-access';
import { SearchPickerComponent, type PickerItem } from './search-picker.component';
import type { OpenRouterPolicy } from './router-gap.component';

/**
 * Side panel listing the router policies behind ONE subject (routerAccess):
 *   a service (its routing line's "Edit routing") — the service edge router policies
 *     covering it: "Routing";
 *   a group (its card's ⋯ → Routers) or an identity (the identity lens's "Routers") —
 *     the edge router policies giving those identities routers: "Routers".
 * Each policy names its routers and how it matches; its name opens it in the
 * router-policy editor (a system policy opens read-only). "Add … to an existing
 * policy" (a picker) and "New … policy" open the editor on a pending policy — it
 * reaches the draft, as a router-policy update or create, only from there. It reads
 * the draft world, so what it lists follows the draft.
 */
@Component({
  selector: 'app-router-access-panel',
  standalone: true,
  imports: [RouterLink, SearchPickerComponent],
  templateUrl: './router-access-panel.component.html',
  styleUrls: ['./tag-input.css', './router-access-panel.component.css'],
})
export class RouterAccessPanelComponent {
  private readonly store = inject(PolicyDraftStore);

  readonly subject = input.required<RoutingSubject>();
  readonly closed = output<void>();
  readonly openPolicy = output<OpenRouterPolicy>();

  readonly access = computed(() => routerAccess(this.store.draftWorld(), this.subject()));

  /** "Add this service to an existing policy" / "Add these identities …" / "Add laptop-alice …". */
  readonly extendLabel = computed(() => {
    const s = this.subject();
    const who = s.kind === 'service' ? 'this service' : s.kind === 'group' ? 'these identities' : 'this identity';
    return `Add ${who} to an existing policy`;
  });

  readonly pickerItems = computed<PickerItem[]>(() =>
    (this.access()?.extensions ?? []).map((x) => ({
      value: x.id,
      label: x.name,
      // The router rule beside the name ("#public"): which routers it would give.
      attributes: x.routerRule,
      meta: x.note,
      hay: [x.name, ...x.routerRule, ...x.routerNames].join('\n').toLowerCase(),
    })),
  );

  open(policyId: string): void {
    const a = this.access();
    if (a) this.openPolicy.emit({ target: a.target, policyId });
  }

  /** A policy picked: the editor, with the subject's roles added and highlighted. */
  extend(policyId: string): void {
    const a = this.access();
    const x: Extension | undefined = a?.extensions.find((e) => e.id === policyId);
    if (!a || !x) return;
    this.openPolicy.emit({ target: a.target, policyId: x.id, pending: x.pending, pendingKind: 'update', highlight: x.added });
  }

  create(): void {
    const a = this.access();
    if (a) this.openPolicy.emit({ target: a.target, policyId: a.create.id, pending: a.create, pendingKind: 'create' });
  }
}
