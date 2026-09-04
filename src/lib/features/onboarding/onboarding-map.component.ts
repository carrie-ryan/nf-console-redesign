import { Component, computed, inject } from '@angular/core';
import { OnboardingStateService, PolicyType } from './onboarding-state.service';

/**
 * Onboarding network map — a persistent, path-reactive schematic of the network
 * the user is assembling. Lives in the shell's map region so it never unmounts
 * across step navigation.
 *
 * The diagram is a hand-placed TEACHING schematic (fixed positions every render):
 * an ACCESS zone (identities dial/bind the service) stacked over a TRANSPORT zone
 * (the fabric the service is carried by). Every edge is node-to-node — nothing
 * terminates in empty space — and each policy renders as a PERMISSION CARD (name
 * + what it does) anchored to the relationship it authorizes:
 *   - Service Policy  → rides the dial/bind arrows (identity → service).
 *   - Router Policy   → rides the identity → router edge (crosses zones).
 *   - Service Edge Router Policy → rides the service → router edge.
 * Ghost→solid solidification + the auto/manual/unset variant treatment carry
 * over unchanged; parts fill in as the entities they represent come to exist.
 */

/** How the policy pills are drawn, derived from the path (branch + showPolicyStep). */
export type PolicyVariant = 'unset' | 'manual' | 'auto';

/** An entity node (identity / service / router). `hue` is its solid-state colour
 *  (baked in now for 3c; ghost rendering this pass ignores it). */
export interface MapNode {
  id: string;
  label: string;
  /** Font Awesome 7 solid glyph — the same icons the steps/rail use. */
  glyph: string;
  hue: 'blue' | 'teal' | 'purple' | 'coral';
  cx: number;
  cy: number;
  r: number;
  /** Baseline for the node's label (all centred under/over the node). */
  labelY: number;
  /** Max rendered label width (px, viewBox units). Long entered names are
   *  truncated to this so they never collide with a neighbour or the zone edge. */
  labelMax: number;
}

/** A traffic arrow (identity → service) with a small pill riding on it. */
export interface MapArrow {
  id: string;
  /** SVG path data — pre-offset to the node edges. */
  d: string;
  /** Short label shown in the pill on the arrow (e.g. "dial" / "bind"). */
  pill: string;
  /** Pill centre (a point on the arrow). */
  px: number;
  py: number;
}

/** The three permission cards, keyed to solidity + governed edge. */
export type PolicyCardId = 'service-policy' | 'router-policy' | 'serp';

/**
 * A policy PERMISSION CARD — the policy NAME (bold, top) plus a short permission
 * phrase (muted, below) that says what the policy actually DOES. Each card is
 * anchored to the relationship (edge) it governs, never floating: the Service
 * Policy card rides the dial/bind arrows, the Router Policy card rides the
 * identity→router line, the SERP card rides the service→router line.
 */
export interface PolicyCardSpec {
  id: PolicyCardId;
  glyph: string;
  /** Bold top line — the created policy's real name, or the type name (ghost). */
  name: string;
  /** Muted second line — the permission the policy grants (templated per type). */
  phrase: string;
}

/** A permission card laid out — width hugged to its longest line, centred on the
 *  anchor point that sits on its governed edge. */
export interface PolicyCard extends PolicyCardSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Shield-icon centre (left of the two text lines). */
  iconX: number;
  iconY: number;
  /** Left x shared by both text lines. */
  textX: number;
  /** Baselines for the name (top) and permission phrase (below). */
  nameY: number;
  phraseY: number;
}

/**
 * Part 3c — per-part SOLID state, a true reflection of the real configuration.
 * A part is "solid" once the entity it represents actually exists (keyed off the
 * audited signals). Keyed by node / pill / arrow id so the template looks each up.
 */
export interface Solidity {
  nodes: Record<string, boolean>;
  cards: Record<PolicyCardId, boolean>;
  arrows: Record<string, boolean>;
}

