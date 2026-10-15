/**
 * Read-only SERVICE VIEW — the focused service, plus up to three more added from a
 * group's coverage popover (`?with=`), as three lanes: Bind groups | services |
 * Dial groups. Built from layoutMultiServiceView: a policy covering several
 * services on the canvas is ONE group node with an edge to each. The centre lane
 * stacks the services in layout order — the focused one primary, the others lighter
 * with a × — each with its verdict and routing band.
 *
 * Nodes size to their content, so the SVG edge overlay is MEASURED from the
 * rendered DOM (after each render of a new layout, and on resize). An edge ends
 * where the policy matched that service (serviceMatch): at the first matched
 * attribute chip, at the service name, or — via '#all' — at the node border. It is
 * styled by its members' status on that service (edgeTone); hovering one shows its
 * counts, and a non-green one opens the gap panel for that group and service.
 * Hovering (after a short delay) or focusing an edge, group or service ISOLATES it:
 * it and what it connects stay, everything else fades (see `isolation`). While a
 * policy is open in the editor its groups stay isolated; a hover overrides that.
 *
 * A group's status line describes its edge to the FOCUSED service (none without
 * one). Editing, draft marks and the assist proposal act on the focused service.
 *
 * AT SCALE (a lane with more than COMPACT_AFTER groups; below that nothing changes):
 *   • that lane is COMPACT — one row per group (policy name, kind tag, rule summary,
 *     member count, posture-check count, the worst problem; with several services a
 *     status swatch per service it reaches). Policies with a problem come first, a
 *     policy's groups stay adjacent. A row expands in place to the full group node
 *     (several may be open), and a filter box narrows the lane by policy name,
 *     attribute or member name;
 *   • the services column follows the scroll (stays in view) — positioned by script,
 *     since the horizontal scroller around the canvas defeats `position: sticky`. A
 *     column taller than the scroll container becomes its own scroll box of that
 *     height; hovering or focusing a row then scrolls it (smoothly, only if needed)
 *     to the first service the row reaches, and an edge to a service scrolled out of
 *     the box ends at the box's edge;
 *   • edges are hidden at rest (unless "Edges at rest" is on): only an isolation
 *     (hover, focus, the policy open in the editor) draws its edges. A hint says so,
 *     once per browser.
 *
 * THE LEGEND CARD (app-canvas-legend) sits at the bottom-left of the visible canvas.
 * `legendMatches` says, per entry, which groups, services, edges and empty rules carry
 * it: an entry is listed when something does, and hovering it isolates them (a 'legend'
 * spot). "Show on canvas" (CanvasLayers) hides posture details, host markers and expiry
 * pills everywhere here, and sets whether edges draw at rest (default: not on a compact
 * canvas).
 *
 * SEVERAL SERVICES: each service card's "View details" and "Export access report" sit
 * in a "⋯" menu at its top right (next to × on an added service); with one service
 * they stay links under the card.
 *
 * LIVE CHANGES from outside the builder (PolicyDraftStore.applyLiveChange): while a
 * draft is open, the group and service cards they touched carry "changed in live"
 * until the draft empties; with no draft, the canvas simply re-renders and the touched
 * cards flash for LIVE_FLASH_MS (announced politely for screen readers).
 */

import { expiryIndex, expiryPill } from './expiry';
import { ExpiryPillComponent } from './expiry-pill.component';
import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
  effect,
  Injector,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AccessReportExporter } from './access-report.exporter';
import { CanvasLayers } from './canvas-layers';
import { LEGEND_ENTRIES, emptyMatch, matchSize, type LegendEntry, type LegendMatch } from './canvas-legend';
import { CanvasLegendComponent } from './canvas-legend.component';
import { DemoClock } from './demo-clock';
import { RouterLink } from '@angular/router';
import type { TrifectaWorld } from '../authorization/trifecta-resolver';
import { AssistStore } from './assist/assist.store';
import { PolicyDraftStore, type PolicyMark } from './draft/policy-draft.store';
import type { LiveImpact } from './draft/live-changes';
import { routersFor } from './draft/router-gap';
import { activeHostPolicyIds, hostingFor } from './hosting';
import { serviceOverlaps, type ServiceOverlapView } from './intercepts';
import { ExportReportButtonComponent } from './export-report-button.component';
import { MAX_SERVICES, edgeTone, layoutMultiServiceView, type EdgeTone, type MultiEdge } from './multi-service.layout';
import {
  NOT_SET_UP,
  describeGroup,
  hostWaiting,
  type HostWaiting,
  layoutServiceView,
  postureCounts,
  type LabelCount,
  type StatusCounts,
  type Group,
  type Lane,
  type LaneLayout,
  type RouterGapKind,
  type ServiceViewLayout,
} from './service-view.layout';
import { ServiceViewGroupComponent, shownMemberIds, type HostState, type StatusRow } from './service-view-group.component';
import type { OpenRouterPolicy } from './router-gap.component';

const NO_HOST_WARNING = 'No identity is authorized to host this service, so no one can connect.';
const NO_HOST_WARNING_MANY = 'No identity is authorized to host these services, so no one can connect.';

/** A router gap to explain: a group's members on one service. */
export interface GapRequest {
  groupId: string;
  kind: RouterGapKind;
  serviceId: string;
}

interface EdgePath {
  /** `${groupId}|${serviceId}` */
  id: string;
  groupId: string;
  policyId: string;
  serviceId: string;
  d: string;
  tone: EdgeTone;
  /** via '#all': the policy doesn't single this service out. */
  viaAll: boolean;
  /** "users-gitlab → offline-svc: 16 authorized · …" — the hover tip and aria-label. */
  text: string;
  /** Set on non-green edges, which open the gap panel. */
  gap: RouterGapKind | null;
}

/** A service's eligible routers, each with the SERPs that make it eligible. */
const serviceRouters = (serviceId: string, world: TrifectaWorld) =>
  routersFor(
    world.services.find((s) => s.id === serviceId)!,
    world.serviceEdgeRouterPolicies,
    (p) => p.serviceRoles,
    world.edgeRouters,
  );

const laneTotal = (lane: LaneLayout, verb: string) =>
  `${lane.total} ${lane.total === 1 ? 'identity' : 'identities'} can ${verb}`;

/** How long cards touched by a live change flash when no draft is open. */
export const LIVE_FLASH_MS = 2400;

/** One or more live changes' impact, as sets. */
interface ImpactSets {
  policies: ReadonlySet<string>;
  services: ReadonlySet<string>;
  identities: ReadonlySet<string>;
}
const impactSets = (impacts: readonly LiveImpact[]): ImpactSets => ({
  policies: new Set(impacts.flatMap((i) => i.policyIds)),
  services: new Set(impacts.flatMap((i) => i.serviceIds)),
  identities: new Set(impacts.flatMap((i) => i.identityIds)),
});

/** Hover must rest this long before the canvas isolates what's under the pointer. */
const HOVER_DELAY = 80;

/** What is isolated: an edge (`${groupId}|${serviceId}`), a group, a service, or
 *  what carries a legend entry (its id). */
export interface Spot {
  kind: 'edge' | 'group' | 'service' | 'legend';
  id: string;
}

const sameSpot = (a: Spot | null, b: Spot) => a?.kind === b.kind && a.id === b.id;
const edgeId = (e: { groupId: string; serviceId: string }) => `${e.groupId}|${e.serviceId}`;

const LANE_NAME: Record<Lane, string> = { bind: 'Hosts (Bind)', dial: 'Can dial (Dial)' };

/** A lane with more groups than this switches to compact rows. */
export const COMPACT_AFTER = 8;

