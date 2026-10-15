/**
 * The non-policy draft targets — posture checks, a service's terminator strategy, an
 * identity's hosting defaults — in words, and where they land.
 *
 *   checkUsage       — the service policies that require a check (its "Used by N policies")
 *   describeConfigOp — the change line for one of those ops
 *   configChanges    — per service, the configuration lines a draft adds to its effect
 *                      row. A check's definition change reaches every service its
 *                      policies cover, whether or not any count moves.
 *
 * Hosting defaults apply to the terminators an identity creates from then on; its
 * current terminators are observed state and keep theirs.
 */

import { entityMatchesRoles } from '../../authorization/authorization-resolver';
import { resolve, type TrifectaWorld } from '../../authorization/trifecta-resolver';
import type { AccessTest, Identity, Policy, PostureCheck, Service } from '../../../shared/services/mock-data.service';
import { describeTest } from '../access-tests';
import { requiredChecks } from '../posture';
import { targetOf, type DraftOp } from './policy-draft';

export const DEFAULT_PRECEDENCE = 'default';
export const DEFAULT_COST = 0;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const coversService = (p: Policy, s: Service) =>
  entityMatchesRoles(p.serviceRoles, p.semantic, s.attributes ?? [], s.name, s.id);

/** The service policies (world order) whose postureCheckRoles select the check. */
export function checkUsage(world: TrifectaWorld, checkId: string): Policy[] {
  const checks = world.postureChecks ?? [];
  return world.policies.filter((p) => requiredChecks(p, checks).some((c) => c.id === checkId));
}

/** "Used by 1 policy" / "Not used by any policy". */
export function usageText(n: number): string {
  return n ? `Used by ${plural(n, 'policy', 'policies')}` : 'Not used by any policy';
}

export const precedenceOf = (i: Pick<Identity, 'hostingPrecedence'>) => i.hostingPrecedence ?? DEFAULT_PRECEDENCE;
export const costOf = (i: Pick<Identity, 'hostingCost'>) => i.hostingCost ?? DEFAULT_COST;
export const strategyOf = (s: Pick<Service, 'terminatorStrategy'>) => s.terminatorStrategy ?? 'smartrouting';

// ─── posture check field changes ──────────────────────────────────────────────

const CHECK_FIELD: Record<string, string> = {
  type: 'type',
  timeoutSeconds: 'timeout',
  promptOnWake: 'prompt on wake',
  promptOnUnlock: 'prompt on unlock',
  operatingSystems: 'operating systems',
  processPath: 'process',
  domains: 'domains',
  macAddresses: 'MAC addresses',
  connectionId: 'connection',
};

function fmt(key: string, v: unknown): string {
  if (v === undefined || v === null || v === '') return 'none';
  if (key === 'timeoutSeconds') return `${v} s`;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (key === 'operatingSystems') {
    return (v as PostureCheck['operatingSystems'])!.map((o) => (o.minVersion ? `${o.type} ≥ ${o.minVersion}` : o.type)).join(', ') || 'none';
  }
  if (Array.isArray(v)) return v.join(', ') || 'none';
  return String(v);
}

/** True when what the check REQUIRES changed (type, timeout, OSes, …) — not its name
 *  or attributes (which policies use it is a separate change). */
export function definitionChanged(before: PostureCheck, after: PostureCheck): boolean {
  return Object.keys(CHECK_FIELD).some(
    (k) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify((after as unknown as Record<string, unknown>)[k]),
  );
}

/** "renamed to x; added #a; timeout 1800 s → 900 s" — '' when nothing differs. */
export function checkChanges(before: PostureCheck, after: PostureCheck): string {
  const parts: string[] = [];
  if (after.name !== before.name) parts.push(`renamed to ${after.name}`);
  parts.push(...after.attributes.filter((a) => !before.attributes.includes(a)).map((a) => `added ${a}`));
  parts.push(...before.attributes.filter((a) => !after.attributes.includes(a)).map((a) => `removed ${a}`));
  for (const [key, label] of Object.entries(CHECK_FIELD)) {
    const b = (before as unknown as Record<string, unknown>)[key];
    const a = (after as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) parts.push(`${label} ${fmt(key, b)} → ${fmt(key, a)}`);
  }
  return parts.join('; ');
}

// ─── change lines ─────────────────────────────────────────────────────────────

