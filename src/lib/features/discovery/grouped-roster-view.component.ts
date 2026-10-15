import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { pack, hierarchy } from 'd3-hierarchy';
import { MockDataService } from '../../shared/services/mock-data.service';
import { DrawerService } from '../../shared/services/drawer.service';
import { DISCOVERED_FLOWS } from './discovered-flows.mock';
import { buildGroupedRoster } from './grouped-roster.adapter';
import type { RosterIdentityRef } from './grouped-roster.adapter';

/**
 * Grouped-roster view — the attribute-tag grouping, with a subtractive filter.
 *
 * One circle per group, sized by member count: a tag-node per distinct identity
 * attribute, plus the catch-all's two arms. Hover emphasises one circle and dims
 * the rest; a click opens the group's member list in the app drawer, and a row
 * there drills to that identity (with a scoped way back). Still NO edges and NO
 * group-by control.
 *
 * FILTERING is SUBTRACTIVE and is show/hide ONLY — it never re-groups. The view
 * opens with every node visible (`DEFAULT_VISIBLE`) and the user hides down to
 * what they want; nothing starts sparse and nothing has to be discovered by
 * adding it. A hidden node is not laid out, not counted, and not reachable — it
 * is absent, not dimmed, which is what keeps it distinct from hover emphasis.
 *
 * THE CONTROL SURFACE is a searchable dropdown for the TAGS and persistent
 * toggles for the two CATCH-ALLS. That split is not cosmetic: tag nodes are
 * open-ended (a roster can carry dozens, and the list must stay one row tall
 * however many there are — the popover scrolls internally at a fixed
 * max-height), whereas the catch-alls are a closed set of exactly two that exist
 * for every roster. Burying "Unmanaged hosts" in a searchable list of tags would
 * imply it is one, which is the single distinction this view exists to draw.
 *
 * REPACK, not holes: d3.pack re-runs over the VISIBLE set on every change, so
 * the remaining circles reflow to fill the canvas. Circle area tracks member
 * count, and pack scales its layout to whatever it is given, so keeping hidden
 * nodes as reserved empty space would shrink every surviving circle for no
 * reason — the picture would carry a permanent tax for groups the user chose not
 * to see.
 *
 * HOVER follows the house convention rather than a shared util, matching
 * SankeyChartComponent's `hoveredNodeId` + `.sankey-dim` and SegmentViewComponent's
 * `hoveredNode` + `.node-dim`: a per-component signal, a CSS class, cleared on
 * mouseleave and on a background click.
 *
 * Hover now reveals OVERLAP, so the dim rule carries a claim it did not before:
 * hovering a tag circle draws a line to every other VISIBLE tag circle it shares
 * an identity with, and those circles stay lit alongside the hovered one. "Lit
 * and connected" therefore means "shares with what you are pointing at" — the
 * one relationship multi-membership creates and the flat picture cannot show.
 * Everything else dims. Lines exist only while hovering: there is no at-rest
 * edge set and no pinning — across a roster this size a permanent mesh would be
 * noise rather than structure. Nothing is capped: on a multi-dimensional roster a
 * location tag genuinely does share identities with every application, and a
 * hover that lights most of the map is reporting that, not failing to filter.
 *
 * OVERLAP IS DERIVED TAG-AWARE, from `RosterIdentityRef.attributes` on the
 * hovered node's own members — never from a bare id list, and never by joining
 * on name or display string (a host's `display` and an identity's `name` are
 * both strings; intersecting those is precisely how a false edge to the
 * unmanaged arm would be manufactured). The derivation is guarded to tag
 * circles on BOTH ends: the catch-alls are inert by construction — a no-tag
 * member carries `attributes: []` and an unmanaged host has no id or tag set at
 * all — and the guard states that rather than relying on it.
 *
 * SEMANTICS live in the pure adapter (`buildGroupedRoster`, grouped-roster.adapter.ts):
 * this component only reads the signals the adapter must not touch, hands it the
 * roster + flows, and turns the projection into placed circles. The adapter still
 * computes no geometry; the geometry still computes no grouping; and the FILTER
 * is a view concern living only here — the projection is never re-derived for a
 * subset, it is projected once and drawn in part.
 *
 * Node rendering follows SegmentViewComponent's glyph convention — a `<g>` per
 * node carrying a `<title>` tooltip, a shape, a label, and a count, with the node
 * KIND encoded as a CSS class (`rn-tag` / `rn-no-tag` / `rn-unmanaged`) rather
 * than inline styling. Its LAYOUT is deliberately not reused: bipartite columns
 * and banded lanes express a from→to topology this view does not have.
 */

