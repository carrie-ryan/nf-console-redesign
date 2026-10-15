/**
 * RECORDED MODEL — a stand-in for the LLM: seven recorded scenarios, matched on the
 * exact suggestion text and templated on the current service. Anything else gets
 * one question back. Same shape as a real tool call, so interpretRequest validates
 * it the same way.
 *
 *   host       → create a Bind rule: #servers
 *   dial       → create a Dial rule: #laptops
 *                (the same two templates work for any one attribute:
 *                "Let any identity with #kiosks host this service")
 *   plus       → create one all-of Bind rule [@server-build-01, #servers, #prod]:
 *                the name is let in by itself, OR anyone with both attributes
 *   mark43     → question: one rule can't require a name AND attributes — offer
 *                (a) the name only, or (b) the attributes only (answer chips)
 *   and        → question: "users and laptops" — either attribute, or both?
 *                (answer chips)
 *   unknown    → create a Dial rule naming @jenkins; interpretRequest finds no such
 *                identity and turns it into a question
 *   remove     → changes the previous turn's #laptops op: drops #laptops from its
 *                rule (or deletes the policy when nothing is left). From an all-of
 *                rule of 2+ terms that WIDENS it, so: a question with the counts,
 *                no ops (answer chips: remove anyway / delete the rule).
 *
 * ANSWERS are the replies those questions offer as chips — recorded scenarios too.
 *
 * Beyond the exact texts, two families of prompt are parsed:
 *   "Let any identity with #<attr> host|dial this service" — a one-attribute rule;
 *   "everyone except <B>" / "all <A> except <B>" (exclusion.ts) — no ops: Ziti can't
 *   deny, so a reply with two answer chips (a must-not test for <B>; the identities
 *   in <A> without <B>), each handled here as well.
 */

import type { Policy } from '../../../shared/services/mock-data.service';
import { entityMatchesRoles } from '../../authorization/authorization-resolver';
import { isServicePolicyOp, opPolicyId, type DraftOp } from '../draft/policy-draft';
import { freshPolicyId, type Model, type ModelContext, type ModelResult } from './interpret';
import {
  LIST_PROMPT,
  TEST_PROMPT,
  exclusionQuestions,
  listPrompt,
  mustNotTest,
  noDenyReply,
  parseExclusion,
  testPrompt,
  withoutAttribute,
} from './exclusion';

export const SUGGESTIONS = {
  host: 'Let any identity with #servers host this service',
  dial: 'Let any identity with #laptops dial this service',
  plus: 'Let server-build-01 host this service, plus any identity with both #servers and #prod',
  mark43: 'Only server-build-01 should host this, and only if it has #servers and #prod',
  and: 'Let users and laptops dial this service',
  unknown: 'Let jenkins dial this service',
  remove: 'Remove the laptops',
} as const;

/** Replies offered under questions (not shown with the example prompts). */
export const ANSWERS = {
  nameOnly: 'server-build-01 by name only',
  attrsOnly: 'Anyone with #servers and #prod',
  either: 'Let identities with #users or #laptops dial this service',
  both: 'Let identities with both #users and #laptops dial this service',
  removeAnyway: 'Remove #laptops anyway',
  deleteRule: 'Delete the laptops rule',
} as const;

export const FALLBACK_QUESTION = 'This prototype only understands the example prompts.';

/** A new service policy on the current service, named like the builder's "+ Add rule". */
function createRule(
  ctx: ModelContext,
  type: Policy['type'],
  identityRoles: string[],
  semantic: Policy['semantic'] = 'AnyOf',
): DraftOp {
  const id = freshPolicyId('pol-draft-', ctx.draftWorld);
  return {
    kind: 'create',
    policy: {
      id,
      name: `new-${type}-rule-${id.slice('pol-draft-'.length)}`,
      createdAt: new Date().toISOString(),
      status: 'active',
      type,
      semantic,
      identityRoles,
      serviceRoles: [`@${ctx.serviceId}`],
      postureCheckRoles: [],
    },
  };
}

/** The latest earlier op on this service whose identity rule includes `role`. */
function previousOpWith(ctx: ModelContext, role: string): Policy | null {
  for (const op of [...ctx.draftOps].reverse()) {
    if (!isServicePolicyOp(op) || op.kind === 'delete') continue;
    const policy = ctx.draftWorld.policies.find((p) => p.id === opPolicyId(op));
    if (policy?.serviceRoles.includes(`@${ctx.serviceId}`) && policy.identityRoles.includes(role)) return policy;
  }
  return null;
}

const SCENARIOS: Record<string, (ctx: ModelContext) => ModelResult> = {
  [SUGGESTIONS.host]: (ctx) => ({ ops: [createRule(ctx, 'bind', ['#servers'])] }),

  [SUGGESTIONS.dial]: (ctx) => ({ ops: [createRule(ctx, 'dial', ['#laptops'])] }),

  [SUGGESTIONS.plus]: (ctx) => ({ ops: [createRule(ctx, 'bind', ['@server-build-01', '#servers', '#prod'], 'AllOf')] }),

  [SUGGESTIONS.mark43]: (ctx) => ({
    questions: [
      `A policy can list names and attributes, but they combine as OR: a named identity is always ` +
        `included, whatever its attributes. There's no way to say "server-build-01, but only if it has ` +
        `#servers and #prod." Which do you want for ${ctx.serviceName}?`,
    ],
    answers: [ANSWERS.nameOnly, ANSWERS.attrsOnly],
  }),

  [SUGGESTIONS.and]: () => ({
    questions: ['Do you mean identities with #users or #laptops (either one), or only identities that have both?'],
    answers: [ANSWERS.either, ANSWERS.both],
  }),

  [ANSWERS.nameOnly]: (ctx) => ({ ops: [createRule(ctx, 'bind', ['@server-build-01'])] }),
  [ANSWERS.attrsOnly]: (ctx) => ({ ops: [createRule(ctx, 'bind', ['#servers', '#prod'], 'AllOf')] }),
  [ANSWERS.either]: (ctx) => ({ ops: [createRule(ctx, 'dial', ['#users', '#laptops'], 'AnyOf')] }),
  [ANSWERS.both]: (ctx) => ({ ops: [createRule(ctx, 'dial', ['#users', '#laptops'], 'AllOf')] }),
  [ANSWERS.removeAnyway]: (ctx) => removeLaptops(ctx, true),
  [ANSWERS.deleteRule]: (ctx) => {
    const policy = previousOpWith(ctx, '#laptops');
    return policy
      ? { ops: [{ kind: 'delete', policyId: policy.id }] }
      : { questions: [`There's no #laptops rule for ${ctx.serviceName} in this draft to remove.`] };
  },

  [SUGGESTIONS.unknown]: (ctx) => ({ ops: [createRule(ctx, 'dial', ['@jenkins'])] }),

  [SUGGESTIONS.remove]: (ctx) => removeLaptops(ctx, false),
};

