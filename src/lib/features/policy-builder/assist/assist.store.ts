/**
 * ASSIST STORE — the assist panel's conversation and its one pending proposal.
 *
 * Each turn is a prompt and its Interpretation. A reply with ops is a PROPOSAL:
 * the canvas renders draftWorld + proposal ops (proposalWorld) until the user
 * accepts it ("Add to draft") or it's discarded. A proposal is only live while
 *   - it is the latest turn,
 *   - its service is the one asked about, and
 *   - the draft is exactly the one it was made against (any draft edit, from the
 *     editor, a gap fix, discard or commit, retires it).
 *
 * accept() moves the ops into the PolicyDraftStore the same way the editor would:
 * service-policy updates via upsertUpdate and deletes via deletePolicy (so the
 * store keeps one op per policy), everything else via addOp.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { PolicyDraftStore } from '../draft/policy-draft.store';
import { applyDraft, isServicePolicyOp, opPolicyId, type DraftOp } from '../draft/policy-draft';
import { interpretRequest, type Interpretation, type Model } from './interpret';
import { recordedModel } from './recorded-model';

export type TurnStatus = 'thinking' | 'proposed' | 'added' | 'discarded' | 'reply' | 'failed';

export interface Turn {
  id: number;
  serviceId: string;
  prompt: string;
  status: TurnStatus;
  result: Interpretation | null;
  /** The draft ops the request was made against. */
  basis: readonly DraftOp[];
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class AssistStore {
  private readonly draft = inject(PolicyDraftStore);
  private model: Model = recordedModel;
  private nextId = 1;

  private readonly _turns = signal<readonly Turn[]>([]);
  readonly turns = this._turns.asReadonly();

  /** The floating panel: open (vs. just its launcher) and expanded (vs. compact). */
  readonly open = signal(false);
  readonly expanded = signal(false);

  /** The live proposal, or null (see the header for what retires one). */
  readonly proposal = computed(() => {
    const last = this._turns().at(-1);
    return last?.status === 'proposed' && last.basis === this.draft.ops() ? last : null;
  });

  /** draftWorld + the proposal's ops — what the canvas shows; null without a proposal. */
  readonly proposalWorld = computed<TrifectaWorld | null>(() => {
    const p = this.proposal();
    if (!p?.result) return null;
    try {
      return applyDraft(this.draft.draftWorld(), p.result.ops);
    } catch {
      return null;
    }
  });

  /** Service policies the proposal creates or changes — marked "proposed". */
  readonly proposedPolicyIds = computed(() => {
    const ops = this.proposal()?.result?.ops ?? [];
    return new Set(ops.filter((op) => isServicePolicyOp(op) && op.kind !== 'delete').map(opPolicyId));
  });

  /** A turn's status as shown: a proposal retired by a draft edit reads "discarded". */
  statusOf(turn: Turn): TurnStatus {
    return turn.status === 'proposed' && this.proposal()?.id !== turn.id ? 'discarded' : turn.status;
  }

  turnsFor(serviceId: string): Turn[] {
    return this._turns().filter((t) => t.serviceId === serviceId);
  }

  /** For specs: swap the recorded model. */
  useModel(model: Model): void {
    this.model = model;
  }

  async send(prompt: string, serviceId: string): Promise<void> {
    const text = prompt.trim();
    if (!text) return;
    this.discardProposal();
    const basis = this.draft.ops();
    const history = this.turnsFor(serviceId).map((t) => t.prompt);
    const turn: Turn = { id: this.nextId++, serviceId, prompt: text, status: 'thinking', result: null, basis };
    this._turns.update((ts) => [...ts, turn]);
    try {
      const result = await interpretRequest(text, this.draft.live(), serviceId, basis, this.model, history);
      this.patch(turn.id, { result, status: result.ops.length ? 'proposed' : 'reply' });
    } catch (e) {
      this.patch(turn.id, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Moves the live proposal's ops into the draft. */
  accept(): void {
    const p = this.proposal();
    if (!p?.result) return;
    for (const op of p.result.ops) {
      if (isServicePolicyOp(op) && op.kind === 'update') this.draft.upsertUpdate(op.policyId, op.patch);
      else if (isServicePolicyOp(op) && op.kind === 'delete') this.draft.deletePolicy(op.policyId);
      else this.draft.addOp(op);
    }
    this.patch(p.id, { status: 'added' });
  }

  /** "Reset conversation": drops this service's turns (and any pending proposal). */
  clear(serviceId: string): void {
    this.discardProposal();
    this._turns.update((ts) => ts.filter((t) => t.serviceId !== serviceId));
  }

  /** Retires the latest turn's proposal, if it is still pending. */
  discardProposal(): void {
    const last = this._turns().at(-1);
    if (last?.status === 'proposed') this.patch(last.id, { status: 'discarded' });
  }

  private patch(id: number, changes: Partial<Turn>): void {
    this._turns.update((ts) => ts.map((t) => (t.id === id ? { ...t, ...changes } : t)));
  }
}