/** The "hover a policy" hint has been shown in this browser. */
const HINT_KEY = 'nf.policyBuilder.hoverHintShown';

/** Space kept above the services column while it follows the scroll. */
const STICK_MARGIN = 12;

type ProblemKind = 'noRoute' | 'blocked' | 'bypassed';

/** One group as a compact row. */
export interface CompactRow {
  id: string;
  policyId: string;
  policyName: string;
  kind: 'named' | 'rule';
  /** "named" / "any of" / "all of". */
  tag: string;
  /** The rule as plain language — "any identity with #team-03", or the named members. */
  summary: string;
  /** "3,000 members". */
  members: string;
  /** Posture checks its policy requires. */
  checks: number;
  /** The worst problem: no route, then blocked, then bypassed (it orders the rows). */
  problem: { kind: ProblemKind; text: string } | null;
  /** Every problem, worst first — the badge shows the first one on the canvas (posture
   *  ones hide with posture details). */
  problems: { kind: ProblemKind; text: string }[];
  /** Several services: one swatch per service it has an edge to, in column order. */
  swatches: { serviceId: string; serviceName: string; tone: EdgeTone }[];
  /** The row's aria-label. */
  label: string;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const PROBLEM_TEXT: Record<ProblemKind, string> = { noRoute: 'no route', blocked: 'blocked', bypassed: 'bypassed' };
const TAG: Record<string, string> = { named: 'named', AnyOf: 'any of', AllOf: 'all of' };

const readFlag = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const writeFlag = (key: string): void => {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // no storage: the hint may show again next time
  }
};

/** A multi-service status row's text: the short form when every member shares one
 *  status, else the non-zero counts. Non-green parts carry their gap kind (a link). */
function rowParts(s: StatusCounts): LabelCount[] {
  const buckets: { n: number; one: string; all: string; tone: LabelCount['tone']; gap?: RouterGapKind }[] = [
    { n: s.reachable, one: 'reachable', all: 'all reachable', tone: 'ok' },
    { n: s.routersOffline, one: 'routers offline', all: 'routers offline', tone: 'warn', gap: 'routersOffline' },
    { n: s.noSharedRouter, one: 'no shared router', all: 'no shared router', tone: 'bad', gap: 'noSharedRouter' },
    { n: s.notAuthorized, one: 'not authorized', all: 'not authorized', tone: 'bad' },
  ];
  const present = buckets.filter((b) => b.n > 0);
  if (!present.length) return [{ text: 'no identities', tone: 'neutral' }];
  if (present.length === 1) {
    const b = present[0];
    return [{ text: b.all, tone: b.tone, ...(b.gap ? { gap: b.gap } : {}) }];
  }
  return present.map((b) => ({ text: `${b.n} ${b.one}`, tone: b.tone, ...(b.gap ? { gap: b.gap } : {}) }));
}

/** One service in the centre lane: its layout and its routing band. */
function serviceCard(view: ServiceViewLayout, world: TrifectaWorld, live: TrifectaWorld, focused: boolean) {
  const id = view.service.id;
  const draft = serviceRouters(id, world);
  const before = serviceRouters(id, live);
  const inDraft = new Set(draft.map((r) => r.id));
  const inLive = new Set(before.map((r) => r.id));
  // The draft's eligible routers (marked 'added' if live lacks them), then live
  // routers the draft removes (marked 'removed'), each naming its granting SERPs.
  const routerRows = [
    ...draft.map((r) => ({ ...r, change: inLive.has(r.id) ? null : ('added' as const) })),
    ...before.filter((r) => !inDraft.has(r.id)).map((r) => ({ ...r, change: 'removed' as const })),
  ];
  const { eligible, onlineCount } = view.routers;
  // The SERPs granting its routers, each once — "via a, b", each name a link.
  const viaPolicies = [
    ...new Map(
      routerRows.filter((r) => r.change !== 'removed').flatMap((r) => r.viaIds.map((id, i) => [id, r.via[i]] as const)),
    ),
  ].map(([id, name]) => ({ id, name }));
  // "Routing: 2 of 3 routers online" (then " · via a, b") — or "No routing yet" with no eligible router.
  const routingLine = eligible.length
    ? `Routing: ${onlineCount} of ${eligible.length} ${eligible.length === 1 ? 'router' : 'routers'} online`
    : 'No routing yet';
  // "Set up routing": the first group (Bind, then Dial) with members on no shared router.
  const gapGroup = eligible.length
    ? null
    : [...view.bind.groups, ...view.dial.groups].find((x) => x.status.noSharedRouter > 0);
  // "Traffic shared across 2 hosts · smartrouting" (· from 2 policies) — when more than one host is active.
  const hosting = hostingFor(id, world);
  const active = hosting.activeHostIds.length;
  const policies = active > 1 ? activeHostPolicyIds(id, world, hosting).length : 0;
  const traffic = active > 1 ? { hosts: active, strategy: hosting.strategy, policies } : null;
  const counts = {
    active,
    standby: hosting.servingHosts.length - active - hosting.blockedHostIds.length,
    blocked: hosting.blockedHostIds.length,
    authorized: hosting.authorizedHostIds.length,
  };
  return {
    id,
    view,
    focused,
    routerRows,
    routingLine,
    viaPolicies,
    traffic,
    hosting: counts,
    strategy: hosting.strategy,
    // Eligible routers exist but none is online — an outage.
    outage: eligible.length > 0 && onlineCount === 0,
    routingChanged: routerRows.some((r) => r.change),
    setupGap: gapGroup ? { groupId: gapGroup.id, kind: 'noSharedRouter' as const, serviceId: id } : null,
  };
}

export type ServiceCard = ReturnType<typeof serviceCard>;

@Component({
  selector: 'app-service-view',
  standalone: true,
  imports: [ServiceViewGroupComponent, NgTemplateOutlet, RouterLink, ExportReportButtonComponent, ExpiryPillComponent, CanvasLegendComponent],
  templateUrl: './service-view.component.html',
  styleUrls: ['./canvas-marks.css', './service-view.component.css'],
  host: { '(document:click)': 'closeMenu()' },
})
export class ServiceViewComponent {
  private readonly draft = inject(PolicyDraftStore);
  private readonly assist = inject(AssistStore);
  private readonly clock = inject(DemoClock);
  private readonly exporter = inject(AccessReportExporter);
  /** "Show on canvas" (the legend card): posture details, host markers, expiry pills, edges at rest. */
  readonly layers = inject(CanvasLayers);
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');

  /** The focused service. */
  readonly serviceId = input.required<string>();
  /** Other services on the canvas (`?with=`); unknown ids, the focus and any past
   *  the limit are dropped. */
  readonly withIds = input<readonly string[]>([]);
  /** The draft is submitted for review: no "Add … rule" (the page keeps editors shut too). */
  readonly locked = input(false);
  /** The policy open in the editor; its groups are highlighted. */
  readonly selectedPolicyId = input<string | null>(null);