// ─── Fixed topology geometry (viewBox 640 × 360, landscape) ───────────────────
// FA glyphs by code point (avoids embedding invisible PUA chars in source).
const ICON = {
  identity: String.fromCodePoint(0xf234), // fa-user-plus
  service:  String.fromCodePoint(0xf233), // fa-server
  router:   String.fromCodePoint(0xf6ff), // fa-network-wired
  shield:   String.fromCodePoint(0xf3ed), // fa-shield-halved
};

/**
 * NetFoundry logo — a 64×64 transparent PNG (prepared asset, stored verbatim as a
 * data-URI). Rendered as the router node's icon ONLY when the router draft's
 * hosting choice is NetFoundry-hosted. It's a CHOICE MARKER, not a ghost element:
 * it shows full-colour the moment NF-hosting is picked, independent of whether the
 * router node itself is ghosted or solid (hence drawn OUTSIDE the dimmed node group).
 */
const NF_LOGO =
  'data:image/png;base64,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';

/** Rendered size (px, viewBox units) of the NF logo on the router node. Source is
 *  64px; ~28px keeps it inside the router node (r24 → Ø48) with no overflow. */
const ROUTER_LOGO_SIZE = 28;

/**
 * Entity nodes. The two identities sit upper-left of the Access zone; the Service
 * is the larger hub by the right edge, centred ON the boundary between the zones
 * so it straddles them SYMMETRICALLY — a deliberate ~half-and-half overlap that
 * reads as "reached via access, carried via transport", not a misalignment. The
 * router node(s) live in the Transport band and are NOT listed here — they render
 * from the RouterEntry list (1 or 2), laid out + edged per-router below.
 *
 * The zones leave a clear GUTTER (access ends y188, transport starts y212); the
 * boundary centreline is y200, and the Service node (cy200, r30) is the only node
 * that bridges the gutter. Every other node + card stays wholly within one zone.
 */
// The hosting IDENTITY node is NOT a core node — it's a subordinate, simple-branch-
// only participant (see HOST_NODE below), rendered as a small rounded square rather
// than a co-equal circle. Advanced services have NO hosting identity (the router
// binds the service), so nothing hosting-identity-shaped appears there.
const NODES: readonly MapNode[] = [
  { id: 'dialing', label: 'Dialing identity', glyph: ICON.identity, hue: 'blue',   cx: 96,  cy: 64,  r: 24, labelY: 104, labelMax: 150 },
  // Service is centred on the boundary centreline (y200): ~half in access, ~half
  // in transport. Its label rides ABOVE it, inside access. Tightest labelMax.
  { id: 'service', label: 'Service',          glyph: ICON.service,  hue: 'purple', cx: 548, cy: 200, r: 30, labelY: 158, labelMax: 116 },
];

/**
 * Hosting IDENTITY node — SIMPLE branch only, and deliberately SUBORDINATE: a small
 * rounded SQUARE (not the full circle the core nodes use) so at a glance it reads as
 * a supporting participant, not a co-equal entity. Teal + the identity glyph keep it
 * identifiable as a hosting identity. Sits where the old circle did (upper-left
 * Access zone, below the dialing identity) so the bind arrow still originates cleanly.
 */
const HOST_NODE = { cx: 96, cy: 138, size: 30, labelY: 172, labelMax: 110 } as const;