/** "Remove the laptops": drop #laptops from the previous turn's rule. Narrowing to a
 *  smaller all-of rule widens it, so that asks first unless `anyway`. */
function removeLaptops(ctx: ModelContext, anyway: boolean): ModelResult {
  const policy = previousOpWith(ctx, '#laptops');
  if (!policy) return { questions: [`There's no #laptops rule for ${ctx.serviceName} in this draft to remove.`] };
  const identityRoles = policy.identityRoles.filter((r) => r !== '#laptops');
  const terms = policy.identityRoles.filter((r) => r.startsWith('#'));
  if (policy.semantic === 'AllOf' && terms.length > 1 && !anyway) {
    // Dropping a term from an all-of rule lets MORE identities in.
    const count = (roles: readonly string[]) =>
      ctx.draftWorld.identities.filter((i) => entityMatchesRoles(roles, 'AllOf', i.attributes, i.name, i.id)).length;
    const [now, widened] = [count(policy.identityRoles), count(identityRoles)];
    const rest = terms.filter((t) => t !== '#laptops').join(', ');
    return {
      questions: [
        `${policy.name} matches all of ${terms.join(', ')}. Removing #laptops would widen it from ` +
          `${now} to ${widened} ${widened === 1 ? 'identity' : 'identities'} — anyone with ${rest}. ` +
          `Remove #laptops anyway, or delete the rule?`,
      ],
      answers: [ANSWERS.removeAnyway, ANSWERS.deleteRule],
    };
  }
  return {
    ops: [
      identityRoles.length
        ? { kind: 'update', policyId: policy.id, patch: { identityRoles } }
        : { kind: 'delete', policyId: policy.id },
    ],
  };
}

/** "Let any identity with #<attr> host|dial this service" — the host / dial templates, any one attribute. */
const ONE_ATTRIBUTE = /^Let any identity with (#[\w-]+) (host|dial) this service$/;

/** Names listed by "Show identities in <A> without <B>" before "…and N more". */
const LIST_LIMIT = 20;

/** "everyone except <B>" / "all <A> except <B>": why not, and the two ways round it. */
function exclusion(text: string, ctx: ModelContext): ModelResult | null {
  const req = parseExclusion(text);
  if (!req) return null;
  const questions = exclusionQuestions(req, ctx.draftWorld);
  if (questions.length) return { questions };
  return { reply: noDenyReply(req.except), answers: [testPrompt(req.except), listPrompt(req.from, req.except)] };
}

/** "Add a must-not test for <B>": the track is the latest exclusion request's (dial if none). */
function addMustNotTest(except: string, ctx: ModelContext): ModelResult {
  const asked = [...ctx.history].reverse().map(parseExclusion).find((r) => r !== null);
  const test = mustNotTest(ctx.draftWorld, ctx.serviceId, ctx.serviceName, asked?.track ?? 'dial', except);
  return { ops: [{ kind: 'create', target: 'accessTest', policy: test }] };
}

/** "Show identities in <A> without <B>": the starting point for a narrower attribute. */
function listWithout(from: string | null, except: string, ctx: ModelContext): ModelResult {
  const questions = exclusionQuestions({ from, except }, ctx.draftWorld);
  if (questions.length) return { questions };
  const names = withoutAttribute(ctx.draftWorld, from, except).map((i) => i.name);
  const who = from ? `have ${from} but not ${except}` : `don't have ${except}`;
  const n = names.length;
  const reply = n
    ? `${n} ${n === 1 ? 'identity' : 'identities'} ${who}. Give them an attribute of their own and grant that, ` +
      `instead of ${from ?? 'everyone'}:`
    : `No identity ${from ? `has ${from} but not ${except}` : `is without ${except}`}.`;
  const items = names.slice(0, LIST_LIMIT);
  if (n > LIST_LIMIT) items.push(`…and ${n - LIST_LIMIT} more`);
  return { reply, items, answers: [testPrompt(except)] };
}

export const recordedModel: Model = (text, ctx) => {
  const scenario = SCENARIOS[text];
  if (scenario) return scenario(ctx);
  const m = ONE_ATTRIBUTE.exec(text);
  if (m) return { ops: [createRule(ctx, m[2] === 'host' ? 'bind' : 'dial', [m[1]])] };
  const test = TEST_PROMPT.exec(text);
  if (test) return addMustNotTest(test[1], ctx);
  const list = LIST_PROMPT.exec(text);
  if (list) return listWithout(list[1] ?? null, list[2], ctx);
  return exclusion(text, ctx) ?? { questions: [FALLBACK_QUESTION] };
};
