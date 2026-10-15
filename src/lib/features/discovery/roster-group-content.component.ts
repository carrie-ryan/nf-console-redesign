import { Component, Input, computed, inject, signal } from '@angular/core';
import { DrawerService } from '../../shared/services/drawer.service';
import type { RosterGroupData } from '../../shared/services/drawer.service';
import { MockDataService } from '../../shared/services/mock-data.service';
import { DISCOVERED_FLOWS } from './discovered-flows.mock';
import type { RosterIdentityRef } from './grouped-roster.adapter';

/**
 * Body for the 'roster-group' drawer — the members behind ONE circle on the
 * grouped-roster view (an attribute tag-node, or either catch-all arm).
 *
 * Member-list rendering follows SegmentProvenanceContentComponent's model: a kind
 * banner, then a tallied member list, fed by an already-projected payload it
 * re-derives nothing from. That component is NOT reused: its empty-`reach` branch
 * renders an affirmative "reaches nothing over the overlay" isolation statement,
 * and a tag-group has no reach data at all — rendering silence as isolation would
 * be a false claim.
 *
 * ROW INTERACTION is split by what the row actually IS:
 *   • an IDENTITY row is a button — it opens the 'identity-detail' drawer for
 *     that identity (Summary / Traffic, read only).
 *   • a HOST row stays display only, an `<li>` with no affordance. An unmanaged
 *     host resolves to NO Identity, so there is nothing to open; and enrollment
 *     remains a deferred flow, deliberately not stubbed here.
 *
 * Opening identity-detail REPLACES this drawer's ref — DrawerService holds a
 * single `signal<DrawerEntityRef | null>` with no stack, so there is no return
 * path to this group. See the note on `openIdentity`.
 */
@Component({
  selector: 'app-roster-group-content',
  standalone: true,
  templateUrl: './roster-group-content.component.html',
  styleUrl: './roster-group-content.component.css',
})
export class RosterGroupContentComponent {
  private readonly drawer = inject(DrawerService);
  private readonly mockData = inject(MockDataService);

  private readonly _data = signal<RosterGroupData | null>(null);

  @Input({ required: true })
  set data(value: RosterGroupData) {
    this._data.set(value);
  }

  readonly content = this._data.asReadonly();

  /**
   * Identities carrying MORE than the one tag whose circle was opened. Drives the
   * "N also carry another tag" sub-line — that overlap is the reason the roster's
   * placement total runs far ahead of its identity count (a host carries an
   * application, a tier and a site at once), so the drawer states it rather than
   * leaving the reader to count chips.
   */
  readonly alsoTaggedCount = computed(() => {
    const c = this.content();
    if (!c || c.kind !== 'tag') return 0;
    return c.identities.filter((i) => i.attributes.length > 1).length;
  });

  /** The tag whose node this drawer opened — highlighted in each row's chip set. */
  readonly openedTag = computed(() => {
    const c = this.content();
    return c?.kind === 'tag' ? c.title : null;
  });

  /**
   * Open one identity's detail drawer.
   *
   * RESOLUTION HAPPENS HERE, not in the body: a member row carries only
   * `{id, name, attributes}` (the roster projection), so this looks the full
   * `Identity` up on the live roster and filters the capture for its flows —
   * exactly the contract `IdentityDetailData` documents, and the same division
   * FlowDetailContentComponent uses (caller resolves, body renders).
   *
   * BACK PATH — scoped, not a stack. `DrawerService` still holds ONE
   * `signal<DrawerEntityRef | null>` and `open()` still REPLACES it, so this is a
   * swap rather than a push. The return path is carried in the payload instead:
   * the CURRENT ref — this very group, read live off the service rather than
   * rebuilt from `content()` — travels as `originGroupRef`, and the identity body
   * reopens it to come back. Nothing is pushed or popped, and the shell's
   * `AppDrawerComponent.showBack` / `back()` stay the gated-off defaults they are
   * for the other seven drawer types.
   *
   * The guard is a type-narrowing check, not defensiveness: only a 'roster-group'
   * ref is a sensible origin, and if the open drawer were somehow anything else
   * the identity simply opens with no back control (the field is optional).
   *
   * Defensive: an id absent from the roster simply does not open. It cannot
   * happen from this view (the projection is built FROM the roster), but the
   * lookup is still a lookup, and a half-populated drawer would be worse than
   * none.
   */
  openIdentity(member: RosterIdentityRef): void {
    const identity = this.mockData.identities().find((i) => i.id === member.id);
    if (!identity) return;

    // The ref currently on screen IS this group — carry it verbatim rather than
    // reconstructing one from `content()`, so the drawer the user returns to is
    // byte-for-byte the drawer they left.
    const current = this.drawer.entityRef();
    const originGroupRef = current?.type === 'roster-group' ? current : undefined;

    this.drawer.open({
      type: 'identity-detail',
      data: {
        title: identity.name,
        subtitle: `Identity · ${identity.type}`,
        identity,
        originGroupRef,
        // The capture keys traffic by dialing identity; most roster identities
        // match nothing here, and the body renders that as a stated fact.
        flows: DISCOVERED_FLOWS.filter((f) => f.dialingIdentityId === identity.id),
      },
    });
  }
}