  /** A group node was activated: edit its policy. */
  readonly editPolicy = output<string>();
  /** "+ Add host rule" / "+ Add dial rule". */
  readonly addRule = output<Lane>();
  /** A router gap was opened: a group's status phrase, a non-green edge, or "Set up routing". */
  readonly routerGap = output<GapRequest>();
  /** The hosting line: edit this service's terminator strategy. */
  readonly editStrategy = output<string>();
  /** A shield chip: that posture check, read-only. */
  readonly viewCheck = output<string>();
  /** A host member's hosting defaults. */
  readonly editHost = output<string>();
  /** A posture phrase or bypass chip: explain posture for this group on that service. */
  readonly postureOpen = output<{ groupId: string; serviceId: string }>();
  /** A group's "+N more": list its members in the drawer. */
  readonly openMembers = output<string>();
  /** A service node's "View details": show that service's details. */
  readonly serviceDetails = output<string>();
  /** The service whose details panel is open; its node is highlighted. */
  readonly detailsServiceId = input<string | null>(null);
  /** A "via <policy>" name in a routing band: open that SERP in the editor. */
  readonly openRouterPolicy = output<OpenRouterPolicy>();
  /** A routing line's "Edit routing": that service's routing panel. */
  readonly editRouting = output<string>();
  /** A group card's ⋯ → Routers: the routers its members get. */
  readonly groupRouters = output<{ groupId: string; serviceId: string }>();
  /** A coverage popover added a service to the canvas / a × removed one. */
  readonly addService = output<string>();
  readonly removeService = output<string>();

  /** The world on the canvas: the draft, plus the assist's pending proposal for
   *  the focused service when there is one. */
  readonly world = computed(() => {
    const p = this.assist.proposal();
    const proposed = p?.serviceId === this.serviceId() ? this.assist.proposalWorld() : null;
    return proposed ?? this.draft.draftWorld();
  });

  /** policyId → 'new' | 'edited' (draft) or 'proposed' (pending proposal), for the node marks. */
  readonly marks = computed(() => {
    const marks = new Map<string, PolicyMark | 'proposed'>(this.draft.marks());
    if (this.world() !== this.draft.draftWorld()) {
      for (const id of this.assist.proposedPolicyIds()) marks.set(id, 'proposed');
    }
    return marks;
  });

  // ─── live changes ───────────────────────────────────────────────────────

  /** Cards touched by live changes made while the draft is open. */
  private readonly liveSets = computed(() => impactSets(this.draft.liveSinceDraft().map((c) => c.impact)));
  /** Cards touched by the latest live change, while they flash (no draft open). */
  private readonly flashSets = signal<ImpactSets | null>(null);
  /** "users-gitlab changed in live · Dana (admin)" — the polite announcement of a flash. */
  readonly liveAnnouncement = signal('');

  /** The group ids (on the canvas) a set of changes touches: its policy, or a member. */
  private groupsTouched(sets: ImpactSets | null): ReadonlySet<string> {
    const out = new Set<string>();
    if (!sets || (!sets.policies.size && !sets.identities.size)) return out;
    for (const [id, n] of this.nodes()) {
      if (sets.policies.has(n.group.policyId) || n.group.memberIds.some((m) => sets.identities.has(m))) out.add(id);
    }
    return out;
  }
  private readonly liveGroups = computed(() => this.groupsTouched(this.liveSets()));
  private readonly flashGroups = computed(() => this.groupsTouched(this.flashSets()));

  /** "changed in live" on a group card / a service card. */
  groupLive(groupId: string): boolean {
    return this.liveGroups().has(groupId);
  }
  serviceLive(serviceId: string): boolean {
    return this.liveSets().services.has(serviceId);
  }
  /** A policy container shows the mark when any of its groups has it. */
  blockLive(b: { groupIds: string[] }): boolean {
    return b.groupIds.some((id) => this.groupLive(id));
  }
  groupFlash(groupId: string): boolean {
    return this.flashGroups().has(groupId);
  }
  serviceFlash(serviceId: string): boolean {
    return this.flashSets()?.services.has(serviceId) ?? false;
  }

  /** Router identities (linked to their router) in the world shown — their members get the router icon. */
  /** Time-limited access, per policy with an expiry (countdown pills on its groups). */
  readonly expiries = computed(() => expiryIndex(this.world()));
  readonly routerIds = computed(() => new Set(this.world().identities.filter((i) => i.routerId).map((i) => i.id)));

  /** "new · no identities yet" for a policy with no identity roles. */
  emptyRuleText(policyId: string): string {
    const mark = this.marks().get(policyId);
    return mark ? `${mark} · no identities yet` : 'no identities';
  }

  /** The services on the canvas, focus first. */
  readonly ids = computed(() => {
    const known = new Set(this.world().services.map((s) => s.id));
    const others = this.withIds().filter((id) => known.has(id) && id !== this.serviceId());
    return [this.serviceId(), ...new Set(others)].slice(0, MAX_SERVICES);
  });
  readonly multi = computed(() => layoutMultiServiceView(this.serviceId(), this.ids().slice(1), this.world()));
  readonly isMulti = computed(() => this.ids().length > 1);
  readonly full = computed(() => this.ids().length >= MAX_SERVICES);

  /** Each service's single-service layout — the source of per-service group detail. */
  private readonly views = computed(() => new Map(this.ids().map((id) => [id, layoutServiceView(id, this.world())])));
  /** The focused service's layout. */
  readonly layout = computed(() => this.views().get(this.serviceId())!);

  readonly cards = computed(() =>
    this.multi().services.map((s) => serviceCard(this.views().get(s.id)!, this.world(), this.draft.live(), s.focused)),
  );

  /** Per service on the canvas: the services whose intercepts overlap it for someone who
   *  may dial both (in the world shown) — an amber badge on the node, opening a panel. */
  readonly overlaps = computed(() => new Map(this.cards().map((c) => [c.id, serviceOverlaps(this.world(), c.id)])));
  overlapsOf(serviceId: string): ServiceOverlapView[] {
    return this.overlaps().get(serviceId) ?? [];
  }

  /** The open overlap panel: '<service>|<other>'. Closed when it no longer applies. */
  private readonly overlapPick = signal<string | null>(null);
  readonly overlapOpen = computed(() => {
    const key = this.overlapPick();
    if (!key) return null;
    const [id, other] = key.split('|');
    return this.overlapsOf(id).some((o) => o.otherId === other) ? key : null;
  });
  toggleOverlap(serviceId: string, otherId: string): void {
    const key = `${serviceId}|${otherId}`;
    this.overlapPick.set(this.overlapOpen() === key ? null : key);
  }

  /** Per group: the Group to render (the focused service's when it has an edge
   *  there, else the first service's), and the services its policy covers. */
  readonly nodes = computed(() => {
    const views = [...this.views().values()];
    const names = this.serviceNames();
    const focus = this.serviceId();
    const nodes = new Map<
      string,
      { group: Group; serviceId: string; serviceName: string; onFocus: boolean; coverage: { id: string; name: string }[] }
    >();
    for (const id of [...this.multi().order.bind, ...this.multi().order.dial]) {
      const view = views.find((v) => [...v.bind.groups, ...v.dial.groups].some((g) => g.id === id))!;
      const group = [...view.bind.groups, ...view.dial.groups].find((g) => g.id === id)!;
      const covered = new Set([view.service.id, ...group.otherServiceIds]);
      const coverage = this.world()
        .services.filter((s) => covered.has(s.id))
        .sort((a, b) => Number(b.id === focus) - Number(a.id === focus))
        .map((s) => ({ id: s.id, name: names.get(s.id) ?? s.id }));
      nodes.set(id, { group, serviceId: view.service.id, serviceName: view.service.name, onFocus: view.service.id === focus, coverage });
    }
    return nodes;
  });

  /** Each lane as policy blocks: a policy's groups (adjacent in `order`), one block
   *  per policy. A block of 2+ groups renders as one container under the policy name. */
  readonly blocks = computed(() => {
    const nodes = this.nodes();
    const blocksOf = (lane: Lane) => {
      const out: { policyId: string; policyName: string; groupIds: string[] }[] = [];
      for (const id of this.multi().order[lane]) {
        const g = nodes.get(id)!.group;
        const last = out.at(-1);
        if (last?.policyId === g.policyId) last.groupIds.push(id);
        else out.push({ policyId: g.policyId, policyName: g.policyName, groupIds: [id] });
      }
      return out;
    };
    return { bind: blocksOf('bind'), dial: blocksOf('dial') };
  });

