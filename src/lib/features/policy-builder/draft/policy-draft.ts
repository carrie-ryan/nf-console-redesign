/**
 * POLICY DRAFT — an ordered list of edits applied to a world.
 *
 * Each op has a `target` collection: service policies (the default, so ops written
 * without a target mean what they always did), edge router policies, service edge
 * router policies, posture checks — or, update-only and limited to their
 * configuration fields, services (terminatorStrategy) and identities (default
 * hosting precedence and cost). `policy` / `policyId` name the entity for every
 * target, policy or not.
 *
 * Observed state is never a target: terminators, router online status and posture
 * results come from the network, not from the draft.
 *
 * Pure: applyDraft returns a NEW world and never mutates its input (the world, its
 * arrays, its policies, or the ops). Only the targeted collections change; every
 * other one is carried over by reference. Ops apply in order, so a later op sees
 * the result of earlier ones (create then update of the same id is fine).
 *
 * IDENTITY ATTRIBUTES (target 'identityAttributes', kind 'tag'): one bulk action —
 * add and/or remove attributes on many identities at once. It names no single entity:
 * opEntities lists the identities it touches (as 'identity' entities, so conflicts and
 * history treat them like any other identity change).
 *
 * SYSTEM entities (isSystem: a router identity's own ERP, created by Ziti) are
 * read-only: no op may update or delete one, create one, or set isSystem.
 */

import type {
  AccessTest,
  EdgeRouterPolicy,
  Identity,
  Policy,
  PostureCheck,
  PostureCheckType,
  Service,
  ServiceEdgeRouterPolicy,
} from '../../../shared/services/mock-data.service';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';

export type DraftTarget =
  | 'servicePolicy'
  | 'edgeRouterPolicy'
  | 'serviceEdgeRouterPolicy'
  | 'postureCheck'
  | 'service'
  | 'identity'
  | 'accessTest';

export type PolicyPatch = Partial<Omit<Policy, 'id'>>;
export type EdgeRouterPolicyPatch = Partial<Omit<EdgeRouterPolicy, 'id'>>;
export type ServiceEdgeRouterPolicyPatch = Partial<Omit<ServiceEdgeRouterPolicy, 'id'>>;
export type PostureCheckPatch = Partial<Omit<PostureCheck, 'id'>>;
export type AccessTestPatch = Partial<Omit<AccessTest, 'id'>>;
/** The only service fields a draft may change. */
export type ServiceConfigPatch = Partial<Pick<Service, 'terminatorStrategy'>>;
/** The only identity fields a draft may change: its default hosting precedence and cost
 *  (stored as hostingPrecedence / hostingCost, which the identity form already writes). */
export type IdentityHostingPatch = Partial<Pick<Identity, 'hostingPrecedence' | 'hostingCost'>>;

/** `target` may be omitted: it defaults to 'servicePolicy'. */
export type ServicePolicyOp =
  | { kind: 'create'; target?: 'servicePolicy'; policy: Policy }
  | { kind: 'update'; target?: 'servicePolicy'; policyId: string; patch: PolicyPatch }
  | { kind: 'delete'; target?: 'servicePolicy'; policyId: string };

export type EdgeRouterPolicyOp =
  | { kind: 'create'; target: 'edgeRouterPolicy'; policy: EdgeRouterPolicy }
  | { kind: 'update'; target: 'edgeRouterPolicy'; policyId: string; patch: EdgeRouterPolicyPatch }
  | { kind: 'delete'; target: 'edgeRouterPolicy'; policyId: string };

export type ServiceEdgeRouterPolicyOp =
  | { kind: 'create'; target: 'serviceEdgeRouterPolicy'; policy: ServiceEdgeRouterPolicy }
  | { kind: 'update'; target: 'serviceEdgeRouterPolicy'; policyId: string; patch: ServiceEdgeRouterPolicyPatch }
  | { kind: 'delete'; target: 'serviceEdgeRouterPolicy'; policyId: string };

