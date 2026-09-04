import { Component, Input, computed, inject, signal } from '@angular/core';
import { MockDataService } from '../../shared/services/mock-data.service';
import { DrawerService } from '../../shared/services/drawer.service';
import type { FlowDetailData } from '../../shared/services/drawer.service';
import type { DiscoveredFlow, ObservedSource } from './discovery.models';
import { enrolledSourceIds } from './source-enrollment';
import { ConstructPolicyLauncherService } from './construct-policy-launcher.service';
import type { SelectedDestination } from './construct-policy-modal.component';

/** One compact, read-only flow row the drawer renders. */
interface FlowRow {
  key: string;
  /** Real identity name (enrolled) or the source IP (unenrolled). */
  ingressLabel: string;
  enrolled: boolean;
  destination: string;
  circuits: number;
}

/**
 * Body for the 'flow-detail' drawer — the observed flows behind a clicked
 * observed-traffic Sankey element (CIDR block / source host / destination /
 * ribbon). COMPREHENSION-ONLY: a compact read-only list (Ingress Entity + badge ·
 * Destination · Circuits), NO checkbox, NO selection, NO create action.
 *
 * Enrollment is determined by the SAME shared helper the table/roles/Sankey use
 * (`enrolledSourceIds` over the live identities), never by string-shape — so the
 * known/unknown badge here matches everywhere else exactly.
 */
@Component({
  selector: 'app-flow-detail-content',
  standalone: true,
  templateUrl: './flow-detail-content.component.html',
  styleUrl: './flow-detail-content.component.css',
})
export class FlowDetailContentComponent {
  private readonly mockData = inject(MockDataService);
  private readonly drawer = inject(DrawerService);
  private readonly policyLauncher = inject(ConstructPolicyLauncherService);

  private readonly _data = signal<FlowDetailData | null>(null);
  @Input({ required: true })
  set data(value: FlowDetailData) {
    this._data.set(value);
  }

  /** "Create service policy" is a DESTINATION-only carve-out (Tod's step 4):
   *  turn one observed destination into a specific intercept service + dial
   *  policy. Never shown for a CIDR block, a source host, or a ribbon. */
  readonly canCreatePolicy = computed(() => {
    const d = this._data();
    return !!d && d.elementKind === 'destination' && d.flows.length > 0;
  });

  /** Derived-enrollment set (shared helper) — a source is enrolled iff its id
   *  resolves to a real Identity. Same determination as the raw table. */
  private readonly enrolledIds = computed(() => enrolledSourceIds(this.mockData.identities()));

  /** Compact rows, most-active flows first (biggest contributors lead). */
  readonly rows = computed<FlowRow[]>(() => {
    const d = this._data();
    if (!d) return [];
    const enrolled = this.enrolledIds();
    return d.flows
      .map((f: DiscoveredFlow) => {
        const isEnrolled = f.dialingIdentityId != null && enrolled.has(f.dialingIdentityId);
        return {
          key: f.id,
          // enrolled → real name; unenrolled → the IP (mirrors the table's rule)
          ingressLabel: isEnrolled ? f.dialingIdentityName : f.ingressIp,
          enrolled: isEnrolled,
          destination: f.destinationHostPort,
          circuits: f.circuitCount,
        };
      })
      .sort((a, b) => b.circuits - a.circuits);
  });

  /**
   * Carve a specific service out of this wildcard-observed destination: shape the
   * drawer's flows into the ONE SelectedDestination the modal expects (all flows
   * share this destinationHostPort → a single service card), close the drawer,
   * and open the shell-hosted modal. Same grouping raw-traffic uses: union the
   * dialing identities (dedup by id), protocol only if unanimous.
   */
  createServicePolicy(): void {
    const d = this._data();
    if (!d || d.elementKind !== 'destination' || !d.flows.length) return;

    const enrolled = this.enrolledIds();
    const protocols = new Set<'tcp' | 'udp' | 'http' | 'https'>();
    // Deduped sources classified at build time: enrolled → grantable identity,
    // unenrolled → observed address (keyed by ip; excluded from grants this increment).
    const sources = new Map<string, ObservedSource>();
    for (const f of d.flows) {
      if (f.protocol) protocols.add(f.protocol);
      const id = f.dialingIdentityId;
      if (id != null && enrolled.has(id)) {
        sources.set(id, { kind: 'identity', id, name: f.ingressEntityName });
      } else {
        sources.set(f.ingressIp, { kind: 'address', ip: f.ingressIp });
      }
    }
    const destination: SelectedDestination = {
      hostPort: d.flows[0].destinationHostPort,
      protocol: protocols.size === 1 ? [...protocols][0] : null,
      identities: [...sources.values()],
    };

    // Close the drawer FIRST — the modal is hosted at the shell (outside the
    // drawer's transformed context), so the two never stack.
    this.drawer.close();
    this.policyLauncher.open({ destinations: [destination], flowCount: d.flows.length });
  }
}
