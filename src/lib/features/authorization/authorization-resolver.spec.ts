/**
 * Headless verify harness for the DIAL authorization resolver (no UI).
 *
 * Runs the real resolver over the labeled post-discovery fixtures, DUMPS the pair
 * list + segment grid + segment nodes to the console (run `npx ng test` and read
 * output), and asserts the things to eyeball. FIRST-INCREMENT checks:
 *   (a) AllOf resolves STRICTER than AnyOf  — ops3 (no #mfa-verified) is excluded
 *   (b) '#all' fans out                     — break-glass reaches every service
 *   (c) the isolated pair shows 'none'      — plant→secrets (and bind is ignored)
 *   (d) a partial segment: authorizedCount < totalCount — admin→secrets is 2/3
 * SECOND-INCREMENT checks:
 *   (e) CONSERVATION — sum of segmentEdge.authorizedCount === total pairs (nothing
 *       dropped in roll-up; the old roll-up violated this)
 *   (f) ungrouped catch-all — break-glass→api is a real edge in the '#ungrouped'
 *       row/column
 *   (g) zeroEdgeReason — guest is 'isolated', legacy is 'unresolvable'
 */

import {
  FIXTURE_IDENTITIES,
  FIXTURE_SERVICES,
  FIXTURE_POLICIES,
  FIXTURE_IDENTITY_SEGMENT_ATTR,
  FIXTURE_SERVICE_SEGMENT_ATTR,
} from './authorization.fixtures';
import {
  resolveDialAuthorizations,
  resolveDialAuthorizationGraph,
  rollUpSegments,
  UNGROUPED_SEGMENT,
  type SegmentNode,
} from './authorization-resolver';