export type PostureCheckOp =
  | { kind: 'create'; target: 'postureCheck'; policy: PostureCheck }
  | { kind: 'update'; target: 'postureCheck'; policyId: string; patch: PostureCheckPatch }
  | { kind: 'delete'; target: 'postureCheck'; policyId: string };

export type AccessTestOp =
  | { kind: 'create'; target: 'accessTest'; policy: AccessTest }
  | { kind: 'update'; target: 'accessTest'; policyId: string; patch: AccessTestPatch }
  | { kind: 'delete'; target: 'accessTest'; policyId: string };

/** Services and identities are only ever updated, and only in their config fields. */
export type ServiceConfigOp = { kind: 'update'; target: 'service'; policyId: string; patch: ServiceConfigPatch };
export type IdentityHostingOp = { kind: 'update'; target: 'identity'; policyId: string; patch: IdentityHostingPatch };
/** Bulk tagging: `add` and `remove` applied to every identity in `identityIds`. */
export type IdentityAttributesOp = {
  kind: 'tag';
  target: 'identityAttributes';
  identityIds: string[];
  add: string[];
  remove: string[];
};

export type DraftOp =
  | ServicePolicyOp
  | EdgeRouterPolicyOp
  | ServiceEdgeRouterPolicyOp
  | PostureCheckOp
  | ServiceConfigOp
  | IdentityHostingOp
  | AccessTestOp
  | IdentityAttributesOp;

/** Every op but bulk tagging: one entity, by id. */
export type EntityOp = Exclude<DraftOp, IdentityAttributesOp>;

/** An op's target: a DraftTarget, or 'identityAttributes' for bulk tagging. */
export type OpTarget = DraftTarget | 'identityAttributes';

export const targetOf = (op: DraftOp): OpTarget => op.target ?? 'servicePolicy';

export const isTagOp = (op: DraftOp): op is IdentityAttributesOp => op.kind === 'tag';

export const isServicePolicyOp = (op: DraftOp): op is ServicePolicyOp => targetOf(op) === 'servicePolicy';

/** The id an op creates, updates or deletes ('' for bulk tagging, which names many — see opEntities). */
export const opPolicyId = (op: DraftOp): string => (op.kind === 'tag' ? '' : op.kind === 'create' ? op.policy.id : op.policyId);

/** Every entity an op touches: its one entity — or, for bulk tagging, each identity. */
export function opEntities(op: DraftOp): { target: DraftTarget; id: string }[] {
  if (op.kind === 'tag') return op.identityIds.map((id) => ({ target: 'identity' as const, id }));
  return [{ target: op.target ?? 'servicePolicy', id: op.kind === 'create' ? op.policy.id : op.policyId }];
}

/** "Added #kiosks" / "#kiosks" etc.: an attribute as stored (with its '#'). */
const ATTRIBUTE = /^#[^\s#@,]+$/;

/** The identity's attributes after a tag op: removals, then additions not already there. */
export function tagAttributes(attributes: readonly string[], op: Pick<IdentityAttributesOp, 'add' | 'remove'>): string[] {
  const kept = attributes.filter((a) => !op.remove.includes(a));
  return [...kept, ...op.add.filter((a) => !kept.includes(a))];
}

