import { Component, Input, computed, inject, linkedSignal, signal } from '@angular/core';
import { DrawerService } from '../../shared/services/drawer.service';
import type { IdentityDetailData } from '../../shared/services/drawer.service';
import { ConstructPolicyLauncherService } from './construct-policy-launcher.service';
import { buildIdentityPolicySeed, rollUpIdentityDestinations } from './identity-traffic.adapter';
import type { IdentityDestinationRow } from './identity-traffic.adapter';

/** Which tab is showing. Summary is the default — it is the half that is always
 *  populated; Traffic is empty for most identities. */
type IdentityDetailTab = 'summary' | 'traffic';

/**
 * Body for the 'identity-detail' drawer — ONE identity.
 *
 * Both tabs are read-only projections; the single WRITE path is the footer action
 * (`createServicePolicy`), which mutates nothing itself — it hands a seed to the
 * shared construct-policy modal and lets that modal own the create.
 *
 * Opened from an identity row in the roster-group drawer. Two tabs:
 *
 *   • SUMMARY — the roster record's populated fields, plus its attribute tags
 *     rendered with the same chip treatment the roster-group rows use, so a tag
 *     looks like the same object on both sides of the transition.
 *   • TRAFFIC — this identity's observed destinations, rolled up by the SHARED
 *     `rollUpIdentityDestinations` helper (identity-traffic.adapter.ts), the same
 *     projection the Raw Traffic sub-table renders. Sharing the function is the
 *     point: the two surfaces cannot drift.
 *
 * The component reads NOTHING it was not handed — no MockDataService, no
 * DISCOVERED_FLOWS import. Both halves of `IdentityDetailData` are resolved by
 * the caller, matching FlowDetailContentComponent's contract.
 *
 * FIELD SELECTION is deliberate, not exhaustive. `Identity` declares
 * `externalId`, `isAdmin`, `hostingCost`, `hostingPrecedence`, `tags` and
 * `appData`, and NO seed record populates any of them; `totalUsage` is populated
 * on well under half the roster. Rendering those rows would manufacture the impression of a fact
 * ("Admin: no", "Usage: 0 GB") the data does not actually assert, so they are
 * omitted rather than shown empty.
 */
@Component({
  selector: 'app-identity-detail-content',
  standalone: true,
  templateUrl: './identity-detail-content.component.html',
  styleUrl: './identity-detail-content.component.css',
})
export class IdentityDetailContentComponent {
  private readonly drawer = inject(DrawerService);
  private readonly policyLauncher = inject(ConstructPolicyLauncherService);

  private readonly _data = signal<IdentityDetailData | null>(null);

  @Input({ required: true })
  set data(value: IdentityDetailData) {
    this._data.set(value);
    // A new identity resets to Summary: the tab is a view of THIS record, not a
    // sticky user preference, and landing on an empty Traffic tab for a freshly
    // opened identity would read as a broken drawer.
    this.tab.set('summary');
  }

  readonly content = this._data.asReadonly();

  readonly tab = signal<IdentityDetailTab>('summary');
  select(t: IdentityDetailTab): void {
    this.tab.set(t);
  }

  /** The identity's destinations, one row per distinct `host:port`, circuits
   *  desc — the SAME pure rollup the Raw Traffic sub-table calls. */
  readonly trafficRows = computed<IdentityDestinationRow[]>(() => {
    const c = this.content();
    return c ? rollUpIdentityDestinations(c.flows) : [];
  });

  /** Total circuits across every destination — the one figure worth summing
   *  here (destinations are distinct, so their circuits do add up). */
  readonly totalCircuits = computed(() =>
    this.trafficRows().reduce((sum, r) => sum + r.circuits, 0),
  );

  /** Tab-strip count badge. Zero is shown, not hidden — "Traffic 0" is the
   *  honest label for an identity the capture never saw. */
  readonly destinationCount = computed(() => this.trafficRows().length);

  /**
   * The group this identity was drilled from, when there is one. Drives BOTH the
   * back control's visibility and its label — the control names the destination
   * ("Back to #users") rather than saying "Back", so it reads as a return to a
   * specific list, not browser history.
   */
  readonly originGroup = computed(() => {
    const ref = this.content()?.originGroupRef;
    return ref?.type === 'roster-group' ? ref : null;
  });

