/**
 * SERVICE LIST — the policy builder's entry state: every service, its verdict line,
 * and how many Bind / Dial policies are its own. Pure; reads the (draft) world.
 *
 * "Its own" excludes policies that reach the service only through '#all'
 * (coversOnlyViaAll) — those apply to every service and are counted separately.
 * Matching goes through the world's index; verdicts come from verdictFor() (index
 * counts, no group layout). serviceListRows leaves the verdict out — the list
 * computes it per visible row, cached per world.
 */

import type { TrifectaWorld } from '../authorization/trifecta-resolver';
import { indexFor } from '../authorization/world-index';
import { coversOnlyViaAll, verdictFor, type ServiceVerdict } from './service-view.layout';

/** A row without its verdict. */
export interface ServiceListEntry {
  id: string;
  name: string;
  attributes: readonly string[];
  interceptAddress: string;
  /** Policies of its own, by type. */
  bind: number;
  dial: number;
  /** Policies covering it only via '#all'. */
  viaAll: number;
}

export interface ServiceListRow extends ServiceListEntry {
  verdict: ServiceVerdict;
}

/** Every service's row, without verdicts (cheap: index lookups only). */
export function serviceListRows(world: TrifectaWorld): ServiceListEntry[] {
  const ix = indexFor(world);
  return world.services.map((s) => {
    const policies = ix.policiesForService(s.id);
    const own = policies.filter((p) => !coversOnlyViaAll(p, s));
    return {
      id: s.id,
      name: s.name,
      attributes: s.attributes ?? [],
      interceptAddress: s.interceptAddress,
      bind: own.filter((p) => p.type === 'bind').length,
      dial: own.filter((p) => p.type === 'dial').length,
      viaAll: policies.length - own.length,
    };
  });
}

/** Every row with its verdict. */
export function layoutServiceList(world: TrifectaWorld): ServiceListRow[] {
  return serviceListRows(world).map((r) => ({ ...r, verdict: verdictFor(r.id, world) }));
}

/** Case-insensitive match on name, attributes, or intercept address. */
export function filterServiceList<R extends ServiceListEntry>(rows: readonly R[], query: string): R[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) =>
    [r.name, r.interceptAddress, ...r.attributes].some((t) => t.toLowerCase().includes(q)),
  );
}

/** "1 Bind · 2 Dial" — or "No policies yet" when it has none of its own. */
export function policyCountText(r: Pick<ServiceListEntry, 'bind' | 'dial'>): string {
  if (r.bind === 0 && r.dial === 0) return 'No policies yet';
  return `${r.bind} Bind · ${r.dial} Dial`;
}