/**
 * Canvas the pack lays out into. Kept near-SQUARE on purpose: d3.pack fills a
 * circle of diameter min(W, H) and centres it, so a wide canvas does not widen
 * the picture — it only pads both sides with dead space and shrinks every circle.
 *
 * SIZED FOR ~20 CIRCLES. Pack radii are RELATIVE: every leaf is scaled to fit the
 * enclosing circle, so adding groups shrinks all of them. At the original 820×620
 * (effective diameter 620) the multi-dimensional roster pushed the smaller tags
 * under LABEL_INSIDE_MIN_R and their labels moved outside, where they collide.
 * Diameter 620 → 900 is ~2.1× the area and ~1.45× on every radius, which carries
 * the smallest tag node back inside. The ~140 units of surplus width are not
 * waste: that margin is where the overlap summary panel gets placed.
 */
const CANVAS_W = 1040;
const CANVAS_H = 900;
/** Gap between packed circles (d3.pack padding, in the same user units). */
const PACK_PADDING = 12;
/**
 * Below this radius a circle cannot hold its label and the label moves outside.
 * Outside labels collide with neighbouring circles (pack leaves only PACK_PADDING
 * between them), so this sits as low as the geometry allows: at the label's y=20
 * baseline an r=30 circle still spans 2·√(30²−20²) ≈ 44px of chord, which clears
 * the longest tag token at 12px.
 */
const LABEL_INSIDE_MIN_R = 30;
/** Below this radius even the count would collide with the edge. */
const COUNT_INSIDE_MIN_R = 16;

/**
 * Overlap-summary panel metrics, in canvas user units. SVG text has no layout
 * box, so the panel is measured rather than shrink-wrapped: CHAR_W is the
 * approximate advance of the 11px sans face the panel renders in — deliberately
 * a slight over-estimate, since a panel a few units wide of the text is
 * unnoticeable whereas a clipped last character is not.
 */
const SUMMARY_CHAR_W = 6.3;
const SUMMARY_PAD = 9;
const SUMMARY_ROW_H = 16;
const SUMMARY_HEAD_H = 26;
/** Gap between the hovered circle's edge and the panel. */
const SUMMARY_GAP = 14;

/** Which arm of the projection a node came from — drives styling + wording. */
type RosterCircleKind = 'tag' | 'no-tag' | 'unmanaged';

/**
 * THE DEFAULT VISIBLE SET — every node, every time.
 *
 * Deliberately isolated as the single place this policy lives, so changing what
 * the view opens with (a curated subset, a "top N by size", a remembered choice)
 * is one edit here rather than a hunt through initialisation and reset. It is a
 * function rather than a literal Set because the node keys are DATA: tag nodes
 * exist only because some identity carries that tag, so the full set cannot be
 * written down ahead of the roster.
 *
 * Both entry points — first render and Reset — go through this; there is no
 * second expression of "all visible" anywhere below.
 */
export const DEFAULT_VISIBLE = (nodeKeys: readonly string[]): ReadonlySet<string> =>
  new Set(nodeKeys);

/**
 * One filterable group, BEFORE layout — the unit the filter list toggles, the
 * header counts add up, and the overlap derivation reads. Carries the projection's
 * `members` so both can work over the visible subset without re-deriving the
 * projection: multi-membership means the visible identity total is a UNION, never
 * a sum of counts, and the same refs answer "which identities are shared".
 */
interface RosterNodeDatum {
  key: string;
  kind: RosterCircleKind;
  /** Face label — the raw tag token, or the catch-all arm's name. */
  label: string;
  count: number;
  /** Native tooltip text, rendered verbatim. */
  title: string;
  /** Accessible description of the circle. */
  ariaLabel: string;
  /**
   * The identity refs behind this node, straight from the projection — each
   * carrying its FULL tag set (`RosterIdentityRef.attributes`).
   *
   * EMPTY for 'unmanaged': a host is an observed address with no Identity, so it
   * contributes to no identity total and can never be an overlap endpoint.
   *
   * The full refs (not just ids) are what make the overlap derivation TAG-AWARE:
   * "does this member also carry #laptops" is answered from the member itself,
   * with no second lookup and no join on name or display string.
   */
  members: readonly RosterIdentityRef[];
}

