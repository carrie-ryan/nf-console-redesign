import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { costOf, precedenceOf } from './draft/config-effects';
import { MAX_COST, PRECEDENCES } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';

type Precedence = (typeof PRECEDENCES)[number];

const PRECEDENCE_HELP: Record<Precedence, string> = {
  default: 'Shares traffic with the other default hosts. The usual choice.',
  required: 'Preferred: while it is up, default hosts get no traffic.',
  failed: 'Last resort: gets traffic only when no better host is left.',
};

/**
 * Side panel for ONE host identity's default hosting precedence and cost — the only
 * identity fields a draft changes. They apply to the terminators it creates from now
 * on; its current terminators are observed state, listed read-only. Pending pattern:
 * local until "Add to draft".
 */
@Component({
  selector: 'app-host-editor',
  standalone: true,
  templateUrl: './host-editor.component.html',
  styleUrls: ['./policy-editor.component.css', './tag-input.css', './posture-check-editor.component.css'],
})
export class HostEditorComponent {
  private readonly store = inject(PolicyDraftStore);

  readonly identityId = input.required<string>();
  readonly closed = output<void>();

  readonly editError = signal<string | null>(null);
  readonly precedences = PRECEDENCES;
  readonly help = PRECEDENCE_HELP;
  readonly maxCost = MAX_COST;

  readonly identity = computed(() => this.store.draftWorld().identities.find((i) => i.id === this.identityId()));
  readonly precedence = linkedSignal<Precedence>(() => precedenceOf(this.identity() ?? {}) as Precedence);
  readonly cost = linkedSignal(() => costOf(this.identity() ?? {}));
  readonly mark = computed(() => this.store.routerMark('identity', this.identityId()));

  readonly costValid = computed(() => Number.isInteger(this.cost()) && this.cost() >= 0 && this.cost() <= MAX_COST);
  readonly dirty = computed(() => {
    const i = this.identity();
    return !!i && (this.precedence() !== precedenceOf(i) || this.cost() !== costOf(i));
  });

  /** Observed: its terminators now, with where they run. */
  readonly terminators = computed(() => {
    const w = this.store.draftWorld();
    return (w.terminators ?? [])
      .filter((t) => t.identityId === this.identityId())
      .map((t) => ({
        id: t.id,
        service: w.services.find((s) => s.id === t.serviceId)?.name ?? t.serviceId,
        router: w.edgeRouters.find((r) => r.id === t.routerId)?.name ?? t.routerId,
        precedence: t.precedence,
        cost: t.cost,
      }));
  });

  setCost(raw: string): void {
    this.cost.set(raw.trim() === '' ? NaN : Number(raw));
  }

  addToDraft(): void {
    if (!this.costValid()) return;
    const i = this.identity()!;
    const patch: Record<string, unknown> = {};
    if (this.precedence() !== precedenceOf(i)) patch['hostingPrecedence'] = this.precedence();
    if (this.cost() !== costOf(i)) patch['hostingCost'] = this.cost();
    try {
      this.store.upsertUpdate(this.identityId(), patch, 'identity');
      this.editError.set(null);
      this.closed.emit();
    } catch (e) {
      this.editError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