  /** A container fades as a whole when none of its groups is isolated (its groups
   *  then don't fade again inside it). */
  blockFaded(b: { groupIds: string[] }): boolean {
    return b.groupIds.every((id) => this.fadedGroup(id));
  }

  /** "9 authorized · 2 serving". */
  readonly bindTotal = computed(() => {
    const v = this.layout().serviceVerdict;
    return `${v.hostsAuthorized} authorized · ${v.hostsServing} serving`;
  });

  /** Per service on the canvas: each serving host's marker state. */
  /** Per service on the canvas: each serving host's state — 'serving' if active,
   *  'standby' if serving below the top precedence present. */
  private readonly hostStates = computed(() => {
    const out = new Map<string, ReadonlyMap<string, HostState>>();
    for (const id of this.ids()) {
      const h = hostingFor(id, this.world());
      const active = new Set(h.activeHostIds);
      const blocked = new Set(h.blockedHostIds);
      const state = (hid: string): HostState => (active.has(hid) ? 'serving' : blocked.has(hid) ? 'blocked' : 'standby');
      out.set(id, new Map(h.servingHosts.map((s) => [s.identityId, state(s.identityId)])));
    }
    return out;
  });
  private static readonly NO_HOSTS: ReadonlyMap<string, HostState> = new Map();

  /** A host group's member markers: none on Dial groups. With several services they
   *  show only when the group has an edge to just one of them (else the rows carry
   *  per-service counts), for that service. */
  hostStateFor(group: Group): ReadonlyMap<string, HostState> {
    if (group.lane !== 'bind') return ServiceViewComponent.NO_HOSTS;
    let serviceId = this.serviceId();
    if (this.isMulti()) {
      const edges = this.multi().edges.filter((e) => e.groupId === group.id);
      if (edges.length !== 1) return ServiceViewComponent.NO_HOSTS;
      serviceId = edges[0].serviceId;
    }
    return this.hostStates().get(serviceId) ?? ServiceViewComponent.NO_HOSTS;
  }

  /** "· 2 serving · 1 standby" parts for a host group's row on one service (zero counts
   *  omitted; hosts blocked by posture are in the posture part). */
  private hostParts(g: Group, serviceId: string): LabelCount[] {
    if (g.lane !== 'bind') return [];
    const states = this.hostStates().get(serviceId);
    const count = (s: HostState) => g.memberIds.filter((id) => states?.get(id) === s).length;
    return (['serving', 'standby'] as const)
      .map((s) => ({ n: count(s), s }))
      .filter((x) => x.n > 0)
      .map((x) => ({ text: `${x.n} ${x.s}`, tone: 'neutral' as const }));
  }

  /** The node's hosting line: "2 active · 1 standby · 1 blocked by posture · 31 authorized"
   *  (standby and blocked omitted at 0). */
  hostingText(c: ServiceCard): string {
    const h = c.hosting;
    const parts = [
      `${h.active} active`,
      h.standby ? `${h.standby} standby` : null,
      h.blocked ? `${h.blocked} blocked by posture` : null,
      `${h.authorized} authorized`,
    ];
    return parts
      .filter(Boolean)
      .join(' · ');
  }

  /** Per card: no host serving yet — "Ready · …after you commit" (draft) or "Waiting…" (live). */
  private readonly waits = computed(
    () => new Map(this.cards().map((c) => [c.id, hostWaiting(c.id, this.world(), this.draft.live())] as const)),
  );
  waitingOf(c: ServiceCard): HostWaiting | null {
    return this.waits().get(c.id) ?? null;
  }
  /** The waiting tooltip, for the node's aria-label (" — 6 hosts are authorized…"). */
  waitingLabel(c: ServiceCard): string {
    const w = this.waitingOf(c);
    return w ? ` — ${w.title}` : '';
  }

  /** The verdict as the node shows it: "Not set up yet" for a blank service, and
   *  without the hosting count, which hostingText carries. */
  nodeVerdictText(c: ServiceCard): string {
    const v = c.view.serviceVerdict;
    if (v.notSetUp) return NOT_SET_UP;
    const wait = this.waitingOf(c);
    if (wait) return wait.text;
    if (v.reason) return v.text;
    const blocked = v.blockedByPosture ? ` · ${v.blockedByPosture} blocked by posture` : '';
    return `${v.canConnect} of ${v.dialTotal} can connect${blocked}`;
  }

  /** The hosting line for the service node's aria-label ('' with no authorized host). */
  hostingLabel(c: ServiceCard): string {
    return c.hosting.authorized ? ` · ${this.hostingText(c)}` : '';
  }

  /** The traffic line for the service node's aria-label ('' without one). */
  trafficLabel(c: ServiceCard): string {
    const t = c.traffic;
    return t ? ` · ${this.trafficText(c)}${t.policies > 1 ? ` · from ${t.policies} policies` : ''}` : '';
  }

  /** "Traffic shared across 2 hosts · smartrouting", for the aria-label too. */
  trafficText(c: ServiceCard): string {
    const t = c.traffic!;
    return `Traffic shared across ${t.hosts} hosts · ${t.strategy}`;
  }
  readonly dialTotal = computed(() => laneTotal(this.layout().dial, 'dial'));
  readonly noHostWarning = computed(() => (this.isMulti() ? NO_HOST_WARNING_MANY : NO_HOST_WARNING));
  /** An empty Bind lane is a warning only when someone can dial; otherwise it is
   *  simply not set up yet, and as neutral as an empty Dial lane. */
  readonly dialHasMembers = computed(() => this.multi().groups.some((g) => g.lane === 'dial' && g.memberCount > 0));

  readonly laneName = LANE_NAME;

  // ─── compact lanes (at scale) ───────────────────────────────────────────

  /** Per lane: more than COMPACT_AFTER groups. */
  readonly compactLanes = computed<Record<Lane, boolean>>(() => ({
    bind: this.multi().order.bind.length > COMPACT_AFTER,
    dial: this.multi().order.dial.length > COMPACT_AFTER,
  }));
  /** Any compact lane: edges hide at rest and the services column follows the scroll. */
  readonly compact = computed(() => this.compactLanes().bind || this.compactLanes().dial);

  /** Per service on the canvas: its groups by id. */
  private readonly groupsOn = computed(() => {
    const out = new Map<string, ReadonlyMap<string, Group>>();
    for (const [id, v] of this.views()) out.set(id, new Map([...v.bind.groups, ...v.dial.groups].map((g) => [g.id, g])));
    return out;
  });