/**
 * One hover-time overlap: the hovered TAG circle shares `count` identities with
 * the circle at `targetKey`. Geometry is pre-trimmed to both circles' EDGES —
 * a centre-to-centre line would run under two opaque fills and read as passing
 * through them rather than between them.
 */
interface OverlapLine {
  targetKey: string;
  /** The other circle's tag token — the summary's "…with #laptops". */
  targetLabel: string;
  /** How many identities the two circles share. */
  count: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Midpoint of the trimmed segment — where the count badge sits. */
  mx: number;
  my: number;
}

/** One placed circle the template renders. Geometry lives ONLY here. */
interface RosterCircle extends RosterNodeDatum {
  cx: number;
  cy: number;
  r: number;
  labelInside: boolean;
  showCount: boolean;
}

/** A node in the (flat) pack input tree: the root carries `children`, each leaf
 *  carries a `datum`. Neither ever carries both. */
interface PackNode {
  children?: PackNode[];
  datum?: RosterNodeDatum;
}

@Component({
  selector: 'app-grouped-roster-view',
  standalone: true,
  templateUrl: './grouped-roster-view.component.html',
  styleUrl: './grouped-roster-view.component.css',
})
export class GroupedRosterViewComponent {
  private readonly data = inject(MockDataService);
  private readonly drawer = inject(DrawerService);

  /** Transient hover — pure rendering: dims the non-hovered circles via a CSS
   *  class, touches neither the projection nor the drawer. */
  readonly hoveredNodeId = signal<string | null>(null);

  /**
   * The projection. Reactive on `identities()` so tagging an identity anywhere in
   * the app (the discovery apply flow tags members via MockDataService) re-groups
   * this view. Flows are the static observed capture — the unmanaged arm only
   * moves if the roster changes, since enrollment is derived against it.
   */
  readonly roster = computed(() => buildGroupedRoster(this.data.identities(), DISCOVERED_FLOWS));

  /**
   * EVERY group, unfiltered — the filter list's rows and the denominator of
   * "showing N of M". A zero-count group would pack to a zero radius and vanish,
   * so empty groups are dropped rather than offered as un-hideable nothings.
   */
  readonly allNodes = computed<RosterNodeDatum[]>(() => {
    const r = this.roster();

    return [
      ...r.tagNodes.map((node) => ({
        key: `tag:${node.attribute}`,
        kind: 'tag' as const,
        label: node.attribute,
        count: node.memberCount,
        title: `${node.attribute} · ${node.memberCount} ${node.memberCount === 1 ? 'identity' : 'identities'}`,
        ariaLabel: `${node.attribute}, ${node.memberCount} identities carry this tag`,
        members: node.members,
      })),
      {
        key: 'catch-all:no-tag',
        kind: 'no-tag' as const,
        label: 'No role attribute',
        count: r.catchAll.noTag.memberCount,
        title: `No role attribute · ${r.catchAll.noTag.memberCount} managed identities carrying none`,
        ariaLabel: `No role attribute catch-all, ${r.catchAll.noTag.memberCount} managed identities carry none`,
        members: r.catchAll.noTag.members,
      },
      {
        key: 'catch-all:unmanaged',
        kind: 'unmanaged' as const,
        label: 'Unmanaged hosts',
        count: r.catchAll.unmanaged.memberCount,
        title: `Unmanaged hosts · ${r.catchAll.unmanaged.memberCount} observed sources with no identity`,
        ariaLabel: `Unmanaged hosts catch-all, ${r.catchAll.unmanaged.memberCount} observed sources resolve to no identity`,
        // hosts are NOT identities — no ref, no tag set, no overlap
        members: [] as readonly RosterIdentityRef[],
      },
    ].filter((n) => n.count > 0);
  });

  // ─── filter state ─────────────────────────────────────────────────────────

