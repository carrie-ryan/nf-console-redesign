import { Component, computed, input, output, signal } from '@angular/core';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyGraph } from 'd3-sankey';

/**
 * Generic, N-stage Sankey chart — pure "nodes/links in → SVG + events out".
 *
 * It knows NOTHING about authorization, services, segments, or observed traffic:
 * consumers hand it already-stage-assigned nodes/links plus column headers, and it
 * runs d3-sankey, renders the SVG, does hover-isolate, and emits node/link click
 * events. All domain semantics (what a node MEANS, what a click DOES, tooltip text)
 * live in the consumer's adapter and its event handlers.
 *
 * Columns come from `stageIndex` (0..N-1); links must connect adjacent-stage nodes
 * (d3 derives the column layout from that topology). `kind` and `state` are opaque
 * styling strings the chart maps to generic CSS classes (`node-kind-<kind>`,
 * `link-state-<state>`, `link-touches-<kind>`) — no chart-side interpretation.
 */

/** One column node. `stageIndex` = which column (0-based). `kind`/`title`/
 *  `ariaLabel` are opaque, consumer-set. */
export interface SankeyChartNode {
  id: string;
  stageIndex: number;
  label: string;
  /** Tooltip text, rendered verbatim (<title>). Falls back to `label`. */
  title?: string;
  /** Opaque styling tag → `node-kind-<kind>` CSS class (e.g. 'catch-all'). */
  kind?: string;
  /** Optional magnitude; unused by the layout today (d3 sizes nodes from links). */
  weight?: number;
  /** Opaque a11y label for the node's clickable group. */
  ariaLabel?: string;
}

/** One ribbon between two adjacent-stage nodes. `state` is an opaque styling tag. */
export interface SankeyChartLink {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
  /** Opaque styling tag → `link-state-<state>` CSS class (e.g. 'full'/'partial'). */
  state?: string;
  /** Opaque a11y label for the ribbon. */
  ariaLabel?: string;
}

export interface SankeyNodeClickEvent {
  nodeId: string;
  stageIndex: number;
  kind?: string;
}
export interface SankeyLinkClickEvent {
  linkId: string;
  sourceNodeId: string;
  targetNodeId: string;
}

// ─── layout constants (generic; wide viewBox so columns fill the card) ────────
const SANK_W = 1500;
const SANK_MARGIN_X = 168; // room for first/last-column labels outside the columns
const SANK_MARGIN_Y = 18;
const SANK_NODE_W = 14;
const SANK_NODE_PAD = 16;
const SANK_HEADER_H = 30; // reserved band at top for the per-column headers

// ─── d3 input shapes (extra props ride alongside d3's geometry) ───────────────
interface NodeX {
  id: string;
  stageIndex: number;
  label: string;
  title: string;
  kind?: string;
  ariaLabel?: string;
}
interface LinkX {
  linkId: string;
  state?: string;
  ariaLabel?: string;
  /** kinds of this link's endpoint nodes → `link-touches-<kind>` classes. */
  touchesKinds: string[];
}

/** A positioned node the template renders (d3 geometry flattened out). */
interface NodeView extends NodeX {
  x0: number;
  y0: number;
  w: number;
  h: number;
  isFirst: boolean;
  isLast: boolean;
}
/** A positioned ribbon the template renders. */
interface LinkView {
  key: string;
  linkId: string;
  sourceId: string;
  targetId: string;
  path: string;
  width: number;
  state?: string;
  ariaLabel?: string;
  touchesKinds: string[];
}
/** A column header centered over its stage's node column. */
interface HeaderView {
  x: number;
  y: number;
  text: string;
}

@Component({
  selector: 'app-sankey-chart',
  standalone: true,
  templateUrl: './sankey-chart.component.html',
  styleUrl: './sankey-chart.component.css',
})
export class SankeyChartComponent {
  // ─── inputs (already stage-assigned) ──────────────────────────────────────
  readonly nodes = input<readonly SankeyChartNode[]>([]);
  readonly links = input<readonly SankeyChartLink[]>([]);
  /** Column headers by stageIndex; a missing/empty entry renders no header. */
  readonly headers = input<readonly string[]>([]);
  /** Accessible name for the whole chart svg. */
  readonly ariaLabel = input<string>('Sankey flow diagram');

  // ─── outputs (semantics live in the consumer) ─────────────────────────────
  readonly nodeClick = output<SankeyNodeClickEvent>();
  readonly linkClick = output<SankeyLinkClickEvent>();
  /** Empty-canvas click — consumers may use it to clear a selection. */
  readonly backgroundClick = output<void>();

  // ─── hover-isolate state (pure rendering, no consumer involvement) ────────
  readonly hoveredNodeId = signal<string | null>(null);

