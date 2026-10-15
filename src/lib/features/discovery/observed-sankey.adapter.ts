/**
 * Observed-traffic → generic-Sankey adapter (DATA ONLY, no rendering).
 *
 * Converts observed `DiscoveredFlow[]` into the shared SankeyChartComponent's
 * generic node/link shape as a CIDR-FIRST 3-STAGE structure:
 *
 *   0 = CIDR block (/24) → 1 = source host (IP) → 2 = destination
 *
 * This is the observed reality: an operator points discovery at CIDR /24 blocks of
 * mostly-unknown hosts, watches which specific source IPs light up, and sees where
 * each dials. Grouping sources under their subnets is the key legibility win over
 * the old flat Source→Protocol→Destination shape.
 *
 * Port is NOT its own column and NOT the middle stage — a literal "IP:port" middle
 * would be roughly one node per flow, which is not legible. The dialed intercept
 * port folds into the SOURCE node's tooltip instead; protocol/port fold into the
 * DESTINATION node's tooltip.
 *
 * SCALE, stated plainly: this was tuned for the discovery capture alone (6 / 27 /
 * 24 nodes), and the middle column was the binding constraint even then. It now
 * renders the capture PLUS the managed estate's own traffic, so the source column
 * is several times that and the chart is correspondingly tall. That was a
 * deliberate call — the map is meant to show the whole estate — but this is the
 * stage to revisit first if the picture stops being readable, and the honest fix
 * is a stage-0 roll-up or a filter, not smaller type.
 *
 * Weighted by `circuitCount` — the REAL observed magnitude. The chart stays
 * generic: this file only imports the two interface TYPES from it
 * (SankeyChartNode/SankeyChartLink) — never d3, the component, or any layout code.
 */

import type {
  SankeyChartNode,
  SankeyChartLink,
  SankeyNodeClickEvent,
  SankeyLinkClickEvent,
} from '../../shared/components/sankey-chart/sankey-chart.component';
import type { DiscoveredFlow } from './discovery.models';

export interface ObservedSankeyData {
  nodes: SankeyChartNode[];
  links: SankeyChartLink[];
  headers: string[];
}

/**
 * The flows behind a clicked Sankey element, plus display strings. The resolver
 * (below) owns ALL id/`${stage}:${value}` + cidr24Of knowledge, so the consumer
 * never parses node ids or re-derives CIDRs — it just opens a drawer with this.
 */
export interface ResolvedElement {
  kind: 'cidr' | 'source' | 'destination' | 'ribbon';
  /** The element's name — the raw value, or "source → dest" for a ribbon. */
  title: string;
  /** "<Kind> · N flows" — the drawer sub-line. */
  subtitle: string;
  flows: DiscoveredFlow[];
}

/** Stage-qualified node id — `${stageIndex}:${value}` — so a CIDR, an IP, and a
 *  host:port that stringify differently never collide across columns. */
function nodeId(stageIndex: number, value: string): string {
  return `${stageIndex}:${value}`;
}

/** Derive the /24 block for an IP: first three octets + `.0/24`. */
function cidr24Of(ip: string): string {
  return ip.split('.').slice(0, 3).join('.') + '.0/24';
}

/** The dialed intercept port = the `:port` suffix of `destinationHostPort`
 *  (NOT egressPort — the intercept side, per prior decision). */
function portOf(hostPort: string): string {
  const i = hostPort.lastIndexOf(':');
  return i > 0 ? hostPort.slice(i + 1) : '';
}

/**
 * Build the CIDR-first observed-traffic Sankey data from raw flows. PURE — no
 * Angular, no signals, no d3.
 *
 * Each flow walks CIDR block → source host → destination; it contributes its
 * `circuitCount` to one node per stage and one link per transition. Nodes and
 * links are aggregated (distinct per stage / per source-target pair), summing
 * circuitCount, so all the hosts in a /24 collapse under one block node and many
 * flows from one host to one destination collapse into one band.
 *
 * ENROLLMENT: a source is enrolled iff its `dialingIdentityId` is in `enrolledIds`
 * (the shared derived set — resolves to a real Identity). The adapter stays PURE:
 * the caller passes the set in rather than the adapter reaching into a service.
 * Unenrolled source (middle) nodes get `kind: 'unenrolled'` (→ .node-kind-unenrolled)
 * and are labelled by IP; enrolled ones get no kind and are labelled by name.
 * CIDR and destination nodes never get the unenrolled kind — a subnet is not a
 * source, and a destination is the far side.
 *
 * Missing/empty required fields are a step-zero data bug, so we THROW rather than
 * invent an 'unknown' node — the mock guarantees every flow carries all fields.
 */
