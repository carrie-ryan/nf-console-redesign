import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { opPolicyId, targetOf } from './draft/policy-draft';
import { gapFixPreview, routerGap, type FixPreview, type GapFix, type RouterRef } from './draft/router-gap';
import { LazyDiffs, calculatingText } from './draft/lazy-diffs';
import { InViewDirective } from './in-view.directive';
import type { RouterPolicy, RouterTarget } from './router-policy-editor.component';
import type { RouterGapKind } from './service-view.layout';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Member names a row lists before "+N more". */
const NAMES_VISIBLE = 3;

/**
 * Side panel explaining ONE router gap — a group's members with no shared router,
 * or with only offline routers in common — and offering fixes as draft ops. It
 * reads the draft world, so once a fix is applied the gap it explains shrinks
 * (usually to nothing) in place.
 *
 * A fix that can extend an existing policy OR create a separate one is ONE fix with
 * a choice between the two (extend recommended) and one preview. "Review and add"
 * opens the router-policy editor on the chosen form — the existing policy with the
 * new entries added and highlighted, or the new suggested policy — and it reaches
 * the draft only from there. "Set up routing for both" (two new policies) is added
 * here, and its confirmation offers "Edit <policy>" for each. Every "via <policy>"
 * name opens that policy in the editor.
 */

/** Open a router policy in the editor — as it is, or with a fix under review. */
export interface OpenRouterPolicy {
  target: RouterTarget;
  policyId: string;
  /** The policy as the fix would leave it; not in the draft yet. */
  pending?: RouterPolicy;
  pendingKind?: 'create' | 'update';
  /** Roles the fix adds to an existing policy. */
  highlight?: string[];
}
@Component({
  selector: 'app-router-gap',
  standalone: true,
  imports: [NgTemplateOutlet, InViewDirective],
  templateUrl: './router-gap.component.html',
  styleUrl: './router-gap.component.css',
})
export class RouterGapComponent {
  private readonly store = inject(PolicyDraftStore);

  readonly serviceId = input.required<string>();
  readonly groupId = input.required<string>();
  readonly kind = input.required<RouterGapKind>();
  readonly closed = output<void>();
  readonly openPolicy = output<OpenRouterPolicy>();

  readonly applyError = signal<string | null>(null);
  /** The last fix applied here: its confirmation line and the policies it touched. */
  readonly applied = signal<{ line: string; edits: { target: RouterTarget; policyId: string; name: string }[] } | null>(null);

  readonly gap = computed(() => routerGap(this.store.draftWorld(), this.serviceId(), this.groupId(), this.kind()));

  /** Fix previews (each fix and its alternative form), filled in after the panel renders. */
  private readonly previews = new LazyDiffs<FixPreview>();

  constructor() {
    effect(() => {
      const g = this.gap();
      const world = this.store.draftWorld();
      untracked(() => {
        const fixes = (g?.fixes ?? []).flatMap((f) => (f.alternative ? [f, f.alternative] : [f]));
        this.previews.setJobs(
          fixes.map((f) => ({ key: this.key(f), world, ops: f.ops, map: (diff, after) => gapFixPreview(world, g!, after, diff) })),
        );
      });
    });
    inject(DestroyRef).onDestroy(() => this.previews.cancel());
  }

  private key(f: GapFix): string {
    return `${f.kind}:${f.form}`;
  }

  /** A fix's preview line came on screen: compute it. */
  onScreen(f: GapFix): void {
    this.previews.want(this.key(f));
  }

  /** null while calculating. */
  preview(f: GapFix): FixPreview | null {
    return this.previews.results().get(this.key(f)) ?? null;
  }

  /** Until the preview is ready: "Reaches N services · M identities — calculating…". */
  calculating(f: GapFix): string {
    return calculatingText(this.previews.reach(this.key(f)));
  }

  readonly heading = computed(() => (this.kind() === 'noSharedRouter' ? 'No shared router' : 'Routers offline'));

