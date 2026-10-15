import { Component, DestroyRef, computed, effect, inject, input, linkedSignal, output, untracked } from '@angular/core';
import type { Policy } from '../../shared/services/mock-data.service';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { posturePanel, previewFromDiff, previewText, type BlockedGroup, type PostureFix, type PreviewRow } from './posture-panel.model';
import { LazyDiffs, calculatingText } from './draft/lazy-diffs';
import { InViewDirective } from './in-view.directive';

/** Members an expanded blocked group lists at a time. */
export const BLOCKED_PAGE = 50;

/** Open a service policy in the editor with a posture fix under review. */
export interface OpenPostureFix {
  policyId: string;
  pending: Policy;
  /** The role the fix adds — highlighted in the editor. */
  highlight: string[];
}

/**
 * Side panel explaining posture for ONE group on ONE service: who is blocked (and by
 * which checks, on which granting policies), who bypasses this policy's checks, and —
 * for each bypass — "Add <check> to <policy>", reviewed in the policy editor. It reads
 * the draft world, so it updates once a fix is in the draft.
 *
 * Blocked members are grouped by identical failing checks and reason ("67 hosts fail
 * check-1 · device"); a group expands to its members, BLOCKED_PAGE at a time.
 *
 * It opens at once: a fix's preview is computed once its card is on screen
 * (LazyDiffs, in screen order), showing its reach and "calculating…" until it's ready.
 */
@Component({
  selector: 'app-posture-panel',
  standalone: true,
  templateUrl: './posture-panel.component.html',
  imports: [InViewDirective],
  styleUrls: ['./router-gap.component.css', './posture-panel.component.css'],
})
export class PosturePanelComponent {
  private readonly store = inject(PolicyDraftStore);

  readonly serviceId = input.required<string>();
  readonly groupId = input.required<string>();
  readonly closed = output<void>();
  /** Review a fix in the policy editor. */
  readonly reviewFix = output<OpenPostureFix>();
  /** Open a granting policy as it is. */
  readonly editPolicy = output<string>();
  /** A shield chip: that posture check, read-only. */
  readonly viewCheck = output<string>();

  readonly panel = computed(() => posturePanel(this.store.draftWorld(), this.serviceId(), this.groupId()));

  /** Fix previews, by fix key — filled in after the panel renders. */
  private readonly previews = new LazyDiffs<PreviewRow[]>();

  constructor() {
    effect(() => {
      const p = this.panel();
      const world = this.store.draftWorld();
      untracked(() =>
        this.previews.setJobs(
          (p?.fixes ?? []).map((f) => ({
            key: this.key(f),
            world,
            ops: f.ops,
            map: (diff) => previewFromDiff(world, diff, p!.serviceId),
          })),
        ),
      );
    });
    inject(DestroyRef).onDestroy(() => this.previews.cancel());
  }

  key(f: PostureFix): string {
    return `${f.checkId}|${f.policyId}`;
  }

  /** A fix card came on screen: compute its preview. */
  onScreen(f: PostureFix): void {
    this.previews.want(this.key(f));
  }

  /** null while calculating. */
  preview(f: PostureFix): PreviewRow[] | null {
    return this.previews.results().get(this.key(f)) ?? null;
  }

  /** Until the preview is ready: "Reaches N services · M identities — calculating…". */
  calculating(f: PostureFix): string {
    return calculatingText(this.previews.reach(this.key(f)));
  }

  /** Per blocked group: how many of its members are shown (0: collapsed). Reset when the panel's group changes. */
  readonly shown = linkedSignal<string, Record<string, number>>({
    source: () => `${this.serviceId()}|${this.groupId()}`,
    computation: () => ({}),
  });
  /** "Show 16 more" — or, past a page, "Show 50 more of 1,234". */
  moreText(left: number): string {
    return left <= BLOCKED_PAGE ? `Show ${left} more` : `Show ${BLOCKED_PAGE} more of ${left.toLocaleString('en-US')}`;
  }

  toggleGroup(g: BlockedGroup): void {
    this.shown.update((s) => ({ ...s, [g.key]: s[g.key] ? 0 : BLOCKED_PAGE }));
  }

  showMore(g: BlockedGroup): void {
    this.shown.update((s) => ({ ...s, [g.key]: (s[g.key] ?? 0) + BLOCKED_PAGE }));
  }

  readonly subtitle = computed(() => {
    const p = this.panel();
    if (!p) return '';
    const who = p.group.lane === 'dial' ? 'dialers' : 'hosts';
    return `${p.group.policyName} · ${who} on ${p.serviceName}`;
  });

  readonly previewText = previewText;

  review(f: PostureFix): void {
    this.reviewFix.emit({ policyId: f.policyId, pending: f.policy, highlight: [f.role] });
  }
}