  /**
   * Which nodes are drawn. A `linkedSignal` rather than a plain one so the set
   * survives a roster change sensibly: a node the user hid STAYS hidden, and a
   * node that did not exist before (a tag created by the discovery apply flow)
   * arrives VISIBLE, matching the default policy. Without the previous-value
   * branch, tagging an identity elsewhere in the app would silently reset the
   * user's filter.
   */
  readonly visibleKeys = linkedSignal<RosterNodeDatum[], ReadonlySet<string>>({
    source: this.allNodes,
    computation: (nodes, previous) => {
      const keys = nodes.map((n) => n.key);
      if (!previous) return DEFAULT_VISIBLE(keys);
      const knownBefore = new Set(previous.source.map((n) => n.key));
      return new Set(keys.filter((k) => !knownBefore.has(k) || previous.value.has(k)));
    },
  });

  isVisible(key: string): boolean {
    return this.visibleKeys().has(key);
  }

  /** Show/hide one group. Clears the hover: the hovered node may be the one just
   *  hidden, which would otherwise leave every remaining circle dimmed against a
   *  node that is no longer on the canvas. */
  toggle(key: string): void {
    this.hoveredNodeId.set(null);
    this.visibleKeys.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Restore the default — the same single expression first render uses. Also
   *  clears the search, so Reset returns the CONTROL to its opening state too,
   *  not just the canvas. */
  reset(): void {
    this.hoveredNodeId.set(null);
    this.tagQuery.set('');
    this.visibleKeys.set(DEFAULT_VISIBLE(this.allNodes().map((n) => n.key)));
  }

  /** The drawn subset, in the projection's order. */
  readonly visibleNodes = computed(() =>
    this.allNodes().filter((n) => this.visibleKeys().has(n.key)),
  );

  readonly visibleCount = computed(() => this.visibleNodes().length);
  readonly totalCount = computed(() => this.allNodes().length);
  readonly allVisible = computed(() => this.visibleCount() === this.totalCount());
  readonly noneVisible = computed(() => this.visibleCount() === 0);

  /** The filter's two populations, kept apart because the catch-alls are NOT
   *  tags and are labelled separately wherever they appear. Tags go in the
   *  searchable dropdown; the catch-alls stay outside it as fixed toggles. */
  readonly tagNodes = computed(() => this.allNodes().filter((n) => n.kind === 'tag'));
  readonly catchAllNodes = computed(() => this.allNodes().filter((n) => n.kind !== 'tag'));

  // ─── tag dropdown (control surface only — the mechanism above is unchanged) ─

  /**
   * The dropdown wrapper — the outside-click boundary.
   *
   * Deliberately NOT the component host, which is the whole view: a click on the
   * canvas or the intro is OUTSIDE the menu and must close it, but it is inside
   * the host. ActionMenuComponent can use its host for this because its host IS
   * the menu; here the two are not the same element.
   */
  private readonly dropRef = viewChild<ElementRef<HTMLElement>>('dropRoot');

  readonly menuOpen = signal(false);
  /** Free-text narrowing of the TAG list only. Purely a way to find a row in a
   *  long list — it never hides a circle by itself, so a typed query with the
   *  popover closed changes nothing on the canvas. */
  readonly tagQuery = signal('');

  /** Trigger click: stopPropagation so the document:click self-close below does
   *  not immediately close what this click just opened (ActionMenuComponent's
   *  pattern, for the same reason). */
  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update((o) => !o);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen()) return;
    const drop = this.dropRef()?.nativeElement;
    if (drop && !drop.contains(event.target as Node)) this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menuOpen.set(false);
  }

  /** Tags matching the query, case-insensitive substring on the label. */
  readonly filteredTagNodes = computed(() => {
    const q = this.tagQuery().trim().toLowerCase();
    const tags = this.tagNodes();
    return q ? tags.filter((n) => n.label.toLowerCase().includes(q)) : tags;
  });

  readonly visibleTagCount = computed(
    () => this.tagNodes().filter((n) => this.visibleKeys().has(n.key)).length,
  );
  readonly allTagsVisible = computed(() => this.visibleTagCount() === this.tagNodes().length);
  readonly noTagsVisible = computed(() => this.visibleTagCount() === 0);

  /**
   * Show/hide EVERY tag at once. Scoped to tags on purpose: the catch-alls are
   * not in this list and are not swept by its bulk actions — a user clearing the
   * tags to study the two catch-alls would be ill served by having them vanish
   * too.
   *
   * "Clear all" is a USER ACTION, never a default: `DEFAULT_VISIBLE` still owns
   * what the view opens with and what Reset restores, and neither is affected by
   * this.
   */
  setAllTags(visible: boolean): void {
    this.hoveredNodeId.set(null);
    const tagKeys = this.tagNodes().map((n) => n.key);
    this.visibleKeys.update((prev) => {
      const next = new Set(prev);
      for (const k of tagKeys) {
        if (visible) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  // ─── header figures, recomputed over the VISIBLE set ──────────────────────

  /**
   * Distinct identities across the visible groups — a UNION, not a sum. An
   * identity carrying two visible tags is one identity; hiding one of those tags
   * does not remove it while the other is still shown. This is exactly why the
   * count cannot be derived by adding circle sizes.
   */
  readonly identityCount = computed(() => {
    const ids = new Set<string>();
    for (const n of this.visibleNodes()) for (const m of n.members) ids.add(m.id);
    return ids.size;
  });

  /** Filings across the visible TAG circles — the figure their sizes add up to. */
  readonly tagPlacements = computed(() =>
    this.visibleNodes().reduce((sum, n) => (n.kind === 'tag' ? sum + n.count : sum), 0),
  );

  /** Distinct identities under the visible TAG circles (excludes the no-tag arm) —
   *  the "N tagged identities make M placements" figure in the intro. */
  readonly taggedIdentityCount = computed(() => {
    const ids = new Set<string>();
    for (const n of this.visibleNodes()) {
      if (n.kind === 'tag') for (const m of n.members) ids.add(m.id);
    }
    return ids.size;
  });

  /**
   * Visible unmanaged HOSTS. Reported separately and never folded into
   * `identityCount`, because a host is not an identity — the whole point of the
   * second catch-all arm. Without this figure, hiding the unmanaged circle would
   * move nothing in the header and the 19 hosts on screen would go unaccounted
   * for; with it, every visible circle is represented by exactly one total.
   */
  readonly hostCount = computed(() =>
    this.visibleNodes().reduce((sum, n) => (n.kind === 'unmanaged' ? sum + n.count : sum), 0),
  );

  /** True while any tag circle is drawn — gates the placements figure, which is
   *  meaningless (and reads as a broken 0) with every tag hidden. */
  readonly hasTagNodes = computed(() => this.visibleNodes().some((n) => n.kind === 'tag'));

  readonly canvasW = CANVAS_W;
  readonly canvasH = CANVAS_H;

  /**
   * Pack the VISIBLE groups into collision-free circles. Re-runs whenever the
   * filter changes, so the survivors reflow to fill the canvas rather than
   * holding the hidden nodes' space.
   */
  readonly circles = computed<RosterCircle[]>(() => {
    const data = this.visibleNodes();
    if (data.length === 0) return [];

    // Flat hierarchy: one root, every group a leaf. `sum` gives each leaf its own
    // count (the root's value is their total, which the layout only uses to scale).
    const root = hierarchy<PackNode>(
      { children: data.map((datum) => ({ datum })) },
      (d) => d.children,
    ).sum((d) => d.datum?.count ?? 0);

    const packed = pack<PackNode>()
      .size([CANVAS_W, CANVAS_H])
      .padding(PACK_PADDING)(root);

    return (packed.children ?? []).flatMap((leaf) => {
      const datum = leaf.data.datum;
      if (!datum) return [];
      return [
        {
          ...datum,
          cx: leaf.x,
          cy: leaf.y,
          r: leaf.r,
          labelInside: leaf.r >= LABEL_INSIDE_MIN_R,
          showCount: leaf.r >= COUNT_INSIDE_MIN_R,
        },
      ];
    });
  });

  // ─── hover (emphasis only) ────────────────────────────────────────────────

  /** The hovered circle, if it is still on the canvas. */
  private readonly hoveredCircle = computed(() => {
    const key = this.hoveredNodeId();
    return key === null ? null : (this.circles().find((c) => c.key === key) ?? null);
  });

  /**
   * The hovered tag circle's overlaps with the other VISIBLE tag circles.
   *
   * Derived from `circles()`, which is post-filter by construction, so a shared
   * identity with a HIDDEN circle draws nothing — correct, since the user removed
   * that circle from the picture and a line to nowhere would be worse than no
   * line.
   *
   * The membership test is `member.attributes.includes(other.label)`: `label` on
   * a tag circle IS the raw attribute token, and every member carries its full
   * tag set, so this is an exact tag test on the identity itself. Identity is
   * established by the ref, never by `name`.
   *
   * Empty for a catch-all hover (the `kind !== 'tag'` guards on both ends), and
   * empty when nothing is hovered.
   */
  readonly overlaps = computed<OverlapLine[]>(() => {
    const hovered = this.hoveredCircle();
    if (!hovered || hovered.kind !== 'tag') return [];

    const lines: OverlapLine[] = [];
    for (const other of this.circles()) {
      // A catch-all can never be an overlap target: a no-tag member's attribute
      // set is empty and an unmanaged host has none at all, so the test below
      // would find nothing anyway — the guard makes that a stated rule rather
      // than an accident of the data.
      if (other.key === hovered.key || other.kind !== 'tag') continue;

      const shared = hovered.members.filter((m) => m.attributes.includes(other.label));
      if (shared.length === 0) continue;

      // Trim to both circles' EDGES along the centre line. Pack leaves
      // PACK_PADDING between circles, so the trimmed segment is always positive
      // here; the guard covers a degenerate layout rather than today's data.
      const dx = other.cx - hovered.cx;
      const dy = other.cy - hovered.cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= hovered.r + other.r) continue;

      const ux = dx / dist;
      const uy = dy / dist;
      const x1 = hovered.cx + ux * hovered.r;
      const y1 = hovered.cy + uy * hovered.r;
      const x2 = other.cx - ux * other.r;
      const y2 = other.cy - uy * other.r;

      lines.push({
        targetKey: other.key,
        targetLabel: other.label,
        count: shared.length,
        x1,
        y1,
        x2,
        y2,
        mx: (x1 + x2) / 2,
        my: (y1 + y2) / 2,
      });
    }

    // Biggest overlap first — the summary reads as a ranking, and the order is
    // stable across re-renders because the tie-break is the tag token.
    return lines.sort((a, b) => b.count - a.count || (a.targetLabel < b.targetLabel ? -1 : 1));
  });

  /**
   * Which circles stay at full weight: the hovered one and everything it shares
   * with. `null` means nothing is hovered, so nothing dims.
   */
  private readonly litKeys = computed<ReadonlySet<string> | null>(() => {
    const hovered = this.hoveredNodeId();
    if (hovered === null) return null;
    const keys = new Set<string>([hovered]);
    for (const line of this.overlaps()) keys.add(line.targetKey);
    return keys;
  });

  /** Dim a circle that is neither hovered nor an overlap of the hovered one. */
  isDimmed(c: RosterCircle): boolean {
    const lit = this.litKeys();
    return lit !== null && !lit.has(c.key);
  }

  /**
   * The stable overlap readout, anchored beside the hovered circle.
   *
   * It exists because the lines alone are not readable: counts sit on thin
   * segments at arbitrary angles, and reading them means tracing each one. The
   * summary states the same facts as a list, in a fixed place, so the shape is
   * the lines' job and the numbers are the panel's.
   *
   * Only for a TAG hover — a catch-all has no overlaps to report, and a panel
   * saying so would assert a relationship the arm cannot have.
   */
  readonly summary = computed(() => {
    const hovered = this.hoveredCircle();
    if (!hovered || hovered.kind !== 'tag') return null;

    const rows = this.overlaps().map((l) => ({
      key: l.targetKey,
      text: `${l.count} shared with ${l.targetLabel}`,
    }));

    // Width from the longest row: SVG text has no intrinsic box, so the backing
    // panel has to be sized from the content rather than shrink-wrapping it.
    const longest = Math.max(
      hovered.label.length + 2,
      ...rows.map((r) => r.text.length),
      'No shared identities'.length,
    );
    const w = Math.round(longest * SUMMARY_CHAR_W + SUMMARY_PAD * 2);
    const h = Math.round(SUMMARY_HEAD_H + Math.max(rows.length, 1) * SUMMARY_ROW_H + SUMMARY_PAD);

    // PLACEMENT — four candidate sides, scored by how much of the picture each
    // would cover. A panel that lands on a circle is not a minor blemish here:
    // the circles it covers are exactly the ones it is naming, so a right-side
    // default that happens to sit on #laptops hides the evidence for its own
    // "4 shared with #laptops" row. Preference order breaks ties, so placement
    // stays stable (and right-of-circle) whenever nothing is in the way.
    const clamp = (p: { x: number; y: number }) => ({
      x: Math.max(4, Math.min(p.x, CANVAS_W - w - 4)),
      y: Math.max(4, Math.min(p.y, CANVAS_H - h - 4)),
    });
    // Four sides, then the four diagonals. The sides alone were enough at nine
    // circles; on a packed map of twenty every side of a central circle has a
    // neighbour against it, and the diagonals are where the clear space actually
    // is. Order is the preference order, so a clear right-hand side still wins.
    const right = hovered.cx + hovered.r + SUMMARY_GAP;
    const left = hovered.cx - hovered.r - SUMMARY_GAP - w;
    const below = hovered.cy + hovered.r + SUMMARY_GAP;
    const above = hovered.cy - hovered.r - SUMMARY_GAP - h;
    const candidates = [
      { x: right, y: hovered.cy - h / 2 },
      { x: left, y: hovered.cy - h / 2 },
      { x: hovered.cx - w / 2, y: below },
      { x: hovered.cx - w / 2, y: above },
      { x: right, y: below },
      { x: left, y: below },
      { x: right, y: above },
      { x: left, y: above },
    ].map(clamp);

    // Overlap against each circle's BOUNDING BOX — an over-estimate of the true
    // circle/rect intersection, which is the right way to be wrong here: it
    // pushes the panel a little further clear than strictly necessary rather
    // than tucking it against a rim.
    const cover = (p: { x: number; y: number }) =>
      this.circles().reduce((sum, c) => {
        const ox = Math.max(0, Math.min(p.x + w, c.cx + c.r) - Math.max(p.x, c.cx - c.r));
        const oy = Math.max(0, Math.min(p.y + h, c.cy + c.r) - Math.max(p.y, c.cy - c.r));
        return sum + ox * oy;
      }, 0);

    const best = candidates.reduce((a, b) => (cover(b) < cover(a) ? b : a));

    return { title: hovered.label, rows, x: best.x, y: best.y, w, h };
  });

  /** Background click: clear the hover, mirroring the Sankey's `onBackground`. */
  onBackground(): void {
    this.hoveredNodeId.set(null);
  }

  // ─── click → group drawer ─────────────────────────────────────────────────

  /**
   * Open the clicked group's members in the app drawer. All three kinds open the
   * SAME drawer type: what differs is which row shape it carries — identity rows
   * (with their full tag sets) for a tag / no-tag group, host rows for unmanaged.
   * The projection is already exactly what the drawer renders, so nothing is
   * re-derived, capped, or re-sorted here — and nothing is filtered either: the
   * filter hides whole circles, never members within one.
   */
  openGroup(c: RosterCircle): void {
    const r = this.roster();

    if (c.kind === 'unmanaged') {
      this.drawer.open({
        type: 'roster-group',
        data: {
          title: c.label,
          subtitle: `Unmanaged hosts · ${c.count} observed ${c.count === 1 ? 'source' : 'sources'}`,
          kind: 'unmanaged',
          count: c.count,
          identities: [],
          hosts: r.catchAll.unmanaged.members,
        },
      });
      return;
    }

    if (c.kind === 'no-tag') {
      this.drawer.open({
        type: 'roster-group',
        data: {
          title: c.label,
          subtitle: `Catch-all · ${c.count} managed ${c.count === 1 ? 'identity' : 'identities'} with no tag`,
          kind: 'no-tag',
          count: c.count,
          identities: r.catchAll.noTag.members,
          hosts: [],
        },
      });
      return;
    }

    const node = r.tagNodes.find((n) => n.attribute === c.label);
    if (!node) return;
    this.drawer.open({
      type: 'roster-group',
      data: {
        title: node.attribute,
        subtitle: `Role attribute · ${node.memberCount} ${node.memberCount === 1 ? 'identity' : 'identities'}`,
        kind: 'tag',
        count: node.memberCount,
        identities: node.members,
        hosts: [],
      },
    });
  }
}
