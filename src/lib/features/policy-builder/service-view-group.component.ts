import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, afterNextRender, computed, inject, Injector, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PolicyMark } from './draft/policy-draft.store';
import { describeCoverage, labelGroup, type Group, type LabelCount, type RouterGapKind } from './service-view.layout';
import type { EdgeTone } from './multi-service.layout';
import type { PolicyExpiry } from './expiry';
import { ExpiryPillComponent } from './expiry-pill.component';
import { CanvasLayers } from './canvas-layers';

/** Multi-service mode: the group's status on ONE service it has an edge to, as one
 *  short line — "all reachable" / "routers offline" / "no shared router" when every
 *  member shares it, else the non-zero counts ("2 reachable · 1 no shared router"). */
export type HostState = 'serving' | 'standby' | 'blocked';

const HOST_TITLE: Record<HostState, string> = {
  serving: 'Serving this service now',
  standby: 'Standby: it gets traffic only if no better host is left',
  blocked: 'Blocked by posture: it fails its Bind posture checks, so its terminators get no traffic',
};

export interface StatusRow {
  serviceId: string;
  serviceName: string;
  tone: EdgeTone;
  /** Route status: "all with an online route" / "2 reachable · 1 no shared router". */
  parts: LabelCount[];
  /** Serving / standby / blocked by posture / bypassed — a second line under the name. */
  extras: LabelCount[];
}

/** Rule groups list this many member names before "+N more", which opens the member drawer. */
const MEMBERS_VISIBLE = 3;

/** The members a card names: a named group's entries that are members; a rule group's
 *  first MEMBERS_VISIBLE, serving then standby hosts first (so "+N more" never hides
 *  who is hosting). */
export function shownMemberIds(g: Group, state: ReadonlyMap<string, HostState>): string[] {
  if (g.kind === 'named') return g.named!.filter((n) => g.memberIds.includes(n.id)).map((n) => n.id);
  const rank = (id: string) => (state.get(id) === 'serving' ? 0 : state.has(id) ? 1 : 2);
  return [...g.memberIds].sort((a, b) => rank(a) - rank(b)).slice(0, MEMBERS_VISIBLE);
}

/**
 * One group node in the service view, sized to its content. 'named' and 'rule'
 * groups are styled apart. Text comes from labelGroup(): the visible text without
 * the direction prefix, the host's aria-label with it.
 *
 * The node is a labelled group holding three kinds of control: the policy name
 * (edit the policy), member names (open the identity lens), and the router-gap
 * phrases in the status line (open the gap panel). A click anywhere else on the node also edits — a mouse shortcut; the
 * name button is the keyboard path.
 *
 * When the policy covers other services too, the header carries a layers badge with
 * the total service count; hovering or focusing it lists them all: the focused one
 * first ("this service"), those already on the canvas highlighted with a × that
 * takes them off it, the rest as
 * buttons that add them to the canvas (disabled once it holds the maximum).
 *
 * On a canvas with several services the single status line becomes one row per
 * service the group has an edge to (`statusRows`): a swatch in the edge's style,
 * the service name and that edge's counts. Hovering a service highlights its row.
 */
@Component({
  selector: 'app-service-view-group',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, ExpiryPillComponent],
  templateUrl: './service-view-group.component.html',
  styleUrls: ['./canvas-marks.css', './service-view-group.component.css'],
  host: {
    role: 'group',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.data-group-id]': 'group().id',
    '[class.named]': "group().kind === 'named'",
    '[class.rule]': "group().kind === 'rule'",
    '[class.selected]': 'selected()',
    '[class.in-container]': 'inContainer()',
    '[class.marked]': 'mark() !== null',
    '[class.proposed]': "mark() === 'proposed'",
    '[class.live-changed]': 'liveChanged()',
    '[class.live-flash]': 'flash()',
    '(click)': 'activate.emit()',
    '(document:click)': 'closeMenu()',
  },
})
export class ServiceViewGroupComponent {
  /** "Show on canvas": posture details, host markers, expiry pills. */
  protected readonly layers = inject(CanvasLayers);