  readonly subtitle = computed(() => {
    const g = this.gap();
    if (!g) return '';
    if (!g.memberIds.length) return `${g.policyName} · resolved in draft`;
    const who = g.lane === 'dial' ? ['dialer', 'dialers'] : ['host', 'hosts'];
    return `${g.policyName} · ${plural(g.memberIds.length, who[0], who[1])} on ${g.serviceName}`;
  });

  shown(names: readonly string[]): string {
    const more = names.length - NAMES_VISIBLE;
    return names.slice(0, NAMES_VISIBLE).join(', ') + (more > 0 ? `, +${more} more` : '');
  }

  /** Per fix kind: 'create' when "Create a separate policy" is chosen over extending. */
  private readonly choice = signal<Partial<Record<GapFix['kind'], 'extend' | 'create'>>>({});

  /** The form a fix will be reviewed in: the extend form unless create was chosen. */
  chosen(f: GapFix): GapFix {
    return f.alternative && this.choice()[f.kind] === 'create' ? f.alternative : f;
  }

  choose(f: GapFix, form: 'extend' | 'create'): void {
    this.choice.update((c) => ({ ...c, [f.kind]: form }));
  }

  /** One router policy, created or extended: reviewed in the editor before it's added. */
  reviewable(f: GapFix): boolean {
    return f.ops.length === 1;
  }

  /** The existing policy an extend fix adds to. */
  extendedName(f: GapFix): string {
    const op = f.ops[0];
    return op.kind === 'update' ? this.policyOf(targetOf(op) as RouterTarget, op.policyId)?.name ?? op.policyId : '';
  }

  private policyOf(target: RouterTarget, id: string): RouterPolicy | undefined {
    const w = this.store.draftWorld();
    const list: readonly RouterPolicy[] = target === 'edgeRouterPolicy' ? w.edgeRouterPolicies : w.serviceEdgeRouterPolicies;
    return list.find((p) => p.id === id);
  }

  review(fix: GapFix): void {
    const op = this.chosen(fix).ops[0];
    const target = targetOf(op);
    if (target !== 'edgeRouterPolicy' && target !== 'serviceEdgeRouterPolicy') return;
    if (op.kind === 'create') {
      this.openPolicy.emit({ target, policyId: op.policy.id, pending: op.policy as RouterPolicy, pendingKind: 'create' });
    } else if (op.kind === 'update') {
      const current = this.policyOf(target, op.policyId);
      if (!current) return;
      const pending = { ...current, ...op.patch, id: current.id } as RouterPolicy;
      const was = new Set(Object.values(current).filter(Array.isArray).flat() as string[]);
      const highlight = (Object.values(op.patch).filter(Array.isArray).flat() as string[]).filter((r) => !was.has(r));
      this.openPolicy.emit({ target, policyId: op.policyId, pending, pendingKind: 'update', highlight });
    }
  }

  apply(f: GapFix): void {
    try {
      this.store.addOps(f.ops);
      this.applyError.set(null);
      const world = this.store.draftWorld();
      const edits = f.ops
        .filter((op) => targetOf(op) !== 'servicePolicy')
        .map((op) => {
          const target = targetOf(op) as RouterTarget;
          const list = target === 'edgeRouterPolicy' ? world.edgeRouterPolicies : world.serviceEdgeRouterPolicies;
          const policyId = opPolicyId(op);
          return { target, policyId, name: list.find((p) => p.id === policyId)?.name ?? policyId };
        });
      this.applied.set({ line: f.lines.join('; '), edits });
    } catch (e) {
      this.applyError.set(e instanceof Error ? e.message : String(e));
    }
  }

  /** "via a, b": each name opens its policy (ERPs on the identity side, SERPs on the service side). */
  via(r: RouterRef, target: RouterTarget) {
    return r.via.map((name, i) => ({ name, policyId: r.viaIds[i], target, system: !!r.viaSystem?.[i] }));
  }
}
