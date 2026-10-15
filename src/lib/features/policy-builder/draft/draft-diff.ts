/**
 * DRAFT DIFF — what a draft changes, compared against the live world.
 *
 * No matching or status logic of its own: pair statuses come from resolve() (via
 * enumerateForService) and verdicts from layoutServiceView(), run on both worlds.
 * A service is AFFECTED when any of its pairs changes status on either track, or
 * any verdict field changes; `services` lists every affected one, with `changed`
 * saying whether its verdict moved. Verdicts are compared field by field, never by
 * display text.
 *
 * Pairs and services are compared over the ids present in BOTH worlds (a draft only
 * edits policies, so in practice that is all of them), in live-world order.
 *
 * SCOPED: only services the draft can reach (affected-services.ts), plus those with a
 * configuration line or a loosening, are resolved and laid out; every other service
 * provably has no pair or verdict change. `{ scope: 'all' }` diffs every service —
 * the guard spec checks the two agree. The live side (pairs and verdict per service)
 * is memoised in the live world's index, so an edit pays only for its draft side.
 *
 * PAIR-SCOPED: within a service, only the identities affectedPairs names are
 * re-resolved on the draft; every other pair keeps its live result, and the draft
 * verdict is recounted from those merged results (countVerdict). `{ scope: 'all' }`
 * re-resolves every pair too.
 */

import {
  enumerateForService,
  resolve,
  type ResolvedPair,
  type TrifectaStatus,
  type TrifectaWorld,
} from '../../authorization/trifecta-resolver';
import { indexFor } from '../../authorization/world-index';
import { countVerdict, layoutServiceView, type ServiceVerdict } from '../service-view.layout';
import { affectedFor, pairsFor, touchedBetween } from './affected-services';
import { configChanges, type ConfigChange } from './config-effects';
import { loosenings, type Loosening } from './loosening';

export type Track = 'dial' | 'bind';

export interface PairChange {
  identityId: string;
  serviceId: string;
  track: Track;
  before: TrifectaStatus;
  after: TrifectaStatus;
}

/** The structured part of a ServiceVerdict — no display text. */
export type VerdictFields = Pick<
  ServiceVerdict,
  'canConnect' | 'dialTotal' | 'hostsReachable' | 'hostsServing' | 'blockedByPosture' | 'reason'
>;

export interface ServiceVerdictChange {
  serviceId: string;
  verdictBefore: VerdictFields;
  verdictAfter: VerdictFields;
  /** Any field differs. */
  changed: boolean;
}

export interface DraftDiff {
  /** Status changes only, per track. */
  pairChanges: PairChange[];
  /** One entry per affected service, in live-world order. */
  services: ServiceVerdictChange[];
  /** Services with a pair change, a verdict change or a configuration change, in live-world order. */
  affectedServiceIds: string[];
  /** Configuration edits (posture checks, terminator strategy, hosting defaults) per
   *  service they reach — present even when no count moves. */
  configChanges: ConfigChange[];
  /** Created or changed policies that give already-covered identities a route with
   *  different or fewer posture checks. */
  loosenings: Loosening[];
}

const VERDICT_FIELDS = ['canConnect', 'dialTotal', 'hostsReachable', 'hostsServing', 'blockedByPosture', 'reason'] as const;

const verdictFields = (v: ServiceVerdict): VerdictFields => ({
  canConnect: v.canConnect,
  dialTotal: v.dialTotal,
  hostsReachable: v.hostsReachable,
  hostsServing: v.hostsServing,
  blockedByPosture: v.blockedByPosture,
  reason: v.reason,
});

const TRACK_STATUS: Record<Track, (p: ResolvedPair) => TrifectaStatus> = {
  dial: (p) => p.status,
  bind: (p) => p.bindStatus,
};

/** One world's side of a service: its pairs (and by identity) and verdict. */
interface ServiceSide {
  pairs: readonly ResolvedPair[];
  byIdentity: ReadonlyMap<string, ResolvedPair>;
  verdict: VerdictFields;
}

