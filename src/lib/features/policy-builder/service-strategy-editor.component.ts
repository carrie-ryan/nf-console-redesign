import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import type { TerminatorStrategy } from '../../shared/services/mock-data.service';
import { strategyOf } from './draft/config-effects';
import { STRATEGIES } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { hostingFor } from './hosting';

const STRATEGY_HELP: Record<TerminatorStrategy, string> = {
  smartrouting: 'Picks the host with the lowest cost, adjusted for its current load and recent failures. The default.',
  weighted: 'Spreads traffic across hosts by cost: the lower a host’s cost, the more traffic it gets.',
  random: 'Picks any active host at random, ignoring cost.',
};

/**
 * Side panel for ONE service's terminator strategy — the only service field a draft
 * changes. Pending pattern: the choice is local until "Add to draft". The hosts it
 * chooses among (their terminators) are observed state, listed read-only.
 */
@Component({
  selector: 'app-service-strategy-editor',
  standalone: true,
  templateUrl: './service-strategy-editor.component.html',
  styleUrls: ['./policy-editor.component.css', './tag-input.css', './posture-check-editor.component.css'],
})
export class ServiceStrategyEditorComponent {
  private readonly store = inject(PolicyDraftStore);

  readonly serviceId = input.required<string>();
  readonly closed = output<void>();

  readonly editError = signal<string | null>(null);
  readonly strategies = STRATEGIES;
  readonly help = STRATEGY_HELP;

  readonly service = computed(() => this.store.draftWorld().services.find((s) => s.id === this.serviceId()));
  readonly strategy = linkedSignal(() => strategyOf(this.service() ?? {}));
  readonly dirty = computed(() => !!this.service() && this.strategy() !== strategyOf(this.service()!));
  readonly mark = computed(() => this.store.routerMark('service', this.serviceId()));

  /** Observed: the active hosts it would choose among. */
  readonly activeHosts = computed(() => {
    const w = this.store.draftWorld();
    const h = hostingFor(this.serviceId(), w);
    return h.activeHostIds.map((id) => w.identities.find((i) => i.id === id)?.name ?? id);
  });

  addToDraft(): void {
    try {
      this.store.upsertUpdate(this.serviceId(), { terminatorStrategy: this.strategy() }, 'service');
      this.editError.set(null);
      this.closed.emit();
    } catch (e) {
      this.editError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
