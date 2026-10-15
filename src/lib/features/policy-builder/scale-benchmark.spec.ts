/**
 * Engine benchmark on the scale world (authorization/scale-world.ts). Timing only —
 * the assertions check the work happened, never how fast; machines vary.
 *
 * OPT-IN: skipped unless SCALE_BENCH=1 (it takes minutes at full size):
 *   SCALE_BENCH=1 npx ng test --watch=false --include src/lib/features/policy-builder/scale-benchmark.spec.ts
 *
 * Steps under 5 s: median of 5 runs. Slower steps: one run, marked "single run".
 * Every run gets a fresh world object (`cold()`), so the world index and its memos
 * start empty — the numbers are cold costs, never cache hits.
 * applyDraft + diffWorlds is timed on a 500-identity / 50-service world only, next to
 * an estimate for full size (2 × all-pairs + 2 × services × mean layout).
 *
 * Scoped diff: three edits at full size — a cold draft world each, against a live
 * world whose diff side is already cached (as a long-lived live world's would be);
 * single runs, with the affected service count.
 *
 * Interactive vs review: the same three edits, timing what runs on each change
 * (applyDraft, affectedServices, the 4-service canvas layout on the draft) and, apart,
 * the async review checks (runChecks) from start to completion.
 */

import { entityMatchesRoles } from '../authorization/authorization-resolver';
import { buildScaleWorld } from '../authorization/scale-world';
import { enumerateForService, resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import { evaluateTests } from './access-tests';
import { diffWorlds, liveDiffSide } from './draft/draft-diff';
import { affectedServices } from './draft/affected-services';
import { runChecks } from './draft/draft-checks';
import type { DraftOp } from './draft/policy-draft';
import { applyDraft } from './draft/policy-draft';
import { validateTerminators } from './hosting';
import { layoutMultiServiceView } from './multi-service.layout';
import { layoutServiceView } from './service-view.layout';

const ENABLED = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['SCALE_BENCH'] === '1';
const RUNS = 5;
const SLOW_MS = 5000;

interface Row {
  label: string;
  ms: number;
  note: string;
}

/** Median of RUNS — unless the first run is already slow: then that run alone. */
function measure<T>(fn: () => T): { ms: number; single: boolean; result: T } {
  let t0 = performance.now();
  let result = fn();
  const first = performance.now() - t0;
  if (first >= SLOW_MS) return { ms: first, single: true, result };
  const times = [first];
  for (let i = 1; i < RUNS; i++) {
    t0 = performance.now();
    result = fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { ms: times[Math.floor(RUNS / 2)], single: false, result };
}

/** A new world object with the same collections: its index (and memos) start empty. */
const cold = (w: TrifectaWorld): TrifectaWorld => ({ ...w });

const policiesCovering = (w: TrifectaWorld, serviceId: string) => {
  const s = w.services.find((x) => x.id === serviceId)!;
  return w.policies.filter((p) => entityMatchesRoles(p.serviceRoles, p.semantic, s.attributes ?? [], s.name, s.id));
};

/** The service the most service policies select. */
export function mostCovered(w: TrifectaWorld): { id: string; n: number } {
  return w.services.map((s) => ({ id: s.id, n: policiesCovering(w, s.id).length })).reduce((a, b) => (b.n > a.n ? b : a));
}

const oneEdit = (w: TrifectaWorld, serviceId: string) => {
  const edited = policiesCovering(w, serviceId).find((p) => p.type === 'dial')!;
  return () => {
    const live = cold(w);
    return diffWorlds(live, applyDraft(live, [{ kind: 'update', policyId: edited.id, patch: { identityRoles: [...edited.identityRoles, '#team-00'] } }]));
  };
};

describe.skipIf(!ENABLED)('scale benchmark (SCALE_BENCH=1)', () => {
  it('times the engine on the scale world', () => {
    const rows: Row[] = [];
    const time = <T>(label: string, fn: () => T, note = ''): T => {
      const { ms, single, result } = measure(fn);
      rows.push({ label, ms, note: [single ? 'single run' : `median of ${RUNS}`, note].filter(Boolean).join('; ') });
      return result;
    };

    const world = time('buildScaleWorld', () => buildScaleWorld());
    expect(world.identities).toHaveLength(3000);

    const pairs = time(`resolve all pairs (${world.identities.length} × ${world.services.length})`, () => {
      let dial = 0;
      const w = cold(world);
      for (const i of w.identities) for (const s of w.services) if (resolve(i.id, s.id, w).dial.authorized) dial++;
      return dial;
    });
    const allPairsMs = rows[rows.length - 1].ms;

    const top = mostCovered(world);
    const others = world.services
      .filter((s) => s.id !== top.id)
      .map((s) => ({ id: s.id, n: policiesCovering(world, s.id).length }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((c) => c.id);

    time(`enumerateForService (${top.id})`, () => enumerateForService(top.id, cold(world)));
    time(`layoutServiceView (${top.id}, ${top.n} policies)`, () => layoutServiceView(top.id, cold(world)));
    time('layoutMultiServiceView (4 services)', () => layoutMultiServiceView(top.id, others, cold(world)));

    // applyDraft + diffWorlds: measured small, estimated full.
    const small = buildScaleWorld(1, { identities: 500, services: 50 });
    const smallTop = mostCovered(small);
    const diff = time('applyDraft + diffWorlds (500 identities × 50 services)', oneEdit(small, smallTop.id));
    const sample = world.services.filter((_, i) => i % 20 === 0); // 10 services
    const t0 = performance.now();
    for (const s of sample) layoutServiceView(s.id, cold(world));
    const meanLayout = (performance.now() - t0) / sample.length;
    const estimate = 2 * allPairsMs + 2 * world.services.length * meanLayout;
    rows.push({
      label: 'applyDraft + diffWorlds (3,000 × 200), ESTIMATE',
      ms: estimate,
      note: `2 × all pairs + 2 × 200 × ${meanLayout.toFixed(0)} ms mean layout (10-service sample); not run`,
    });

    const tests = time('evaluateTests', () => evaluateTests(cold(world)));
    const issues = time('validateTerminators', () => validateTerminators(cold(world)));

    const table = [
      '| step | ms | how |',
      '|---|---:|---|',
      ...rows.map((r) => `| ${r.label} | ${r.ms.toFixed(1)} | ${r.note} |`),
    ].join('\n');
    const report = `\nSCALE BENCHMARK\n${table}\n(dial-authorized pairs: ${pairs}; small diff touched ${diff.affectedServiceIds.length} services)\n`;
    // The test runner swallows console output; stdout gets through.
    const stdout = (globalThis as { process?: { stdout?: { write(s: string): void } } }).process?.stdout;
    if (stdout) stdout.write(report);
    else console.log(report);

    expect(issues).toEqual([]);
    expect(tests).toHaveLength(10);
  }, 1_800_000);

  it('scoped diff at full size: cold draft, warm live', () => {
    const live = buildScaleWorld();
    const out = (globalThis as { process?: { stdout?: { write(s: string): void } } }).process?.stdout;
    const say = (line: string) => (out ? out.write(line + '\n') : console.log(line));

    let t0 = performance.now();
    for (const s of live.services) liveDiffSide(live, s.id);
    const warm = performance.now() - t0;

    const commonest = (values: readonly string[]) => {
      const n = new Map<string, number>();
      for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
      return [...n.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
    };
    const [serviceAttr, serviceAttrN] = commonest(live.services.flatMap((s) => s.attributes ?? []));
    const [identityAttr, identityAttrN] = commonest(live.identities.flatMap((i) => i.attributes));
    const policy = (id: string, identityRoles: string[], serviceRoles: string[]): DraftOp => ({
      kind: 'create',
      policy: { id, name: id, createdAt: '', status: 'active', type: 'dial', semantic: 'AnyOf', identityRoles, serviceRoles, postureCheckRoles: [] },
    });
    const erp = live.edgeRouterPolicies[1];

    const scenarios: [string, DraftOp[]][] = [
      ['(a) named-identity policy on one service', [policy('bench-a', [`@${live.identities[1].name}`], [`@${live.services[5].id}`])]],
      [`(b) attribute policy on ${serviceAttr} (on ${serviceAttrN} services)`, [policy('bench-b', ['#team-10'], [serviceAttr])]],
      [`(c) ERP ${erp.id} edited to ${identityAttr} (on ${identityAttrN} identities)`, [{ kind: 'update', target: 'edgeRouterPolicy', policyId: erp.id, patch: { identityRoles: [identityAttr] } }]],
    ];

    const rows: string[] = [];
    for (const [label, ops] of scenarios) {
      t0 = performance.now();
      const draft = applyDraft(live, ops); // a new world: cold index
      const affected = affectedServices(ops, live, draft).length;
      const diff = diffWorlds(live, draft);
      const ms = performance.now() - t0;
      rows.push(`| ${label} | ${affected} | ${ms.toFixed(1)} | single run |`);
      expect(diff.services.length).toBeLessThanOrEqual(affected + diff.configChanges.length + diff.loosenings.length);
    }
    say(`\nSCOPED DIFF (3,000 identities × 200 services; live side warmed in ${warm.toFixed(0)} ms)\n| edit | affected services | ms | how |\n|---|---:|---:|---|\n${rows.join('\n')}\n`);
  }, 1_800_000);

  it('interactive vs review: sync per edit, async to completion', async () => {
    const live = buildScaleWorld();
    const out = (globalThis as { process?: { stdout?: { write(s: string): void } } }).process?.stdout;
    const say = (line: string) => (out ? out.write(line + '\n') : console.log(line));
    for (const s of live.services) liveDiffSide(live, s.id); // a long-lived live world: warm

    const commonest = (values: readonly string[]) => {
      const n = new Map<string, number>();
      for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
      return [...n.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    };
    const serviceAttr = commonest(live.services.flatMap((s) => s.attributes ?? []));
    const identityAttr = commonest(live.identities.flatMap((i) => i.attributes));
    const policy = (id: string, identityRoles: string[], serviceRoles: string[]): DraftOp => ({
      kind: 'create',
      policy: { id, name: id, createdAt: '', status: 'active', type: 'dial', semantic: 'AnyOf', identityRoles, serviceRoles, postureCheckRoles: [] },
    });
    const erp = live.edgeRouterPolicies[1];
    const withAttr = live.services.filter((s) => s.attributes?.includes(serviceAttr)).map((s) => s.id);
    const top = mostCovered(live).id;

    // Canvas: the service the edit is about, plus three more.
    const scenarios: [string, DraftOp[], string[]][] = [
      ['(a) named-identity policy on one service', [policy('bench-a', [`@${live.identities[1].name}`], [`@${live.services[5].id}`])], [live.services[5].id, ...withAttr.slice(0, 3)]],
      [`(b) attribute policy on ${serviceAttr}`, [policy('bench-b', ['#team-10'], [serviceAttr])], withAttr.slice(0, 4)],
      [`(c) ERP ${erp.id} edited to ${identityAttr}`, [{ kind: 'update', target: 'edgeRouterPolicy', policyId: erp.id, patch: { identityRoles: [identityAttr] } }], [top, ...withAttr.filter((id) => id !== top).slice(0, 3)]],
    ];

    const rows: string[] = [];
    for (const [label, ops, canvas] of scenarios) {
      let t0 = performance.now();
      const draft = applyDraft(live, ops); // cold draft world
      const affected = affectedServices(ops, live, draft).length;
      layoutMultiServiceView(canvas[0], canvas.slice(1), draft);
      const sync = performance.now() - t0;

      t0 = performance.now();
      const result = await runChecks(live, draft);
      const asyncMs = performance.now() - t0;
      expect(result).not.toBeNull();
      rows.push(`| ${label} | ${affected} | ${sync.toFixed(1)} | ${asyncMs.toFixed(1)} |`);
    }
    say(`\nINTERACTIVE vs REVIEW (3,000 × 200; 4 services on the canvas; live warm; single runs)\n| edit | affected services | sync per edit (ms) | async checks to completion (ms) |\n|---|---:|---:|---:|\n${rows.join('\n')}\n`);
  }, 1_800_000);
});
