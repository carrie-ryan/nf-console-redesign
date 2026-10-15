/**
 * The posture panel's content for ONE group on ONE service — pure and headless.
 *
 *   blocked  — members with an online route whose posture (the group's lane) fails:
 *              each granting policy with the checks it fails. A failing check is the
 *              device's to pass, not a policy fix.
 *              Grouped (blockedGroups) by identical failing checks and reason — "67
 *              hosts fail check-1 · device" — largest first, each with its members.
 *   bypasses — members who skip one of this policy's checks through another granting
 *              policy they satisfy that doesn't require it: "bob@corp.com skips
 *              require-mfa on git-repo through users-gitlab, which has no posture checks."
 *   fixes    — one per (check, bypassing policy): "Add require-mfa to users-gitlab",
 *              the policy with the check added, and its ops. Their preview (can
 *              connect / blocked by posture, before → after, per service) is NOT
 *              computed here: the panel runs each fix's diff lazily and maps it with
 *              previewFromDiff, so the panel opens at once.
 */

import { resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import type { Policy } from '../../shared/services/mock-data.service';
import type { DraftDiff } from './draft/draft-diff';
import { indexFor } from '../authorization/world-index';
import { effectRows, type Delta } from './draft/draft-summary';
import type { DraftOp } from './draft/policy-draft';
import { addCheckFix, bypassesFor, postureFor } from './posture';
import { layoutServiceView, type Group } from './service-view.layout';

export interface PreviewRow {
  serviceId: string;
  serviceName: string;
  canConnect: Delta;
  blocked: Delta;
}

export interface BlockedMember {
  identityId: string;
  name: string;
  /** Every granting policy, with the checks the member fails on it. */
  grants: { policyId: string; policyName: string; failingCheckNames: string[] }[];
  /** "Device must pass require-mfa; not a policy fix", once per failing check. */
  deviceLines: string[];
}

/** Why a blocked member fails. Posture results say only which checks pass, so a
 *  failing check is always the device's to pass ("Device must pass …"). */
export type BlockedReason = 'device';

/** Blocked members with the same failing checks and reason. */
export interface BlockedGroup {
  /** `${checkIds}|${reason}` */
  key: string;
  checkIds: string[];
  checkNames: string[];
  reason: BlockedReason;
  /** "67 hosts fail check-1 · device" / "1 dialer fails require-mfa and edr · device". */
  text: string;
  /** "Device must pass check-1; not a policy fix", once per check. */
  deviceLines: string[];
  members: BlockedMember[];
}

export interface BypassLine {
  identityId: string;
  checkId: string;
  viaPolicyId: string;
  text: string;
}

export interface PostureFix {
  checkId: string;
  policyId: string;
  /** "Add require-mfa to users-gitlab" */
  title: string;
  /** The bypassing policy with the check added — the editor's pending copy. */
  policy: Policy;
  /** The role added to its postureCheckRoles. */
  role: string;
  ops: DraftOp[];
}

export interface PosturePanel {
  serviceId: string;
  serviceName: string;
  group: Group;
  checkNames: string[];
  blocked: BlockedMember[];
  /** `blocked`, grouped by identical failing checks and reason; largest first. */
  blockedGroups: BlockedGroup[];
  bypasses: BypassLine[];
  fixes: PostureFix[];
}

/** From a draft diff against `world`: each service whose can-connect or blocked-by-posture
 *  count changes, live order (the current service first). */
export function previewFromDiff(world: TrifectaWorld, diff: DraftDiff, currentServiceId = ''): PreviewRow[] {
  return effectRows(diff, world, currentServiceId)
    .filter((r) => r.canConnect.delta !== 0 || r.blocked.delta !== 0)
    .map((r) => ({ serviceId: r.serviceId, serviceName: r.serviceName, canConnect: r.canConnect, blocked: r.blocked }));
}

/** "git-repo: can connect 17 → 1 · blocked by posture 1 → 17" (unchanged halves omitted). */
export function previewText(r: PreviewRow): string {
  const parts = [
    r.canConnect.delta ? `can connect ${r.canConnect.before} → ${r.canConnect.after}` : null,
    r.blocked.delta ? `blocked by posture ${r.blocked.before} → ${r.blocked.after}` : null,
  ].filter(Boolean);
  return `${r.serviceName}: ${parts.join(' · ')}`;
}

export function posturePanel(world: TrifectaWorld, serviceId: string, groupId: string): PosturePanel | null {
  const view = layoutServiceView(serviceId, world);
  const group = [...view.bind.groups, ...view.dial.groups].find((g) => g.id === groupId);
  if (!group) return null;

  const ix = indexFor(world);
  const nameOf = (id: string) => ix.identity(id)?.name ?? id;
  const policyName = (id: string) => ix.policy(id)?.name ?? id;
  const checkName = (id: string) => ix.check(id)?.name ?? id;
  const service = view.service.name;
  const ownChecks = new Set(group.checks.map((k) => k.id));
  const track = group.lane;

  const blocked: BlockedMember[] = [];
  const failingOf = new Map<string, string[]>(); // member → failing check ids, world order
  const bypasses: BypassLine[] = [];
  for (const id of group.memberIds) {
    const posture = postureFor(id, serviceId, track, world);
    if (!posture.satisfied && isReachable(id, serviceId, track, world)) {
      const failing = [...new Set(posture.grantingPolicies.flatMap((g) => g.failingCheckIds))];
      const order = (world.postureChecks ?? []).map((c) => c.id);
      failingOf.set(id, failing.sort((a, b) => order.indexOf(a) - order.indexOf(b)));
      blocked.push({
        identityId: id,
        name: nameOf(id),
        grants: posture.grantingPolicies.map((g) => ({
          policyId: g.policyId,
          policyName: policyName(g.policyId),
          failingCheckNames: g.failingCheckIds.map(checkName),
        })),
        deviceLines: failing.map((k) => `Device must pass ${checkName(k)}; not a policy fix`),
      });
    }
    for (const b of bypassesFor(posture, id).filter((b) => ownChecks.has(b.checkId))) {
      const via = policyName(b.viaPolicyId);
      const has = b.viaCheckIds.length
        ? `which requires ${b.viaCheckIds.map(checkName).join(', ')} instead`
        : 'which has no posture checks';
      bypasses.push({
        identityId: id,
        checkId: b.checkId,
        viaPolicyId: b.viaPolicyId,
        text: `${nameOf(id)} skips ${checkName(b.checkId)} on ${service} through ${via}, ${has}.`,
      });
    }
  }

  const seen = new Set<string>();
  const fixes: PostureFix[] = [];
  for (const b of bypasses) {
    const key = `${b.checkId}|${b.viaPolicyId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { policy, role } = addCheckFix(world, b.checkId, b.viaPolicyId);
    const ops: DraftOp[] = [{ kind: 'update', policyId: policy.id, patch: { postureCheckRoles: policy.postureCheckRoles } }];
    fixes.push({
      checkId: b.checkId,
      policyId: b.viaPolicyId,
      title: `Add ${checkName(b.checkId)} to ${policy.name}`,
      policy,
      role,
      ops,
    });
  }

  const groups = new Map<string, BlockedGroup>();
  const who = track === 'bind' ? ['host', 'hosts'] : ['dialer', 'dialers'];
  for (const m of blocked) {
    const checkIds = failingOf.get(m.identityId)!;
    const reason: BlockedReason = 'device';
    const key = `${checkIds.join(',')}|${reason}`;
    let g = groups.get(key);
    if (!g) {
      const checkNames = checkIds.map(checkName);
      g = { key, checkIds, checkNames, reason, text: '', deviceLines: checkNames.map((k) => `Device must pass ${k}; not a policy fix`), members: [] };
      groups.set(key, g);
    }
    g.members.push(m);
  }
  const blockedGroups = [...groups.values()]
    .map((g) => {
      const n = g.members.length;
      const names = g.checkNames.length > 1 ? `${g.checkNames.slice(0, -1).join(', ')} and ${g.checkNames.at(-1)}` : g.checkNames[0] ?? 'its checks';
      return { ...g, text: `${n.toLocaleString('en-US')} ${n === 1 ? who[0] : who[1]} ${n === 1 ? 'fails' : 'fail'} ${names} · ${g.reason}` };
    })
    .sort((a, b) => b.members.length - a.members.length);

  return { serviceId, serviceName: service, group, checkNames: group.checks.map((k) => k.name), blocked, blockedGroups, bypasses, fixes };
}

/** The member has an online route on this track (the verdict only blocks those). */
function isReachable(identityId: string, serviceId: string, track: 'dial' | 'bind', world: TrifectaWorld): boolean {
  const pair = resolve(identityId, serviceId, world);
  return (track === 'dial' ? pair.status : pair.bindStatus) === 'AUTHORIZED_REACHABLE';
}
