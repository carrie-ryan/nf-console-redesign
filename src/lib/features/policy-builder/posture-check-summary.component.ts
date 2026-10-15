import { Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MockDataService, type PostureCheck, type PostureCheckType } from '../../shared/services/mock-data.service';
import { checkUsage, usageText } from './draft/config-effects';
import { PolicyDraftStore } from './draft/policy-draft.store';

const TYPE_LABEL: Record<PostureCheckType, string> = {
  MFA: 'MFA',
  OS: 'Operating system',
  Process: 'Process',
  Domain: 'Domain',
  MAC: 'MAC address',
  WindowsDomain: 'Windows domain',
  ServiceProvider: 'Service provider',
};

const list = (v: readonly string[] | undefined) => (v?.length ? v.join(', ') : 'none');

/**
 * A posture check, READ-ONLY: the builder references checks, it doesn't define them.
 * Name, type, attributes, the settings that decide who passes, who passes now, and
 * which policies require it ("Used by N policies"). "Edit in Posture Checks" opens the
 * check on its own page; `returnTo` brings the user back to this service (the draft
 * lives in PolicyDraftStore, so it survives the round trip).
 */
@Component({
  selector: 'app-posture-check-summary',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header class="pe-header">
      <div class="pe-avatar" aria-hidden="true"><i class="fa-solid fa-shield-halved"></i></div>
      <div class="pe-heading">
        <h2 class="pe-title">{{ check()?.name ?? 'Posture check' }}</h2>
        <span class="pe-subtitle">Posture check · read-only here</span>
      </div>
      <button type="button" class="pe-icon-btn" (click)="closed.emit()" aria-label="Close posture check">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
    </header>

    <div class="pe-body">
      @if (check(); as c) {
        <dl class="pcs-facts">
          <div><dt>Type</dt><dd class="pcs-type">{{ typeLabel[c.type] }}</dd></div>
          <div><dt>Attributes</dt><dd>{{ c.attributes.length ? c.attributes.join(', ') : 'none' }}</dd></div>
          @for (s of settings(); track s.label) {
            <div class="pcs-setting"><dt>{{ s.label }}</dt><dd>{{ s.value }}</dd></div>
          }
        </dl>

        <p class="pce-usage pcs-usage">
          <strong>{{ usage() }}</strong>@if (usedBy().length) {: {{ usedBy().join(', ') }}}
        </p>
        <p class="pce-observed">
          <i class="fa-solid fa-satellite-dish" aria-hidden="true"></i>
          {{ passingNow() }} — reported by their devices.
        </p>

        <div class="pe-actions">
          <a class="btn btn-secondary btn-sm pcs-edit" [routerLink]="['/posture-checks', c.id, 'edit']" [queryParams]="{ returnTo: returnTo() }">
            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Edit in Posture Checks
          </a>
        </div>
        <p class="pe-hint">Checks are defined on the Posture Checks page; the builder only chooses which ones a policy requires.</p>
      } @else {
        <p class="pe-hint">This posture check no longer exists.</p>
        <button type="button" class="btn btn-secondary btn-sm" (click)="closed.emit()">Close</button>
      }
    </div>
  `,
  styleUrls: ['./policy-editor.component.css', './posture-check-editor.component.css'],
  styles: `
    .pcs-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.375rem 0.875rem; margin: 0; font-size: 0.8125rem; }
    .pcs-facts div { display: contents; }
    .pcs-facts dt { color: var(--color-text-3); font-weight: 500; }
    .pcs-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--color-text); }
    .pcs-edit { display: inline-flex; align-items: center; gap: 0.375rem; text-decoration: none; }
  `,
})
export class PostureCheckSummaryComponent {
  private readonly store = inject(PolicyDraftStore);
  private readonly data = inject(MockDataService);
  private readonly router = inject(Router);

  readonly checkId = input.required<string>();
  readonly closed = output<void>();

  readonly typeLabel = TYPE_LABEL;
  private readonly world = this.store.draftWorld;

  readonly check = computed<PostureCheck | null>(() => (this.world().postureChecks ?? []).find((c) => c.id === this.checkId()) ?? null);

  /** The settings that decide who passes, per type. */
  readonly settings = computed<{ label: string; value: string }[]>(() => {
    const c = this.check();
    if (!c) return [];
    switch (c.type) {
      case 'MFA':
        return [
          { label: 'Timeout', value: c.timeoutSeconds ? `${c.timeoutSeconds} s` : 'none' },
          { label: 'Prompt on wake', value: c.promptOnWake ? 'on' : 'off' },
          { label: 'Prompt on unlock', value: c.promptOnUnlock ? 'on' : 'off' },
        ];
      case 'OS':
        return [{ label: 'Systems', value: list(c.operatingSystems?.map((o) => (o.minVersion ? `${o.type} ≥ ${o.minVersion}` : o.type))) }];
      case 'Process':
        return [{ label: 'Process', value: c.processPath || 'none' }];
      case 'MAC':
        return [{ label: 'MAC addresses', value: list(c.macAddresses) }];
      case 'ServiceProvider': {
        const conn = c.connectionId ? (this.data.providerConnections().find((x) => x.id === c.connectionId)?.name ?? c.connectionId) : 'none';
        const n = c.conditions?.length ?? 0;
        return [
          { label: 'Connection', value: conn },
          { label: 'Conditions', value: `${n} ${n === 1 ? 'condition' : 'conditions'} (all must pass)` },
        ];
      }
      default:
        return [{ label: 'Domains', value: list(c.domains) }];
    }
  });

  /** The draft's policies that require it. */
  readonly usedBy = computed(() => (this.check() ? checkUsage(this.world(), this.checkId()).map((p) => p.name) : []));
  readonly usage = computed(() => usageText(this.usedBy().length));

  readonly passingNow = computed(() => {
    const n = (this.world().postureResults ?? []).filter((r) => r.passedCheckIds.includes(this.checkId())).length;
    return `${n} ${n === 1 ? 'identity passes' : 'identities pass'} it now`;
  });

  /** Back to this builder view (service, ?with=) after Posture Checks. */
  readonly returnTo = () => this.router.url;
}