  /**
   * Return to the originating group by REOPENING its ref. Not a pop: the service
   * holds one ref and `open()` replaces it, so this is the same swap that got us
   * here, run the other way. The ref carries the group's full member list, so the
   * list comes back exactly as it was left.
   *
   * This is the body's OWN affordance. The shell header arrow stays gated off
   * (`AppDrawerComponent.showBack` is a hardcoded false, `back()` an empty
   * no-op) — scoping the control to this body is what keeps the other seven
   * drawer types untouched.
   */
  backToGroup(): void {
    const origin = this.originGroup();
    if (origin) this.drawer.open(origin);
  }

  // ─── destination selection ──────────────────────────────────────────
  /**
   * Which destinations the action will carve. Opens FULLY SELECTED — this drawer is
   * a drill-in on one identity, so it is the equivalent of Raw traffic's expanded
   * group row, which now also reveals its destinations pre-selected. Same control,
   * same starting state, either side.
   *
   * A `linkedSignal` over `trafficRows()` with NO `previous` branch, so a new
   * identity always arrives fully selected. That is deliberately unlike
   * `GroupedRosterViewComponent.visibleKeys`, which DOES consult `previous`: there
   * the canvas persists across a roster change and a node the user hid must stay
   * hidden, whereas here a source change means a wholly different identity and
   * inheriting its predecessor's ticks would be meaningless.
   */
  readonly selectedHostPorts = linkedSignal(
    () => new Set(this.trafficRows().map((r) => r.hostPort)),
  );

  isDestinationSelected(hostPort: string): boolean {
    return this.selectedHostPorts().has(hostPort);
  }
  toggleDestination(hostPort: string): void {
    this.selectedHostPorts.update((prev) => {
      const next = new Set(prev);
      if (next.has(hostPort)) next.delete(hostPort);
      else next.add(hostPort);
      return next;
    });
  }
  readonly selectedDestinationCount = computed(() => this.selectedHostPorts().size);
  readonly allDestinationsSelected = computed(
    () => this.trafficRows().length > 0 && this.selectedDestinationCount() === this.trafficRows().length,
  );
  /** Some but not all — drives the header box's `indeterminate` state. */
  readonly someDestinationsSelected = computed(() => {
    const n = this.selectedDestinationCount();
    return n > 0 && n < this.trafficRows().length;
  });
  /**
   * The header select-all. Same house semantics as `RoutersComponent.selectAllPage`
   * and `RawTrafficComponent.toggleIdentity`: clicking while INDETERMINATE fills to
   * all rather than clearing.
   */
  toggleAllDestinations(): void {
    const all = this.trafficRows().map((r) => r.hostPort);
    const allSelected = all.every((hp) => this.selectedHostPorts().has(hp));
    this.selectedHostPorts.set(new Set(allSelected ? [] : all));
  }

  /**
   * The action is gated on the SELECTION, not merely on having traffic: unticking
   * every row disables it, exactly as clearing the selection does in Raw traffic.
   *
   * The ~21 roster-only identities never reach this at all — the action now lives
   * inside the Traffic tab's populated branch, so the empty state cannot render one
   * by construction rather than by a guard.
   */
  readonly canCreatePolicy = computed(() => this.selectedDestinationCount() > 0);

  /**
   * Carve this identity's observed destinations into intercept services + dial
   * policies — one card per destination, each granting this identity alone.
   *
   * The seed shaping is the pure `buildIdentityPolicySeed` (identity-traffic.adapter.ts),
   * so the card list and the Traffic tab above it are the same projection in the
   * same order and cannot drift.
   *
   * ORDERING IS LOAD-BEARING: close the drawer FIRST, then open the shell-hosted
   * modal. The drawer is a `transform: translateX` containing block, so a
   * `position: fixed` modal rendered inside it would be clipped into the drawer and
   * sit beneath it — which is the entire reason ConstructPolicyLauncherService
   * exists rather than the modal being imported here directly.
   */
  createServicePolicy(): void {
    const c = this.content();
    if (!c) return;

    // Narrow to the ticked destinations BEFORE seeding. `buildIdentityPolicySeed`
    // needs no knowledge of selection — it rolls up whatever flows it is handed —
    // so this is a call-site filter, exactly as raw-traffic's `selectedDestinations`
    // filters by its own selected pairings. `flowCount` narrows with it, keeping
    // the modal's "N flows across M destinations" lede honest.
    const selected = this.selectedHostPorts();
    const flows = c.flows.filter((f) => selected.has(f.destinationHostPort));
    if (flows.length === 0) return;

    this.drawer.close();
    this.policyLauncher.open({
      destinations: buildIdentityPolicySeed(c.identity, flows),
      flowCount: flows.length,
    });
  }

  /** House date format (matches SessionsComponent / RoutersComponent). */
  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
