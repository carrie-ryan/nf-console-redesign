/**
 * Proves interpretRequest + the recorded model: each of the six scenarios on
 * reports-svc in the seed world. Every returned op applies; the question cases
 * return no ops; summaries are the builder's own group labels.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/assist/interpret.spec.ts`
 */

import type { Policy } from '../../../shared/services/mock-data.service';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { applyDraft, opPolicyId, type DraftOp } from '../draft/policy-draft';
import { layoutServiceView } from '../service-view.layout';
import { interpretRequest, type Interpretation, type Model } from './interpret';
import { ANSWERS, FALLBACK_QUESTION, SUGGESTIONS, recordedModel } from './recorded-model';

const REPORTS = 'svc-008';
const seed = buildSeedWorld();

const ask = (text: string, draftOps: readonly DraftOp[] = [], model: Model = recordedModel) =>
  interpretRequest(text, seed, REPORTS, draftOps, model);

/** The canvas's label text for a policy's groups on reports-svc. */
const canvasLabels = (world: TrifectaWorld, policyId: string) => {
  const l = layoutServiceView(REPORTS, world);
  return [...l.bind.groups, ...l.dial.groups].filter((g) => g.policyId === policyId).map((g) => g.label.text);
};

/** The ops apply on top of the draft (applyDraft throws otherwise). */
const expectApplies = (r: Interpretation, draftOps: readonly DraftOp[] = []) => {
  const after = applyDraft(applyDraft(seed, draftOps), r.ops);
  expect(after).toBeTruthy();
  return after;
};