  readonly group = input.required<Group>();
  /** Draft state of this group's policy ('proposed': in the assist's pending
   *  proposal, not yet in the draft); null when it matches live. */
  readonly mark = input<PolicyMark | 'proposed' | null>(null);
  /** Changed in live (outside the builder) while the draft is open — "changed in live". */
  readonly liveChanged = input(false);
  /** Just changed in live with no draft open: flash once. */
  readonly flash = input(false);
  /** Status chips in the header (none inside a container, which carries them). One sits
   *  beside the name; several get their own line under it. */
  readonly statusChipCount = computed(() =>
    this.inContainer() ? 0 : (this.mark() !== null ? 1 : 0) + (this.liveChanged() ? 1 : 0),
  );
  /** Time-limited access on its policy: the policy's own expiry (a pill under the
   *  header) and its named entries' (a pill beside the member). */
  readonly expiry = input<PolicyExpiry | null>(null);
  /** Its policy is open in the editor. */
  readonly selected = input(false);
  /** Inside its policy's container, which carries the policy name and mark. */
  readonly inContainer = input(false);
  /** The service `group` was laid out for, and every service's name (for otherServiceIds). */
  readonly serviceName = input.required<string>();
  readonly serviceNames = input<ReadonlyMap<string, string>>(new Map());
  /** Show the status line — the group has an edge to the focused service. */
  readonly statusShown = input(true);
  /** Several services on the canvas: one status row per service it has an edge to. */
  readonly statusRows = input<readonly StatusRow[]>([]);
  /** "N authorized", shown once above the rows. */
  readonly rowsAuthorized = computed(() => {
    const s = this.group().status;
    return `${s.reachable + s.routersOffline + s.noSharedRouter} authorized`;
  });
  /** The hovered/focused service — its row is highlighted, the others fade. */
  readonly hotServiceId = input<string | null>(null);
  /** Router identities on the canvas: their members show the router icon. */
  readonly routerIds = input<ReadonlySet<string>>(new Set());
  /** Host groups: members with a live terminator on the service — 'serving', or
   *  'standby' when their best terminator has failed. Absent = not serving. */
  readonly hostState = input<ReadonlyMap<string, HostState>>(new Map());
  /** A gap phrase in a status row: open the gap for this group on that service. */
  readonly rowGap = output<{ serviceId: string; kind: RouterGapKind }>();
  /** A posture phrase: open the posture panel — on that row's service, or (null) the
   *  service the group was laid out for. */
  readonly posture = output<string | null>();
  /** A shield chip: that posture check, read-only. */
  readonly viewCheck = output<string>();
  /** A host member: edit its hosting defaults. */
  readonly editHost = output<string>();
  /** Every service the policy covers, the focused one first. */
  readonly coverage = input<readonly { id: string; name: string }[]>([]);
  /** The services on the canvas, the focused one, and whether it holds the maximum. */
  readonly canvasIds = input<readonly string[]>([]);
  readonly focusId = input<string | null>(null);
  readonly canvasFull = input(false);
  /** A popover row added a service to the canvas / removed one already there. */
  readonly addService = output<string>();
  readonly removeService = output<string>();
  /** Edit this group's policy. */
  readonly activate = output<void>();
  /** "+N more": list every member in the member drawer (never inline). */
  readonly members = output<void>();
  /** Explain a router-gap phrase ("N with no shared router" / "N with routers offline"). */
  readonly gap = output<RouterGapKind>();
  /** ⋯ → Routers: the edge router policies giving its members routers. */
  readonly routers = output<void>();
  /** The draft is submitted for review: no "Routers" in the menu. */
  readonly locked = input(false);

  /** " after this draft" on a group whose policy the draft created or edited: its
   *  counts describe the draft, not live. '' otherwise. */
  readonly afterDraft = computed(() => (this.mark() === 'new' || this.mark() === 'edited' ? ' after this draft' : ''));

  /** A status chip's tooltip: only on draft-marked groups ("3 authorized after this draft"). */
  chipTitle(text: string): string | null {
    return this.afterDraft() ? text + this.afterDraft() : null;
  }

  readonly ariaLabel = computed(() => {
    const mark = this.mark();
    const all = this.group().appliesToAll ? ' · applies to all services' : '';
    const coverage = describeCoverage(this.group(), this.serviceName(), this.serviceNames());
    const rows = this.statusRows();
    const after = this.afterDraft();
    const text = rows.length
      ? `${this.group().label.summary} · ${this.rowsAuthorized()} · ${rows.map((r) => `on ${r.serviceName}: ${[...r.parts, ...r.extras].map((c) => c.text).join(', ')}`).join('; ')}${after}`
      : this.statusShown()
        ? `${this.group().label.text}${after}`
        : this.group().label.summary;
    const checks = this.group().checks.length ? ` · requires ${this.group().checks.map((k) => k.name).join(', ')}` : '';
    const live = this.liveChanged() ? ' · changed in live' : '';
    return `${text}${checks}${all}${mark ? ` · ${mark}` : ''}${live}${this.hostingLabel()} · ${coverage}`;
  });