export function buildObservedSankeyData(
  flows: readonly DiscoveredFlow[],
  enrolledIds: ReadonlySet<string>,
): ObservedSankeyData {
  // Per-node aggregates gathered in one pass, so tooltips that need whole-column
  // facts (a block's host count, a source's distinct ports) can be built after.
  interface CidrAgg {
    cidr: string;
    hosts: Set<string>;
    circuits: number;
  }
  interface SourceAgg {
    ip: string;
    identityId: string;
    name: string;
    enrolled: boolean;
    ports: Set<string>;
    circuits: number;
  }
  const cidrAgg = new Map<string, CidrAgg>();
  const sourceAgg = new Map<string, SourceAgg>();
  const destNode = new Map<string, SankeyChartNode>();

  // link accumulator keyed by `${sourceId}->${targetId}`
  const linkMap = new Map<string, SankeyChartLink>();
  const addLink = (sourceNodeId: string, targetNodeId: string, weight: number): void => {
    const id = `${sourceNodeId}->${targetNodeId}`;
    const existing = linkMap.get(id);
    if (existing) existing.weight += weight;
    else linkMap.set(id, { id, sourceNodeId, targetNodeId, weight });
  };

  for (const f of flows) {
    // ── validate required fields (a missing one is a step-zero mock bug) ──
    const ip = f.ingressIp?.trim() || '';
    const dest = f.destinationHostPort?.trim() || '';
    const protocol = f.appProtocol ?? '';
    if (!ip) throw new Error(`Flow ${f.id}: missing ingressIp (source stage).`);
    if (!dest) throw new Error(`Flow ${f.id}: missing destinationHostPort (destination stage).`);
    const port = portOf(dest);
    if (!port) throw new Error(`Flow ${f.id}: destinationHostPort "${dest}" has no port.`);

    const w = f.circuitCount;
    const cidr = cidr24Of(ip);
    const enrolled = f.dialingIdentityId != null && enrolledIds.has(f.dialingIdentityId);

    // ── stage 0: CIDR block ──
    let cb = cidrAgg.get(cidr);
    if (!cb) cidrAgg.set(cidr, (cb = { cidr, hosts: new Set(), circuits: 0 }));
    cb.hosts.add(ip);
    cb.circuits += w;

    // ── stage 1: source host (IP) ──
    let sa = sourceAgg.get(ip);
    if (!sa)
      sourceAgg.set(
        ip,
        (sa = {
          ip,
          // Opaque node key: null identity id (unenrolled) falls back to ingressIp.
          identityId: f.dialingIdentityId ?? f.ingressIp,
          // known → real name; unknown → the IP (mirrors the table's known/IP rule)
          name: enrolled ? f.dialingIdentityName?.trim() || ip : ip,
          enrolled,
          ports: new Set(),
          circuits: 0,
        }),
      );
    sa.ports.add(port);
    sa.circuits += w;

    // ── stage 2: destination (title folds protocol · port · gateway) ──
    const destId = nodeId(2, dest);
    let dn = destNode.get(destId);
    if (!dn) {
      const destTitle = `${dest} · ${protocol || 'tcp'} · ${port} · ${f.egressEntityName} (gateway)`;
      destNode.set(destId, (dn = { id: destId, stageIndex: 2, label: dest, weight: 0, title: destTitle }));
    }
    dn.weight = (dn.weight ?? 0) + w;

    // ── links: CIDR → source, source → destination ──
    addLink(nodeId(0, cidr), nodeId(1, ip), w);
    addLink(nodeId(1, ip), destId, w);
  }

  // ── materialise nodes with whole-column tooltips ──
  const nodes: SankeyChartNode[] = [];

  for (const cb of cidrAgg.values()) {
    nodes.push({
      id: nodeId(0, cb.cidr),
      stageIndex: 0,
      label: cb.cidr,
      weight: cb.circuits,
      title: `${cb.cidr} · ${cb.hosts.size} source ${cb.hosts.size === 1 ? 'host' : 'hosts'} · ${cb.circuits} circuits`,
    });
  }

  for (const sa of sourceAgg.values()) {
    const ports = [...sa.ports].sort((a, b) => Number(a) - Number(b)).join(', ');
    const title = sa.enrolled
      ? `${sa.ip} · ${sa.name} (managed) · ports ${ports}`
      : `${sa.ip} · unmanaged · ports ${ports}`;
    nodes.push({
      id: nodeId(1, sa.ip),
      stageIndex: 1,
      label: sa.name,
      weight: sa.circuits,
      title,
      ...(sa.enrolled ? {} : { kind: 'unenrolled' }),
    });
  }

  nodes.push(...destNode.values());

  return {
    nodes,
    links: [...linkMap.values()],
    headers: ['CIDR block', 'Source host', 'Destination'],
  };
}