describe('interpretRequest with the recorded model (reports-svc, seed)', () => {
  it('host #servers → one Bind rule, summarised as its canvas label, with a routing note', async () => {
    const r = await ask(SUGGESTIONS.host);
    expect(r.questions).toEqual([]);
    expect(r.ops).toMatchObject([
      { kind: 'create', policy: { type: 'bind', semantic: 'AnyOf', identityRoles: ['#servers'], serviceRoles: [`@${REPORTS}`] } },
    ]);
    const after = expectApplies(r);
    expect(r.summary).toEqual(canvasLabels(after, opPolicyId(r.ops[0])));
    expect(r.summary).toEqual(['Hosts: any identity with #servers · 31 authorized · 0 with an online route · 31 with no shared router']);
    expect(r.notes).toEqual([{
      text: '31 hosts (any identity with #servers) on reports-svc would have no shared router.',
      serviceId: REPORTS,
      groupId: `bind:${opPolicyId(r.ops[0])}:rule`,
      kind: 'noSharedRouter',
    }]);
  });

  it('dial #laptops → one Dial rule', async () => {
    const r = await ask(SUGGESTIONS.dial);
    expect(r.ops).toMatchObject([{ kind: 'create', policy: { type: 'dial', identityRoles: ['#laptops'] } }]);
    const after = expectApplies(r);
    expect(r.summary).toEqual(canvasLabels(after, opPolicyId(r.ops[0])));
    expect(r.summary[0]).toMatch(/^Can dial: any identity with #laptops · 11 authorized · /);
    expect(r.notes.map((n) => [n.text, n.groupId])).toEqual([
      ['11 dialers (any identity with #laptops) on reports-svc would have no shared router.', `dial:${opPolicyId(r.ops[0])}:rule`],
    ]);
  });

  it('"plus" → one all-of Bind rule; applies as two groups, summarised as both canvas labels', async () => {
    const r = await ask(SUGGESTIONS.plus);
    expect(r.questions).toEqual([]);
    expect(r.ops).toMatchObject([
      { kind: 'create', policy: { type: 'bind', semantic: 'AllOf', identityRoles: ['@server-build-01', '#servers', '#prod'] } },
    ]);
    const after = expectApplies(r);
    const id = opPolicyId(r.ops[0]);
    const groups = layoutServiceView(REPORTS, after).bind.groups.filter((g) => g.policyId === id);
    expect(groups.map((g) => [g.kind, g.memberCount])).toEqual([['named', 1], ['rule', 7]]);
    expect(r.summary).toEqual(canvasLabels(after, id));
    expect(r.summary).toEqual([
      'Hosts: server-build-01 · 1 authorized · 0 with an online route · 1 with no shared router',
      'Hosts: any identity matching all of #servers, #prod · 7 authorized · 0 with an online route · 7 with no shared router',
    ]);
    // One routing note per group, each pointing at its own gap panel.
    expect(r.notes.map((n) => [n.text, n.groupId])).toEqual([
      ['1 host (server-build-01) on reports-svc would have no shared router.', `bind:${id}:named`],
      ['7 hosts (any identity matching all of #servers, #prod) on reports-svc would have no shared router.', `bind:${id}:rule`],
    ]);
  });

  it('the Mark43 request → no ops; a question offering name-only or attributes-only', async () => {
    const r = await ask(SUGGESTIONS.mark43);
    expect(r.ops).toEqual([]);
    expect(r.summary).toEqual([]);
    expect(r.questions).toEqual([
      'A policy can list names and attributes, but they combine as OR: a named identity is always ' +
        "included, whatever its attributes. There's no way to say \"server-build-01, but only if it has " +
        '#servers and #prod." Which do you want for reports-svc?',
    ]);
    expect(r.answers).toEqual([ANSWERS.nameOnly, ANSWERS.attrsOnly]);
  });

  it('the Mark43 answers: (a) name only → one named group; (b) attributes only → one all-of rule group', async () => {
    const a = await ask(ANSWERS.nameOnly);
    const b = await ask(ANSWERS.attrsOnly);
    const groups = (r: Interpretation) =>
      layoutServiceView(REPORTS, expectApplies(r)).bind.groups.map((g) => [g.kind, g.memberCount]);
    expect(groups(a)).toEqual([['named', 1]]);
    expect(groups(b)).toEqual([['rule', 7]]);
    expect(b.ops).toMatchObject([{ policy: { semantic: 'AllOf', identityRoles: ['#servers', '#prod'] } }]);
  });

  it('"users and laptops" → either-or-both question, no ops', async () => {
    const r = await ask(SUGGESTIONS.and);
    expect(r.ops).toEqual([]);
    expect(r.questions).toEqual([
      'Do you mean identities with #users or #laptops (either one), or only identities that have both?',
    ]);
    expect(r.answers).toEqual([ANSWERS.either, ANSWERS.both]);
    const either = await ask(ANSWERS.either);
    const both = await ask(ANSWERS.both);
    expect(either.ops).toMatchObject([{ policy: { semantic: 'AnyOf', identityRoles: ['#users', '#laptops'] } }]);
    expect(both.ops).toMatchObject([{ policy: { semantic: 'AllOf', identityRoles: ['#users', '#laptops'] } }]);
    const dialers = (x: Interpretation) => layoutServiceView(REPORTS, expectApplies(x)).dial.total;
    expect(dialers(either)).toBeGreaterThan(dialers(both));
  });

  it('unknown "jenkins" → the model proposes @jenkins; validation turns it into a question, no ops', async () => {
    const r = await ask(SUGGESTIONS.unknown);
    expect(r.ops).toEqual([]);
    expect(r.questions).toEqual(['There\'s no identity named "jenkins". Which identity did you mean?']);
  });

  it('"remove the laptops" → changes the previous turn\'s #laptops op', async () => {
    const turn1 = await ask(SUGGESTIONS.dial);
    const r = await ask(SUGGESTIONS.remove, turn1.ops);
    const created = opPolicyId(turn1.ops[0]);
    // #laptops was its only role, so the rule goes.
    expect(r.ops).toEqual([{ kind: 'delete', policyId: created }]);
    const after = expectApplies(r, turn1.ops);
    expect(after.policies.some((p) => p.id === created)).toBe(false);
    expect(r.summary).toEqual(canvasLabels(applyDraft(seed, turn1.ops), created).map((t) => `Removes ${t}`));
    expect(r.notes).toEqual([]);
  });

  it('"remove the laptops" on an any-of rule of 2 terms drops only #laptops', async () => {
    const turn1 = await ask(SUGGESTIONS.dial);
    const op = turn1.ops[0] as { kind: 'create'; policy: Policy };
    const mixed: DraftOp[] = [{ kind: 'create', policy: { ...op.policy, identityRoles: ['#laptops', '#users'] } }];
    const r = await ask(SUGGESTIONS.remove, mixed);
    expect(r.ops).toEqual([{ kind: 'update', policyId: opPolicyId(op), patch: { identityRoles: ['#users'] } }]);
    const after = expectApplies(r, mixed);
    expect(r.summary).toEqual(canvasLabels(after, opPolicyId(op)));
  });

  it('"remove the laptops" from an all-of rule of 2+ terms → a question with the widened count, no ops', async () => {
    const turn1 = await ask(SUGGESTIONS.dial);
    const op = turn1.ops[0] as { kind: 'create'; policy: Policy };
    const allOf: DraftOp[] = [
      { kind: 'create', policy: { ...op.policy, semantic: 'AllOf', identityRoles: ['#laptops', '#users'] } },
    ];
    const r = await ask(SUGGESTIONS.remove, allOf);
    expect(r.ops).toEqual([]);
    const both = seed.identities.filter((i) => i.attributes.includes('#laptops') && i.attributes.includes('#users')).length;
    const users = seed.identities.filter((i) => i.attributes.includes('#users')).length;
    expect(r.questions).toEqual([
      `${op.policy.name} matches all of #laptops, #users. Removing #laptops would widen it from ${both} to ${users} ` +
        'identities — anyone with #users. Remove #laptops anyway, or delete the rule?',
    ]);
    expect(users).toBeGreaterThan(both);
    expect(r.answers).toEqual([ANSWERS.removeAnyway, ANSWERS.deleteRule]);

    // The answers: remove anyway → drop #laptops; delete → the rule goes.
    const anyway = await ask(ANSWERS.removeAnyway, allOf);
    expect(anyway.ops).toEqual([{ kind: 'update', policyId: op.policy.id, patch: { identityRoles: ['#users'] } }]);
    expectApplies(anyway, allOf);
    const del = await ask(ANSWERS.deleteRule, allOf);
    expect(del.ops).toEqual([{ kind: 'delete', policyId: op.policy.id }]);
    expectApplies(del, allOf);
  });

  it('"remove the laptops" on a rule whose only attribute is #laptops but which names identities keeps the names', async () => {
    const turn1 = await ask(SUGGESTIONS.dial);
    const op = turn1.ops[0] as { kind: 'create'; policy: Policy };
    for (const semantic of ['AnyOf', 'AllOf'] as const) {
      const named: DraftOp[] = [
        { kind: 'create', policy: { ...op.policy, semantic, identityRoles: ['@laptop-alice', '#laptops'] } },
      ];
      const r = await ask(SUGGESTIONS.remove, named);
      expect(r.ops, semantic).toEqual([{ kind: 'update', policyId: op.policy.id, patch: { identityRoles: ['@laptop-alice'] } }]);
      const after = expectApplies(r, named);
      const groups = layoutServiceView(REPORTS, after).dial.groups.filter((g) => g.policyId === op.policy.id);
      expect(groups.map((g) => [g.kind, g.memberNames]), semantic).toEqual([['named', ['laptop-alice']]]);
    }
  });

  it('"remove the laptops" from an all-of rule of one term still deletes it', async () => {
    const turn1 = await ask(SUGGESTIONS.dial);
    const op = turn1.ops[0] as { kind: 'create'; policy: Policy };
    const allOf: DraftOp[] = [{ kind: 'create', policy: { ...op.policy, semantic: 'AllOf' } }];
    const r = await ask(SUGGESTIONS.remove, allOf);
    expect(r.ops).toEqual([{ kind: 'delete', policyId: op.policy.id }]);
  });

  it('"remove the laptops" with nothing to remove → a question', async () => {
    const r = await ask(SUGGESTIONS.remove);
    expect(r.ops).toEqual([]);
    expect(r.questions).toEqual(["There's no #laptops rule for reports-svc in this draft to remove."]);
  });

  it('any other text → the fallback question', async () => {
    const r = await ask('let everyone in');
    expect(r).toEqual({ ops: [], summary: [], reply: null, items: [], questions: [FALLBACK_QUESTION], answers: [], notes: [] });
  });

  it('a new rule takes the next free draft id', async () => {
    const turn1 = await ask(SUGGESTIONS.dial);
    const turn2 = await ask(SUGGESTIONS.host, turn1.ops);
    expect(opPolicyId(turn2.ops[0])).not.toBe(opPolicyId(turn1.ops[0]));
    expectApplies(turn2, turn1.ops);
  });
});

describe('interpretRequest validation (any model)', () => {
  const rule = (identityRoles: string[], over: Partial<{ serviceRoles: string[] }> = {}): DraftOp => ({
    kind: 'create',
    policy: {
      id: 'pol-x', name: 'x', createdAt: '2026-10-07T00:00:00Z', status: 'active', type: 'dial', semantic: 'AnyOf',
      identityRoles, serviceRoles: over.serviceRoles ?? [`@${REPORTS}`], postureCheckRoles: [],
    },
  });

  it('unknown attributes, services and routers become questions; nothing is returned', async () => {
    const r = await ask('x', [], () => ({
      ops: [
        rule(['#nope'], { serviceRoles: ['@no-such-svc'] }),
        { kind: 'create', target: 'edgeRouterPolicy', policy: {
          id: 'rp-x', name: 'rp-x', createdAt: '2026-10-07T00:00:00Z', status: 'active', semantic: 'AnyOf',
          identityRoles: ['#users'], edgeRouterRoles: ['@er-999'] } },
      ],
    }));
    expect(r.ops).toEqual([]);
    expect(r.questions).toEqual([
      'No identity has the attribute #nope. Did you mean a different attribute?',
      'There\'s no service named "no-such-svc". Which service did you mean?',
      'There\'s no router named "er-999". Which router did you mean?',
    ]);
  });

  it('ops that would not apply become a question', async () => {
    const r = await ask('x', [], () => ({ ops: [{ kind: 'delete', policyId: 'pol-404' }] }));
    expect(r.ops).toEqual([]);
    expect(r.questions).toEqual(["That change can't be applied: applyDraft delete: no policy with id 'pol-404'"]);
  });

  it('model questions win over any ops it also sent', async () => {
    const r = await ask('x', [], () => ({ ops: [rule(['#users'])], questions: ['Which users?'] }));
    expect(r).toEqual({ ops: [], summary: [], reply: null, items: [], questions: ['Which users?'], answers: [], notes: [] });
  });

  it('summary never echoes model text', async () => {
    const r = await ask('x', [], () => ({ ops: [rule(['#users'])], questions: [] }));
    expect(r.summary).toEqual(canvasLabels(applyDraft(seed, r.ops), 'pol-x'));
  });

  it('existing #all and router attributes are accepted', async () => {
    const r = await ask('x', [], () => ({ ops: [rule(['#all'])] }));
    expect(r.questions).toEqual([]);
    expect(r.ops).toHaveLength(1);
  });
});