  /**
   * d3-sankey layout over the generic nodes/links. Each column is derived from
   * link topology (d3's default justify align), which agrees with `stageIndex`
   * when consumers link only adjacent stages. Geometry is flattened into plain
   * view shapes so the template imports no d3.
   */
  readonly layout = computed<{ nodes: NodeView[]; links: LinkView[]; headers: HeaderView[]; width: number; height: number }>(() => {
    const inNodes = this.nodes();
    const inLinks = this.links();
    if (inNodes.length === 0) return { nodes: [], links: [], headers: [], width: SANK_W, height: 200 };

    const stageCount = Math.max(...inNodes.map((n) => n.stageIndex)) + 1;
    const kindById = new Map(inNodes.map((n) => [n.id, n.kind]));

    // tallest column drives the height (same packing math as before)
    let maxCol = 0;
    for (let s = 0; s < stageCount; s += 1) {
      const c = inNodes.filter((n) => n.stageIndex === s).length;
      if (c > maxCol) maxCol = c;
    }
    const height = Math.max(620, maxCol * (SANK_NODE_PAD + 22) + SANK_MARGIN_Y * 2 + SANK_HEADER_H);

    const gen = sankey<NodeX, LinkX>()
      .nodeId((d) => d.id)
      .nodeWidth(SANK_NODE_W)
      .nodePadding(SANK_NODE_PAD)
      .extent([
        // top edge pushed down by the header band so headers sit above row 1
        [SANK_MARGIN_X, SANK_MARGIN_Y + SANK_HEADER_H],
        [SANK_W - SANK_MARGIN_X, height - SANK_MARGIN_Y],
      ]);

    // d3 mutates its input graph; feed fresh copies each run.
    const graph: SankeyGraph<NodeX, LinkX> = gen({
      nodes: inNodes.map((n) => ({
        id: n.id,
        stageIndex: n.stageIndex,
        label: n.label,
        title: n.title ?? n.label,
        kind: n.kind,
        ariaLabel: n.ariaLabel,
      })),
      links: inLinks.map((l) => ({
        source: l.sourceNodeId,
        target: l.targetNodeId,
        value: l.weight,
        linkId: l.id,
        state: l.state,
        ariaLabel: l.ariaLabel,
        touchesKinds: [kindById.get(l.sourceNodeId), kindById.get(l.targetNodeId)].filter(
          (k): k is string => !!k,
        ),
      })),
    } as unknown as SankeyGraph<NodeX, LinkX>);

    const linkPath = sankeyLinkHorizontal<NodeX, LinkX>();

    const nodeViews: NodeView[] = graph.nodes.map((n) => ({
      id: n.id,
      stageIndex: n.stageIndex,
      label: n.label,
      title: n.title,
      kind: n.kind,
      ariaLabel: n.ariaLabel,
      x0: n.x0 ?? 0,
      y0: n.y0 ?? 0,
      w: (n.x1 ?? 0) - (n.x0 ?? 0),
      h: (n.y1 ?? 0) - (n.y0 ?? 0),
      isFirst: n.stageIndex === 0,
      isLast: n.stageIndex === stageCount - 1,
    }));

    const linkViews: LinkView[] = graph.links.map((l) => {
      const s = l.source as NodeX;
      const t = l.target as NodeX;
      return {
        key: `${s.id} ${t.id}`,
        linkId: l.linkId,
        sourceId: s.id,
        targetId: t.id,
        path: linkPath(l) ?? '',
        width: Math.max(1, l.width ?? 1),
        state: l.state,
        ariaLabel: l.ariaLabel,
        touchesKinds: l.touchesKinds,
      };
    });

    // column headers: centered over each stage's node x-range (same coords the
    // nodes use, so they track the columns under the responsive viewBox).
    const headerY = SANK_MARGIN_Y + 15;
    const headerText = this.headers();
    const headerViews: HeaderView[] = [];
    for (let s = 0; s < stageCount; s += 1) {
      const text = headerText[s];
      if (!text) continue;
      const col = nodeViews.filter((n) => n.stageIndex === s);
      if (col.length === 0) continue;
      const x0 = Math.min(...col.map((n) => n.x0));
      headerViews.push({ x: x0 + col[0].w / 2, y: headerY, text });
    }

    return { nodes: nodeViews, links: linkViews, headers: headerViews, width: SANK_W, height };
  });

  // ─── template class helpers (generic kind/state → CSS class strings) ──────
  nodeGroupClass(n: NodeView): string {
    const pos = n.isFirst ? 'pos-first' : n.isLast ? 'pos-last' : 'pos-interior';
    const kind = n.kind ? ` node-kind-${n.kind}` : '';
    return `sankey-node-g ${pos} col-${n.stageIndex} node-clickable${kind}`;
  }
  linkClass(l: LinkView): string {
    const state = l.state ? ` link-state-${l.state}` : '';
    const touches = l.touchesKinds.map((k) => ` link-touches-${k}`).join('');
    return `sankey-link${state}${touches}`;
  }
  /** Dim a ribbon not incident to the hovered node (hover-isolate). */
  isLinkDim(l: LinkView): boolean {
    const h = this.hoveredNodeId();
    if (!h) return false;
    return l.sourceId !== h && l.targetId !== h;
  }
  /** Truncate a label to `max` chars with an ellipsis (matches the prior chart). */
  truncLabel(s: string, max = 22): string {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // ─── event plumbing ───────────────────────────────────────────────────────
  onNodeClick(n: NodeView): void {
    this.nodeClick.emit({ nodeId: n.id, stageIndex: n.stageIndex, kind: n.kind });
  }
  onLinkClick(l: LinkView): void {
    this.linkClick.emit({ linkId: l.linkId, sourceNodeId: l.sourceId, targetNodeId: l.targetId });
  }
  onBackground(): void {
    this.hoveredNodeId.set(null);
    this.backgroundClick.emit();
  }
}