  /** Per compact lane: its rows, policies with a problem first (a policy's groups adjacent). */
  readonly compactRows = computed<Record<Lane, CompactRow[]>>(() => {
    const out: Record<Lane, CompactRow[]> = { bind: [], dial: [] };
    const nodes = this.nodes();
    const multi = this.isMulti();
    const names = this.serviceNames();
    const edgesOf = new Map<string, MultiEdge[]>();
    for (const e of this.multi().edges) edgesOf.set(e.groupId, [...(edgesOf.get(e.groupId) ?? []), e]);
    const rowOf = (id: string): CompactRow => {
      const g = nodes.get(id)!.group;
      const edges = edgesOf.get(id) ?? [];
      // Problems on the services it reaches: the focused one alone, or the largest per kind across the canvas.
      const worst: Record<ProblemKind, number> = { noRoute: 0, blocked: 0, bypassed: 0 };
      for (const e of edges) {
        const on = this.groupsOn().get(e.serviceId)?.get(id);
        if (!on) continue;
        worst.noRoute = Math.max(worst.noRoute, on.status.noSharedRouter + on.status.routersOffline);
        worst.blocked = Math.max(worst.blocked, on.posture.blocked);
        worst.bypassed = Math.max(worst.bypassed, on.posture.bypassed);
      }
      const kinds = (['noRoute', 'blocked', 'bypassed'] as const).filter((k) => worst[k] > 0);
      const problemText = (k: ProblemKind) => `${worst[k].toLocaleString('en-US')} ${PROBLEM_TEXT[k]}`;
      const tag = TAG[g.kind === 'named' ? 'named' : g.rule!.semantic];
      const summary = describeGroup(g);
      const members = plural(g.memberCount, 'member', 'members');
      const swatches = multi
        ? edges.map((e) => ({ serviceId: e.serviceId, serviceName: names.get(e.serviceId) ?? e.serviceId, tone: edgeTone(e.statusCounts) }))
        : [];
      const label = [
        g.policyName,
        tag,
        summary,
        members,
        g.checks.length ? plural(g.checks.length, 'posture check', 'posture checks') : null,
        ...kinds.map(problemText),
        ...swatches.map((w) => `${w.serviceName}: ${TONE_TEXT[w.tone]}`),
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        id,
        policyId: g.policyId,
        policyName: g.policyName,
        kind: g.kind,
        tag,
        summary,
        members,
        checks: g.checks.length,
        problem: kinds.length ? { kind: kinds[0], text: problemText(kinds[0]) } : null,
        problems: kinds.map((k) => ({ kind: k, text: problemText(k) })),
        swatches,
        label: `${label} — expand`,
      };
    };
    for (const lane of ['bind', 'dial'] as const) {
      if (!this.compactLanes()[lane]) continue;
      const blocks = this.blocks()[lane].map((b) => b.groupIds.map(rowOf));
      const problem = (rows: CompactRow[]) => (rows.some((r) => r.problem) ? 0 : 1);
      out[lane] = blocks.sort((a, b) => problem(a) - problem(b)).flat(); // stable: lane order within each
    }
    return out;
  });

  /** Per lane: the filter text. Reset when the focus changes. */
  readonly filters = linkedSignal<string, Record<Lane, string>>({ source: this.serviceId, computation: () => ({ bind: '', dial: '' }) });

  /** Template accessors for one compact lane. */
  rowsIn(lane: Lane): CompactRow[] {
    return this.shownRows()[lane];
  }
  rowCount(lane: Lane): number {
    return this.compactRows()[lane].length;
  }
  filterOf(lane: Lane): string {
    return this.filters()[lane];
  }
  laneTitle(lane: Lane): string {
    return LANE_NAME[lane];
  }

  setFilter(lane: Lane, text: string): void {
    this.filters.update((f) => ({ ...f, [lane]: text }));
  }

  /** Per group: what the filter searches — policy name, rule terms / named refs, member names. */
  private readonly haystacks = computed(() => {
    const out = new Map<string, string>();
    for (const [id, n] of this.nodes()) {
      const g = n.group;
      const terms = g.kind === 'named' ? g.named!.map((x) => x.name) : g.rule!.terms;
      out.set(id, [g.policyName, ...terms, ...g.memberNames].join('\n').toLowerCase());
    }
    return out;
  });

  /** A compact lane's rows that match its filter. */
  readonly shownRows = computed<Record<Lane, CompactRow[]>>(() => {
    const rows = this.compactRows();
    const f = this.filters();
    const match = (lane: Lane) => {
      const q = f[lane].trim().toLowerCase();
      if (!q) return rows[lane];
      const hay = this.haystacks();
      return rows[lane].filter((r) => hay.get(r.id)!.includes(q));
    };
    return { bind: match('bind'), dial: match('dial') };
  });

  /** Rows expanded to their full node. Reset when the focus changes. */
  readonly expanded = linkedSignal<string, ReadonlySet<string>>({ source: this.serviceId, computation: () => new Set() });

