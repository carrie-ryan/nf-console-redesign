import { Component, Input, signal } from '@angular/core';
import type { PolicyProvenanceData } from '../../shared/services/drawer.service';

/**
 * Body for the 'policy-provenance' drawer. Renders WHY an identity-segment →
 * service-segment cell is authorized (or affirmatively why it is NOT): the
 * from→to relationship, the roll-up state (full / partial with count), and the
 * union of dial policies that grant it — each with its semantic and
 * identityRoles → serviceRoles.
 *
 * For a 'none' cell the policy list is empty by design; the template renders an
 * affirmative "these segments are isolated" statement instead of a blank list —
 * the absence IS the finding.
 *
 * Pure presentation: it receives a fully-projected payload (already rolled up
 * over the resolver output by the segment view) and re-derives nothing.
 */
@Component({
  selector: 'app-policy-provenance-content',
  standalone: true,
  templateUrl: './policy-provenance-content.component.html',
  styleUrl: './policy-provenance-content.component.css',
})
export class PolicyProvenanceContentComponent {
  private readonly _data = signal<PolicyProvenanceData | null>(null);

  @Input({ required: true })
  set data(value: PolicyProvenanceData) {
    this._data.set(value);
  }

  readonly content = this._data.asReadonly();
}