// ─── click → flows resolution (comprehension-only drawer) ─────────────────────
// Two resolvers rather than one union-input fn: node and link clicks carry
// genuinely different payloads (a node has one id + stage; a link has a
// source/target pair), so a single signature would force awkward optional fields.
// Both keep every id-parsing + CIDR rule INSIDE this file — the consumer stays
// oblivious to the `${stage}:${value}` convention.

/** Recover the raw value a node id encodes. `${stageIndex}:${value}` has a
 *  single-digit stage prefix, so the first colon splits it; a destination's own
 *  colon (host:port) is preserved because indexOf finds only the first. */
function valueOf(nodeId: string): string {
  return nodeId.slice(nodeId.indexOf(':') + 1);
}

/** Resolve a NODE click to the flows behind it (CIDR block / source / destination). */
export function flowsForNode(
  flows: readonly DiscoveredFlow[],
  ev: SankeyNodeClickEvent,
): ResolvedElement {
  const value = valueOf(ev.nodeId);
  switch (ev.stageIndex) {
    case 0: {
      const matched = flows.filter((f) => cidr24Of(f.ingressIp) === value);
      return { kind: 'cidr', title: value, subtitle: `CIDR block · ${matched.length} flows`, flows: matched };
    }
    case 1: {
      const matched = flows.filter((f) => f.ingressIp === value);
      // Header must match the rows / app-wide convention: enrolled → real name,
      // unenrolled → IP. The flows already carry that exact label in
      // `dialingIdentityName` (the enrolled name for enrolled sources, the IP for
      // unenrolled per the CIDR-first mock), so reuse it — header === row by
      // construction. Fall back to the IP if (defensively) no flow matched.
      const title = matched[0]?.dialingIdentityName ?? value;
      return { kind: 'source', title, subtitle: `Source host · ${matched.length} flows`, flows: matched };
    }
    default: {
      const matched = flows.filter((f) => f.destinationHostPort === value);
      return { kind: 'destination', title: value, subtitle: `Destination · ${matched.length} flows`, flows: matched };
    }
  }
}

/** Resolve a LINK (ribbon) click to the flows behind it. The source node's stage
 *  distinguishes the two transitions: `0:` = CIDR→source, `1:` = source→dest. */
export function flowsForLink(
  flows: readonly DiscoveredFlow[],
  ev: SankeyLinkClickEvent,
): ResolvedElement {
  const srcValue = valueOf(ev.sourceNodeId);
  const tgtValue = valueOf(ev.targetNodeId);
  // CIDR→source ribbon: target is the source IP, which alone pins the flows
  // (its /24 is implied). source→destination ribbon: match both IP and dest.
  const isCidrToSource = ev.sourceNodeId.startsWith('0:');
  const matched = isCidrToSource
    ? flows.filter((f) => f.ingressIp === tgtValue)
    : flows.filter((f) => f.ingressIp === srcValue && f.destinationHostPort === tgtValue);
  return {
    kind: 'ribbon',
    title: `${srcValue} → ${tgtValue}`,
    subtitle: `Flow · ${matched.length} flows`,
    flows: matched,
  };
}
