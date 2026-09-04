/**
 * Derived-enrollment lookup — the SINGLE, shared determination used by every view
 * that displays an observed source (raw-traffic table, suggested-roles evidence,
 * ungrouped/straggler chips).
 *
 * A source is ENROLLED iff its id resolves to a real Identity — i.e. its id is
 * present in MockDataService.identities() (which spreads DISCOVERY_IDENTITIES).
 * This is the SAME contract the engine/store use to tag members.
 *
 * NEVER infer enrollment from the string shape. An unenrolled source's id happens
 * to be a bare IP, but that is incidental — the contract is the identity lookup,
 * not the format. Deriving from "looks like an IP" would drift from the model the
 * moment an enrolled identity is named after an address (or an unenrolled source
 * gets a synthetic non-IP id).
 */

import type { Identity } from '../../shared/services/mock-data.service';

/** Build the set of enrolled source ids from the identity roster. Callers wrap
 *  this in a computed over `MockDataService.identities()` so it stays reactive. */
export function enrolledSourceIds(identities: readonly Identity[]): ReadonlySet<string> {
  return new Set(identities.map((i) => i.id));
}
