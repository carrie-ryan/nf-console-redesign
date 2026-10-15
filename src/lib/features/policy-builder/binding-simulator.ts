/**
 * DEMO — SIMULATED BINDING. After a commit, real hosts' tunnelers bind the services
 * they are now allowed to host; here, BIND_DELAY_MS after it (by the demo clock), on
 * the services the commit can affect (affectedServices):
 *
 *   start — each host that is now ready (Bind-authorized, an online router it shares
 *           with the service, Bind posture passed) but wasn't before the commit, and
 *           has no terminator for the service, gets ONE terminator on its first online
 *           shared router (precedence 'default', cost 0);
 *   stop  — terminators that no longer validate (validateTerminators: the host lost
 *           its authorization, or the router is no longer shared) are removed.
 *
 * Only hosts the commit made ready bind: an authorized host that was already idle
 * before stays idle (its tunneler is presumably down) — the seed's idle hosts keep
 * their story. Terminators stay observed state (MockDataService.terminators, never a
 * draft target). Each run is recorded in History under "Ziti" ("6 hosts started
 * serving gitlab-internal") as an observed entry: nothing to revert.
 *
 * The Demo panel's "Hosts bind after commit" toggle (`enabled`) turns it off: commits
 * then leave hosts waiting. Advancing the demo clock runs whatever has come due.
 */

import { Injectable, inject, signal } from '@angular/core';
import { MockDataService, type Terminator } from '../../shared/services/mock-data.service';
import { resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import { indexFor } from '../authorization/world-index';
import { affectedServices } from './draft/affected-services';
import { PolicyDraftStore, type CommitEvent } from './draft/policy-draft.store';
import { DemoClock } from './demo-clock';
import { hostingFor, validateTerminators } from './hosting';
import { postureFor } from './posture';

export const BIND_DELAY_MS = 3000;
export const ZITI_ACTOR = 'Ziti';

export interface BindingChanges {
  /** The world's terminators after the run. */
  terminators: Terminator[];
  /** "6 hosts started serving gitlab-internal" / "2 hosts stopped serving api-prod". */
  lines: string[];
}

/** Ready to serve: authorized with an online route, and Bind posture passed. */
const ready = (identityId: string, serviceId: string, world: TrifectaWorld) =>
  !!indexFor(world).service(serviceId) &&
  resolve(identityId, serviceId, world).bindStatus === 'AUTHORIZED_REACHABLE' &&
  postureFor(identityId, serviceId, 'bind', world).satisfied;

const hosts = (n: number) => `${n} ${n === 1 ? 'host' : 'hosts'}`;

/** The terminators `world` would have once its hosts bind / unbind on `serviceIds`,
 *  with `before` the world before the commit. Pure. */
export function bindingChanges(world: TrifectaWorld, before: TrifectaWorld, serviceIds: readonly string[]): BindingChanges {
  const ix = indexFor(world);
  const existing = [...(world.terminators ?? [])];
  const taken = new Set(existing.map((t) => t.id));
  let n = 1;
  const freshId = () => {
    while (taken.has(`term-sim-${n}`)) n++;
    taken.add(`term-sim-${n}`);
    return `term-sim-${n}`;
  };
  const scope = new Set(serviceIds);
  const invalid = new Set(
    validateTerminators(world)
      .filter((i) => i.problem === 'orphaned' || i.problem === 'routerNotShared')
      .map((i) => i.terminatorId),
  );
  const removed = existing.filter((t) => scope.has(t.serviceId) && invalid.has(t.id));
  const kept = existing.filter((t) => !removed.includes(t));
  const added: Terminator[] = [];
  const lines: string[] = [];

  for (const serviceId of serviceIds) {
    const service = ix.service(serviceId);
    if (!service) continue;
    const bound = new Set(kept.filter((t) => t.serviceId === serviceId).map((t) => t.identityId));
    const starting = hostingFor(serviceId, world).authorizedHostIds.filter(
      (id) => !bound.has(id) && ready(id, serviceId, world) && !ready(id, serviceId, before),
    );
    for (const identityId of starting) {
      const common = new Set(resolve(identityId, serviceId, world).routers.common);
      const router = world.edgeRouters.find((r) => common.has(r.id) && r.isOnline);
      if (!router) continue;
      added.push({ id: freshId(), serviceId, identityId, routerId: router.id, precedence: 'default', cost: 0 });
    }
    const started = added.filter((t) => t.serviceId === serviceId).length;
    if (started) lines.push(`${hosts(started)} started serving ${service.name}`);
    // Hosts left with no terminator for the service.
    const stillServing = new Set(kept.filter((t) => t.serviceId === serviceId).map((t) => t.identityId));
    const stopped = new Set(removed.filter((t) => t.serviceId === serviceId && !stillServing.has(t.identityId)).map((t) => t.identityId));
    if (stopped.size) lines.push(`${hosts(stopped.size)} stopped serving ${service.name}`);
  }
  return { terminators: [...kept, ...added], lines };
}

@Injectable({ providedIn: 'root' })
export class BindingSimulator {
  private readonly store = inject(PolicyDraftStore);
  private readonly data = inject(MockDataService);
  private readonly clock = inject(DemoClock);

  /** The Demo panel's "Hosts bind after commit". */
  readonly enabled = signal(true);

  /** Commits waiting for their hosts to bind: when (demo clock), and what they touched. */
  private pending: { dueAt: number; before: TrifectaWorld; serviceIds: string[] }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.store.onCommit((e) => this.onCommit(e));
  }

  private onCommit(e: CommitEvent): void {
    if (!this.enabled()) return;
    const serviceIds = affectedServices(e.record.ops, e.before, e.after);
    if (!serviceIds.length) return;
    this.pending.push({ dueAt: this.clock.now().getTime() + BIND_DELAY_MS, before: e.before, serviceIds });
    this.schedule();
  }

  /** Runs every pending binding that has come due (by the demo clock) — also called
   *  when the demo clock jumps ahead. */
  runDue(): void {
    const now = this.clock.now().getTime();
    const due = this.pending.filter((p) => p.dueAt <= now);
    this.pending = this.pending.filter((p) => p.dueAt > now);
    for (const p of due) this.bind(p.before, p.serviceIds);
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.pending.length) return;
    const wait = Math.min(...this.pending.map((p) => p.dueAt)) - this.clock.now().getTime();
    this.timer = setTimeout(() => this.runDue(), Math.max(0, wait));
  }

  private bind(before: TrifectaWorld, serviceIds: string[]): void {
    const { terminators, lines } = bindingChanges(this.store.live(), before, serviceIds);
    if (!lines.length) return;
    this.data.terminators.set(terminators);
    this.store.recordObserved(ZITI_ACTOR, lines);
  }
}
