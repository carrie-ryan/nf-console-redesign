import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import {
  resolveDialAuthorizationGraph,
  UNGROUPED_SEGMENT,
  type SegmentEdge,
  type SegmentNode,
  type SegmentState,
  type ZeroEdgeReason,
} from './authorization-resolver';
import {
  FIXTURE_IDENTITIES,
  FIXTURE_SERVICES,
  FIXTURE_POLICIES,
  FIXTURE_IDENTITY_SEGMENT_ATTR,
  FIXTURE_SERVICE_SEGMENT_ATTR,
} from './authorization.fixtures';
import {
  FIXTURE_IDENTITIES_OT,
  FIXTURE_SERVICES_OT,
  FIXTURE_POLICIES_OT,
  FIXTURE_GROUPING_OT,
  type SegmentPlacement,
} from './authorization.fixtures.ot';
import {
  DrawerService,
  type PolicyProvenanceEntry,
  type ProvenanceIdentityMember,
  type ProvenanceServiceMember,
  type ProvenanceExclusionReason,
  type SegmentReachEntry,
  type ServiceReachedByEntry,
} from '../../shared/services/drawer.service';
import {
  explainCell,
  type CellIdentityExplanation,
  type CellServiceExplanation,
  type ExclusionReason,
} from './cell-explanation';
import { buildSankeyFlows, type SankeyFlow } from './sankey-flow';
import {
  SankeyChartComponent,
  type SankeyChartNode,
  type SankeyChartLink,
  type SankeyNodeClickEvent,
  type SankeyLinkClickEvent,
} from '../../shared/components/sankey-chart/sankey-chart.component';

/** Max members rendered per drawer section; excess collapses to "showing N of M". */
const MEMBER_LIST_CAP = 15;

/**
 * Node presentation kind — derived from SegmentNode flags, NOT re-computed.
 * Priority: a zero-edge REASON (the urgent signal) wins over the catch-all flag.
 *   • 'isolated'     — sealed "no access" (intentional posture)
 *   • 'unresolvable' — warning "untagged — check config" (a tagging gap)
 *   • 'ungrouped'    — muted catch-all bag of leftovers
 *   • 'normal'       — a cohesive segment with edges
 */
type NodeKind = 'normal' | 'ungrouped' | 'isolated' | 'unresolvable';

/** A laid-out graph node (a segment box) with its SVG geometry + anchor point. */
interface GraphNode {
  segment: string;
  label: string;
  side: 'identity' | 'service';
  count: number;
  /** Pre-pluralized member line, e.g. "1 service" / "3 identities". */
  countText: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Edge attach point (mid of the inner face). */
  anchorX: number;
  anchorY: number;
}

/** A drawn edge — only 'full' / 'partial' reach here ('none' is never drawn). */
interface GraphEdge {
  key: string;
  /** Raw segment ids (identity-side, service-side) for the provenance lookup. */
  fromSegment: string;
  toSegment: string;
  fromLabel: string;
  toLabel: string;
  state: Exclude<SegmentState, 'none'>;
  /** "2/3" for partial, null for full. */
  countLabel: string | null;
  path: string;
  midX: number;
  midY: number;
}

/** One matrix cell — EVERY (row,col) present, including 'none'. */
interface MatrixCell {
  /** Raw segment ids so a click (incl. 'none' cells) can roll up provenance. */
  fromSegment: string;
  toSegment: string;
  /** Selection key, identical to the graph edge's — lets selection persist across the toggle. */
  key: string;
  /** Short service-segment label (for the accessible name). */
  toLabel: string;
  state: SegmentState;
  authorizedCount: number;
  totalCount: number;
  /** Colorblind-safe glyph, paired with color + count so state never relies on hue. */
  glyph: string;
  countLabel: string;
  isCatchAll: boolean;
}

interface MatrixRow {
  label: string;
  isUngrouped: boolean;
  kind: NodeKind;
  cells: MatrixCell[];
}

// ─── Sankey (surface C) ─────────────────────────────────────────────────────
// The d3 layout, SVG render, and hover-isolate now live in the generic
// SankeyChartComponent (src/lib/shared/components/sankey-chart). This component
// only ADAPTS resolver output into that chart's generic node/link shape and
// reacts to its click events — all authorization semantics stay here.

/** Parse a service's protocol + port for the middle-node tooltip. App-protocol
 *  (PROFINET/OPC-UA/S7) lives only as the interceptAddress hostname prefix and
 *  only for a subset; everything else falls back to the transport protocol.
 *  Port is the `:NNNN` suffix (uniform across services). */
function parseServiceEndpoint(protocol: string, interceptAddress: string): { proto: string; port: string } {
  const colon = interceptAddress.lastIndexOf(':');
  const port = colon >= 0 ? interceptAddress.slice(colon + 1) : '?';
  const host = colon >= 0 ? interceptAddress.slice(0, colon) : interceptAddress;
  const prefix = host.split('.')[0]?.toLowerCase();
  const appProto: Record<string, string> = { profinet: 'PROFINET', opcua: 'OPC-UA', s7: 'S7' };
  const proto = appProto[prefix ?? ''] ?? protocol.toUpperCase();
  return { proto, port };
}
/** The middle-node tooltip string. Shares `parseServiceEndpoint` with the
 *  service-provenance drawer so tooltip and drawer can never disagree. */
function serviceEndpointLabel(name: string, protocol: string, interceptAddress: string): string {
  const { proto, port } = parseServiceEndpoint(protocol, interceptAddress);
  return `${name} · ${proto} · port ${port}`;
}

