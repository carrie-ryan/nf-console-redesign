/**
 * INTERPRET — turns a plain-language request into draft ops, through a model whose
 * output is checked, never trusted. Pure apart from the model call; no UI.
 *
 *   interpretRequest(text, world, serviceId, draftOps, model)
 *     → { ops, summary, questions, notes }
 *
 * The model (recorded-model.ts today; a tool-calling LLM later) returns a
 * tool-call-shaped { ops?, questions?, answers? }. Then:
 *   1. Model questions — or a plain reply (text, perhaps a list of items) — pass
 *      through, and stop it: no ops. Its `answers` (suggested replies, each a prompt
 *      the user can send back) pass through with them.
 *   2. Every role the ops name must exist — @identity / #identity-attribute,
 *      @service / #service-attribute, @router / #router-attribute ('#all' always
 *      exists). An unknown one becomes a question, and no ops are returned.
 *   3. applyDraft(draftWorld, ops) must not throw; if it does, a question, no ops.
 *   4. summary is built from the ops alone, with the builder's own group label
 *      (labelGroup via layoutServiceView) — never from model text.
 *   5. notes: routing gaps the ops open — pairs that become AUTHORIZED_NO_ROUTER —
 *      one per group, so "Set up routing" can open that group's gap panel.
 *
 * `world` is live; the ops apply on top of draftWorld = applyDraft(world, draftOps).
 */

import type { Policy } from '../../../shared/services/mock-data.service';
import { entityMatchesRoles } from '../../authorization/authorization-resolver';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { diffWorlds } from '../draft/draft-diff';
import { describeOps, trackCount } from '../draft/draft-summary';
import { applyDraft, isServicePolicyOp, opPolicyId, type DraftOp } from '../draft/policy-draft';
import { describeGroup, layoutServiceView, type Group } from '../service-view.layout';

/** What the model sees besides the text. */
export interface ModelContext {
  serviceId: string;
  serviceName: string;
  /** The ops already in the draft (earlier turns), oldest first. */
  draftOps: readonly DraftOp[];
  /** applyDraft(world, draftOps) — what the request applies on top of. */
  draftWorld: TrifectaWorld;
  /** The conversation so far on this service: earlier prompts, oldest first. */
  history: readonly string[];
}

/** A tool call's arguments: proposed ops, or questions back to the user. */
export interface ModelResult {
  ops?: DraftOp[];
  questions?: string[];
  /** Suggested replies to the questions — each one a prompt the user can send. */
  answers?: string[];
  /** A plain answer, no ops: an explanation, perhaps with a list (`items`). */
  reply?: string;
  items?: string[];
}

export type Model = (text: string, context: ModelContext) => ModelResult | Promise<ModelResult>;

/** A routing gap the ops open on one group. */
export interface RoutingNote {
  /** "31 hosts (any identity with #servers) on reports-svc would have no shared router." */
  text: string;
  serviceId: string;
  /** The group's id in the service view — the gap panel's groupId. */
  groupId: string;
  kind: 'noSharedRouter';
}

export interface Interpretation {
  /** Validated ops, ready for the store; empty whenever there are questions. */
  ops: DraftOp[];
  /** One line per op, in the builder's wording. */
  summary: string[];
  questions: string[];
  /** A plain answer, no ops (an explanation), and any list it gives. */
  reply: string | null;
  items: string[];
  /** Suggested replies to `questions` / `reply`, shown as chips under them. */
  answers: string[];
  /** Routing gaps the ops would open. */
  notes: RoutingNote[];
}

const NOTHING: Omit<Interpretation, 'questions'> = { ops: [], summary: [], reply: null, items: [], answers: [], notes: [] };

type Named = { id: string; name: string; attributes?: readonly string[] };

/** Roles naming nothing in `entities`, worded for a question. */
function unknownRoles(roles: readonly string[], entities: readonly Named[], noun: string): string[] {
  return roles
    .filter((r) => r !== '#all')
    .filter((r) => !entities.some((e) => entityMatchesRoles([r], 'AnyOf', e.attributes ?? [], e.name, e.id)))
    .map((r) =>
      r.startsWith('@')
        ? `There's no ${noun} named "${r.slice(1)}". Which ${noun} did you mean?`
        : `No ${noun} has the attribute ${r}. Did you mean a different attribute?`,
    );
}

function validateRoles(ops: readonly DraftOp[], world: TrifectaWorld): string[] {
  const questions: string[] = [];
  for (const op of ops) {
    const fields = op.kind === 'create' ? op.policy : op.kind === 'update' ? op.patch : null;
    if (!fields) continue;
    const f = fields as Partial<Record<'identityRoles' | 'serviceRoles' | 'edgeRouterRoles', string[]>>;
    questions.push(
      ...unknownRoles(f.identityRoles ?? [], world.identities, 'identity'),
      ...unknownRoles(f.serviceRoles ?? [], world.services, 'service'),
      ...unknownRoles(f.edgeRouterRoles ?? [], world.edgeRouters, 'router'),
    );
  }
  return [...new Set(questions)];
}