const sideOf = (serviceId: string, world: TrifectaWorld): ServiceSide => {
  const pairs = enumerateForService(serviceId, world);
  return {
    pairs,
    byIdentity: new Map(pairs.map((p) => [p.identityId, p])),
    verdict: verdictFields(layoutServiceView(serviceId, world).serviceVerdict),
  };
};

/** The live side of a service, memoised in the live world's index (a live world
 *  outlives many drafts). Exported so a caller can warm it ahead of edits. */
export function liveDiffSide(live: TrifectaWorld, serviceId: string): ServiceSide {
  return indexFor(live).memo(liveKey(serviceId), () => sideOf(serviceId, live));
}

const liveKey = (serviceId: string) => `diff:live:${serviceId}`;

/** Pair resolves per warm-up step: a few ms of work at full scale. */
const WARM_BATCH = 100;

/**
 * Warms liveDiffSide for every service, in small steps (background work: see
 * live-warmup.ts). Each step resolves up to `batch` of a service's pairs (memoised
 * in the index, so the side itself is then quick), or builds one service's side;
 * services already warm are skipped. Yields the services done so far.
 */
export function* warmLiveSteps(live: TrifectaWorld, batch = WARM_BATCH): Generator<number, void, void> {
  const ix = indexFor(live);
  let done = 0;
  for (const s of live.services) {
    if (!ix.hasMemo(liveKey(s.id))) {
      for (let i = 0; i < live.identities.length; i += batch) {
        for (const identity of live.identities.slice(i, i + batch)) resolve(identity.id, s.id, live);
        yield done;
      }
      liveDiffSide(live, s.id);
    }
    yield ++done;
  }
}

export interface DiffOptions {
  /** 'affected' (default): only services the draft can reach. 'all': every service. */
  scope?: 'affected' | 'all';
}

/** What a diff will look at: computed once, before any per-service work. */
export interface DiffPlan {
  config: ConfigChange[];
  looser: Loosening[];
  /** Services with a config line or a loosening — affected whatever their counts do. */
  alwaysAffected: ReadonlySet<string>;
  /** The services to diff, live order. */
  serviceIds: string[];
  /** Per service: the identities to re-resolve on the draft ('all' for every one). */
  candidates: (serviceId: string) => ReadonlySet<string> | 'all';
}

/** One service's part of the diff. */
export interface ServiceDiff {
  serviceId: string;
  pairChanges: PairChange[];
  verdictBefore: VerdictFields;
  verdictAfter: VerdictFields;
}

/** Step 1: config lines, loosenings and the services in scope. */
export function planDiff(live: TrifectaWorld, draft: TrifectaWorld, options: DiffOptions = {}): DiffPlan {
  const draftIx = indexFor(draft);
  const config = configChanges(live, draft);
  const looser = loosenings(live, draft);
  const alwaysAffected = new Set<string>([...config.map((c) => c.serviceId), ...looser.map((l) => l.serviceId)]);
  const inScope =
    options.scope === 'all' ? null : new Set([...affectedFor(touchedBetween(live, draft), live, draft), ...alwaysAffected]);
  const serviceIds = live.services
    .map((s) => s.id)
    .filter((id) => draftIx.service(id) && (!inScope || inScope.has(id)));
  const pairs = options.scope === 'all' ? null : pairsFor(touchedBetween(live, draft), live, draft);
  const none: ReadonlySet<string> = new Set();
  // In scope only for a config line or a loosening: no pair can change there.
  const candidates = (id: string) => (pairs ? (pairs.get(id) ?? none) : 'all');
  return { config, looser, alwaysAffected, serviceIds, candidates };
}

/**
 * Step 2, per service: pair status changes and both verdicts (live side cached).
 * Only `candidates` are re-resolved on the draft; the rest keep their live pairs, and
 * the draft verdict is recounted from the merged results.
 */
