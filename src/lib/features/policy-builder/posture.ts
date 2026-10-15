/**
 * Posture for one (identity, service) pair on one track: which granting service
 * policies' posture checks the identity satisfies. Pure and headless, like the
 * trifecta resolver it builds on. Read-only — nothing here feeds the verdict yet.
 *
 * A pair is authorized by every service policy of the track that matches both sides
 * (resolve's viaPolicies). Each of those policies requires the posture checks its
 * postureCheckRoles select; the pair passes posture when ANY granting policy has all
 * its checks passed (a policy with none always does).
 *
 * bypassedChecks: check C on granting policy P is bypassed when another granting
 * policy that the identity satisfies doesn't require C — the identity has a way in
 * without it. How many checks either policy has doesn't matter. bob → git-repo:
 * admins-dev-access requires require-mfa, which bob fails, but users-gitlab (no
 * checks) lets him in anyway. Two satisfied policies with different checks each
 * bypass the other's.
 */

import { entityMatchesRoles } from '../authorization/authorization-resolver';
import { resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import { indexFor } from '../authorization/world-index';
import type { Policy, PostureCheck } from '../../shared/services/mock-data.service';

export type Track = 'dial' | 'bind';

export interface GrantingPolicyPosture {
  policyId: string;
  /** The checks the policy's postureCheckRoles select, in world.postureChecks order. */
  requiredCheckIds: string[];
  /** The required checks the identity doesn't pass. */
  failingCheckIds: string[];
  /** The identity passes every required check (true with none). */
  satisfied: boolean;
}

export interface Posture {
  /** world.policies order. */
  grantingPolicies: GrantingPolicyPosture[];
  /** Any granting policy is satisfied. */
  satisfied: boolean;
  /** Check ids, world.postureChecks order. */
  bypassedChecks: string[];
}

/**
 * The checks a policy requires. Uses the policy's own semantic, as for its identity
 * and service roles — NOTE: whether the controller applies `semantic` to
 * postureCheckRoles this way is unverified.
 */
export function requiredChecks(policy: Policy, checks: readonly PostureCheck[]): PostureCheck[] {
  return checks.filter((c) => entityMatchesRoles(policy.postureCheckRoles, policy.semantic, c.attributes, c.name, c.id));
}

export function postureFor(identityId: string, serviceId: string, track: Track, world: TrifectaWorld): Posture {
  // Memoised per (pair, track) on the world's index, like resolve.
  const ix = indexFor(world);
  const key = `${identityId}\u0000${serviceId}\u0000${track}`;
  const memo = ix.postures.get(key) as Posture | undefined;
  if (memo) return memo;

  const checks = world.postureChecks ?? [];
  const passed = ix.passedChecks(identityId);

  // viaPolicies is already in world.policies order.
  const grantingPolicies = resolve(identityId, serviceId, world)[track].viaPolicies
    .map((id) => ix.policy(id)!)
    .map((p): GrantingPolicyPosture => {
      const requiredCheckIds = ix.requiredChecks(p).map((c) => c.id);
      const failingCheckIds = requiredCheckIds.filter((id) => !passed.has(id));
      return { policyId: p.id, requiredCheckIds, failingCheckIds, satisfied: failingCheckIds.length === 0 };
    });

  const bypassed = new Set<string>();
  for (const p of grantingPolicies) {
    for (const checkId of p.requiredCheckIds) {
      if (grantingPolicies.some((q) => q !== p && q.satisfied && !q.requiredCheckIds.includes(checkId))) bypassed.add(checkId);
    }
  }

  const posture: Posture = {
    grantingPolicies,
    satisfied: grantingPolicies.some((p) => p.satisfied),
    bypassedChecks: checks.filter((c) => bypassed.has(c.id)).map((c) => c.id),
  };
  ix.postures.set(key, posture);
  return posture;
}

// ─── bypasses and their fix ───────────────────────────────────────────────────

export interface Bypass {
  identityId: string;
  checkId: string;
  /** A granting policy that lets the identity in without the check — of the satisfied
   *  ones that don't require it, the one with the fewest checks, then world.policies order. */
  viaPolicyId: string;
  /** Its own required checks (often none). */
  viaCheckIds: string[];
}

/** One Bypass per bypassed check — see Posture.bypassedChecks. */
export function bypassesFor(posture: Posture, identityId: string): Bypass[] {
  return posture.bypassedChecks.map((checkId) => {
    const via = posture.grantingPolicies
      .filter((q) => q.satisfied && !q.requiredCheckIds.includes(checkId))
      .sort((a, b) => a.requiredCheckIds.length - b.requiredCheckIds.length)[0];
    return { identityId, checkId, viaPolicyId: via.policyId, viaCheckIds: via.requiredCheckIds };
  });
}

/**
 * The role that adds `check` to `policy`'s postureCheckRoles: the check's first
 * attribute when that can't narrow an existing rule (AnyOf, or no # terms yet),
 * else @<check name>, which is unioned whatever the semantic.
 */
export function roleForCheck(policy: Policy, check: PostureCheck): string {
  const hasTerms = policy.postureCheckRoles.some((r) => r.startsWith('#'));
  const attr = check.attributes[0];
  return attr && (policy.semantic === 'AnyOf' || !hasTerms) ? attr : `@${check.name}`;
}

/** "Add <check> to <policy>": the policy with the check's role added. */
export function addCheckFix(world: TrifectaWorld, checkId: string, policyId: string): { policy: Policy; role: string } {
  const policy = world.policies.find((p) => p.id === policyId);
  const check = world.postureChecks?.find((c) => c.id === checkId);
  if (!policy || !check) throw new Error(`addCheckFix: unknown policy '${policyId}' or check '${checkId}'`);
  const role = roleForCheck(policy, check);
  const roles = policy.postureCheckRoles.includes(role) ? policy.postureCheckRoles : [...policy.postureCheckRoles, role];
  return { policy: { ...policy, postureCheckRoles: [...roles] }, role };
}