  /** Expands a row in place (focus moves to its Collapse button), or collapses it (focus back to the row). */
  toggleRow(id: string): void {
    const open = !this.expanded().has(id);
    this.expanded.update((s) => {
      const next = new Set(s);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
    afterNextRender(
      () => {
        const sel = open ? `.c-open[data-open-id="${id}"] .c-collapse` : `.c-row[data-group-id="${id}"]`; // ids hold no quotes
        this.canvas().nativeElement.querySelector<HTMLElement>(sel)?.focus();
      },
      { injector: this.injector },
    );
  }

  /** A compact row's badge: its worst problem on the canvas — posture ones only with posture details shown. */
  badgeOf(r: CompactRow): CompactRow['problem'] {
    return this.layers.posture() ? r.problem : (r.problems.find((p) => p.kind === 'noRoute') ?? null);
  }

  /** Edges drawn with nothing isolated: "Edges at rest" (off by default on a compact canvas). */
  readonly edgesAtRest = computed(() => this.layers.edgesAtRest(this.compact()));

  /** The hint, shown the first time a compact canvas without edges at rest appears in
   *  this browser, until a policy is hovered. */
  private readonly hintOpen = signal(!readFlag(HINT_KEY));
  readonly showHint = computed(() => this.compact() && !this.edgesAtRest() && this.hintOpen());

  dismissHint(): void {
    this.hintOpen.set(false);
  }

  /** The edges drawn: all of them — or, without edges at rest, only an isolation's. */
  readonly shownEdges = computed(() => {
    const all = this.edges();
    if (this.edgesAtRest()) return all;
    const iso = this.isolation();
    return iso ? all.filter((e) => iso.edges.has(e.id)) : [];
  });

  /** A lane's aria-label: the focused service's summary, or just its name with several services. */
  laneLabel(lane: Lane): string {
    return this.isMulti() ? LANE_NAME[lane] : this.layout()[lane].summary;
  }

  /** The user's open/closed choice per service's routing band; absent follows the
   *  default (expanded only for an outage). Reset when the focus changes. */
  private readonly bandOpen = linkedSignal<string, Record<string, boolean>>({
    source: this.serviceId,
    computation: () => ({}),
  });

  bandExpanded(c: ServiceCard): boolean {
    return c.routerRows.length > 0 && (this.bandOpen()[c.id] ?? c.outage);
  }

  toggleBand(c: ServiceCard): void {
    this.bandOpen.update((o) => ({ ...o, [c.id]: !this.bandExpanded(c) }));
  }

  /** " · attributes #git, #prod" for a service node's aria-label. */
  attrsLabel(c: ServiceCard): string {
    const a = c.view.service.attributes;
    return a.length ? ` · attributes ${a.join(', ')}` : '';
  }

  /** id → name, for each group's coverage. */
  readonly serviceNames = computed(() => new Map(this.world().services.map((s) => [s.id, s.name])));

  /** What an edge ends at inside its service node: an attribute chip, 'name', or null (the border). */
  private targetOf(e: MultiEdge): string | null {
    const { via, terms } = e.serviceMatch;
    if (via === 'named') return 'name';
    if (via === 'all') return null;
    const attrs = this.views().get(e.serviceId)!.service.attributes;
    return terms.find((t) => attrs.includes(t)) ?? null;
  }

  // ─── legend ─────────────────────────────────────────────────────────────

  /**
   * Per legend entry: what carries it on this canvas (with its layer on). Group-level
   * marks count where a card draws them — a host marker or router icon only on a
   * member the card names, a posture phrase where the group has an edge.
   */
  readonly legendMatches = computed(() => {
    const out = new Map<string, LegendMatch>(LEGEND_ENTRIES.map((e) => [e.id, emptyMatch()]));
    const at = (id: string) => out.get(id)!;
    const layers = { posture: this.layers.posture(), hosts: this.layers.hosts(), expiry: this.layers.expiry() };
    const now = this.clock.nowMs();

    // Lines, and the groups whose status reads as a link.
    for (const e of this.multi().edges) {
      const id = edgeId(e);
      const tone = edgeTone(e.statusCounts);
      const into = (m: LegendMatch) => (m.edges.add(id), m.groups.add(e.groupId), m.services.add(e.serviceId));
      into(at(`line-${tone}`));
      if (e.serviceMatch.via === 'all') into(at('line-all'));
      if (tone === 'warn' || tone === 'bad') at('verdict-gap').groups.add(e.groupId);
      const on = this.groupsOn().get(e.serviceId)?.get(e.groupId);
      if (layers.posture && on?.posture.blocked) at('card-blocked').groups.add(e.groupId);
      if (layers.posture && on?.posture.bypassed) at('card-bypass').groups.add(e.groupId);
    }

    // Group cards.
    const marks = this.marks();
    const expiries = this.expiries();
    const routers = this.routerIds();
    for (const [id, n] of this.nodes()) {
      const g = n.group;
      at(g.kind === 'named' ? 'card-named' : 'card-rule').groups.add(id);
      if (n.coverage.length > 1) at('card-cover').groups.add(id);
      if (g.appliesToAll) at('card-all').groups.add(id);
      if (layers.posture && g.checks.length) at('card-check').groups.add(id);
      const mark = marks.get(g.policyId);
      if (mark) at(`draft-${mark}`).groups.add(id);
      if (this.groupLive(id)) at('draft-live').groups.add(id);
      const states = this.hostStateFor(g);
      const shown = shownMemberIds(g, states);
      if (shown.some((m) => routers.has(m))) at('card-router').groups.add(id);
      if (layers.hosts && g.lane === 'bind') {
        if (shown.length) at('host-edit').groups.add(id);
        for (const m of shown) {
          const st = states.get(m);
          if (st) at(`host-${st}`).groups.add(id);
        }
      }
      const x = expiries.get(g.policyId);
      if (layers.expiry && x) {
        const pills = [x.at, ...(g.kind === 'named' ? shown.map((m) => x.entries.get(m)) : [])].filter((t): t is string => !!t);
        for (const t of pills) at(expiryPill(t, now).soon ? 'card-expiry-soon' : 'card-expiry').groups.add(id);
      }
    }
    for (const lane of ['bind', 'dial'] as const) {
      if (this.compactLanes()[lane]) continue; // rows, not containers
      for (const b of this.blocks()[lane]) if (b.groupIds.length > 1) b.groupIds.forEach((id) => at('card-box').groups.add(id));
    }
    for (const e of [...this.layout().bind.emptyPolicies, ...this.layout().dial.emptyPolicies]) at('card-empty').rules.add(e.policyId);

    // Service cards.
    for (const c of this.cards()) {
      const svc = (entry: string) => at(entry).services.add(c.id);
      const v = c.view.serviceVerdict;
      const wait = this.waitingOf(c);
      svc(v.notSetUp ? 'verdict-blank' : wait ? `verdict-${wait.kind}` : v.tone === 'ok' ? 'verdict-ok' : 'verdict-bad');
      if (c.view.service.attributes.length) svc('svc-attr');
      if (c.hosting.authorized) svc('svc-hosting');
      if ((c.traffic?.policies ?? 0) > 1) svc('svc-traffic');
      if (this.overlapsOf(c.id).length) svc('svc-overlap');
      svc(!c.routerRows.length ? 'svc-norouting' : c.outage ? 'svc-outage' : 'svc-routing');
      if (c.routingChanged && !this.bandExpanded(c)) svc('draft-routing');
      if (this.serviceLive(c.id)) svc('draft-live');
      if (this.isMulti()) svc('svc-menu');
      if (!c.focused) svc('svc-remove');
    }
    return out;
  });

  /** The legend's rows: each entry, whether the canvas has it, whether its layer hides it. */
  readonly legendEntries = computed<LegendEntry[]>(() => {
    const matches = this.legendMatches();
    return LEGEND_ENTRIES.map((e) => {
      const hidden = !!e.layer && !this.layers.layer(e.layer);
      return { ...e, hidden, present: !hidden && matchSize(matches.get(e.id)!) > 0 };
    });
  });

  legendEnter(e: { id: string; focus: boolean }): void {
    const spot: Spot = { kind: 'legend', id: e.id };
    if (e.focus) this.focusIn(spot);
    else this.hoverIn(spot);
  }

  legendLeave(e: { id: string; focus: boolean }): void {
    const spot: Spot = { kind: 'legend', id: e.id };
    clearTimeout(this.hoverTimer);
    if (sameSpot(this.spot(), spot)) this.spot.set(null);
  }

  // ─── a service card's "⋯" menu (several services) ──────────────────────

  /** The service whose menu is open. */
  readonly menuOpen = signal<string | null>(null);

  toggleMenu(serviceId: string): void {
    const open = this.menuOpen() !== serviceId;
    this.menuOpen.set(open ? serviceId : null);
    if (open) this.focusMenuItem(serviceId, 0);
  }

  /** Clicks outside a menu close it (a click inside stops at the menu). */
  closeMenu(): void {
    if (this.menuOpen()) this.menuOpen.set(null);
  }

  /** Escape closes it, back to its button; arrows move between items; Tab leaves (and closes). */
  menuKey(serviceId: string, ev: KeyboardEvent): void {
    const items = [...this.menuItems(serviceId)];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.menuOpen.set(null);
      this.canvas().nativeElement.querySelector<HTMLElement>(`[data-service-id="${serviceId}"] .svc-menu-btn`)?.focus();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = (i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      items[ev.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (ev.key === 'Tab') {
      this.menuOpen.set(null);
    }
  }

  menuDetails(serviceId: string): void {
    this.menuOpen.set(null);
    this.serviceDetails.emit(serviceId);
  }

  /** "Export access report" from the menu: the same live CSV as the link; the ⋯ spins meanwhile. */
  menuExport(c: ServiceCard): void {
    this.menuOpen.set(null);
    void this.exporter.export(this.exportKey(c.id), { kind: 'services', ids: [c.id] }, c.view.service.name);
  }

  exportKey(serviceId: string): string {
    return `svc-menu-${serviceId}`;
  }

  exporting(serviceId: string): boolean {
    return this.exporter.running()?.key === this.exportKey(serviceId);
  }

  private menuItems(serviceId: string): NodeListOf<HTMLElement> {
    return this.canvas().nativeElement.querySelectorAll<HTMLElement>(`[data-service-id="${serviceId}"] .svc-menu [role="menuitem"]`);
  }

  private focusMenuItem(serviceId: string, index: number): void {
    afterNextRender(() => this.menuItems(serviceId)[index]?.focus(), { injector: this.injector });
  }

  // ─── isolation ──────────────────────────────────────────────────────────

  /** The edge, group or service under the pointer (after HOVER_DELAY) or holding focus. */
  readonly spot = signal<Spot | null>(null);
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;

  hoverIn(s: Spot): void {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => this.spot.set(s), HOVER_DELAY);
  }

  hoverOut(s: Spot): void {
    clearTimeout(this.hoverTimer);
    if (sameSpot(this.spot(), s)) this.spot.set(null);
  }

  focusIn(s: Spot): void {
    clearTimeout(this.hoverTimer);
    this.spot.set(s);
  }

  /** Focus moving between controls inside one node keeps it isolated. */
  focusOut(s: Spot, e: FocusEvent): void {
    const to = e.relatedTarget as Node | null;
    if (to && (e.currentTarget as Element).contains(to)) return;
    if (sameSpot(this.spot(), s)) this.spot.set(null);
  }

  /**
   * What stays at full strength while something is isolated — everything else
   * fades. An edge keeps itself, its group, its service and target; a group its
   * edges and their services and targets; a service the edges into it and their
   * groups. With nothing hovered or focused, the policy open in the editor is
   * isolated like its groups. Then, for every kept edge that matched on
   * attributes, the same group's other edges matching on a shared term (and their
   * services) are kept too. Null: nothing is isolated.
   */
  readonly isolation = computed(() => {
    const s = this.spot();
    const selected = this.selectedPolicyId();
    const all = this.multi().edges;
    const policyOf = (groupId: string) => this.nodes().get(groupId)?.group.policyId;
    if (s?.kind === 'legend') {
      // What carries the entry, as it is — no attribute pull-in.
      const m = this.legendMatches().get(s.id);
      return m && matchSize(m) ? { ...m, targets: new Set<string>(), focusEdge: null } : null;
    }
    let kept: MultiEdge[];
    const groups = new Set<string>();
    const services = new Set<string>();
    if (s?.kind === 'edge') kept = all.filter((e) => edgeId(e) === s.id);
    else if (s?.kind === 'group') {
      kept = all.filter((e) => e.groupId === s.id);
      groups.add(s.id);
    } else if (s?.kind === 'service') {
      kept = all.filter((e) => e.serviceId === s.id);
      services.add(s.id);
    } else if (selected) {
      kept = all.filter((e) => policyOf(e.groupId) === selected);
      for (const id of this.nodes().keys()) if (policyOf(id) === selected) groups.add(id);
    } else return null;

    // Step 2: an attribute match pulls in the same group's other edges that matched
    // on a shared term — the other services that rule covers the same way.
    const shared = (a: MultiEdge, b: MultiEdge) => a.serviceMatch.terms.some((t) => b.serviceMatch.terms.includes(t));
    const extra = all.filter(
      (e) =>
        !kept.includes(e) &&
        e.serviceMatch.via === 'attributes' &&
        kept.some((k) => k.serviceMatch.via === 'attributes' && k.groupId === e.groupId && shared(k, e)),
    );
    kept = [...kept, ...extra];

    const targets = new Set<string>();
    for (const e of kept) {
      groups.add(e.groupId);
      services.add(e.serviceId);
      const t = this.targetOf(e);
      if (t) targets.add(`${e.serviceId}|${t}`);
    }
    return { edges: new Set(kept.map(edgeId)), groups, services, targets, rules: new Set<string>(), focusEdge: s?.kind === 'edge' ? s.id : null };
  });

  /** Several services: per group, one status row per edge (in service order). */
  readonly statusRows = computed(() => {
    const rows = new Map<string, StatusRow[]>();
    if (!this.isMulti()) return rows;
    for (const e of this.multi().edges) {
      const view = this.views().get(e.serviceId)!;
      const g = [...view.bind.groups, ...view.dial.groups].find((x) => x.id === e.groupId)!;
      const list = rows.get(e.groupId) ?? [];
      list.push({
        serviceId: e.serviceId,
        serviceName: view.service.name,
        tone: edgeTone(e.statusCounts),
        parts: rowParts(g.status),
        extras: [...this.hostParts(g, e.serviceId), ...postureCounts(g.posture)],
      });
      rows.set(e.groupId, list);
    }
    return rows;
  });

  /** The hovered/focused service, for highlighting its status rows. */
  readonly hotServiceId = computed(() => {
    const s = this.spot();
    return s?.kind === 'service' ? s.id : null;
  });

  isKeptEdge(id: string): boolean {
    return this.isolation()?.edges.has(id) ?? false;
  }

  /** Faded: something is isolated and this isn't part of it. */
  fadedEdge(id: string): boolean {
    const iso = this.isolation();
    return !!iso && !iso.edges.has(id);
  }

  fadedGroup(id: string): boolean {
    const iso = this.isolation();
    return !!iso && !iso.groups.has(id);
  }

  fadedService(id: string): boolean {
    const iso = this.isolation();
    return !!iso && !iso.services.has(id);
  }

  /** An empty rule ("no identities yet") stays at full strength: its legend entry is isolated. */
  keptRule(policyId: string): boolean {
    return this.isolation()?.rules.has(policyId) ?? false;
  }

  isHotTarget(serviceId: string, target: string): boolean {
    return this.isolation()?.targets.has(`${serviceId}|${target}`) ?? false;
  }

  /** The hovered/focused edge, redrawn last so it sits above the others. */
  readonly raisedEdge = computed(() => {
    const id = this.isolation()?.focusEdge;
    return id ? (this.edges().find((e) => e.id === id) ?? null) : null;
  });

  // ─── edge tip + click ───────────────────────────────────────────────────

  /** The edge under the pointer / holding focus, and where its tip goes (canvas px). */
  readonly tip = signal<{ id: string; text: string; x: number; y: number; flip: boolean } | null>(null);

  showTip(e: EdgePath, ev: MouseEvent | FocusEvent): void {
    const origin = this.canvas().nativeElement.getBoundingClientRect();
    let x: number;
    let y: number;
    if (ev instanceof MouseEvent) {
      [x, y] = [ev.clientX, ev.clientY];
    } else {
      const r = (ev.target as Element).getBoundingClientRect();
      [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    }
    // Near the right edge the tip opens to the pointer's left.
    const flip = x - origin.left > origin.width - 300;
    this.tip.set({ id: e.id, text: e.text, x: x - origin.left, y: y - origin.top, flip });
  }

  hideTip(e: EdgePath): void {
    if (this.tip()?.id === e.id) this.tip.set(null);
  }

  openEdge(e: EdgePath, ev?: Event): void {
    if (!e.gap) return;
    ev?.preventDefault();
    this.routerGap.emit({ groupId: e.groupId, kind: e.gap, serviceId: e.serviceId });
  }

  /** A group's status-line phrase: always about the focused service. */
  groupGap(groupId: string, kind: RouterGapKind): void {
    this.routerGap.emit({ groupId, kind, serviceId: this.serviceId() });
  }

  // ─── measured overlay ───────────────────────────────────────────────────

  /** Measured overlay geometry — written only by measure(). */
  readonly edges = signal<EdgePath[]>([]);
  readonly svgSize = signal({ w: 0, h: 0 });

  private readonly injector = inject(Injector);

  constructor() {
    // A live change with no draft open: flash what it touched, then let it go.
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    let seen = this.draft.lastLiveChange();
    effect(() => {
      const change = this.draft.lastLiveChange();
      if (!change || change === seen) return;
      seen = change;
      untracked(() => {
        if (this.draft.ops().length) return; // the draft's marks say it instead
        clearTimeout(flashTimer);
        this.flashSets.set(impactSets([change.impact]));
        this.liveAnnouncement.set(`${change.entities.map((e) => e.name).join(', ')} changed in live · ${change.actor}`);
        flashTimer = setTimeout(() => this.flashSets.set(null), LIVE_FLASH_MS);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(flashTimer));
    // The hint counts as shown once it appears; the first isolated policy retires it.
    effect(() => {
      if (this.showHint()) writeFlag(HINT_KEY);
      const s = this.spot();
      if (s?.kind === 'group' || s?.kind === 'edge') this.hintOpen.set(false);
    });
    // A hovered or focused row: show the first service it reaches in a scrolling column.
    effect(() => {
      const s = this.spot();
      if (s?.kind === 'group') untracked(() => this.revealFirstService(s.id));
    });
    // Re-measure after every render that follows a layout change.
    afterRenderEffect(() => {
      this.multi();
      this.measure();
    });
    // … and whenever the canvas itself resizes (fonts, viewport, a band opening).
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(() => this.measure());
      ro.observe(this.canvas().nativeElement);
      destroyRef.onDestroy(() => ro.disconnect());
      // The services column follows the scroll (compact canvases): re-place it, and the edges, per frame.
      const scroller = scrollParent(this.canvas().nativeElement);
      let frame = 0;
      const onScroll = () => {
        if (!this.compact() || frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          this.measure();
        });
      };
      const target: HTMLElement | Window = scroller ?? window;
      target.addEventListener('scroll', onScroll, { passive: true });
      // The column's own scrolling (scroll doesn't bubble: capture it on the canvas).
      const canvas = this.canvas().nativeElement;
      canvas.addEventListener('scroll', onScroll, { passive: true, capture: true });
      destroyRef.onDestroy(() => {
        target.removeEventListener('scroll', onScroll);
        canvas.removeEventListener('scroll', onScroll, { capture: true });
        cancelAnimationFrame(frame);
      });
      this.scroller = scroller;
    });
  }

  private scroller: HTMLElement | null = null;
  private stickOffset = 0;
  /** The services column is its own scroll box (compact, and too tall for the container). */
  private columnScrolls = false;

  private columnEl(): HTMLElement | null {
    return this.canvas().nativeElement.querySelector<HTMLElement>('.lane-service .service-body');
  }

  /** A scrolling column: bring the first service `groupId` reaches into view, if it isn't. */
  private revealFirstService(groupId: string): void {
    const body = this.columnEl();
    if (!this.columnScrolls || !body) return;
    const first = this.multi().edges.find((e) => e.groupId === groupId)?.serviceId; // edges are in column order
    const node = first ? body.querySelector<HTMLElement>(`[data-service-id="${first}"] .service`) : null;
    if (!node) return;
    const b = body.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    if (n.top >= b.top && n.bottom <= b.bottom) return; // already visible
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ top: body.scrollTop + (n.top - b.top) - 8, behavior: smooth ? 'smooth' : 'auto' });
  }

  /**
   * Compact canvases: offsets the services column so it stays at the top of the
   * scroll container while its lanes scroll past — when it fits in the container's
   * height; otherwise (and below the threshold) it sits where the grid puts it.
   */
  private stick(): void {
    const body = this.columnEl();
    if (!body) return;
    let offset = 0;
    let scrolls = false;
    if (this.compact()) {
      const view = this.scroller ? this.scroller.getBoundingClientRect() : { top: 0, height: innerHeight };
      const height = this.scroller ? this.scroller.clientHeight : innerHeight;
      // Too tall for the scroll container: its own scroll box, as tall as the container allows.
      scrolls = body.scrollHeight + 2 * STICK_MARGIN > height;
      const max = scrolls ? `${height - 2 * STICK_MARGIN}px` : '';
      if (body.style.maxHeight !== max) body.style.maxHeight = max;
      body.classList.toggle('sv-col-scroll', scrolls);
      const r = body.getBoundingClientRect();
      const top = r.top - this.stickOffset; // where the grid puts it
      const lane = body.parentElement!.getBoundingClientRect();
      offset = Math.max(0, Math.min(view.top + STICK_MARGIN - top, lane.bottom - top - r.height));
    } else if (body.style.maxHeight) {
      body.style.maxHeight = '';
      body.classList.remove('sv-col-scroll');
    }
    this.columnScrolls = scrolls;
    if (offset !== this.stickOffset) {
      this.stickOffset = offset;
      body.style.transform = offset ? `translateY(${offset}px)` : '';
    }
  }

  private measure(): void {
    this.stick();
    const canvas = this.canvas().nativeElement;
    const column = this.columnScrolls ? this.columnEl()!.getBoundingClientRect() : null;
    const origin = canvas.getBoundingClientRect();
    const nodes = this.nodes();

    const paths: EdgePath[] = [];
    for (const e of this.multi().edges) {
      const svcEl = canvas.querySelector<HTMLElement>(`[data-service-id="${e.serviceId}"] .service`);
      const groupEl = canvas.querySelector(`[data-group-id="${e.groupId}"]`);
      const r = groupEl?.getBoundingClientRect();
      const svc = svcEl?.getBoundingClientRect();
      if (!svcEl || !svc || !groupEl || !r) continue;
      const group = nodes.get(e.groupId)!.group;
      const y1 = r.top + r.height / 2 - origin.top;
      // Bind groups sit left of the services, Dial groups right of them.
      const leftOfService = group.lane === 'bind';
      // The curve spans the whole gutter: from the lane edge — a group inside its
      // policy's container leads out to the container's border first.
      const box = groupEl.closest('.policy-box')?.getBoundingClientRect() ?? r;
      const x0 = (leftOfService ? r.right : r.left) - origin.left;
      const x1 = (leftOfService ? box.right : box.left) - origin.left;
      const lead = x1 !== x0 ? ` L ${x1} ${y1}` : '';
      const x2 = (leftOfService ? svc.left : svc.right) - origin.left;
      const mx = (x1 + x2) / 2;
      // The target inside the node: curve to the border at its height, then straight in.
      const target = this.targetOf(e);
      const targetEl =
        target === 'name'
          ? svcEl.querySelector('.svc-name')
          : target
            ? svcEl.querySelector(`[data-chip="${CSS.escape(target)}"]`)
            : null;
      const t = targetEl?.getBoundingClientRect();
      let y2 = (t ? t.top + t.height / 2 : svc.top + svc.height / 2) - origin.top;
      let tail = t ? ` L ${(leftOfService ? t.left - 3 : t.right + 3) - origin.left} ${y2}` : '';
      // A scrolling column: an edge to a service out of its view ends at the box's edge.
      if (column) {
        const lo = column.top - origin.top + 6;
        const hi = column.bottom - origin.top - 6;
        if (y2 < lo || y2 > hi) {
          y2 = Math.min(hi, Math.max(lo, y2));
          tail = '';
        }
      }

      const tone = edgeTone(e.statusCounts);
      const single = this.views().get(e.serviceId)!;
      const counts = [...single.bind.groups, ...single.dial.groups].find((g) => g.id === e.groupId)!.label.counts;
      paths.push({
        id: edgeId(e),
        groupId: e.groupId,
        policyId: group.policyId,
        serviceId: e.serviceId,
        d: `M ${x0} ${y1}${lead} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}${tail}`,
        tone,
        viaAll: e.serviceMatch.via === 'all',
        text: `${group.policyName} → ${single.service.name}: ${counts.map((c) => c.text).join(' · ')}`,
        gap: tone === 'bad' ? 'noSharedRouter' : tone === 'warn' ? 'routersOffline' : null,
      });
    }
    this.edges.set(paths);
    if (this.spot()?.kind === 'edge' && !paths.some((p) => p.id === this.spot()!.id)) this.spot.set(null);
    this.svgSize.set({ w: origin.width, h: origin.height });
  }
}

const TONE_TEXT: Record<EdgeTone, string> = { ok: 'all reachable', warn: 'routers offline', bad: 'no shared router', none: 'no identities' };

/** The nearest ancestor that scrolls vertically; null: the window. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