/** The change line for a posture-check, service or identity op; null for policy ops. */
export function describeConfigOp(op: DraftOp, world: TrifectaWorld, next: TrifectaWorld): string | null {
  const target = targetOf(op);
  if (target === 'postureCheck') {
    const find = (w: TrifectaWorld, id: string) => (w.postureChecks ?? []).find((c) => c.id === id)!;
    switch (op.kind) {
      case 'create': {
        const c = op.policy as PostureCheck;
        const attrs = c.attributes.length ? `: ${c.attributes.join(', ')}` : '';
        return `Created posture check ${c.name} (${c.type})${attrs} · ${usageText(checkUsage(next, c.id).length).toLowerCase()}`;
      }
      case 'update': {
        const users = new Set([...checkUsage(world, op.policyId), ...checkUsage(next, op.policyId)].map((p) => p.id));
        const what = checkChanges(find(world, op.policyId), find(next, op.policyId)) || 'no changes';
        return `Updated posture check ${find(world, op.policyId).name}: ${what} · ${usageText(users.size).toLowerCase()}`;
      }
      case 'delete':
        return `Deleted posture check ${find(world, op.policyId).name} · was ${usageText(checkUsage(world, op.policyId).length).toLowerCase()}`;
    }
  }
  if (target === 'accessTest') {
    const find = (w: TrifectaWorld, id: string) => (w.accessTests ?? []).find((t) => t.id === id)!;
    switch (op.kind) {
      case 'create':
        return `Added test: ${describeTest(op.policy as AccessTest, next)}`;
      case 'update': {
        const [b, a] = [describeTest(find(world, op.policyId), world), describeTest(find(next, op.policyId), next)];
        return b === a ? `Updated test: ${a} (note)` : `Updated test: ${b} → ${a}`;
      }
      case 'delete':
        return `Removed test: ${describeTest(find(world, op.policyId), world)}`;
    }
  }
  if (target === 'service' && op.kind === 'update') {
    const b = world.services.find((s) => s.id === op.policyId)!;
    const a = next.services.find((s) => s.id === op.policyId)!;
    return `Set ${b.name}'s terminator strategy: ${strategyOf(b)} → ${strategyOf(a)}`;
  }
  if (target === 'identity' && op.kind === 'update') {
    const b = world.identities.find((i) => i.id === op.policyId)!;
    const a = next.identities.find((i) => i.id === op.policyId)!;
    return `Set ${b.name}'s hosting defaults: ${hostingParts(b, a) || 'no changes'}`;
  }
  return null;
}

/** "precedence default → required; cost 0 → 10" — '' when equal. */
function hostingParts(b: Identity, a: Identity): string {
  const parts: string[] = [];
  if (precedenceOf(a) !== precedenceOf(b)) parts.push(`precedence ${precedenceOf(b)} → ${precedenceOf(a)}`);
  if (costOf(a) !== costOf(b)) parts.push(`cost ${costOf(b)} → ${costOf(a)}`);
  return parts.join('; ');
}

// ─── per-service configuration effects ────────────────────────────────────────

export interface ConfigChange {
  serviceId: string;
  lines: string[];
}

/** Every service a draft's configuration edits reach, in live order, with what changed there. */
export function configChanges(live: TrifectaWorld, draft: TrifectaWorld): ConfigChange[] {
  const lines = new Map<string, string[]>();
  const add = (serviceId: string, line: string) => lines.set(serviceId, [...(lines.get(serviceId) ?? []), line]);
  const services = live.services.filter((s) => draft.services.some((d) => d.id === s.id));

  // Posture checks: created, deleted or redefined — on every service their users cover.
  const before = new Map((live.postureChecks ?? []).map((c) => [c.id, c]));
  const after = new Map((draft.postureChecks ?? []).map((c) => [c.id, c]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(id);
    const a = after.get(id);
    if (b && a && !checkChanges(b, a)) continue;
    const users = [...checkUsage(live, id), ...checkUsage(draft, id)];
    const name = (a ?? b)!.name;
    for (const s of services) {
      const here = [...new Set(users.filter((p) => coversService(p, s)).map((p) => p.name))];
      if (!here.length) continue;
      const by = here.join(', ');
      add(s.id, !b ? `New posture check ${name} · required here by ${by}` : !a ? `Posture check ${name} deleted · ${by} no longer requires it` : `Posture check ${name} redefined (${checkChanges(b, a)}) · required here by ${by}`);
    }
  }

  // Terminator strategy.
  for (const s of services) {
    const d = draft.services.find((x) => x.id === s.id)!;
    if (strategyOf(d) !== strategyOf(s)) add(s.id, `Terminator strategy: ${strategyOf(s)} → ${strategyOf(d)}`);
  }

  // Hosting defaults: on each service the identity may host (in the draft).
  for (const i of live.identities) {
    const d = draft.identities.find((x) => x.id === i.id);
    if (!d) continue;
    const parts = hostingParts(i, d);
    if (!parts) continue;
    for (const s of services) {
      if (!resolve(i.id, s.id, draft).bind.authorized) continue;
      add(s.id, `${i.name}'s hosting defaults: ${parts} (new terminators; current ones keep theirs)`);
    }
  }

  return services.filter((s) => lines.has(s.id)).map((s) => ({ serviceId: s.id, lines: lines.get(s.id)! }));
}