// ─── Text metrics (canvas) ────────────────────────────────────────────────────
// Shared canvas 2d context to measure text at the ACTUAL SVG font — used both to
// truncate long node labels and to size each policy pill to hug its own label.
const LABEL_FONT = "600 11px Inter, system-ui, sans-serif";      // node labels
const CARD_NAME_FONT = "700 9.5px Inter, system-ui, sans-serif"; // card name (bold top)
const CARD_PHRASE_FONT = "500 8px Inter, system-ui, sans-serif"; // card permission phrase
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureText(text: string, font: string): number {
  if (typeof document === 'undefined') {
    const px = Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1]) || 10; // SSR-safe estimate
    return text.length * px * 0.58;
  }
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 6;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
/** Longest ellipsised prefix of `text` that renders within `maxWidth` px at `font`. */
function truncateToWidth(text: string, maxWidth: number, font = LABEL_FONT): string {
  if (measureText(text, font) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(text.slice(0, mid) + '…', font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

/**
 * The four edges, all node-to-node (nothing terminates in empty space):
 *  - dial / bind: the identity→service traffic arrows the Service Policy authorizes
 *    (a small "dial"/"bind" pill rides each near its origin, left of the card).
 *  - the two SERP/Router-policy edges are drawn inline in the template (see
 *    SERP_EDGE / ROUTER_LINK_EDGE) because they carry a card, not a pill.
 * dial + bind are pre-offset to the node edges; the pills sit on the left third
 * (clear of the Service Policy card, which rides the converging right portion).
 */
const ARROWS: readonly MapArrow[] = [
  { id: 'dial', d: 'M119,71 L519,191',  pill: 'dial', px: 145, py: 79 },
  // Bind starts at the shrunk host node's right edge (~x111) rather than the old
  // r24 circle's rim; still simple-branch-only (advanced has no hosting identity).
  { id: 'bind', d: 'M112,140 L518,196', pill: 'bind', px: 145, py: 145 },
];

// ─── Config annotations (short text set FLUSH ALONG the flow it describes) ────────
// A service's configs annotate the SIDE they define — intercept.v1 the client/dial
// side, host.v1/v2 the hosting side. Rendered as tiny muted text SET ALONG the
// relevant line (rotated to its slope, centred on it), reading like an edge label on
// a wire — no box, no leader. Content is just the short type ('intercept' / 'host');
// the full config name is form-level detail, not map-level.
const ANNO_DIAL_FRAC = 0.70;  // 'intercept' sits ~70% along the dial arrow (past the service-policy card)
const ANNO_HOST_FRAC = 0.15;  // 'host' sits ~15% along the service→router connector (near the service, above the SERP card)
const ANNO_FRAC_STEP = 0.08;  // shift along the line when multiple configs share a side (uncommon)
// The dial arrow's endpoints (matches ARROWS 'dial'), for the along-line maths.
const ANNO_DIAL_LINE = { x1: 119, y1: 71, x2: 519, y2: 191 } as const;
/** Angle (deg) of the segment (x1,y1)→(x2,y2), for rotating flush text onto it. */
function lineAngle(x1: number, y1: number, x2: number, y2: number): number {
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
}

/** A config annotation — short text set FLUSH ALONG its flow: anchored to a point
 *  ON the line and rotated to the line's slope, so it reads as a label on the wire. */
export interface ConfigAnnotation {
  id: string;
  side: 'dial' | 'host';
  /** Short label — 'intercept' / 'host' (the type, not the config's long name). */
  label: string;
  /** Anchor point ON the flow (text is centred here) + the flow's slope in degrees. */
  x: number; y: number; angle: number;
  solid: boolean;
}

// ─── Per-router edges + layout ────────────────────────────────────────────────
// Each router connects independently to the SERVICE (SERP: the router carries the
// service) and to the DIALING identity (Router policy: identities may use the
// router). With two routers there are two of each. Edges are node-to-node, offset
// to both circle rims (no dangling stubs). The single-router offsets these produce
// reproduce the original hand-tuned strings ('M520,209 L323,274' / 'M112,82
// L284,265') exactly, so one router looks unchanged.
const SERVICE_NODE = NODES.find((n) => n.id === 'service')!;
const DIALING_NODE = NODES.find((n) => n.id === 'dialing')!;

/** Straight edge from circle A to circle B, trimmed to each circle's rim. */
function edgeBetween(ax: number, ay: number, ar: number, bx: number, by: number, br: number): string {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return `M${(ax + ux * ar).toFixed(1)},${(ay + uy * ar).toFixed(1)} ` +
         `L${(bx - ux * br).toFixed(1)},${(by - uy * br).toFixed(1)}`;
}

/** Where the router node(s) sit in the transport band. ONE router keeps the
 *  original single-node placement (centred). TWO reflow side-by-side in the LOWER
 *  transport band (node tops ~y264, below the Router-policy + SERP cards which end
 *  ~y258 and stay put), each a touch smaller so both fit collision-free. */
interface RouterLayout { cx: number; cy: number; r: number; labelY: number; sublabelY: number; labelMax: number; }
const ROUTER_SOLO: RouterLayout =
  { cx: 300, cy: 282, r: 24, labelY: 322, sublabelY: 334, labelMax: 150 };
const ROUTER_PAIR: readonly RouterLayout[] = [
  { cx: 238, cy: 286, r: 22, labelY: 324, sublabelY: 336, labelMax: 140 },
  { cx: 452, cy: 286, r: 22, labelY: 324, sublabelY: 336, labelMax: 140 },
];

/** A laid-out router node — its geometry plus everything the template needs to
 *  render it independently: label, hosting badge/logo, solid state, and its two
 *  OWN edges (to the service and to the dialing identity). */
export interface RouterNodeView {
  id: string;
  cx: number; cy: number; r: number;
  labelY: number; sublabelY: number;
  rawLabel: string;
  label: string;
  hostedByNf: boolean;
  hostingLabel: string;
  solid: boolean;
  logoX: number; logoY: number; logoSize: number;
  connectorEdge: string; connectorSolid: boolean;
  linkEdge: string; linkSolid: boolean;
}

// ─── Permission card metrics + anchors ────────────────────────────────────────
// A card is [shield · name / phrase]. width = TEXT_X + max(nameW, phraseW) +
// RIGHT_PAD, so it hugs its longest line; each card is CENTRED on its anchor,
// which sits ON the edge the policy governs.
const CARD_H = 34;
const CARD_ICON_X = 14;    // shield centre, from the card's left edge
const CARD_TEXT_X = 26;    // both text lines start here, from the card's left edge
const CARD_RIGHT_PAD = 11;
const CARD_NAME_MAX = 118; // long policy names truncate to this (never overflow)
// Card centres — each a point ON its governed edge, so the card reads as a label
// riding that relationship rather than floating in zone dead-space. Each anchor
// is chosen so the whole card (h=34) stays WHOLLY inside one zone: the Service
// Policy card in access (y≤188), the Router Policy + SERP cards in transport
// (y≥212). No card sits on the seam.
const CARD_ANCHORS: Record<PolicyCardId, { cx: number; cy: number }> = {
  'service-policy': { cx: 282, cy: 141 }, // on the dial arrow, beside bind (access)
  'router-policy':  { cx: 255, cy: 234 }, // on the identity→router crosser (transport)
  // Nudged down (was cy241) so the flush 'host' label clears it on the connector's
  // upper (near-service) segment; still on the service→router edge, still ≥2px above
  // the 2-router pair-B node (top y264) and clear of the solo router (x≤324).
  serp:             { cx: 421, cy: 245 }, // on the service→router edge (transport)
};

/** Permission-phrase templates (short — must not overflow the card). Service is a
 *  function of the ACTUAL dial/bind directions created; the other two are fixed. */
const CARD_PHRASE = {
  router: 'identities may use routers',
  serp: 'routers may carry service',
} as const;
const GHOST_PHRASE = 'depends on path'; // unset (no path chosen) generic phrase
/** Generic type names shown before a real policy of that type exists (ghost). */
const CARD_TYPE_NAME: Record<PolicyCardId, string> = {
  'service-policy': 'Service policy',
  'router-policy': 'Router policy',
  serp: 'Service edge router policy',
};

@Component({
  selector: 'app-onboarding-map',
  standalone: true,
  imports: [],
  templateUrl: './onboarding-map.component.html',
  styleUrl: './onboarding-map.component.css',
})
export class OnboardingMapComponent {
  readonly state = inject(OnboardingStateService);

  // Static geometry exposed to the template.
  readonly arrows = ARROWS;
  /** Router glyph (fa-network-wired) — the icon a self-hosted router node shows. */
  readonly routerGlyph = ICON.router;
  /** Identity glyph (fa-user-plus) — the subordinate hosting node's icon. */
  readonly hostGlyph = ICON.identity;
  /** Hosting node geometry (rounded square) with its rect top-left pre-computed. */
  readonly hostNode = { ...HOST_NODE, x: HOST_NODE.cx - HOST_NODE.size / 2, y: HOST_NODE.cy - HOST_NODE.size / 2 };

  /** The NetFoundry logo data-URI (stored verbatim). Rendered as a router node's
   *  icon when THAT router is NetFoundry-hosted — a CHOICE MARKER (always full
   *  colour, drawn outside the dimmed node group), independent of solid/ghost. */
  readonly nfLogo = NF_LOGO;

  /**
   * The router node(s) — one per RouterEntry (the pre-provisioned NetFoundry
   * router, plus an optional second, POC-capped at two). Each reflects ITS entry:
   * label (entry.routerName, fallback "Router"), hosting badge/logo (NF-hosted →
   * NF logo + "NetFoundry-hosted"; else glyph + "Self-hosted"), solid/ghost
   * (entry.saved), and its OWN two edges — service→router (SERP) and
   * identity→router (Router policy) — each solidifying only when BOTH its endpoints
   * exist (service && thisRouter; identity && thisRouter). Layout reflows from the
   * single centred node (one router) to a side-by-side pair (two), staying clear of
   * the Router-policy + SERP cards above.
   */
  readonly routerNodes = computed<RouterNodeView[]>(() => {
    const routers = this.state.routerDraft()().routers;
    const layouts = routers.length >= 2 ? ROUTER_PAIR : [ROUTER_SOLO];
    const identitySaved = this.state.identityDraft()().saved;
    const serviceComplete = this.state.isComplete('service');
    const svc = SERVICE_NODE, dial = DIALING_NODE;
    return routers.slice(0, layouts.length).map((entry, i) => {
      const L = layouts[i];
      const rawLabel = entry.routerName.trim() || 'Router';
      const hostedByNf = entry.hostingType === 'netfoundry';
      const solid = entry.saved;
      // Logo scales with the node radius so it stays inside the ring in both layouts.
      const logoSize = Math.round(ROUTER_LOGO_SIZE * (L.r / 24));
      return {
        id: entry.id,
        cx: L.cx, cy: L.cy, r: L.r,
        labelY: L.labelY, sublabelY: L.sublabelY,
        rawLabel,
        label: truncateToWidth(rawLabel, L.labelMax),
        hostedByNf,
        hostingLabel: hostedByNf ? 'NetFoundry-hosted' : 'Self-hosted',
        solid,
        logoSize,
        logoX: L.cx - logoSize / 2,
        logoY: L.cy - logoSize / 2,
        connectorEdge: edgeBetween(svc.cx, svc.cy, svc.r, L.cx, L.cy, L.r),
        connectorSolid: serviceComplete && solid,
        linkEdge: edgeBetween(dial.cx, dial.cy, dial.r, L.cx, L.cy, L.r),
        linkSolid: identitySaved && solid,
      };
    });
  });

  /**
   * The three permission cards — NAME (bold) + permission phrase (muted) — as a
   * TRUE REFLECTION of the real policies, laid out centred on their governed edge:
   *  - Service Policy: name + "allows dial / bind / dial + bind to service",
   *    reflecting the ACTUAL dial/bind directions among the created service
   *    policies (never hardcoded — falls back to the dial+bind template only when
   *    none are built yet).
   *  - Router Policy: name + "identities may use routers".
   *  - Service Edge Router Policy: name + "routers may carry service".
   * Ghost/unbuilt (no policy of that type created): the card shows the type name;
   * unset (no path chosen) greys the phrase to the generic "depends on path". The
   * name is the created policy's real name, truncated with the measureText
   * machinery so a long name never overflows or collides; width hugs the longest
   * line so the card stays as compact as its content allows.
   */
  readonly policyCards = computed<PolicyCard[]>(() => {
    const variant = this.policyVariant();
    const created = this.state.policyStepDraft()().createdPolicies;

    // Service policies may be several (a Dial one + a Bind one). Combine their
    // ACTUAL directions into the single phrase the card riding the arrows shows.
    const svc = created.filter((p) => p.type === 'service');
    const svcDial = svc.some((p) => p.extra === 'Dial');
    const svcBind = svc.some((p) => p.extra === 'Bind');
    const servicePhrase =
      variant === 'unset' ? GHOST_PHRASE
      : svcDial && svcBind ? 'allows dial + bind to service'
      : svcDial ? 'allows dial to service'
      : svcBind ? 'allows bind to service'
      : 'allows dial + bind to service'; // template default (auto / not yet built)
    const serviceName =
      svc.length === 0 ? CARD_TYPE_NAME['service-policy']
      : svc.length === 1 ? svc[0].name
      : `${svc.length} service policies`;

    const routerPol = created.find((p) => p.type === 'router');
    const serpPol = created.find((p) => p.type === 'service-edge-router');

    const specs: PolicyCardSpec[] = [
      { id: 'service-policy', glyph: ICON.shield, name: serviceName, phrase: servicePhrase },
      {
        id: 'router-policy', glyph: ICON.shield,
        name: routerPol?.name ?? CARD_TYPE_NAME['router-policy'],
        phrase: variant === 'unset' ? GHOST_PHRASE : CARD_PHRASE.router,
      },
      {
        id: 'serp', glyph: ICON.shield,
        name: serpPol?.name ?? CARD_TYPE_NAME.serp,
        phrase: variant === 'unset' ? GHOST_PHRASE : CARD_PHRASE.serp,
      },
    ];

    return specs.map((spec) => {
      const name = truncateToWidth(spec.name, CARD_NAME_MAX, CARD_NAME_FONT);
      const nameW = measureText(name, CARD_NAME_FONT);
      const phraseW = measureText(spec.phrase, CARD_PHRASE_FONT);
      const w = Math.round(CARD_TEXT_X + Math.max(nameW, phraseW) + CARD_RIGHT_PAD);
      const a = CARD_ANCHORS[spec.id];
      const x = Math.round(a.cx - w / 2);
      const y = a.cy - CARD_H / 2;
      return {
        ...spec, name, x, y, w, h: CARD_H,
        iconX: x + CARD_ICON_X, iconY: y + CARD_H / 2,
        textX: x + CARD_TEXT_X,
        nameY: y + CARD_H / 2 - 3,
        phraseY: y + CARD_H / 2 + 9,
      };
    });
  });

  /**
   * The path-derived policy treatment — reused straight from the existing signals
   * (branch + showPolicyStep), NOT re-derived:
   *  - unset   → path not chosen; policies undetermined (faint).
   *  - manual  → advanced with no attrs (or sticky policies): the user builds them.
   *  - auto    → simple, or advanced+attributes: NetFoundry auto-creates them.
   */
  readonly policyVariant = computed<PolicyVariant>(() => {
    if (this.state.branch() === 'unset') return 'unset';
    return this.state.showPolicyStep() ? 'manual' : 'auto';
  });

  /** Header subline naming the path the topology currently draws. */
  readonly pathLabel = computed<string>(() => {
    switch (this.state.branch()) {
      case 'simple':   return 'Simple service path';
      case 'advanced': return 'Advanced service path';
      default:         return 'Pick a path to shape it';
    }
  });

  /**
   * The SIMPLE-branch hosting IDENTITY name — a real identity that hosts the
   * service (distinct from the enrolled dialing identity). Simple-only: advanced
   * services are hosted by the router, not a hosting identity, so this is '' there.
   * (This is the de-overloaded successor to the old hostIdentityName — the advanced
   * "host config as identity" behaviour is GONE; host configs now annotate, see
   * configAnnotations.)
   */
  readonly hostingIdentityName = computed<string>(() => {
    if (this.state.branch() !== 'simple') return '';
    const hosts = this.state.serviceSimpleDraft()().hostIdentities;
    return hosts.length ? hosts[0] : '';
  });

  /** Whether the subordinate hosting-identity node (and its bind arrow) appear —
   *  SIMPLE branch with a real host identity ONLY. Never in advanced. */
  readonly showHostingNode = computed<boolean>(
    () => this.state.branch() === 'simple' && this.state.serviceSimpleDraft()().hostIdentities.length > 0,
  );

  /** The hosting node's rendered (truncated) label. */
  readonly hostingNodeLabel = computed<string>(() =>
    truncateToWidth(this.hostingIdentityName() || 'Hosting identity', HOST_NODE.labelMax),
  );

  /**
   * Config annotations — a service's attached configs, as SHORT TEXT SET FLUSH ALONG
   * the flow each defines (rotated onto the line, centred on it): 'intercept' along
   * the DIAL arrow (client-access side), 'host' along the SERVICE→ROUTER connector
   * (hosting side — in advanced the router binds the service). Advanced-only (simple
   * has no attached configs; its hosting is the identity node). The host label reads
   * the FIRST router's connector so it stays flush in both 1- and 2-router layouts,
   * and sits near the service (above the slightly-lowered SERP card). Multiple of a
   * type step along the line (uncommon). Config types other than intercept/host are
   * omitted (form-level detail, not map-level).
   */
  readonly configAnnotations = computed<ConfigAnnotation[]>(() => {
    if (this.state.branch() !== 'advanced') return [];
    const configs = this.state.serviceAdvancedDraft()().attachedConfigs;
    const solid = this.state.isComplete('service');

    // The dial arrow (fixed) — 'intercept' rides it, tilted to its slope.
    const D = ANNO_DIAL_LINE;
    const dialAngle = lineAngle(D.x1, D.y1, D.x2, D.y2);

    // The FIRST router's service→router connector (rim-to-rim) — 'host' rides it.
    // Angle is read router→service so the text is upright (up-to-the-right), not flipped.
    const first = this.state.routerDraft()().routers.length >= 2 ? ROUTER_PAIR[0] : ROUTER_SOLO;
    const dx = first.cx - SERVICE_NODE.cx, dy = first.cy - SERVICE_NODE.cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const sx = SERVICE_NODE.cx + ux * SERVICE_NODE.r, sy = SERVICE_NODE.cy + uy * SERVICE_NODE.r; // service rim
    const ex = first.cx - ux * first.r, ey = first.cy - uy * first.r;                              // router rim
    const hostAngle = lineAngle(ex, ey, sx, sy);

    const out: ConfigAnnotation[] = [];
    const at = (x1: number, y1: number, x2: number, y2: number, f: number) => ({
      x: Math.round(x1 + (x2 - x1) * f),
      y: Math.round(y1 + (y2 - y1) * f),
    });

    configs.filter((c) => c.type === 'intercept.v1').forEach((c, i) => {
      const p = at(D.x1, D.y1, D.x2, D.y2, ANNO_DIAL_FRAC + i * ANNO_FRAC_STEP);
      out.push({ id: c.id, side: 'dial', label: 'intercept', x: p.x, y: p.y, angle: dialAngle, solid });
    });
    configs.filter((c) => c.type === 'host.v1' || c.type === 'host.v2').forEach((c, i) => {
      // Step TOWARD the service (smaller frac) so a second host never drifts down the
      // connector onto the SERP card.
      const p = at(sx, sy, ex, ey, Math.max(0.05, ANNO_HOST_FRAC - i * ANNO_FRAC_STEP));
      out.push({ id: c.id, side: 'host', label: 'host', x: p.x, y: p.y, angle: hostAngle, solid });
    });
    return out;
  });

  /**
   * The full, entered names per node (a true reflection of the config), with a
   * generic fallback when empty. Reactive: identity/simple-service names are
   * write-through (live as the user types); the advanced service + host names are
   * persisted on Continue (the accepted in-step asymmetry). Router labels are NOT
   * here — each router node owns its label (see routerNodes()).
   */
  readonly rawLabels = computed<Record<string, string>>(() => {
    const identityName = this.state.identityDraft()().identityName.trim();
    const serviceName = (this.state.branch() === 'advanced'
      ? this.state.serviceAdvancedDraft()().serviceName
      : this.state.serviceSimpleDraft()().serviceName).trim();
    return {
      dialing: identityName || 'Identity',
      service: serviceName || 'Service',
    };
  });

  /** Truncated (ellipsised) labels the SVG renders — guaranteed within each
   *  node's safe width so a long name never breaks the layout. */
  readonly nodeLabels = computed<Record<string, string>>(() => {
    const raw = this.rawLabels();
    const out: Record<string, string> = {};
    for (const n of NODES) out[n.id] = truncateToWidth(raw[n.id] ?? n.label, n.labelMax);
    return out;
  });

  /** Core nodes to render — dialing identity + service (both always present). The
   *  hosting identity node is NOT here; it's a subordinate, simple-only node
   *  rendered separately (see showHostingNode / hostNode). */
  readonly visibleNodes = computed<MapNode[]>(() => [...NODES]);

  /** Arrows to render — the bind arrow exists only alongside the hosting node
   *  (simple branch with a host identity). Advanced has no bind arrow: the service
   *  is bound by the router (service↔router connector). */
  readonly visibleArrows = computed<MapArrow[]>(() =>
    this.showHostingNode() ? [...ARROWS] : ARROWS.filter((a) => a.id !== 'bind'),
  );

  /**
   * Live SOLID state for the NON-router parts, keyed to real state:
   * dialing→identity.saved, service→isComplete('service'); permission cards reflect
   * the actual created policy of that type (manual) or come into being with the
   * service (auto). Router nodes + their edges carry their OWN solidity per entry
   * (see routerNodes()) — a router solidifies with its entry.saved, independent of
   * the policy that authorizes it.
   */
  readonly solid = computed<Solidity>(() => {
    const identity = this.state.identityDraft()().saved;
    const service = this.state.isComplete('service');
    const hostPresent = this.showHostingNode();

    const variant = this.policyVariant();
    const created = this.state.policyStepDraft()().createdPolicies;
    const hasType = (t: PolicyType) => created.some((p) => p.type === t);
    // auto → the card's policy is auto-created with the service; manual → it exists
    // once the user has created that policy type; unset → never solid.
    const cardSolid = (t: PolicyType) =>
      variant === 'auto' ? service : variant === 'manual' ? hasType(t) : false;

    return {
      nodes: {
        dialing: identity,
        hosting: hostPresent && service, // solidifies with the service (when present)
        service,
      },
      cards: {
        'service-policy': cardSolid('service'),
        'router-policy': cardSolid('router'),
        serp: cardSolid('service-edge-router'),
      },
      arrows: {
        dial: identity && service,           // Dialing —dial→ Service
        bind: hostPresent && service,        // Hosting —bind→ Service (only when present)
      },
    };
  });
}