function applyTag(identities: readonly Entity[], op: IdentityAttributesOp): readonly Entity[] {
  const fail = (msg: string): never => {
    throw new Error(`applyDraft tag: ${msg}`);
  };
  const lists = [op.identityIds, op.add, op.remove];
  if (!lists.every((l) => Array.isArray(l) && l.every((x) => typeof x === 'string'))) fail('needs identityIds, add and remove lists');
  if (!op.identityIds.length) fail('needs at least one identity');
  if (!op.add.length && !op.remove.length) fail('needs an attribute to add or remove');
  const bad = [...op.add, ...op.remove].filter((a) => !ATTRIBUTE.test(a));
  if (bad.length) fail(`invalid attribute ${bad.map((a) => `'${a}'`).join(', ')}`);
  const both = op.add.filter((a) => op.remove.includes(a));
  if (both.length) fail(`can't both add and remove ${both.join(', ')}`);
  const wanted = new Set(op.identityIds);
  if (wanted.size !== op.identityIds.length) fail('lists an identity twice');
  const known = new Set(identities.map((i) => i.id));
  const missing = op.identityIds.filter((id) => !known.has(id));
  if (missing.length) fail(`no identity with id ${missing.map((id) => `'${id}'`).join(', ')}`);
  return identities.map((i) => {
    if (!wanted.has(i.id)) return i;
    const before = (i['attributes'] as string[] | undefined) ?? [];
    const after = tagAttributes(before, op);
    return after.length === before.length && after.every((a, k) => a === before[k]) ? i : { ...i, attributes: after };
  });
}

// ─── per-target rules ─────────────────────────────────────────────────────────

type Entity = { id: string; [k: string]: unknown };
type CollectionKey =
  | 'policies'
  | 'edgeRouterPolicies'
  | 'serviceEdgeRouterPolicies'
  | 'postureChecks'
  | 'services'
  | 'identities'
  | 'accessTests';

const TYPES: readonly Policy['type'][] = ['dial', 'bind'];
const SEMANTICS: readonly Policy['semantic'][] = ['AnyOf', 'AllOf'];
export const CHECK_TYPES: readonly PostureCheckType[] = ['OS', 'MFA', 'Process', 'Domain', 'MAC', 'WindowsDomain', 'ServiceProvider'];
export const STRATEGIES: readonly NonNullable<Service['terminatorStrategy']>[] = ['smartrouting', 'weighted', 'random'];
export const PRECEDENCES = ['default', 'required', 'failed'] as const;
export const TEST_KINDS: readonly AccessTest['kind'][] = ['mustNotDial', 'mustNotHost', 'mustConnect'];
/** Ziti's terminator cost range. */
export const MAX_COST = 65535;

interface TargetRule {
  key: CollectionKey;
  /** Used in error messages: "no edge router policy with id …". */
  noun: string;
  /** Role arrays the entity must carry. */
  roles: readonly string[];
  /** Policies have a semantic; checks, services and identities don't. */
  semantic: boolean;
  /** Set for update-only targets: the only fields a patch may carry. */
  patchable?: readonly string[];
  validate?: (p: Entity, fail: (msg: string) => never) => void;
}

