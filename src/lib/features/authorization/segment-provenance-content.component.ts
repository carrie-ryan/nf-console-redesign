import { Component, Input, signal } from '@angular/core';
import type { SegmentProvenanceData } from '../../shared/services/drawer.service';

/**
 * Body for the 'segment-provenance' drawer — the INDEX view for one segment NODE
 * (as opposed to the 'policy-provenance' edge drawer, which is the per-pair
 * detail). Renders the segment's kind (a state chip), its member list (resolved
 * names), and its REACH: every other segment it is authorized to, each row a
 * hand-off that opens the existing edge drawer for that pair.
 *
 * For an isolated / unresolvable segment `reach` is empty by design; the template
 * renders an affirmative isolation statement instead of a blank list — mirroring
 * the edge drawer's 'none' case (the absence IS the finding).
 *
 * Pure presentation: it receives a fully-projected payload (members + reach
 * already rolled up over the resolver output by the segment view) and re-derives
 * nothing. Reach-row clicks delegate to the payload's `onReachSelect` closure.
 */
@Component({
  selector: 'app-segment-provenance-content',
  standalone: true,
  templateUrl: './segment-provenance-content.component.html',
  styleUrl: './segment-provenance-content.component.css',
})
export class SegmentProvenanceContentComponent {
  private readonly _data = signal<SegmentProvenanceData | null>(null);

  @Input({ required: true })
  set data(value: SegmentProvenanceData) {
    this._data.set(value);
  }

  readonly content = this._data.asReadonly();
}
