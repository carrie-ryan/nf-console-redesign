/**
 * AssistStore: a reply with ops is a proposal the canvas previews; Add to draft
 * moves it into the PolicyDraftStore; a new prompt, a draft edit or Discard
 * retires it.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/assist/assist.store.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { PolicyDraftStore } from '../draft/policy-draft.store';
import { opPolicyId } from '../draft/policy-draft';
import { layoutServiceView } from '../service-view.layout';
import { AssistStore } from './assist.store';
import { SUGGESTIONS } from './recorded-model';

const REPORTS = 'svc-008';

describe('AssistStore', () => {
  let assist: AssistStore;
  let draft: PolicyDraftStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    assist = TestBed.inject(AssistStore);
    draft = TestBed.inject(PolicyDraftStore);
  });

  it('a reply with ops is a proposal: previewed, not in the draft', async () => {
    await assist.send(SUGGESTIONS.host, REPORTS);
    const p = assist.proposal()!;
    expect(p.status).toBe('proposed');
    expect(draft.ops()).toEqual([]);
    const id = opPolicyId(p.result!.ops[0]);
    expect(assist.proposedPolicyIds()).toEqual(new Set([id]));
    expect(layoutServiceView(REPORTS, assist.proposalWorld()!).bind.groups.map((g) => g.policyId)).toEqual([id]);
  });

  it('Add to draft moves the ops into the draft store', async () => {
    await assist.send(SUGGESTIONS.plus, REPORTS);
    assist.accept();
    expect(assist.proposal()).toBeNull();
    expect(assist.turns().at(-1)!.status).toBe('added');
    expect(draft.ops()).toHaveLength(1);
    expect(layoutServiceView(REPORTS, draft.draftWorld()).bind.groups.map((g) => g.kind)).toEqual(['named', 'rule']);
  });

  it('a question is a reply, never a proposal', async () => {
    await assist.send(SUGGESTIONS.mark43, REPORTS);
    expect(assist.proposal()).toBeNull();
    expect(assist.turns().at(-1)!.status).toBe('reply');
    expect(assist.turns().at(-1)!.result!.questions).toHaveLength(1);
  });

  it('a new prompt discards an unaccepted proposal', async () => {
    await assist.send(SUGGESTIONS.host, REPORTS);
    await assist.send(SUGGESTIONS.and, REPORTS);
    expect(assist.turns().map((t) => t.status)).toEqual(['discarded', 'reply']);
    expect(draft.ops()).toEqual([]);
  });

  it('a draft edit retires the proposal (shown as discarded)', async () => {
    await assist.send(SUGGESTIONS.host, REPORTS);
    const turn = assist.turns().at(-1)!;
    draft.createForService('dial', REPORTS);
    expect(assist.proposal()).toBeNull();
    expect(assist.proposalWorld()).toBeNull();
    expect(assist.statusOf(turn)).toBe('discarded');
  });

  it('"remove the laptops" after the laptops rule was added drops it the editor\'s way', async () => {
    await assist.send(SUGGESTIONS.dial, REPORTS);
    assist.accept();
    await assist.send(SUGGESTIONS.remove, REPORTS);
    assist.accept();
    // deletePolicy on a draft-created policy just removes its create.
    expect(draft.ops()).toEqual([]);
  });

  it('the floating panel starts closed and compact', () => {
    expect([assist.open(), assist.expanded()]).toEqual([false, false]);
  });

  it('clear(service) drops only that service\'s turns and discards a pending proposal', async () => {
    await assist.send(SUGGESTIONS.and, 'svc-004');
    await assist.send(SUGGESTIONS.host, REPORTS);
    expect(assist.proposal()).not.toBeNull();
    assist.clear(REPORTS);
    expect(assist.turnsFor(REPORTS)).toEqual([]);
    expect(assist.turnsFor('svc-004')).toHaveLength(1);
    expect(assist.proposal()).toBeNull();
    expect(draft.ops()).toEqual([]);
  });

  it('Discard retires the proposal and leaves the draft alone', async () => {
    await assist.send(SUGGESTIONS.dial, REPORTS);
    assist.discardProposal();
    expect(assist.proposal()).toBeNull();
    expect(assist.turns().at(-1)!.status).toBe('discarded');
    expect(draft.ops()).toEqual([]);
  });
});
