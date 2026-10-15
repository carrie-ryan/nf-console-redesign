import { Injectable, computed, signal } from '@angular/core';
import type { DialLogRecord } from '../../data-access/template-search.service';
import type {
  DialLogStatusFilter,
  DialLogTypeFilter,
} from '../../features/dial-logs/dial-logs.logic';
import type { DiscoveredFlow } from '../../features/discovery/discovery.models';
import type { Identity } from './mock-data.service';
import type {
  RosterHostRef,
  RosterIdentityRef,
} from '../../features/discovery/grouped-roster.adapter';
import type { ConcernListData } from '../../features/dashboard/concern.models';

/**
 * Payload for the 'service-activity' drawer — the grouped dial-log activity
 * table scoped to one or more services, plus the header text the shell shows.
 * `records` are the raw dial records; the content component groups them.
 */
export interface ServiceActivityData {
  /** Header name (e.g. "Service Activity"). */
  title: string;
  /** Header sub-line. Optional and normally omitted: the activity body derives
   *  a LIVE subheading from its own filter state (so it tracks the pills rather
   *  than the entry point), and the shell renders that instead. */
  subtitle?: string;
  records: DialLogRecord[];
  /** Initial status filter for the activity table. Openers summoned from an
   *  alert pass 'failed' so the user lands on failures; omit (→ 'all') otherwise. */
  defaultStatusFilter?: DialLogStatusFilter;
  /** Initial failure-TYPE filter for the activity table. The no-terminators
   *  critical-signal card passes 'terminator' to preset the same drawer to
   *  terminator errors; omit (→ 'all') otherwise. */
  defaultTypeFilter?: DialLogTypeFilter;
}

/**
 * Conceptual-help payload for the onboarding flow's "Learn more" affordances.
 * `topic` selects which concept the help body renders — a union so each future
 * onboarding step can add its own concept (service, router, policy …) without a
 * new drawer type.
 */
export interface OnboardingHelpData {
  /** Header name (e.g. "About Identities"). */
  title: string;
  /** Header sub-line (e.g. "Concept · Create Identity"). */
  subtitle: string;
  topic: 'identity' | 'router' | 'service' | 'advanced-service' | 'policy' | 'router-policy' | 'verify';
}

/**
 * One authorizing dial policy, flattened for provenance display. A view-layer
 * projection of the Policy model (mock-data.service) — carries only what the
 * provenance panel renders, so the drawer needn't import the full entity type.
 */
export interface PolicyProvenanceEntry {
  id: string;
  name: string;
  identityRoles: string[];
  serviceRoles: string[];
  semantic: 'AnyOf' | 'AllOf';
  type: 'dial';
}

/** Why a member is excluded/unreached, projected for display (mirrors the
 *  cell-explanation ExclusionReason — kept as a local projection so the drawer
 *  stays decoupled from the authorization module). */
export interface ProvenanceExclusionReason {
  kind: 'no-matching-policy' | 'failed-allof';
  /** Name of the AllOf policy the member half-matched (failed-allof only). */
  nearestPolicyName?: string;
  /** The specific roles the member lacks (failed-allof only). */
  missingRoles?: string[];
}

/** One identity member of the cell's from-segment, with its per-member status. */
export interface ProvenanceIdentityMember {
  id: string;
  name: string;
  status: 'authorized' | 'excluded';
  reason?: ProvenanceExclusionReason;
}

/** One service member of the cell's to-segment, with its per-member status. */
export interface ProvenanceServiceMember {
  id: string;
  name: string;
  status: 'reached' | 'unreached';
  reason?: ProvenanceExclusionReason;
}

/**
 * Payload for the 'policy-provenance' drawer — the dial policies authorizing one
 * identity-segment → service-segment CELL (the segment-pair grain, NOT a single
 * identity→service pair). For a 'none' cell `policies` is empty by design: the
 * body renders an affirmative isolation message, not a blank list.
 *
 * The `identities` / `services` member lists are the DRILL-IN within the cell
 * (per-member status + exclusion reasons from explainCell). Both are pre-sorted
 * exclusions-first and capped for display; the *Total / *Count fields carry the
 * true (pre-cap) tallies so the body can render "showing N of M" and section
 * headers honestly.
 */
