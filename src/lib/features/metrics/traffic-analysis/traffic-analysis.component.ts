import { Component, computed, inject, signal } from '@angular/core';
import { MetricsNavComponent } from '../metrics-nav/metrics-nav.component';
import { DiscoveryReviewComponent } from '../../discovery/discovery-review.component';
import { RawTrafficComponent } from '../../discovery/raw-traffic.component';
import { SankeyChartComponent } from '../../../shared/components/sankey-chart/sankey-chart.component';
import {
  buildObservedSankeyData,
  flowsForLink,
  flowsForNode,
} from '../../discovery/observed-sankey.adapter';
import { DISCOVERED_FLOWS } from '../../discovery/discovered-flows.mock';
import { enrolledSourceIds } from '../../discovery/source-enrollment';
import { MockDataService } from '../../../shared/services/mock-data.service';
import { DrawerService } from '../../../shared/services/drawer.service';
import type {
  SankeyLinkClickEvent,
  SankeyNodeClickEvent,
} from '../../../shared/components/sankey-chart/sankey-chart.component';

type TrafficSubtab = 'suggested' | 'raw' | 'flow';

@Component({
  selector: 'app-traffic-analysis',
  standalone: true,
  imports: [
    MetricsNavComponent,
    DiscoveryReviewComponent,
    RawTrafficComponent,
    SankeyChartComponent,
  ],
  templateUrl: './traffic-analysis.component.html',
  styleUrl: './traffic-analysis.component.css'
})
export class TrafficAnalysisComponent {
  private readonly data = inject(MockDataService);
  private readonly drawer = inject(DrawerService);

  /** Which subtab is active: engine-suggested roles, the raw-flow picker, or the
   *  observed-traffic flow map. */
  readonly subtab = signal<TrafficSubtab>('flow');

  /**
   * Observed-traffic Sankey data (CIDR block → source host → destination),
   * weighted by circuitCount. Reactive on identities so enrollment badging stays
   * in sync: unenrolled source hosts (id not resolving to a real Identity) are
   * marked via the shared `enrolledSourceIds` set. Built from the shared, generic
   * SankeyChartComponent's node/link shape via the observed adapter.
   */
  readonly observedSankey = computed(() =>
    buildObservedSankeyData(DISCOVERED_FLOWS, enrolledSourceIds(this.data.identities())),
  );

  /** Click a Sankey node → open the comprehension-only flow-detail drawer showing
   *  the DiscoveredFlow[] behind that CIDR block / source host / destination. The
   *  adapter owns the id-parsing + CIDR derivation; the consumer just opens. */
  onSankeyNodeClick(ev: SankeyNodeClickEvent): void {
    this.openFlowDetail(flowsForNode(DISCOVERED_FLOWS, ev));
  }

  /** Click a ribbon → the flows behind that CIDR→source or source→destination edge. */
  onSankeyLinkClick(ev: SankeyLinkClickEvent): void {
    this.openFlowDetail(flowsForLink(DISCOVERED_FLOWS, ev));
  }

  private openFlowDetail(resolved: ReturnType<typeof flowsForNode>): void {
    this.drawer.open({
      type: 'flow-detail',
      data: {
        title: resolved.title,
        subtitle: resolved.subtitle,
        elementKind: resolved.kind,
        flows: resolved.flows,
      },
    });
  }
}
