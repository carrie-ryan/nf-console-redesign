/**
 * LOOSENING — a draft that gives identities who already had a route to a service a
 * NEW route with different or fewer posture checks: "Admins can now connect with
 * crowdstrike-healthy instead of require-mfa".
 *
 * Only policies the draft creates or changes are considered. For each of them (Q),
 * each service it covers and each identity it grants there: if the identity already
 * had a route in live (any granting policy, Q's old self included), and Q's checks
 * are not a superset of ANY of those routes' checks, the draft loosens that
 * identity's posture there. A route whose checks include an existing route's checks
 * is stricter, never looser; an identity with no route before gets new access, not a
 * loosening.
 */

import { entityMatchesRoles } from '../../authorization/authorization-resolver';
import { resolve, type TrifectaWorld } from '../../authorization/trifecta-resolver';
import type { Policy } from '../../../shared/services/mock-data.service';
import { requiredChecks } from '../posture';
import { definitionChanged } from './config-effects';

export interface Loosening {
  serviceId: string;
  /** The created or changed policy giving the looser route. */
  policyId: string;
  /** world.identities order. */
  identityIds: string[];
  newCheckIds: string[];
  /** The checks of the routes they had, each distinct set once. */
  oldCheckSets: string[][];
  /** "Admins can now connect with crowdstrike-healthy instead of require-mfa" */
  text: string;
}

const NAMES_SHOWN = 3;

const checkIds = (p: Policy, w: TrifectaWorld) => requiredChecks(p, w.postureChecks ?? []).map((c) => c.id);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const covers = (p: Policy, e: { id: string; name: string; attributes?: readonly string[] }, roles: 'identityRoles' | 'serviceRoles') =>
  entityMatchesRoles(p[roles], p.semantic, e.attributes ?? [], e.name, e.id);

/** "Admins" for a policy whose identity side is one #term; else the names ("+N more"). */
function who(q: Policy, names: readonly string[]): string {
  const terms = q.identityRoles.filter((r) => r.startsWith('#'));
  if (terms.length === 1 && q.identityRoles.length === 1 && terms[0] !== '#all') {
    const word = terms[0].slice(1);
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  return names.length > NAMES_SHOWN ? `${shown} and ${names.length - NAMES_SHOWN} more` : shown;
}

export function loosenings(live: TrifectaWorld, draft: TrifectaWorld): Loosening[] {
  const liveById = new Map(live.policies.map((p) => [p.id, p]));
  const changed = draft.policies.filter((q) => {
    const before = liveById.get(q.id);
    return !before || JSON.stringify(before) !== JSON.stringify(q);
  });
  const checkName = (id: string) =>
    (draft.postureChecks ?? []).find((c) => c.id === id)?.name ?? (live.postureChecks ?? []).find((c) => c.id === id)?.name ?? id;
  const setText = (ids: readonly string[]) => (ids.length ? ids.map(checkName).join(' and ') : 'no posture checks');

  const out: Loosening[] = [];
  for (const service of live.services) {
    if (!draft.services.some((s) => s.id === service.id)) continue;
    for (const q of changed) {
      if (!covers(q, service, 'serviceRoles')) continue;
      const track = q.type;
      const newIds = checkIds(q, draft);
      const before = liveById.get(q.id);
      const affected: string[] = [];
      const oldSets: string[][] = [];
      for (const identity of draft.identities) {
        if (!covers(q, identity, 'identityRoles')) continue;
        if (!live.identities.some((i) => i.id === identity.id)) continue;
        const liveGrants = resolve(identity.id, service.id, live)[track].viaPolicies.map((id) => liveById.get(id)!);
        if (!liveGrants.length) continue; // new access, not a loosening
        // Unchanged route: Q already granted this identity with the same checks.
        if (before && liveGrants.includes(before) && sameSet(checkIds(before, live), newIds)) continue;
        const sets = liveGrants.map((p) => checkIds(p, live));
        if (sets.some((old) => old.every((c) => newIds.includes(c)))) continue; // stricter or equal
        affected.push(identity.id);
        for (const set of sets) if (!oldSets.some((o) => sameSet(o, set))) oldSets.push(set);
      }
      if (!affected.length) continue;
      const names = affected.map((id) => draft.identities.find((i) => i.id === id)!.name);
      const verb = track === 'dial' ? 'connect' : 'host';
      out.push({
        serviceId: service.id,
        policyId: q.id,
        identityIds: affected,
        newCheckIds: newIds,
        oldCheckSets: oldSets,
        text: `${who(q, names)} can now ${verb} with ${setText(newIds)} instead of ${oldSets.map(setText).join(' or ')}`,
      });
    }
  }
  return out;
}

// ─── requirements removed ─────────────────────────────────────────────────────

const policiesText = (names: readonly string[]) =>
  `${names.length} ${names.length === 1 ? 'policy' : 'policies'}: ${names.join(', ')}`;

/**
 * Warnings for a draft that drops posture requirements outright — they don't block
 * commit, but they loosen access wherever those policies apply:
 *   • a deleted check that live policies required:
 *     "Deleting require-mfa removes a requirement from 1 policy: admins-dev-access"
 *   • policies that no longer require a check they did (their check roles edited):
 *     "Removes a requirement from 1 policy: admins-dev-access (require-mfa)"
 *   • a check whose definition changed, for the policies requiring it before and after:
 *     "Changes a requirement used by 1 policy: admins-dev-access (require-mfa)"
 */
export function requirementWarnings(live: TrifectaWorld, draft: TrifectaWorld): string[] {
  const out: string[] = [];
  const draftChecks = new Set((draft.postureChecks ?? []).map((c) => c.id));
  const deleted = (live.postureChecks ?? []).filter((c) => !draftChecks.has(c.id));
  for (const c of deleted) {
    const users = live.policies.filter((p) => checkIds(p, live).includes(c.id)).map((p) => p.name);
    if (users.length) out.push(`Deleting ${c.name} removes a requirement from ${policiesText(users)}`);
  }

  const deletedIds = new Set(deleted.map((c) => c.id));
  const name = (id: string) => (live.postureChecks ?? []).find((c) => c.id === id)?.name ?? id;
  const dropped: string[] = [];
  for (const before of live.policies) {
    const after = draft.policies.find((p) => p.id === before.id);
    if (!after) continue; // a deleted policy removes access, not a requirement
    const now = checkIds(after, draft);
    const lost = checkIds(before, live).filter((id) => !now.includes(id) && !deletedIds.has(id));
    if (lost.length) dropped.push(`${before.name} (${lost.map(name).join(', ')})`);
  }
  if (dropped.length) out.push(`Removes a requirement from ${policiesText(dropped)}`);

  const changed: string[] = [];
  for (const before of live.postureChecks ?? []) {
    const after = (draft.postureChecks ?? []).find((c) => c.id === before.id);
    if (!after || !definitionChanged(before, after)) continue;
    for (const p of draft.policies) {
      const was = live.policies.find((x) => x.id === p.id);
      if (was && checkIds(was, live).includes(before.id) && checkIds(p, draft).includes(before.id)) changed.push(`${p.name} (${after.name})`);
    }
  }
  if (changed.length) out.push(`Changes a requirement used by ${policiesText(changed)}`);
  return out;
}