// ─── layout constants (compact node) ───────────────────────────────────────────
const NODE_W = 120;
const NODE_H = 28;
const V_GAP = 26;
const COL_GAP = 520; // bipartite: horizontal space between the two columns (spread edges across the width)
const PAD_X = 8;
const PAD_Y = 8;
// layered-only spacing. Nodes stay compact; the HORIZONTAL gaps are deliberately
// generous so the graph fills the card width and edges get room to be traced —
// plant lanes sit well apart, and the aside zone is pushed far right so its long
// cross-graph edges have a long horizontal run instead of bunching. Vertical gaps
// stay tight (the graph must still fit the viewport height without scrolling).
const LANE_GAP = 190; // horizontal gap between lane columns within a band
const ROW_GAP = 44; // vertical gap between the identity row-group and service row-group inside one band
const BAND_GAP = 68; // vertical gap between bands
const ASIDE_GAP = 470; // horizontal gap between the band grid and the aside zone

/** Strip the discovery prefixes for a short, human label. */
function shortLabel(segment: string): string {
  if (segment === UNGROUPED_SEGMENT) return 'ungrouped';
  return segment
    .replace(FIXTURE_IDENTITY_SEGMENT_ATTR, '')
    .replace(FIXTURE_SERVICE_SEGMENT_ATTR, '')
    .replace(/^#/, '');
}

function nodeKind(node: SegmentNode): NodeKind {
  if (node.zeroEdgeReason === 'isolated') return 'isolated';
  if (node.zeroEdgeReason === 'unresolvable') return 'unresolvable';
  if (node.isUngrouped) return 'ungrouped';
  return 'normal';
}

/**
 * STATIC microsegmentation segment view — render-only, no interaction.
 *
 * Two coordinated surfaces off the SAME resolver output
 * (resolveDialAuthorizationGraph over the labeled post-discovery fixtures):
 *   A. a bipartite node-link graph (identity segments → service segments) that
 *      draws ONLY 'full'/'partial' edges and encodes the three node states;
 *   B. a companion matrix showing EVERY cell (including all 'none') — the audit
 *      surface where isolation is proven, nothing omitted.
 *
 * No authorization is re-derived here: the component only reads pairs /
 * segmentEdges / segmentNodes and shapes them for display. Colorblind-safe —
 * every edge/cell/node state pairs color with dash, glyph, or label.
 */
@Component({
  selector: 'app-segment-view',
  standalone: true,
  imports: [SankeyChartComponent],
  templateUrl: './segment-view.component.html',
  styleUrl: './segment-view.component.css',
})
export class SegmentViewComponent {
  /**
   * Fixture selection is REACTIVE, bound to the `fixture` query param through
   * withComponentInputBinding() (app.config.ts). DEFAULT (param absent, or any
   * value other than 'ot') is the small post-discovery fixture; `?fixture=ot`
   * loads the large Purdue/OT stress fixture. Both share the SAME segment
   * prefixes, so nothing downstream changes.
   *
   * Reading the param at RENDER time (not module load) is the fix: the onboarding
   * guard (canMatch: [requireOnboarded]) redirects every hard load of /segments to
   * /onboarding, and isOnboarded is a non-persisted in-memory signal — so the app
   * always bootstraps at a param-less URL. A module-level const read at bootstrap
   * therefore froze to the default forever; a computed off the input does not.
   */
  readonly fixture = input<string | undefined>(undefined);

  /**
   * User-facing fixture selection, driven by the in-UI toggle (below). Seeded from
   * the `fixture` input so a reachable deep-link / CDP `?fixture=ot` still preselects
   * OT, but writable — the URL-param path is unreachable via normal navigation
   * (the onboarding guard redirects hard loads of /segments and drops the query
   * string), so the toggle is the real control. linkedSignal re-seeds if the input
   * ever changes, yet a user click wins until then.
   */
  protected readonly fixtureSel = linkedSignal<'small' | 'ot'>(() =>
    this.fixture() === 'ot' ? 'ot' : 'small',
  );
  private readonly useOt = computed(() => this.fixtureSel() === 'ot');

  private readonly activeIdentities = computed(() =>
    this.useOt() ? FIXTURE_IDENTITIES_OT : FIXTURE_IDENTITIES,
  );
  private readonly activeServices = computed(() =>
    this.useOt() ? FIXTURE_SERVICES_OT : FIXTURE_SERVICES,
  );
  private readonly activePolicies = computed(() =>
    this.useOt() ? FIXTURE_POLICIES_OT : FIXTURE_POLICIES,
  );
  /**
   * Optional per-fixture graph-layout hint (option b): OT supplies a segment→band/lane
   * map → layered layout; the small fixture supplies none → bipartite fallback. Purely
   * presentational; the resolver never sees it.
   */
  private readonly activeGrouping = computed<Record<string, SegmentPlacement> | undefined>(() =>
    this.useOt() ? FIXTURE_GROUPING_OT : undefined,
  );

  // ─ resolver output (ground truth) — recomputed reactively when the active
  //   fixture changes. Identical call, args, and grouping prefixes as before;
  //   ONLY the evaluation timing moved from a field initializer to a computed. ─
  private readonly graph = computed(() =>
    resolveDialAuthorizationGraph(
      this.activeIdentities(),
      this.activeServices(),
      this.activePolicies(),
      FIXTURE_IDENTITY_SEGMENT_ATTR,
      FIXTURE_SERVICE_SEGMENT_ATTR,
    ),
  );

  readonly pairCount = computed(() => this.graph().pairs.length);

  private readonly drawer = inject(DrawerService);

  // ─ the ONLY interactive state: which surface is shown (graph is default) ─
  readonly activeSurface = signal<'graph' | 'matrix' | 'sankey'>('graph');

  // ─ active EDGE selection — key is "fromSegment→toSegment", identical for the
  //   edge and the matrix cell, so it persists across the toggle and anchors both.
  //   READ BY THE MATRIX. Node interaction must NOT touch this. ─
  readonly selectedKey = signal<string | null>(null);

  // ─ GRAPH-ONLY node interaction state (never read by the matrix) ─
  // Transient hover, driving hover-isolate (pure rendering — dims non-incident
  // edges via a CSS class; touches neither resolver nor drawer nor graph model).
  readonly hoveredNode = signal<{ side: 'identity' | 'service'; segment: string } | null>(null);
  // Persistent node selection — DELIBERATELY separate from selectedKey (an edge
  // key). Overloading selectedKey would cross-wire the matrix, which reads it.
  readonly selectedSegment = signal<{ side: 'identity' | 'service'; segment: string } | null>(null);

  /** id → entity over the ACTIVE sets — the view-only join that turns the
   *  resolver's memberIds into display names for the segment (node) drawer. */
  private readonly identityById = computed(
    () => new Map(this.activeIdentities().map((i) => [i.id, i])),
  );
  private readonly serviceById = computed(
    () => new Map(this.activeServices().map((s) => [s.id, s])),
  );

  /** id → Policy over the ACTIVE policy set (the id space authorizedBy references —
   *  NOT MockDataService.policies, which would silently miss). */
  private readonly policyById = computed(
    () => new Map(this.activePolicies().map((p) => [p.id, p])),
  );

  /**
   * The full derived view model — graph nodes/edges, matrix, tallies, conservation,
   * and the provenance lookup tables — all computed together off ONE resolver
   * result so the shared layout intermediates aren't duplicated. Pure aggregation
   * over resolver output; the body is the previous constructor, verbatim, wrapped
   * in a computed so it re-runs when the active fixture changes.
   */
  private readonly view = computed(() => {
    const { segmentEdges, segmentNodes, pairs } = this.graph();

    const idNodes = segmentNodes.filter((n) => n.side === 'identity');
    const svcNodes = segmentNodes.filter((n) => n.side === 'service');

    // — provenance lookup tables (view aggregation over resolver output) —
    const idMembersBySeg = new Map<string, string[]>();
    const svcMembersBySeg = new Map<string, string[]>();
    const edgeByKey = new Map<string, SegmentEdge>();
    for (const n of idNodes) idMembersBySeg.set(n.segment, n.memberIds);
    for (const n of svcNodes) svcMembersBySeg.set(n.segment, n.memberIds);
    for (const e of segmentEdges) edgeByKey.set(`${e.fromSegment}→${e.toSegment}`, e);

    // ── LAYOUT ────────────────────────────────────────────────────────────────
    // Two interchangeable layouts emitting the SAME { graphNodes, graphEdges,
    // svgWidth, svgHeight } shape (identical GraphNode/GraphEdge fields), so the
    // template is layout-agnostic. A caller-supplied grouping map selects the
    // layered layout; its absence falls back to the bipartite two-column layout.

    // Node body without geometry — geometry (x/y/anchors) is added per layout.
    const baseNode = (n: SegmentNode, side: 'identity' | 'service') => {
      const singular = side === 'identity' ? 'identity' : 'service';
      const plural = side === 'identity' ? 'identities' : 'services';
      return {
        segment: n.segment,
        label: shortLabel(n.segment),
        side,
        count: n.memberCount,
        countText: `${n.memberCount} ${n.memberCount === 1 ? singular : plural}`,
        kind: nodeKind(n),
        w: NODE_W,
        h: NODE_H,
      };
    };

    // Shared edge builder: draw ONLY 'full' / 'partial' (skip 'none'); a per-layout
    // `geom` supplies the endpoints + path so orientation lives in one place.
    const buildEdges = (
      idBySeg: Map<string, GraphNode>,
      svcBySeg: Map<string, GraphNode>,
      geom: (
        from: GraphNode,
        to: GraphNode,
      ) => { x1: number; y1: number; x2: number; y2: number; path: string },
    ): GraphEdge[] =>
      segmentEdges
        .filter((e): e is SegmentEdge & { state: 'full' | 'partial' } => e.state !== 'none')
        .map((e) => {
          const from = idBySeg.get(e.fromSegment)!;
          const to = svcBySeg.get(e.toSegment)!;
          const { x1, y1, x2, y2, path } = geom(from, to);
          return {
            key: `${e.fromSegment}→${e.toSegment}`,
            fromSegment: e.fromSegment,
            toSegment: e.toSegment,
            fromLabel: from.label,
            toLabel: to.label,
            state: e.state,
            countLabel: e.state === 'partial' ? `${e.authorizedCount}/${e.totalCount}` : null,
            path,
            midX: (x1 + x2) / 2,
            midY: (y1 + y2) / 2,
          };
        });

    // Horizontal S-curve between the two columns (bipartite): tangents offset in X.
    const horizGeom = (from: GraphNode, to: GraphNode) => {
      const x1 = from.anchorX;
      const y1 = from.anchorY;
      const x2 = to.anchorX;
      const y2 = to.anchorY;
      const dx = (x2 - x1) * 0.5;
      return { x1, y1, x2, y2, path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}` };
    };

    // Vertical S-curve (layered): attach on nearest horizontal face by center-Y,
    // tangents offset in Y. Works for any relative position (down, up, same band).
    const vertGeom = (from: GraphNode, to: GraphNode) => {
      const x1 = from.x + from.w / 2;
      const x2 = to.x + to.w / 2;
      const down = to.y + to.h / 2 >= from.y + from.h / 2;
      const y1 = down ? from.y + from.h : from.y;
      const y2 = down ? to.y : to.y + to.h;
      const dy = (y2 - y1) * 0.5;
      return { x1, y1, x2, y2, path: `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}` };
    };

    // — bipartite fallback (unchanged math; only the svg-size basis feeds Part 3 CSS) —
    const layoutBipartite = () => {
      const idBlockH = idNodes.length * NODE_H + (idNodes.length - 1) * V_GAP;
      const svcBlockH = svcNodes.length * NODE_H + (svcNodes.length - 1) * V_GAP;
      const contentH = Math.max(idBlockH, svcBlockH);
      const leftX = PAD_X;
      const rightX = PAD_X + NODE_W + COL_GAP;
      const place = (nodes: SegmentNode[], side: 'identity' | 'service', x: number, blockH: number): GraphNode[] => {
        const yStart = PAD_Y + (contentH - blockH) / 2;
        return nodes.map((n, i) => {
          const y = yStart + i * (NODE_H + V_GAP);
          return {
            ...baseNode(n, side),
            x,
            y,
            // identity nodes attach on their RIGHT face, service nodes on their LEFT.
            anchorX: side === 'identity' ? x + NODE_W : x,
            anchorY: y + NODE_H / 2,
          };
        });
      };
      const laidId = place(idNodes, 'identity', leftX, idBlockH);
      const laidSvc = place(svcNodes, 'service', rightX, svcBlockH);
      const idBySeg = new Map(laidId.map((n) => [n.segment, n]));
      const svcBySeg = new Map(laidSvc.map((n) => [n.segment, n]));
      return {
        graphNodes: [...laidId, ...laidSvc],
        graphEdges: buildEdges(idBySeg, svcBySeg, horizGeom),
        svgWidth: rightX + NODE_W + PAD_X,
        svgHeight: contentH + PAD_Y * 2,
      };
    };

    // — layered layout: bands stack top→bottom; lanes spread left→right; identities
    //   sit in the upper row-group of a band, services in the lower row-group, both
    //   on the SAME lane→x grid so a shared lane reads as one vertical column.
    //   Segments sharing a (band, side, lane) stack vertically. 'aside' segments go
    //   to a separate far-right column. —
    const layoutLayered = (grouping: Record<string, SegmentPlacement>) => {
      const laneX = (lane: number) => PAD_X + lane * (NODE_W + LANE_GAP);
      interface Tagged {
        node: SegmentNode;
        side: 'identity' | 'service';
        lane: number;
      }
      const banded = new Map<number, Tagged[]>();
      const aside: Tagged[] = [];
      const partition = (nodes: SegmentNode[], side: 'identity' | 'service') => {
        for (const n of nodes) {
          const p = grouping[n.segment];
          if (!p || p.band === 'aside') {
            aside.push({ node: n, side, lane: p ? p.lane : aside.length });
          } else {
            const arr = banded.get(p.band) ?? [];
            arr.push({ node: n, side, lane: p.lane });
            banded.set(p.band, arr);
          }
        }
      };
      partition(idNodes, 'identity');
      partition(svcNodes, 'service');

      const laid: GraphNode[] = [];
      let maxRight = 0;
      let maxBottom = 0;

      // place one side's rows for a band, stacking same-lane nodes; return the row height
      const placeRow = (rows: Tagged[], rowTop: number): number => {
        const byLane = new Map<number, Tagged[]>();
        for (const t of rows) {
          const arr = byLane.get(t.lane) ?? [];
          arr.push(t);
          byLane.set(t.lane, arr);
        }
        let subH = 0;
        for (const [lane, stack] of byLane) {
          stack.sort((p, q) => p.node.segment.localeCompare(q.node.segment));
          const x = laneX(lane);
          stack.forEach((t, i) => {
            const y = rowTop + i * (NODE_H + V_GAP);
            laid.push({ ...baseNode(t.node, t.side), x, y, anchorX: x + NODE_W / 2, anchorY: y + NODE_H / 2 });
            maxRight = Math.max(maxRight, x + NODE_W);
            maxBottom = Math.max(maxBottom, y + NODE_H);
          });
          subH = Math.max(subH, stack.length * NODE_H + (stack.length - 1) * V_GAP);
        }
        return subH;
      };

      let cursorY = PAD_Y;
      for (const band of [...banded.keys()].sort((a, b) => a - b)) {
        const tagged = banded.get(band)!;
        const ids = tagged.filter((t) => t.side === 'identity');
        const svcs = tagged.filter((t) => t.side === 'service');
        const idSubH = placeRow(ids, cursorY);
        const gap = idSubH > 0 && svcs.length > 0 ? ROW_GAP : 0;
        const svcSubH = placeRow(svcs, cursorY + idSubH + gap);
        cursorY += idSubH + gap + svcSubH + BAND_GAP;
      }

      // aside zone: single far-right column, stacked in (lane, identity-first) order
      const asideX = maxRight + ASIDE_GAP;
      aside.sort((p, q) => p.lane - q.lane || (p.side === q.side ? 0 : p.side === 'identity' ? -1 : 1));
      aside.forEach((t, i) => {
        const y = PAD_Y + i * (NODE_H + V_GAP);
        laid.push({ ...baseNode(t.node, t.side), x: asideX, y, anchorX: asideX + NODE_W / 2, anchorY: y + NODE_H / 2 });
        maxRight = Math.max(maxRight, asideX + NODE_W);
        maxBottom = Math.max(maxBottom, y + NODE_H);
      });

      const idBySeg = new Map(laid.filter((n) => n.side === 'identity').map((n) => [n.segment, n]));
      const svcBySeg = new Map(laid.filter((n) => n.side === 'service').map((n) => [n.segment, n]));
      return {
        graphNodes: laid,
        graphEdges: buildEdges(idBySeg, svcBySeg, vertGeom),
        svgWidth: maxRight + PAD_X,
        svgHeight: maxBottom + PAD_Y,
      };
    };

    const grouping = this.activeGrouping();
    const { graphNodes, graphEdges, svgWidth, svgHeight } = grouping
      ? layoutLayered(grouping)
      : layoutBipartite();

    // — edge tallies: one computed count, reused in header + graph blurb —
    const drawnEdgeCount = graphEdges.length;
    const noneEdgeCount = segmentEdges.length - drawnEdgeCount;

    // — matrix: every cell present, 'none' included (the audit surface) —
    const glyphFor = (state: SegmentState): string =>
      state === 'full' ? '█' : state === 'partial' ? '◪' : '·';

    const matrixColLabels = svcNodes.map((n) => ({
      label: shortLabel(n.segment),
      isUngrouped: n.isUngrouped,
    }));

    const matrixRows: MatrixRow[] = idNodes.map((rowNode) => {
      const cells: MatrixCell[] = svcNodes.map((colNode) => {
        const e = segmentEdges.find(
          (x) => x.fromSegment === rowNode.segment && x.toSegment === colNode.segment,
        )!;
        return {
          fromSegment: rowNode.segment,
          toSegment: colNode.segment,
          key: `${rowNode.segment}→${colNode.segment}`,
          toLabel: shortLabel(colNode.segment),
          state: e.state,
          authorizedCount: e.authorizedCount,
          totalCount: e.totalCount,
          glyph: glyphFor(e.state),
          countLabel: `${e.authorizedCount}/${e.totalCount}`,
          isCatchAll: rowNode.isUngrouped || colNode.isUngrouped,
        };
      });
      return {
        label: shortLabel(rowNode.segment),
        isUngrouped: rowNode.isUngrouped,
        kind: nodeKind(rowNode),
        cells,
      };
    });

    // — conservation, straight off the resolver output (not re-derived) —
    const rolledUpCount = segmentEdges.reduce((n, e) => n + e.authorizedCount, 0);
    const conservationHolds = rolledUpCount === pairs.length;

    return {
      graphNodes,
      graphEdges,
      svgWidth,
      svgHeight,
      matrixColLabels,
      matrixRows,
      drawnEdgeCount,
      noneEdgeCount,
      rolledUpCount,
      conservationHolds,
      idMembersBySeg,
      svcMembersBySeg,
      edgeByKey,
    };
  });

  /**
   * Authorized-policy Sankey feed (data only — no chart yet). Reuses the SAME
   * grouping the graph/matrix use: identity/service segment membership is the
   * inverse of the view's idMembersBySeg / svcMembersBySeg, and `state` comes
   * from the same edgeByKey roll-up — so this surface can never diverge. Reacts
   * to the Small/OT toggle for free (reads the reactive graph()/view()).
   */
  readonly sankeyFlows = computed<SankeyFlow[]>(() => this.sankeyResult().flows);

  /** Full adapter result incl. the conservation counters (flows + droppedNone + unresolved). */
  readonly sankeyResult = computed(() => {
    const { pairs } = this.graph();
    const v = this.view();
    // invert the shared member maps: memberId → its segment (same grouping as graph/matrix)
    const identitySegmentById = new Map<string, string>();
    for (const [seg, ids] of v.idMembersBySeg) for (const id of ids) identitySegmentById.set(id, seg);
    const serviceSegmentById = new Map<string, string>();
    for (const [seg, ids] of v.svcMembersBySeg) for (const id of ids) serviceSegmentById.set(id, seg);
    return buildSankeyFlows(pairs, identitySegmentById, serviceSegmentById, v.edgeByKey, shortLabel);
  });

  /** serviceId → its service segment (inverse of svcMembersBySeg) — the map the
   *  ribbon-click handler needs to recover a src→svc link's destination segment
   *  (the generic chart event carries node ids only, not auth segments). */
  private readonly serviceSegmentById = computed(() => {
    const v = this.view();
    const m = new Map<string, string>();
    for (const [seg, ids] of v.svcMembersBySeg) for (const id of ids) m.set(id, seg);
    return m;
  });

  /**
   * Adapt sankeyFlows() into the GENERIC SankeyChartComponent shape — surface C.
   * Each flow (src segment → service → dst segment) becomes THREE stage nodes and
   * TWO links (src→svc, svc→dst), both carrying the flow's weight; links sharing a
   * (source,target) are aggregated (weight summed, state → 'partial' if ANY
   * constituent is partial). Node CONSTRUCTION ORDER is preserved exactly so the
   * chart's d3 layout is identical to the prior inline one.
   *
   * All authorization semantics stay here (tooltip via serviceEndpointLabel,
   * catch-all → kind, aria text, full/partial → state); the chart just draws it.
   */
  readonly sankeyChart = computed<{ nodes: SankeyChartNode[]; links: SankeyChartLink[]; headers: string[] }>(() => {
    const flows = this.sankeyFlows();
    if (flows.length === 0) return { nodes: [], links: [], headers: [] };

    const svcById = this.serviceById();
    const nodeMap = new Map<string, SankeyChartNode>();
    const linkMap = new Map<string, SankeyChartLink & { partial: boolean }>();

    const ensureNode = (id: string, stageIndex: 0 | 1 | 2, segment: string, label: string) => {
      if (nodeMap.has(id)) return;
      let title = label;
      let kind: string | undefined;
      let ariaLabel: string;
      if (stageIndex === 1) {
        const s = svcById.get(segment);
        title = s ? serviceEndpointLabel(s.name, s.protocol, s.interceptAddress) : label;
        ariaLabel = `${label} service — show endpoint facts and who reaches it`;
      } else {
        const isCatchAll = segment === UNGROUPED_SEGMENT;
        if (isCatchAll) kind = 'catch-all';
        title = label + (isCatchAll ? ' · ungrouped catch-all' : '');
        ariaLabel = `${label} segment — show members and reach`;
      }
      nodeMap.set(id, { id, stageIndex, label, title, kind, ariaLabel });
    };

    const addLink = (source: string, target: string, weight: number, state: 'full' | 'partial', ariaLabel: string) => {
      const key = `${source} ${target}`;
      const cur = linkMap.get(key);
      if (cur) {
        cur.weight += weight;
        if (state === 'partial') cur.partial = true;
      } else {
        linkMap.set(key, { id: key, sourceNodeId: source, targetNodeId: target, weight, partial: state === 'partial', ariaLabel });
      }
    };

    for (const f of flows) {
      const srcId = `src:${f.source}`;
      const svcId = `svc:${f.service}`;
      const dstId = `dst:${f.destination}`;
      ensureNode(srcId, 0, f.source, f.sourceLabel);
      ensureNode(svcId, 1, f.service, f.serviceLabel);
      ensureNode(dstId, 2, f.destination, f.destinationLabel);
      // src→svc: consumer recovers (fromSegment, service's dst segment) on click
      addLink(srcId, svcId, f.weight, f.state, 'Flow into a service — show authorizing policies');
      // svc→dst: source is ambiguous (a service can be fed by many sources)
      addLink(svcId, dstId, f.weight, f.state, 'Flow into a destination segment — show its members and reach');
    }

    const nodes = [...nodeMap.values()];
    const links: SankeyChartLink[] = [...linkMap.values()].map(({ partial, ...l }) => ({
      ...l,
      state: partial ? 'partial' : 'full',
    }));
    const headers = ['Identity segment', 'Service', 'Service segment'];
    return { nodes, links, headers };
  });

  // ─ thin reactive selectors the template reads (call as functions) ─
  // ─ surface A: bipartite graph ─
  readonly graphNodes = computed(() => this.view().graphNodes);
  readonly graphEdges = computed(() => this.view().graphEdges);
  readonly svgWidth = computed(() => this.view().svgWidth);
  readonly svgHeight = computed(() => this.view().svgHeight);
  // ─ surface B: companion matrix ─
  readonly matrixColLabels = computed(() => this.view().matrixColLabels);
  readonly matrixRows = computed(() => this.view().matrixRows);
  // ─ edge tallies (one source of truth for header + graph blurb) ─
  readonly drawnEdgeCount = computed(() => this.view().drawnEdgeCount);
  readonly noneEdgeCount = computed(() => this.view().noneEdgeCount);
  // ─ conservation footnote (read straight off the resolver) ─
  readonly rolledUpCount = computed(() => this.view().rolledUpCount);
  readonly conservationHolds = computed(() => this.view().conservationHolds);

  /**
   * Roll the resolver's PAIRS up to this segment-pair cell and open the drawer
   * with the union of authorizing dial policies (segment-pair grain, NOT a
   * single identity→service pair). A 'none' cell yields an empty policy list,
   * which the drawer body renders as the affirmative isolation message.
   *
   * Pure view aggregation over existing output — no authorization is re-derived.
   */
  select(fromSegment: string, toSegment: string): void {
    const key = `${fromSegment}→${toSegment}`;
    this.selectedKey.set(key);
    // one graph selection at a time: an edge selection supersedes a node one, so
    // the graph never shows two competing highlights (matrix ignores both signals).
    this.selectedSegment.set(null);

    const view = this.view();
    const graph = this.graph();

    const edge = view.edgeByKey.get(key);
    if (!edge) return;

    const idMembers = new Set(view.idMembersBySeg.get(fromSegment) ?? []);
    const svcMembers = new Set(view.svcMembersBySeg.get(toSegment) ?? []);

    // pairs landing in this cell → union of the policies that authorized them
    const policyIds = new Set<string>();
    for (const p of graph.pairs) {
      if (idMembers.has(p.identityId) && svcMembers.has(p.serviceId)) {
        for (const id of p.authorizedBy) policyIds.add(id);
      }
    }

    const policyById = this.policyById();
    const policies: PolicyProvenanceEntry[] = [...policyIds]
      .map((id) => policyById.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => ({
        id: p.id,
        name: p.name,
        identityRoles: p.identityRoles,
        serviceRoles: p.serviceRoles,
        semantic: p.semantic,
        type: 'dial',
      }));

    const fromLabel = shortLabel(fromSegment);
    const toLabel = shortLabel(toSegment);

    // member drill-in within the cell — per-member status + exclusion reasons
    const explanation = explainCell(fromSegment, toSegment, {
      identities: this.activeIdentities(),
      services: this.activeServices(),
      policies: this.activePolicies(),
      pairs: graph.pairs,
      segmentNodes: graph.segmentNodes,
    });
    const identities = this.buildIdentityMembers(explanation.identities);
    const services = this.buildServiceMembers(explanation.services);

    this.drawer.open({
      type: 'policy-provenance',
      data: {
        title: `${fromLabel} → ${toLabel}`,
        subtitle: 'Dial policy provenance',
        fromLabel,
        toLabel,
        state: edge.state,
        authorizedCount: edge.authorizedCount,
        totalCount: edge.totalCount,
        policies,
        identities: identities.members,
        identityAuthorizedCount: identities.authorizedCount,
        identityTotal: identities.total,
        services: services.members,
        serviceReachedCount: services.reachedCount,
        serviceTotal: services.total,
      },
    });
  }

  /**
   * Is edge `e` incident to the hovered node? Identity nodes own the edge's
   * from-side, service nodes the to-side. Pure geometry over data the GraphEdge
   * already carries — used ONLY by the graph's hover-isolate dim class.
   */
  /**
   * Clear graph interaction state — fired by a click on the empty SVG background
   * (a node/edge click never reaches it, hit-testing picks the topmost element).
   * Dismisses both selection modes and any hover, so a persistent highlight can
   * always be cleared. Leaves the drawer alone (its own backdrop/Esc close it).
   */
  clearGraphSelection(): void {
    this.selectedKey.set(null);
    this.selectedSegment.set(null);
    this.hoveredNode.set(null);
  }

  // ─── Sankey interaction (surface C) — reuses the existing drawers ──────────
  /**
   * Sankey node click (from the chart's nodeClick event). Source (stage 0) /
   * destination (stage 2) segment nodes open the existing segment-provenance
   * drawer; the middle service node (stage 1) opens the service-provenance
   * drawer. The generic event carries a stage-qualified node id (`<stage>:<seg>`);
   * strip the prefix to recover the auth segment / service id.
   */
  onSankeyNodeClick(e: SankeyNodeClickEvent): void {
    const segment = e.nodeId.slice(e.nodeId.indexOf(':') + 1);
    if (e.stageIndex === 0) this.selectNode('identity', segment);
    else if (e.stageIndex === 2) this.selectNode('service', segment);
    else this.selectService(segment);
  }

  /**
   * SANKEY-ONLY service click → open the 'service-provenance' drawer (the INDEX
   * view for one SERVICE: endpoint facts + who reaches it). The REVERSE of
   * selectNode's join — graph.pairs filtered by serviceId, grouped by the source
   * identity's segment — same data, no resolver change. Sets neither selectedKey
   * nor selectedSegment (a service has no graph/Sankey highlight), so the matrix
   * and graph selection state stay untouched.
   */
  selectService(serviceId: string): void {
    const svc = this.serviceById().get(serviceId);
    if (!svc) return;
    const view = this.view();
    const graph = this.graph();

    // service's own segment + identity→source-segment map (same grouping the
    // surfaces use; inverses of the resolver's *MembersBySeg roll-ups).
    const serviceSegmentById = new Map<string, string>();
    for (const [seg, ids] of view.svcMembersBySeg) for (const id of ids) serviceSegmentById.set(id, seg);
    const serviceSegment = serviceSegmentById.get(serviceId) ?? UNGROUPED_SEGMENT;
    const identitySegmentById = new Map<string, string>();
    for (const [seg, ids] of view.idMembersBySeg) for (const id of ids) identitySegmentById.set(id, seg);

    const identityById = this.identityById();

    // reverse join: pairs INTO this service, grouped by source identity's segment
    interface Grp {
      identities: Map<string, string>;
      policies: Set<string>;
    }
    const groups = new Map<string, Grp>();
    const distinctIdentities = new Set<string>();
    for (const p of graph.pairs) {
      if (p.serviceId !== serviceId) continue;
      const src = identitySegmentById.get(p.identityId) ?? UNGROUPED_SEGMENT;
      let g = groups.get(src);
      if (!g) {
        g = { identities: new Map(), policies: new Set() };
        groups.set(src, g);
      }
      g.identities.set(p.identityId, identityById.get(p.identityId)?.name ?? p.identityId);
      for (const id of p.authorizedBy) g.policies.add(id);
      distinctIdentities.add(p.identityId);
    }

    const reachedBy: ServiceReachedByEntry[] = [...groups.entries()]
      .map(([src, g]) => {
        const edge = view.edgeByKey.get(`${src}→${serviceSegment}`);
        // an authorized pair exists, so the segment pair can never be 'none'.
        const state: 'full' | 'partial' = edge && edge.state !== 'none' ? edge.state : 'full';
        return {
          sourceSegment: src,
          sourceSegmentLabel: shortLabel(src),
          identities: [...g.identities.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          state,
          authorizedBy: [...g.policies],
        };
      })
      .sort((a, b) => a.sourceSegmentLabel.localeCompare(b.sourceSegmentLabel));

    const { proto, port } = parseServiceEndpoint(svc.protocol, svc.interceptAddress);
    const serviceSegmentLabel = shortLabel(serviceSegment);

    this.drawer.open({
      type: 'service-provenance',
      data: {
        title: svc.name,
        subtitle: `${serviceSegmentLabel} · ${proto} · ${port}`,
        serviceId,
        serviceName: svc.name,
        serviceSegment,
        serviceSegmentLabel,
        protocol: proto,
        port,
        interceptAddress: svc.interceptAddress,
        reachedBy,
        totalIdentities: distinctIdentities.size,
        // hand a reached-by row off to the EXISTING edge drawer (index → detail)
        onReachSelect: (from, to) => this.select(from, to),
      },
    });
  }

  /**
   * Sankey ribbon click. A src→svc ribbon has an unambiguous (source, dest)
   * segment pair → opens the existing policy-provenance drawer via select().
   * A svc→dst ribbon's source is ambiguous (a service can be fed by many source
   * segments), so it opens the destination segment drawer instead — the honest,
   * unambiguous target for that half.
   */
  onSankeyLinkClick(e: SankeyLinkClickEvent): void {
    if (e.sourceNodeId.startsWith('src:')) {
      // src→svc ribbon: unambiguous (identity segment, the service's dst segment).
      // The chart event has node ids only; recover the dst segment via serviceSegmentById.
      const fromSegment = e.sourceNodeId.slice(e.sourceNodeId.indexOf(':') + 1);
      const serviceId = e.targetNodeId.slice(e.targetNodeId.indexOf(':') + 1);
      const toSegment = this.serviceSegmentById().get(serviceId) ?? UNGROUPED_SEGMENT;
      this.select(fromSegment, toSegment);
    } else {
      // svc→dst ribbon: source is ambiguous → open the destination segment drawer.
      const toSegment = e.targetNodeId.slice(e.targetNodeId.indexOf(':') + 1);
      this.selectNode('service', toSegment);
    }
  }

  isIncident(e: GraphEdge, hovered: { side: 'identity' | 'service'; segment: string } | null): boolean {
    if (!hovered) return true;
    return hovered.side === 'identity'
      ? e.fromSegment === hovered.segment
      : e.toSegment === hovered.segment;
  }

  /**
   * Is node `n` incident to the hovered node — i.e. should it stay lit? True for
   * the hovered node itself and any node joined to it by a drawn edge; false for
   * unrelated nodes (which the template fades). Graph-only, pure rendering.
   */
  isNodeIncident(n: GraphNode, hovered: { side: 'identity' | 'service'; segment: string } | null): boolean {
    if (!hovered) return true;
    if (n.side === hovered.side) return n.segment === hovered.segment;
    // opposite side: lit iff a drawn edge connects them
    return this.graphEdges().some((e) =>
      hovered.side === 'identity'
        ? e.fromSegment === hovered.segment && e.toSegment === n.segment
        : e.toSegment === hovered.segment && e.fromSegment === n.segment,
    );
  }

  /**
   * GRAPH-ONLY node click → open the 'segment-provenance' drawer (the INDEX view
   * for one segment: its members + everything it reaches). Distinct from select()
   * (the edge/cell → 'policy-provenance' detail). Sets selectedSegment, NOT
   * selectedKey — the matrix reads selectedKey and must stay untouched.
   *
   * Pure view aggregation: members are the resolver's memberIds joined to names
   * in-component; reach is segmentEdges filtered to this segment (state !== 'none').
   * Each reach row hands off to the existing select() via an onReachSelect closure.
   */
  selectNode(side: 'identity' | 'service', segment: string): void {
    this.selectedSegment.set({ side, segment });
    // one graph selection at a time: a node selection clears any lingering edge
    // highlight (selectedKey), so an old selected edge can't read as a stuck hover.
    this.selectedKey.set(null);

    const graph = this.graph();
    const node = graph.segmentNodes.find((n) => n.side === side && n.segment === segment);
    if (!node) return;

    const label = shortLabel(segment);

    // members: resolver ids → display names (view-only join)
    const byId = side === 'identity' ? this.identityById() : this.serviceById();
    const members = node.memberIds
      .map((id) => ({ id, name: byId.get(id)?.name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MEMBER_LIST_CAP);

    // reach: edges incident to this segment, excluding 'none'
    const reach: SegmentReachEntry[] = graph.segmentEdges
      .filter((e) => e.state !== 'none' && (side === 'identity' ? e.fromSegment === segment : e.toSegment === segment))
      .map((e) => ({
        fromSegment: e.fromSegment,
        toSegment: e.toSegment,
        otherLabel: shortLabel(side === 'identity' ? e.toSegment : e.fromSegment),
        state: e.state as 'full' | 'partial',
        authorizedCount: e.authorizedCount,
        totalCount: e.totalCount,
      }))
      .sort((a, b) => a.otherLabel.localeCompare(b.otherLabel));

    this.drawer.open({
      type: 'segment-provenance',
      data: {
        title: label,
        subtitle: `${side === 'identity' ? 'Identity' : 'Service'} segment · segment map`,
        side,
        segment,
        label,
        kind: nodeKind(node),
        memberCount: node.memberCount,
        members,
        reach,
        // hand a reach row off to the EXISTING edge drawer (index → detail)
        onReachSelect: (from, to) => this.select(from, to),
      },
    });
  }

  /** Project an exclusion reason to the drawer's display shape (drops the id). */
  private projectReason(reason: ExclusionReason): ProvenanceExclusionReason {
    return {
      kind: reason.kind,
      nearestPolicyName: reason.nearestPolicyName,
      missingRoles: reason.missingRoles,
    };
  }

  /** Sort excluded-first, cap for display, and report the true (pre-cap) tallies. */
  private buildIdentityMembers(all: CellIdentityExplanation[]): {
    members: ProvenanceIdentityMember[];
    authorizedCount: number;
    total: number;
  } {
    const sorted = [...all].sort(
      (a, b) => (a.status === 'excluded' ? 0 : 1) - (b.status === 'excluded' ? 0 : 1),
    );
    const members = sorted.slice(0, MEMBER_LIST_CAP).map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      reason: m.reason ? this.projectReason(m.reason) : undefined,
    }));
    return {
      members,
      authorizedCount: all.filter((m) => m.status === 'authorized').length,
      total: all.length,
    };
  }

  /** Sort unreached-first, cap for display, and report the true (pre-cap) tallies. */
  private buildServiceMembers(all: CellServiceExplanation[]): {
    members: ProvenanceServiceMember[];
    reachedCount: number;
    total: number;
  } {
    const sorted = [...all].sort(
      (a, b) => (a.status === 'unreached' ? 0 : 1) - (b.status === 'unreached' ? 0 : 1),
    );
    const members = sorted.slice(0, MEMBER_LIST_CAP).map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      reason: m.reason ? this.projectReason(m.reason) : undefined,
    }));
    return {
      members,
      reachedCount: all.filter((m) => m.status === 'reached').length,
      total: all.length,
    };
  }
}