  /** " · serving: a, b · standby: c" — the markers, for the aria-label. */
  private readonly hostingLabel = computed(() => {
    const g = this.group();
    const state = this.hostState();
    const named = (s: HostState) =>
      g.memberIds.map((id, i) => (state.get(id) === s ? g.memberNames[i] : null)).filter((n) => n !== null);
    return (['serving', 'standby', 'blocked'] as const)
      .map((s) => ({ s, names: named(s) }))
      .filter((x) => x.names.length)
      .map((x) => ` · ${x.s}: ${x.names.join(', ')}`)
      .join('');
  });

  /** The badge popover's rows. */
  readonly coverRows = computed(() =>
    this.coverage().map((s) => ({
      ...s,
      state:
        s.id === this.focusId()
          ? ('focus' as const)
          : this.canvasIds().includes(s.id)
            ? ('onCanvas' as const)
            : this.canvasFull()
              ? ('full' as const)
              : ('add' as const),
    })),
  );
  readonly coverOpen = signal(false);

  remove(id: string, e: Event): void {
    e.stopPropagation(); // not an edit
    this.removeService.emit(id);
  }

  add(row: { id: string; state: string }, e: Event): void {
    e.stopPropagation(); // not an edit
    if (row.state === 'add') this.addService.emit(row.id);
  }

  toggleCover(e: Event): void {
    e.stopPropagation(); // not an edit
    this.coverOpen.update((v) => !v);
  }

  /** Close once focus leaves the badge and its popover. */
  coverBlur(e: FocusEvent): void {
    const to = e.relatedTarget as Node | null;
    if (!to || !(e.currentTarget as HTMLElement).contains(to)) this.coverOpen.set(false);
  }

  openGap(kind: RouterGapKind, e: Event): void {
    e.stopPropagation(); // not an edit
    this.gap.emit(kind);
  }

  edit(e: Event): void {
    e.stopPropagation(); // the host's click would emit again
    this.activate.emit();
  }

  readonly visible = computed(() => labelGroup(this.group(), false));
  /** The status line's counts: for the hovered service when there is one, else the focused. */
  hostTitle(state: HostState): string {
    return HOST_TITLE[state];
  }

  openCheck(checkId: string, e: Event): void {
    e.stopPropagation(); // not an edit of the policy
    this.viewCheck.emit(checkId);
  }

  openHost(identityId: string, e: Event): void {
    e.stopPropagation(); // not an edit of the policy
    this.editHost.emit(identityId);
  }

  openPosture(serviceId: string | null, e: Event): void {
    e.stopPropagation(); // not an edit
    this.posture.emit(serviceId);
  }

  openRowGap(serviceId: string, kind: RouterGapKind, e: Event): void {
    e.stopPropagation(); // not an edit
    this.rowGap.emit({ serviceId, kind });
  }

  readonly kindTag = computed(() => {
    const g = this.group();
    if (g.kind === 'named') return 'named';
    return g.rule!.semantic === 'AllOf' ? 'all of' : 'any of';
  });

  readonly shownMembers = computed(() => {
    const g = this.group();
    const state = this.hostState();
    const names = new Map(g.memberIds.map((id, i) => [id, g.memberNames[i]]));
    return shownMemberIds(g, state).map((id) => ({ id, name: names.get(id)!, state: state.get(id) ?? null }));
  });

  /** A status line's phrases, less the posture ones while posture details are hidden
   *  (the other counts are unchanged — they never included posture). */
  shownParts(parts: readonly LabelCount[]): readonly LabelCount[] {
    return this.layers.posture() ? parts : parts.filter((c) => !c.posture);
  }
  readonly hiddenMembers = computed(() => Math.max(0, this.group().memberCount - MEMBERS_VISIBLE));

  // ─── the ⋯ menu: Edit policy, Routers ─────────────────────────────────────
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  readonly menuOpen = signal(false);

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
    if (this.menuOpen()) afterNextRender(() => this.menuItems()[0]?.focus(), { injector: this.injector });
  }

  /** A click outside closes it (a click inside stops at the menu). */
  closeMenu(): void {
    if (this.menuOpen()) this.menuOpen.set(false);
  }

  /** Escape closes it, back to its button; arrows move between items; Tab leaves (and closes). */
  menuKey(ev: KeyboardEvent): void {
    const items = this.menuItems();
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.menuOpen.set(false);
      this.host.nativeElement.querySelector<HTMLElement>('.g-menu-btn')?.focus();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (ev.key === 'Tab') {
      this.menuOpen.set(false);
    }
  }

  private menuItems(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('.g-menu [role="menuitem"]')];
  }

  menuEdit(): void {
    this.menuOpen.set(false);
    this.activate.emit();
  }

  menuRouters(): void {
    this.menuOpen.set(false);
    this.routers.emit();
  }

  openMembers(e: Event): void {
    e.stopPropagation(); // not an edit
    this.members.emit();
  }
}
