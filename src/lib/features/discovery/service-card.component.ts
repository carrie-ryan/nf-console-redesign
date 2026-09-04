import { Component, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ServiceDraft } from './discovery.models';

/**
 * Shared editable service card, extracted from the roles create-policy modal so
 * both it and the raw "construct from selection" modal use one card.
 *
 * Context-agnostic — it binds only to a `ServiceDraft` + a few flags, never to a
 * cluster/proposal:
 *   • NEW service (`isNew`)  → full editable definition (name / protocol /
 *     intercept / host) + the auto `#svc-role` attribute line,
 *   • EXISTING service       → read-only "tag existing" treatment.
 * Collapsible; the include/exclude checkbox is owned by the host (the card just
 * reflects `included` and emits `includeToggled`).
 */
@Component({
  selector: 'app-service-card',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './service-card.component.html',
  styleUrl: './service-card.component.css',
})
export class ServiceCardComponent {
  /** Two-way: the host stores the (possibly edited) draft; the card edits fields. */
  readonly draft = model.required<ServiceDraft>();
  /** NEW (create) vs EXISTING (tag) — drives editable vs read-only treatment. */
  readonly isNew = input.required<boolean>();
  /** The `#svc-role` this service carries (new) or is tagged with (existing). */
  readonly attribute = input.required<string>();
  /** Optional volume (circuits) shown in the collapsed head. */
  readonly volume = input<number | undefined>(undefined);
  /** Whether this service is included in the policy (host-owned). */
  readonly included = input.required<boolean>();
  /** Emitted when the include checkbox is toggled. */
  readonly includeToggled = output<void>();

  readonly protocols: ServiceDraft['protocol'][] = ['tcp', 'udp', 'http', 'https'];

  readonly expanded = signal(false);
  toggleExpand(): void {
    this.expanded.update((v) => !v);
  }

  setField(key: keyof ServiceDraft, value: string): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }
}