export function diffService(
  live: TrifectaWorld,
  draft: TrifectaWorld,
  serviceId: string,
  candidates: ReadonlySet<string> | 'all' = 'all',
): ServiceDiff {
  const draftIx = indexFor(draft);
  const liveSide = liveDiffSide(live, serviceId);
  const all = candidates === 'all';
  const after = (identityId: string) => (all || candidates.has(identityId) ? resolve(identityId, serviceId, draft) : liveSide.byIdentity.get(identityId)!);
  const pairChanges: PairChange[] = [];
  const scan = all ? liveSide.pairs : liveSide.pairs.filter((p) => candidates.has(p.identityId));
  for (const before of scan) {
    if (!draftIx.identity(before.identityId)) continue;
    const a = after(before.identityId);
    for (const track of ['dial', 'bind'] as const) {
      const b = TRACK_STATUS[track](before);
      const n = TRACK_STATUS[track](a);
      if (b !== n) pairChanges.push({ identityId: before.identityId, serviceId, track, before: b, after: n });
    }
  }
  const verdictAfter = verdictFields(
    countVerdict(serviceId, draft, (id, track) => TRACK_STATUS[track](liveSide.byIdentity.has(id) ? after(id) : resolve(id, serviceId, draft))),
  );
  return { serviceId, pairChanges, verdictBefore: liveSide.verdict, verdictAfter };
}

/** Step 3: the DraftDiff from the plan and every planned service's part, in plan order. */
export function assembleDiff(plan: DiffPlan, parts: readonly ServiceDiff[]): DraftDiff {
  const pairChanges: PairChange[] = [];
  const services: ServiceVerdictChange[] = [];
  for (const part of parts) {
    pairChanges.push(...part.pairChanges);
    const changed = VERDICT_FIELDS.some((f) => part.verdictBefore[f] !== part.verdictAfter[f]);
    if (part.pairChanges.length || changed || plan.alwaysAffected.has(part.serviceId)) {
      services.push({ serviceId: part.serviceId, verdictBefore: part.verdictBefore, verdictAfter: part.verdictAfter, changed });
    }
  }
  return {
    pairChanges,
    services,
    affectedServiceIds: services.map((s) => s.serviceId),
    configChanges: plan.config,
    loosenings: plan.looser,
  };
}

/** Progress through a diff: services done of those in scope. */
export interface DiffProgress {
  done: number;
  total: number;
}

/** The three steps as a generator — yields after each service; returns the diff. */
export function* diffSteps(live: TrifectaWorld, draft: TrifectaWorld): Generator<DiffProgress, DraftDiff, void> {
  const plan = planDiff(live, draft);
  const total = plan.serviceIds.length;
  yield { done: 0, total };
  const parts: ServiceDiff[] = [];
  for (const id of plan.serviceIds) {
    parts.push(diffService(live, draft, id, plan.candidates(id)));
    yield { done: parts.length, total };
  }
  return assembleDiff(plan, parts);
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Runs any step generator in time slices (`sliceMs` of work each), yielding to the
 * browser between them. Resolves with its result, or null once `cancelled()` turns
 * true (checked after every yield).
 */
export async function runChunked<P, R>(
  steps: Generator<P, R, void>,
  onProgress: (p: P) => void = () => undefined,
  cancelled: () => boolean = () => false,
  sliceMs = 12,
): Promise<R | null> {
  let sliceStart = performance.now();
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    onProgress(next.value);
    if (performance.now() - sliceStart >= sliceMs) {
      await yieldToBrowser();
      if (cancelled()) return null;
      sliceStart = performance.now();
    }
  }
}

/** The whole diff, synchronously: plan, every service, assemble. Panels and the
 *  review run the same steps in chunks instead (diffSteps + runChunked). */
export function diffWorlds(live: TrifectaWorld, draft: TrifectaWorld, options: DiffOptions = {}): DraftDiff {
  const plan = planDiff(live, draft, options);
  return assembleDiff(plan, plan.serviceIds.map((id) => diffService(live, draft, id, plan.candidates(id))));
}