export interface PolicyProvenanceData {
  /** Header name (e.g. "eng → devtools"). */
  title: string;
  /** Header sub-line (e.g. "Dial policy provenance"). */
  subtitle: string;
  fromLabel: string;
  toLabel: string;
  state: 'full' | 'partial' | 'none';
  authorizedCount: number;
  totalCount: number;
  policies: PolicyProvenanceEntry[];

  /** From-segment identities (excluded first, capped). */
  identities: ProvenanceIdentityMember[];
  /** Authorized identities among the FULL (pre-cap) member set. */
  identityAuthorizedCount: number;
  /** Total from-segment members (pre-cap) — for the header + "showing N of M". */
  identityTotal: number;

  /** To-segment services (unreached first, capped). */
  services: ProvenanceServiceMember[];
  /** Reached services among the FULL (pre-cap) member set. */
  serviceReachedCount: number;
  /** Total to-segment members (pre-cap). */
  serviceTotal: number;
}

/**
 * Node kind for a segment (mirror of the segment view's local `NodeKind`, kept
 * as a structurally-identical literal union here so this shared service does NOT
 * import a feature component — that would invert the dependency and risk a cycle,
 * since the segment view already imports DrawerService).
 */
export type SegmentNodeKind = 'normal' | 'ungrouped' | 'isolated' | 'unresolvable';

/** One reachable segment (an edge the focused segment participates in, state !== 'none'). */
export interface SegmentReachEntry {
  /** Ordered pair (identity-side, service-side) so a click opens the EXISTING edge drawer. */
  fromSegment: string;
  toSegment: string;
  /** Short label of the segment on the far end of this edge. */
  otherLabel: string;
  state: 'full' | 'partial';
  authorizedCount: number;
  totalCount: number;
}

/**
 * Payload for the 'segment-provenance' drawer — the INDEX view for a single
 * segment NODE (not an edge): its members, and everything it reaches. Clicking a
 * reach row hands off to the edge drawer (policy-provenance) for the detail, so
 * this is the map and that is the drill-in — no provenance is duplicated here.
 *
 * `onReachSelect` is the callback the segment view supplies (a thin closure over
 * its existing `select(from,to)`), letting a reach row open the edge drawer
 * without app-drawer needing to know segment-view's internals. For an isolated /
 * unresolvable node `reach` is empty by design and the body renders the
 * affirmative isolation statement, mirroring the edge drawer's 'none' case.
 */
export interface SegmentProvenanceData {
  /** Header name (e.g. "dmz-brokers"). */
  title: string;
  /** Header sub-line (e.g. "Identity segment · segment map"). */
  subtitle: string;
  side: 'identity' | 'service';
  segment: string;
  label: string;
  kind: SegmentNodeKind;
  memberCount: number;
  /** Resolved member names (capped for display; memberCount carries the true total). */
  members: { id: string; name: string }[];
  reach: SegmentReachEntry[];
  /** Open the existing edge drawer for a reach row's ordered pair. */
  onReachSelect: (fromSegment: string, toSegment: string) => void;
}

/** One source segment authorized to dial a service, with the specific identities
 *  in it and the segment-pair state. The REVERSE of SegmentReachEntry: a reach
 *  row answers "what does this segment reach"; this answers "who reaches this
 *  service". A row click opens the existing edge drawer for (sourceSegment →
 *  this service's segment). */
export interface ServiceReachedByEntry {
  /** raw #discovered-group-* the reaching identities belong to. */
  sourceSegment: string;
  sourceSegmentLabel: string;
  /** the specific identities in that segment authorized to THIS service. */
  identities: { id: string; name: string }[];
  /** segment-pair state for sourceSegment → this service's segment. */
  state: 'full' | 'partial';
  /** policy ids granting these (for the row → policies hand-off / affordance). */
  authorizedBy: string[];
}