describe('dial authorization resolver — cross-join + segment roll-up', () => {
  const { pairs, segmentEdges, segmentNodes } = resolveDialAuthorizationGraph(
    FIXTURE_IDENTITIES,
    FIXTURE_SERVICES,
    FIXTURE_POLICIES,
    FIXTURE_IDENTITY_SEGMENT_ATTR,
    FIXTURE_SERVICE_SEGMENT_ATTR,
  );

  const edge = (from: string, to: string) =>
    segmentEdges.find((e) => e.fromSegment === from && e.toSegment === to);
  const node = (side: SegmentNode['side'], segment: string) =>
    segmentNodes.find((n) => n.side === side && n.segment === segment);
  const hasPair = (identityName: string, serviceName: string) =>
    pairs.some((p) => p.identityName === identityName && p.serviceName === serviceName);

  it('DUMP — pairs, segment grid, and segment nodes (inspect this)', () => {
    // Pair list.
    // eslint-disable-next-line no-console
    console.log(`\n===== AUTHORIZED PAIRS (${pairs.length}) — dial ground truth =====`);
    // eslint-disable-next-line no-console
    console.table(
      pairs.map((p) => ({ identity: p.identityName, service: p.serviceName, by: p.authorizedBy.join(', ') })),
    );

    // Segment grid: identity segments (rows) × service segments (cols).
    const rows = [...new Set(segmentEdges.map((e) => e.fromSegment))];
    const cols = [...new Set(segmentEdges.map((e) => e.toSegment))];
    const short = (s: string) => s.replace('#discovered-group-', '').replace('#discovered-svc-', '').replace('#', '');
    const grid = rows.map((r) => {
      const cell: Record<string, string> = {};
      for (const c of cols) {
        const e = edge(r, c)!;
        cell[short(c)] = `${e.state} ${e.authorizedCount}/${e.totalCount}`;
      }
      return { 'identity ↓ / service →': short(r), ...cell };
    });
    // eslint-disable-next-line no-console
    console.log(`\n===== SEGMENT GRID (${rows.length}×${cols.length}) =====`);
    // eslint-disable-next-line no-console
    console.table(grid);

    // Segment nodes with catch-all flag + zero-edge reason.
    // eslint-disable-next-line no-console
    console.log(`\n===== SEGMENT NODES (${segmentNodes.length}) — catch-all + zero-edge reason =====`);
    // eslint-disable-next-line no-console
    console.table(
      segmentNodes.map((n) => ({
        side: n.side,
        segment: n.segment,
        ungrouped: n.isUngrouped,
        members: n.memberCount,
        edges: n.authorizedEdgeCount,
        zeroEdgeReason: n.zeroEdgeReason ?? '—',
      })),
    );
    // eslint-disable-next-line no-console
    console.log('');

    expect(pairs.length).toBeGreaterThan(0);
    expect(segmentEdges.length).toBeGreaterThan(0);
    expect(segmentNodes.length).toBeGreaterThan(0);
  });

  // (a) AllOf is STRICTER than AnyOf ------------------------------------------------
  it('(a) AllOf excludes ops3 (missing #mfa-verified); AnyOf would include it', () => {
    expect(hasPair('admin-ws-ops1', 'vault')).toBe(true);
    expect(hasPair('admin-ws-ops2', 'vault')).toBe(true);
    expect(hasPair('admin-ws-ops3', 'vault')).toBe(false);

    const anyOfPolicies = FIXTURE_POLICIES.map((p) =>
      p.id === 'auth-pol-admin-secrets' ? { ...p, semantic: 'AnyOf' as const } : p,
    );
    const anyOfPairs = resolveDialAuthorizations(FIXTURE_IDENTITIES, FIXTURE_SERVICES, anyOfPolicies);
    expect(anyOfPairs.some((p) => p.identityName === 'admin-ws-ops3' && p.serviceName === 'vault')).toBe(true);
  });

  // (b) '#all' fans out -------------------------------------------------------------
  it("(b) '#all' + '@'-ref: break-glass root reaches every service", () => {
    const bg = pairs.filter((p) => p.identityName === 'breakglass-root');
    expect(bg.length).toBe(FIXTURE_SERVICES.length);
    for (const p of bg) expect(p.authorizedBy).toContain('auth-pol-breakglass-all');
  });

  // (c) isolation shows 'none'; the BIND policy is ignored --------------------------
  it("(c) plant→secrets is 'none' (bind policy correctly ignored)", () => {
    const e = edge('#discovered-group-plant', '#discovered-svc-secrets');
    expect(e?.state).toBe('none');
    expect(e?.authorizedCount).toBe(0);
    expect(hasPair('plc-gw-line1', 'vault')).toBe(false);
    expect(pairs.every((p) => !p.authorizedBy.includes('auth-pol-plant-bind-secrets'))).toBe(true);
    expect(segmentEdges.some((e2) => e2.state === 'none')).toBe(true);
  });

  // (d) partial segment: authorizedCount < totalCount -------------------------------
  it('(d) admin→secrets is partial: 2 of 3 authorized', () => {
    expect(edge('#discovered-group-admin', '#discovered-svc-secrets')).toMatchObject({
      state: 'partial',
      authorizedCount: 2,
      totalCount: 3,
    });
  });

  // Full segments (sanity) ----------------------------------------------------------
  it('full segments: eng→devtools (9/9) and plant→ot (6/6)', () => {
    expect(edge('#discovered-group-eng', '#discovered-svc-devtools')).toMatchObject({ state: 'full', authorizedCount: 9, totalCount: 9 });
    expect(edge('#discovered-group-plant', '#discovered-svc-ot')).toMatchObject({ state: 'full', authorizedCount: 6, totalCount: 6 });
  });

  // (e) CONSERVATION — nothing dropped in the roll-up -------------------------------
  it('(e) sum of segmentEdge.authorizedCount === total authorized pairs', () => {
    const rolledUp = segmentEdges.reduce((n, e) => n + e.authorizedCount, 0);
    expect(rolledUp).toBe(pairs.length);
  });

  // (f) ungrouped catch-all makes the roll-up total ---------------------------------
  it("(f) break-glass→api is a real edge in the '#ungrouped' row/column", () => {
    // Both endpoints are ungrouped: break-glass (no group tag) and api (no svc tag).
    expect(hasPair('breakglass-root', 'app-api-prod')).toBe(true);
    const e = edge(UNGROUPED_SEGMENT, UNGROUPED_SEGMENT);
    expect(e).toBeDefined();
    expect(e!.authorizedCount).toBeGreaterThanOrEqual(1);
    expect(node('identity', UNGROUPED_SEGMENT)?.isUngrouped).toBe(true);
    expect(node('service', UNGROUPED_SEGMENT)?.isUngrouped).toBe(true);
    // api sits in the ungrouped service column, not its own segment.
    expect(node('service', UNGROUPED_SEGMENT)?.memberIds).toContain('auth-svc-api');
  });

  // (g) zeroEdgeReason — isolated vs unresolvable -----------------------------------
  it("(g) guest is 'isolated' (matchable, no edge); legacy is 'unresolvable' (no policy)", () => {
    const guest = node('identity', '#discovered-group-guest');
    expect(guest?.authorizedEdgeCount).toBe(0);
    expect(guest?.zeroEdgeReason).toBe('isolated');

    const legacy = node('identity', '#discovered-group-legacy');
    expect(legacy?.authorizedEdgeCount).toBe(0);
    expect(legacy?.zeroEdgeReason).toBe('unresolvable');

    // The ungrouped-identity segment is NOT zero-edge (break-glass reaches services),
    // so it carries no reason — even though the untagged orphan inside it is unmatchable.
    const ungroupedId = node('identity', UNGROUPED_SEGMENT);
    expect(ungroupedId?.authorizedEdgeCount).toBeGreaterThan(0);
    expect(ungroupedId?.zeroEdgeReason).toBeNull();
    expect(ungroupedId?.memberIds).toContain('auth-orphan');

    // Non-zero-edge segments never carry a reason.
    for (const n of segmentNodes) {
      if (n.authorizedEdgeCount > 0) expect(n.zeroEdgeReason).toBeNull();
      else expect(n.zeroEdgeReason).not.toBeNull();
    }
  });

  // Direct rollUpSegments call (signature now takes policies) ------------------------
  it('roll-up dimensions: 6 identity × 4 service segments; ungrouped pinned last', () => {
    const { edges, nodes } = rollUpSegments(
      FIXTURE_IDENTITIES,
      FIXTURE_SERVICES,
      FIXTURE_POLICIES,
      pairs,
      FIXTURE_IDENTITY_SEGMENT_ATTR,
      FIXTURE_SERVICE_SEGMENT_ATTR,
    );
    const rows = [...new Set(edges.map((e) => e.fromSegment))];
    const cols = [...new Set(edges.map((e) => e.toSegment))];
    expect(rows.length).toBe(6);
    expect(cols.length).toBe(4);
    expect(edges.length).toBe(24);
    expect(nodes.length).toBe(10);
    // Ungrouped catch-all sorts last on each axis.
    expect(rows[rows.length - 1]).toBe(UNGROUPED_SEGMENT);
    expect(cols[cols.length - 1]).toBe(UNGROUPED_SEGMENT);
  });
});
