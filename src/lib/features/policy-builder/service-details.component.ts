import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
import { PillComponent } from '../../shared/components/pill/pill.component';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { layoutServiceView, hostWaiting } from './service-view.layout';

/**
 * Side panel with one service's details: its own fields (from the draft world,
 * which never changes services), then the policies that cover it on each lane
 * and its eligible routers. A policy name opens it in the editor.
 */
@Component({
  selector: 'app-service-details',
  standalone: true,
  imports: [DatePipe, PillComponent],
  templateUrl: './service-details.component.html',
  styleUrl: './service-details.component.css',
})
export class ServiceDetailsComponent {
  private readonly store = inject(PolicyDraftStore);

  readonly serviceId = input.required<string>();
  readonly closed = output<void>();
  /** A covering policy was picked: edit it. */
  readonly editPolicy = output<string>();

  readonly service = computed(() => this.store.draftWorld().services.find((s) => s.id === this.serviceId()) ?? null);

  private readonly layout = computed(() => layoutServiceView(this.serviceId(), this.store.draftWorld()));

  readonly verdict = computed(() => this.layout().serviceVerdict);
  /** No host serving yet: "Ready · …after you commit" (draft) / "Waiting for a host…" (live). */
  readonly waiting = computed(() => hostWaiting(this.serviceId(), this.store.draftWorld(), this.store.live()));
  readonly routers = computed(() => this.layout().routers);

  /** Covering policies per lane, one entry per policy (a policy can form two groups). */
  readonly policies = computed(() => {
    const marks = this.store.marks();
    const lane = (l: ReturnType<typeof layoutServiceView>['bind']) => {
      const seen = new Map<string, { id: string; name: string; memberIds: Set<string> }>();
      const entry = (id: string, name: string) => seen.get(id) ?? seen.set(id, { id, name, memberIds: new Set() }).get(id)!;
      // Named and rule groups of one policy can overlap: count distinct identities.
      for (const g of l.groups) g.memberIds.forEach((m) => entry(g.policyId, g.policyName).memberIds.add(m));
      for (const e of l.emptyPolicies) entry(e.policyId, e.policyName);
      return [...seen.values()].map((p) => ({
        id: p.id,
        name: p.name,
        members: p.memberIds.size,
        mark: marks.get(p.id) ?? null,
      }));
    };
    const { bind, dial } = this.layout();
    return { bind: lane(bind), dial: lane(dial) };
  });

  readonly tags = computed(() => Object.entries(this.service()?.tags ?? {}));
}