/**
 * Payload for the 'service-provenance' drawer — the INDEX view for a single
 * SERVICE (the Sankey's middle stage), as opposed to 'segment-provenance' (a
 * segment node) or 'policy-provenance' (a segment-pair edge). Shows the service's
 * endpoint facts (protocol/port/intercept, parent service segment) and its
 * REACHED-BY: every source segment authorized to dial it, grouped, with the
 * specific identities. This is the reverse join of the segment drawer's reach
 * list — a service asking "who dials me" instead of a segment asking "what do I
 * reach". Each reached-by row hands off to the existing edge drawer, mirroring
 * the segment drawer's reach-row compose-down.
 */
export interface ServiceProvenanceData {
  /** Header name (the service name, e.g. "mes-api"). */
  title: string;
  /** Header sub-line (e.g. "mes-svc · HTTPS · 8443"). */
  subtitle: string;
  serviceId: string;
  serviceName: string;
  /** the #discovered-svc-* it belongs to (raw). */
  serviceSegment: string;
  serviceSegmentLabel: string;
  /** transport (tcp/udp/http/https) OR app-protocol if parsed — same as tooltip. */
  protocol: string;
  /** parsed from interceptAddress (same parse the tooltip uses). */
  port: string | number;
  interceptAddress: string;
  /** every source segment authorized to dial this service, grouped. */
  reachedBy: ServiceReachedByEntry[];
  /** total distinct identities across all source segments that reach this service. */
  totalIdentities: number;
  /** Open the existing edge drawer for a reached-by row's ordered pair. */
  onReachSelect: (sourceSegment: string, serviceSegment: string) => void;
}

/**
 * Payload for the 'flow-detail' drawer — the observed DiscoveredFlow[] behind a
 * clicked observed-traffic Sankey element (a CIDR block, a source host, a
 * destination, or a ribbon). COMPREHENSION-ONLY: the body renders a compact,
 * read-only flow list ("show me the flows behind what I clicked") — no create
 * action, no selection. The consumer resolves the flows (via the observed-sankey
 * adapter) and hands them here ready to render.
 */
export interface FlowDetailData {
  /** Header name (the element — e.g. "10.10.30.0/24", "dns.corp:53", "ip → dest"). */
  title: string;
  /** Header sub-line (e.g. "CIDR block · 22 flows"). */
  subtitle: string;
  /** Which Sankey element was clicked — lets the body tune wording if needed. */
  elementKind: 'cidr' | 'source' | 'destination' | 'ribbon';
  flows: DiscoveredFlow[];
}

/**
 * Payload for the 'roster-group' drawer — the members behind ONE circle on the
 * grouped-roster view: an attribute tag-node, or either arm of its catch-all.
 *
 * Deliberately NOT 'segment-provenance', which looks similar: that payload's
 * empty `reach` renders an affirmative "reaches nothing over the overlay"
 * isolation statement, which would be a FALSE claim here — a tag-group has no
 * reach data at all, and silence about reach is not evidence of isolation.
 *
 * The two row shapes stay apart exactly as the adapter keeps them apart: a tag /
 * no-tag group fills `identities` (leaving `hosts` empty), an unmanaged group
 * fills `hosts` (leaving `identities` empty). A host is an observed ADDRESS with
 * no Identity behind it, so it never gets an id/name row.
 *
 * DISPLAY ONLY: rows carry no callback and no ids to navigate with. Identity
 * detail and row drill-in are a later increment, so nothing here needs a drawer
 * stack or a back affordance.
 */
export interface RosterGroupData {
  /** Header name — the tag token, or the catch-all arm's name. */
  title: string;
  /** Header sub-line (e.g. "Attribute tag · 7 identities"). */
  subtitle: string;
  /** Which circle was clicked — drives the body's wording and chip styling. */
  kind: 'tag' | 'no-tag' | 'unmanaged';
  /** The group's member count (=== the rendered rows; nothing is capped). */
  count: number;
  /** Identity rows for a 'tag' / 'no-tag' group; empty for 'unmanaged'. Each row
   *  carries the identity's FULL tag set so double-membership is legible. */
  identities: readonly RosterIdentityRef[];
  /** Host rows for an 'unmanaged' group; empty otherwise. Read-only — enrollment
   *  is a deferred flow and is deliberately NOT offered here. */
  hosts: readonly RosterHostRef[];
}