const RULES: Record<DraftTarget, TargetRule> = {
  servicePolicy: {
    key: 'policies',
    noun: 'policy',
    roles: [],
    semantic: true,
    validate: (p, fail) => {
      if (!TYPES.includes(p['type'] as Policy['type'])) fail(`has invalid type '${p['type']}'`);
      const isTime = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
      if (p['expiresAt'] !== undefined && !isTime(p['expiresAt'])) fail(`has invalid expiresAt '${p['expiresAt']}'`);
      const entries = p['expiringEntries'];
      if (entries === undefined) return;
      if (!Array.isArray(entries)) fail('has invalid expiringEntries');
      const roles = (p['identityRoles'] as string[] | undefined) ?? [];
      const seen = new Set<string>();
      for (const e of entries as { role?: unknown; expiresAt?: unknown }[]) {
        if (typeof e?.role !== 'string' || !e.role.startsWith('@')) fail(`has an expiring entry that isn't a named (@) identity`);
        const role = e.role as string;
        if (!roles.includes(role)) fail(`has an expiring entry for ${role}, which isn't in its identity roles`);
        if (seen.has(role)) fail(`lists an expiring entry for ${role} twice`);
        if (!isTime(e.expiresAt)) fail(`has invalid expiresAt '${e.expiresAt}' for ${role}`);
        seen.add(role);
      }
    },
  },
  edgeRouterPolicy: {
    key: 'edgeRouterPolicies',
    noun: 'edge router policy',
    roles: ['identityRoles', 'edgeRouterRoles'],
    semantic: true,
  },
  serviceEdgeRouterPolicy: {
    key: 'serviceEdgeRouterPolicies',
    noun: 'service edge router policy',
    roles: ['serviceRoles', 'edgeRouterRoles'],
    semantic: true,
  },
  postureCheck: {
    key: 'postureChecks',
    noun: 'posture check',
    roles: ['attributes'],
    semantic: false,
    validate: (p, fail) => {
      if (typeof p['name'] !== 'string' || !p['name'].trim()) fail('needs a name');
      if (!CHECK_TYPES.includes(p['type'] as PostureCheckType)) fail(`has invalid type '${p['type']}'`);
      const t = p['timeoutSeconds'];
      if (t !== undefined && !(Number.isInteger(t) && (t as number) >= 0)) fail(`has invalid timeout '${t}'`);
    },
  },
  service: {
    key: 'services',
    noun: 'service',
    roles: [],
    semantic: false,
    patchable: ['terminatorStrategy'],
    validate: (p, fail) => {
      const v = p['terminatorStrategy'];
      if (v !== undefined && !STRATEGIES.includes(v as never)) fail(`has invalid terminator strategy '${v}'`);
    },
  },
  accessTest: {
    key: 'accessTests',
    noun: 'access test',
    roles: [],
    semantic: false,
    validate: (p, fail) => {
      if (!TEST_KINDS.includes(p['kind'] as AccessTest['kind'])) fail(`has invalid kind '${p['kind']}'`);
      if (typeof p['serviceId'] !== 'string' || !p['serviceId']) fail('needs a service');
      const who = p['who'] as AccessTest['who'] | undefined;
      const list = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
      if (!who || !list(who.names) || !list(who.attributes)) fail('has an invalid who');
      if (!(who!.names?.length || who!.attributes?.length)) fail('needs at least one name or attribute');
    },
  },
  identity: {
    key: 'identities',
    noun: 'identity',
    roles: [],
    semantic: false,
    patchable: ['hostingPrecedence', 'hostingCost'],
    validate: (p, fail) => {
      const prec = p['hostingPrecedence'];
      if (prec !== undefined && !PRECEDENCES.includes(prec as never)) fail(`has invalid hosting precedence '${prec}'`);
      const cost = p['hostingCost'];
      if (cost !== undefined && !(Number.isInteger(cost) && (cost as number) >= 0 && (cost as number) <= MAX_COST)) {
        fail(`has invalid hosting cost '${cost}' (0–${MAX_COST})`);
      }
    },
  },
};