/**
 * One line per op. A service policy covering `serviceId` reads as its group
 * label(s) on the builder's canvas — "Hosts: any identity with #servers · 31
 * authorized · …" — taken from the world it exists in (after for create/update,
 * before for delete, prefixed "Removes"). Anything else falls back to the review
 * panel's describeOps line.
 */
function summarize(ops: readonly DraftOp[], before: TrifectaWorld, after: TrifectaWorld, serviceId: string): string[] {
  const labels = (world: TrifectaWorld, policyId: string) => {
    const l = layoutServiceView(serviceId, world);
    return [...l.bind.groups, ...l.dial.groups].filter((g) => g.policyId === policyId).map((g) => g.label.text);
  };
  return ops.flatMap((op, i) => {
    if (isServicePolicyOp(op)) {
      const found = op.kind === 'delete' ? labels(before, op.policyId) : labels(after, opPolicyId(op));
      if (found.length) return op.kind === 'delete' ? found.map((t) => `Removes ${t}`) : found;
    }
    // Describe against the world this op applies to.
    return describeOps(applyDraft(before, ops.slice(0, i)), [op]);
  });
}

/**
 * One note per group holding pairs that newly become AUTHORIZED_NO_ROUTER. Each
 * pair counts once: in a group of a policy the ops touch if it is in one, else the
 * first group (Bind, then Dial) on its service and lane that holds it.
 */
function routingNotes(ops: readonly DraftOp[], before: TrifectaWorld, after: TrifectaWorld): RoutingNote[] {
  const opened = diffWorlds(before, after).pairChanges.filter(
    (c) => c.after === 'AUTHORIZED_NO_ROUTER' && c.before !== 'AUTHORIZED_NO_ROUTER',
  );
  const touched = new Set(ops.filter(isServicePolicyOp).map(opPolicyId));
  const layouts = new Map<string, ReturnType<typeof layoutServiceView>>();
  const layoutOf = (id: string) => layouts.get(id) ?? layouts.set(id, layoutServiceView(id, after)).get(id)!;
  const counts = new Map<string, { group: Group; serviceId: string; n: number }>();
  for (const c of opened) {
    const groups = layoutOf(c.serviceId)[c.track].groups.filter((g) => g.memberIds.includes(c.identityId));
    const group = groups.find((g) => touched.has(g.policyId)) ?? groups[0];
    if (!group) continue;
    const entry = counts.get(group.id) ?? { group, serviceId: c.serviceId, n: 0 };
    entry.n++;
    counts.set(group.id, entry);
  }
  // Canvas order: per service, Bind before Dial, then top to bottom.
  const order = (e: { group: Group; serviceId: string }) => [e.serviceId, e.group.lane === 'bind' ? 0 : 1, e.group.y] as const;
  const sorted = [...counts.values()].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0].localeCompare(y[0]) || x[1] - y[1] || x[2] - y[2];
  });
  return sorted.map(({ group, serviceId, n }) => ({
    text:
      `${trackCount(n, group.lane)} (${describeGroup(group)}) on ` +
      `${after.services.find((s) => s.id === serviceId)?.name ?? serviceId} would have no shared router.`,
    serviceId,
    groupId: group.id,
    kind: 'noSharedRouter',
  }));
}

export async function interpretRequest(
  text: string,
  world: TrifectaWorld,
  serviceId: string,
  draftOps: readonly DraftOp[],
  model: Model,
  history: readonly string[] = [],
): Promise<Interpretation> {
  const service = world.services.find((s) => s.id === serviceId);
  if (!service) throw new Error(`interpretRequest: unknown service '${serviceId}'`);
  const draftWorld = applyDraft(world, draftOps);

  const result = await model(text, { serviceId, serviceName: service.name, draftOps, draftWorld, history });
  const ops = result.ops ?? [];

  if (result.questions?.length || result.reply) {
    return {
      ...NOTHING,
      reply: result.reply ?? null,
      items: [...(result.items ?? [])],
      questions: [...(result.questions ?? [])],
      answers: [...(result.answers ?? [])],
    };
  }
  if (!ops.length) return { ...NOTHING, questions: ['What would you like to change?'] };

  const unknown = validateRoles(ops, draftWorld);
  if (unknown.length) return { ...NOTHING, questions: unknown };

  let after: TrifectaWorld;
  try {
    after = applyDraft(draftWorld, ops);
  } catch (e) {
    return { ...NOTHING, questions: [`That change can't be applied: ${e instanceof Error ? e.message : String(e)}`] };
  }

  return {
    ops: [...ops],
    summary: summarize(ops, draftWorld, after, serviceId),
    reply: null,
    items: [],
    questions: [],
    answers: [],
    notes: routingNotes(ops, draftWorld, after),
  };
}

/** A policy id with `prefix` not taken in `world` — for models proposing creates. */
export function freshPolicyId(prefix: string, world: TrifectaWorld): string {
  const taken = new Set(world.policies.map((p: Policy) => p.id));
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
