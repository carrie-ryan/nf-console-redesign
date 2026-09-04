import { Component, Input, signal } from '@angular/core';
import type { ServiceProvenanceData } from '../../shared/services/drawer.service';

/**
 * Body for the 'service-provenance' drawer — the INDEX view for one SERVICE (the
 * Sankey's middle stage). Sibling to 'segment-provenance' (a segment node) and
 * 'policy-provenance' (a segment-pair edge): same visual family, different grain.
 *
 * Renders the service's endpoint FACTS (protocol / port / intercept address /
 * parent service segment) and its REACHED-BY: every source segment authorized to
 * dial it, grouped, with the specific identity names. This is the REVERSE of the
 * segment drawer's reach list. Each reached-by group row is a hand-off that opens
 * the existing edge drawer for (sourceSegment → this service's segment).
 *
 * Pure presentation: it receives a fully-projected payload (facts + reachedBy
 * already rolled up over the resolver output by the segment view) and re-derives
 * nothing. Row clicks delegate to the payload's `onReachSelect` closure.
 */
@Component({
  selector: 'app-service-provenance-content',
  standalone: true,
  templateUrl: './service-provenance-content.component.html',
  styleUrl: './service-provenance-content.component.css',
})
export class ServiceProvenanceContentComponent {
  private readonly _data = signal<ServiceProvenanceData | null>(null);

  @Input({ required: true })
  set data(value: ServiceProvenanceData) {
    this._data.set(value);
  }

  readonly content = this._data.asReadonly();
}