const article = (noun: string) => `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;

function ruleFor(op: EntityOp): TargetRule {
  const rule = RULES[op.target ?? 'servicePolicy'];
  if (!rule) throw new Error(`applyDraft ${op.kind}: invalid target '${op.target}'`);
  return rule;
}

function validate(p: Entity, rule: TargetRule, op: DraftOp['kind']): void {
  const fail = (msg: string): never => {
    throw new Error(`applyDraft ${op}: ${rule.noun} '${p.id}' ${msg}`);
  };
  rule.validate?.(p, fail);
  if (rule.semantic && !SEMANTICS.includes(p['semantic'] as Policy['semantic'])) fail(`has invalid semantic '${p['semantic']}'`);
  for (const r of rule.roles) {
    const v = p[r];
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) fail(`needs ${r}`);
  }
}

function indexOf(items: readonly Entity[], id: string, rule: TargetRule, op: DraftOp['kind']): number {
  const i = items.findIndex((p) => p.id === id);
  if (i < 0) throw new Error(`applyDraft ${op}: no ${rule.noun} with id '${id}'`);
  return i;
}

/** Copies the role arrays too, so the result shares no mutable state with the ops. */
const copy = (p: object): Entity =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])) as Entity;

// ─── apply ────────────────────────────────────────────────────────────────────

export function applyDraft(world: TrifectaWorld, ops: readonly DraftOp[]): TrifectaWorld {
  const start: Record<CollectionKey, readonly Entity[]> = {
    policies: world.policies as unknown as readonly Entity[],
    edgeRouterPolicies: world.edgeRouterPolicies as unknown as readonly Entity[],
    serviceEdgeRouterPolicies: world.serviceEdgeRouterPolicies as unknown as readonly Entity[],
    postureChecks: (world.postureChecks ?? []) as unknown as readonly Entity[],
    services: world.services as unknown as readonly Entity[],
    identities: world.identities as unknown as readonly Entity[],
    accessTests: (world.accessTests ?? []) as unknown as readonly Entity[],
  };
  const next = { ...start };

  for (const op of ops) {
    if (op.kind === 'tag') {
      const target = (op as { target?: string }).target;
      if (target !== 'identityAttributes') throw new Error(`applyDraft tag: invalid target '${target}'`);
      next.identities = applyTag(next.identities, op);
      continue;
    }
    const rule = ruleFor(op);
    const items = next[rule.key];
    if (rule.patchable && op.kind !== 'update') {
      throw new Error(`applyDraft ${op.kind}: a draft can only update ${article(rule.noun)}`);
    }
    if (rule.patchable && op.kind === 'update') {
      const extra = Object.keys(op.patch).filter((k) => !rule.patchable!.includes(k));
      if (extra.length) throw new Error(`applyDraft update: a draft can't change ${article(rule.noun)}'s ${extra.join(', ')}`);
    }
    if (op.kind === 'create' && (op.policy as unknown as Entity)['isSystem']) {
      throw new Error(`applyDraft create: a draft can't create a system ${rule.noun}`);
    }
    if (op.kind === 'update' && 'isSystem' in op.patch) {
      throw new Error(`applyDraft update: a draft can't change whether ${article(rule.noun)} is a system one`);
    }
    if (op.kind !== 'create') {
      const target = items.find((p) => p.id === op.policyId);
      if (target?.['isSystem']) {
        throw new Error(`applyDraft ${op.kind}: ${String(target['name'] ?? op.policyId)} is a system ${rule.noun} created by Ziti — it can't be changed`);
      }
    }
    switch (op.kind) {
      case 'create': {
        if (items.some((p) => p.id === op.policy.id)) {
          throw new Error(`applyDraft create: duplicate ${rule.noun} id '${op.policy.id}'`);
        }
        const created = copy(op.policy);
        validate(created, rule, op.kind);
        next[rule.key] = [...items, created];
        break;
      }
      case 'update': {
        const i = indexOf(items, op.policyId, rule, op.kind);
        // The id is the key: a patch never renames it.
        const updated = copy({ ...items[i], ...op.patch, id: op.policyId });
        validate(updated, rule, op.kind);
        next[rule.key] = items.map((p, j) => (j === i ? updated : p));
        break;
      }
      case 'delete': {
        const i = indexOf(items, op.policyId, rule, op.kind);
        next[rule.key] = items.filter((_, j) => j !== i);
        break;
      }
    }
  }

  // Untouched collections keep their identity (and an absent postureChecks stays absent).
  const pick = <T>(key: CollectionKey, original: T): T => (next[key] === start[key] ? original : (next[key] as unknown as T));
  return {
    ...world,
    policies: pick('policies', world.policies),
    edgeRouterPolicies: pick('edgeRouterPolicies', world.edgeRouterPolicies),
    serviceEdgeRouterPolicies: pick('serviceEdgeRouterPolicies', world.serviceEdgeRouterPolicies),
    postureChecks: pick('postureChecks', world.postureChecks),
    services: pick('services', world.services),
    identities: pick('identities', world.identities),
    accessTests: pick('accessTests', world.accessTests),
  };
}