/**
 * Payload for the 'identity-detail' drawer — ONE identity, read only.
 *
 * Both halves are RESOLVED BY THE CALLER, never fetched by the body: the caller
 * holds the roster (a row it already rendered) and the capture, so it hands over
 * the whole `Identity` record plus that identity's flows
 * (`DISCOVERED_FLOWS.filter(f => f.dialingIdentityId === identity.id)`). The
 * content component then reads nothing it was not given — same contract as
 * 'flow-detail', whose `flows` are likewise resolved upstream.
 *
 * `flows` may be EMPTY, and when it is that is a fact about the data, not a
 * missing fetch: the discovery identities and the managed estate both carry
 * observed traffic, but the original demo block (id-001…id-021) is roster-only
 * and has none. The body says so explicitly rather than rendering a bare
 * "nothing here".
 */
export interface IdentityDetailData {
  /** Header name — the identity's name. */
  title: string;
  /** Header sub-line (e.g. "Identity · device"). */
  subtitle: string;
  /** The full roster record. The body renders only the fields the seed actually
   *  populates; never-populated optionals (externalId, isAdmin, hostingCost,
   *  hostingPrecedence, tags, appData) are deliberately not shown, and neither is
   *  totalUsage — it is populated on under half the roster, so a row for it would
   *  read as "0 GB" for everyone else. */
  identity: Identity;
  /** This identity's observed flows, pre-filtered by the caller. Empty is normal. */
  flows: readonly DiscoveredFlow[];
  /**
   * The EXACT drawer ref this identity was drilled from — carried so the body can
   * offer a return path, by reopening it.
   *
   * This is a SCOPED back-reference, deliberately not a stack. `DrawerService`
   * still holds one ref and `open()` still replaces it; going "back" is simply
   * opening this ref again. Nothing is pushed, nothing is popped, and no other
   * drawer type is affected — the shell's `showBack`/`back()` stay the
   * gated-off defaults they are for the other seven types.
   *
   * OPTIONAL by design: identity-detail is valid with no origin (opened from
   * anywhere that is not a roster group). Absent → the body renders no back
   * control at all and the only exit is close. There is no error path.
   *
   * Depth is bounded at one by construction: only the roster-group body sets
   * this, and it sets it to a 'roster-group' ref, which carries no origin of its
   * own. A→B→A is the whole graph.
   */
  originGroupRef?: DrawerEntityRef;
}

/**
 * Discriminated entity reference the drawer renders. The `type` tag is the
 * extension point for drawer bodies; today 'service-activity' (dashboard),
 * 'onboarding-help' (onboarding concepts), 'policy-provenance' (a segment-pair
 * CELL/edge), 'segment-provenance' (a single segment NODE — its members +
 * reach), 'service-provenance' (a single SERVICE — its facts + who reaches it),
 * 'flow-detail' (the observed flows behind a Sankey element), and 'roster-group'
 * (the members behind one grouped-roster circle).
 */
export type DrawerEntityRef =
  | { type: 'service-activity'; data: ServiceActivityData }
  | { type: 'onboarding-help'; data: OnboardingHelpData }
  | { type: 'policy-provenance'; data: PolicyProvenanceData }
  | { type: 'segment-provenance'; data: SegmentProvenanceData }
  | { type: 'service-provenance'; data: ServiceProvenanceData }
  | { type: 'flow-detail'; data: FlowDetailData }
  | { type: 'roster-group'; data: RosterGroupData }
  | { type: 'identity-detail'; data: IdentityDetailData }
  | { type: 'concern-list'; data: ConcernListData };

/**
 * App-level slide-in drawer state (Agora/CC pattern). A single global panel
 * mounted at the console shell — open/close by entityRef rather than routing,
 * so any surface can summon it without a navigation. Signal-based so the shell
 * reacts to open/close and payload swaps.
 */
@Injectable({ providedIn: 'root' })
export class DrawerService {
  private readonly ref = signal<DrawerEntityRef | null>(null);

  /** The currently-open entity reference, or null when closed. */
  readonly entityRef = this.ref.asReadonly();
  /** True while a drawer is open. */
  readonly isOpen = computed(() => this.ref() !== null);

  open(ref: DrawerEntityRef): void {
    this.ref.set(ref);
  }

  close(): void {
    this.ref.set(null);
  }
}
