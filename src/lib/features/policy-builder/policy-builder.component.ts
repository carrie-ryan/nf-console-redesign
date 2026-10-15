import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe, NgTemplateOutlet, formatDate } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MockDataService, type Policy } from '../../shared/services/mock-data.service';
import { DraftReviewComponent } from './draft-review.component';
import { PolicyDraftStore, type DraftSnapshot } from './draft/policy-draft.store';
import type { DraftOp } from './draft/policy-draft';
import { PolicyEditorComponent } from './policy-editor.component';
import { AssistPanelComponent } from './assist/assist-panel.component';
import { AssistStore } from './assist/assist.store';
import { ServiceDetailsComponent } from './service-details.component';
import { ServiceListComponent } from './service-list.component';
import { IdentityViewComponent } from './identity-view.component';
import { RouterGapComponent, type OpenRouterPolicy } from './router-gap.component';
import { PosturePanelComponent, type OpenPostureFix } from './posture-panel.component';
import { PostureCheckSummaryComponent } from './posture-check-summary.component';
import { ServiceStrategyEditorComponent } from './service-strategy-editor.component';
import { HostEditorComponent } from './host-editor.component';
import { AccessTestsPanelComponent, type TestPrefill } from './access-tests-panel.component';
import { HistoryPanelComponent } from './history-panel.component';
import { DemoPanelComponent } from './demo-panel.component';
import { BindingSimulator } from './binding-simulator';
import { ExpiryScheduler } from './expiry-scheduler';
import { ApprovalStore } from './draft/approval.store';
import { entityKey } from './draft/conflicts';
import { MemberDrawerComponent } from './member-drawer.component';
import { type ReasonLink } from './access-tests';
import { DraftChecks } from './draft/draft-checks';
import { RouterPolicyEditorComponent } from './router-policy-editor.component';
import { RouterAccessPanelComponent } from './router-access-panel.component';
import type { RoutingSubject } from './draft/router-access';
import { ServiceViewComponent, type GapRequest } from './service-view.component';
import { MAX_SERVICES } from './multi-service.layout';
import type { Lane, RouterGapKind } from './service-view.layout';

/** The draft bar's passing message, in the place of the idle bar. */
type BarMessage =
  | { kind: 'committed'; text: string }
  | { kind: 'discarded'; text: string; snapshot: DraftSnapshot };

/** How long each message stays, unless a draft change clears it first. */
export const COMMITTED_MS = 6000;
export const DISCARDED_MS = 8000;

const plural = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;

type Panel =
  | { kind: 'edit'; policyId: string; pending?: Policy; highlight?: string[]; focus?: 'expires' }
  | { kind: 'review' }
  | { kind: 'gap'; groupId: string; gapKind: RouterGapKind; serviceId: string }
  | { kind: 'posture'; groupId: string; serviceId: string }
  /** checkId null: a new check. */
  | { kind: 'check'; checkId: string }
  | { kind: 'strategy'; serviceId: string }
  | { kind: 'host'; identityId: string }
  | { kind: 'members'; groupId: string }
  /** Every identity, in selection mode, "Add <attribute>" ready (an attribute no one has). */
  | { kind: 'tag'; attribute: string }
  /** prefill: open the new-test form filled in (the editor's "Add test"). */
  | { kind: 'tests'; prefill?: TestPrefill }
  | { kind: 'history' }
  | { kind: 'service'; serviceId: string }
  | ({ kind: 'router' } & OpenRouterPolicy)
  /** A service's routing (its SERPs), or a group's / identity's routers (their ERPs). */
  | { kind: 'routing'; subject: RoutingSubject }
  | null;

/**
 * /policy-builder — two lenses on the draft world, both linkable via query params
 * (bound through withComponentInputBinding):
 *   Service  (`?service=<id>`)  — who hosts a service, and who may dial it; with
 *            `?with=<id>,<id>` up to three more services share the canvas, and
 *            `?policy=<id>` opens that policy in the editor.
 *   Identity (`?identity=<id>`) — what one identity can reach, and why.
 * A known `identity` param IS the identity lens; it is reached only from member-name
 * links, which keep `?service=`, so "Back" returns to that service (or, without
 * one, to the list). With no (known) service, the service list replaces the canvas
 * — there is no default service.
 *
 * Clicking a group opens its policy in the editor panel; edits land in the
 * PolicyDraftStore and the view renders the draft world as they happen. The
 * right-hand column holds ONE panel: the editor, the draft review, a router gap,
 * a group's posture (from a posture phrase or bypass chip), a posture check (from a
 * shield chip or the editor's posture section), a service's terminator strategy (from
 * its hosting line), a host's hosting defaults (from a host member), the service's details
 * (opened from the service node), a group's members (from its "+N more"), or a router
 * policy (from a "via <policy>" link or a gap fix), a service's routing (its routing line's "Edit
 * routing") or a group's routers (its ⋯ menu), the access tests or the commit history (from the
 * draft bar). A check or policy named in a failing test's reason opens its editor. The identity
 * lens has the draft review, its identity's routers ("Routers") and the router-policy editor.
 */
@Component({
  selector: 'app-policy-builder',
  standalone: true,
  imports: [
    ServiceViewComponent,
    ServiceListComponent,
    ServiceDetailsComponent,
    AssistPanelComponent,
    IdentityViewComponent,
    PolicyEditorComponent,
    DraftReviewComponent,
    RouterGapComponent,
    RouterPolicyEditorComponent,
    RouterAccessPanelComponent,
    PosturePanelComponent,
    PostureCheckSummaryComponent,
    ServiceStrategyEditorComponent,
    HostEditorComponent,
    AccessTestsPanelComponent,
    HistoryPanelComponent,
    MemberDrawerComponent,
    DemoPanelComponent,
    NgTemplateOutlet,
    DatePipe,
    RouterLink,
  ],
  templateUrl: './policy-builder.component.html',
  styleUrl: './policy-builder.component.css',
})
export class PolicyBuilderComponent {
  private readonly router = inject(Router);
  readonly data = inject(MockDataService);
  readonly draft = inject(PolicyDraftStore);
  private readonly assist = inject(AssistStore);
  /** The review computation (diff, tests), off the edit path. */
  private readonly checks = inject(DraftChecks);
  /** DEMO: hosts bind after a commit (created with the page so it hears every commit). */
  private readonly binding = inject(BindingSimulator);
  /** DEMO: the NetFoundry-side expiry scheduler (time-limited access). */
  private readonly expiry = inject(ExpiryScheduler);
  /** Required review (demo): submission, approval, and the draft's lock. */
  readonly approval = inject(ApprovalStore);
  /** Submitted for review: no edits until it's withdrawn, approved or sent back. */
  readonly locked = computed(() => this.draft.lock() !== null);

  /** `?service=<id>` */
  readonly service = input<string>();
  /** `?policy=<id>` — open this policy in the editor (then dropped from the URL). */
  readonly policy = input<string>();
  /** `?with=<id>,<id>` — other services on the canvas, in the order added. */
  readonly with = input<string>();
  /** `?identity=<id>` — present means Identity mode. */
  readonly identity = input<string>();
  /** `?erp=<id>` / `?serp=<id>` — open that router policy in its editor (then dropped from the URL). */
  readonly erp = input<string>();
  readonly serp = input<string>();

  /** The identity in the lens — null (an unknown id too) shows the service side. */
  readonly selectedIdentityId = computed(() => {
    const wanted = this.identity();
    return this.data.identities().some((i) => i.id === wanted) ? wanted! : null;
  });

  readonly mode = computed<'service' | 'identity'>(() => (this.selectedIdentityId() ? 'identity' : 'service'));

  /** "Back to git-repo" when the lens was opened from a service, else "Back to services". */
  readonly backLabel = computed(() => {
    const name = this.data.services().find((s) => s.id === this.selectedId())?.name;
    return name ? `Back to ${name}` : 'Back to services';
  });

  /** The service on the canvas — null shows the service list. */
  readonly selectedId = computed(() => {
    const wanted = this.service();
    return this.data.services().some((s) => s.id === wanted) ? wanted! : null;
  });

  /** The known services in `?with=`, without the focus, at most MAX_SERVICES - 1. */
  readonly withIds = computed(() => {
    const known = new Set(this.data.services().map((s) => s.id));
    const ids = (this.with() ?? '').split(',').filter((id) => known.has(id) && id !== this.selectedId());
    return [...new Set(ids)].slice(0, MAX_SERVICES - 1);
  });

  /** The right-hand column holds at most one panel. */
  private readonly panel = signal<Panel>(null);

  /** The draft review — closed once there is nothing left to review (discard, commit). */
  readonly reviewing = computed(() => this.panel()?.kind === 'review' && this.draft.ops().length > 0);

  /** The policy in the editor — closed once it leaves the draft world (deleted, discarded). */
  readonly editingId = computed(() => {
    const p = this.panel();
    return p?.kind === 'edit' && this.draft.draftWorld().policies.some((x) => x.id === p.policyId) ? p.policyId : null;
  });

  /** Which control the editor opens on ('expires': from the revert warning). */
  readonly editFocus = computed(() => {
    const p = this.panel();
    return p?.kind === 'edit' ? (p.focus ?? null) : null;
  });

  /** A posture fix under review in the editor (null when editing as is). */
  readonly editPending = computed(() => {
    const p = this.panel();
    return p?.kind === 'edit' && p.pending ? { pending: p.pending, highlight: p.highlight ?? [] } : null;
  });

  /** The group whose posture is explained. */
  readonly posture = computed(() => {
    const p = this.panel();
    return p?.kind === 'posture' ? p : null;
  });

  /** The posture check shown read-only (checks are defined on the Posture Checks page). */
  readonly checkView = computed(() => {
    const p = this.panel();
    return p?.kind === 'check' ? p.checkId : null;
  });

  /** The service whose terminator strategy is open. */
  readonly strategyEdit = computed(() => {
    const p = this.panel();
    return p?.kind === 'strategy' ? p.serviceId : null;
  });

  /** The host identity whose hosting defaults are open. */
  readonly hostEdit = computed(() => {
    const p = this.panel();
    return p?.kind === 'host' ? p.identityId : null;
  });

  /** The group whose members are listed. */
  readonly membersOf = computed(() => {
    const p = this.panel();
    return p?.kind === 'members' ? p.groupId : null;
  });

  /** The attribute the tagging list is open for. */
  readonly tagging = computed(() => {
    const p = this.panel();
    return p?.kind === 'tag' ? p.attribute : null;
  });

  /** The services on the canvas, focus first. */
  readonly canvasIds = computed(() => [this.selectedId()!, ...this.withIds()]);

  /** The access tests list. */
  readonly testsOpen = computed(() => this.panel()?.kind === 'tests');
  readonly testPrefill = computed(() => {
    const p = this.panel();
    return p?.kind === 'tests' ? (p.prefill ?? null) : null;
  });

  /** Commit history. */
  readonly historyOpen = computed(() => this.panel()?.kind === 'history');

  /** "Tests · 1 failing" on the draft bar's button — against the draft world. */
  readonly testsLabel = computed(() => {
    const s = this.checks.state();
    if (s.status === 'checking') return 'Tests · checking…';
    const failing = s.result.tests.filter((r) => !r.pass).length;
    return failing ? `Tests · ${failing} failing` : 'Tests';
  });
  readonly testsFailing = computed(() => this.testsLabel().endsWith('failing'));

  /** The router gap being explained. */
  readonly gap = computed(() => {
    const p = this.panel();
    return p?.kind === 'gap' ? p : null;
  });

  /** The router policy in its editor (possibly a pending suggestion). */
  readonly routerPolicy = computed(() => {
    const p = this.panel();
    return p?.kind === 'router' ? p : null;
  });

  /** The routing / routers panel's subject. */
  readonly routing = computed(() => {
    const p = this.panel();
    return p?.kind === 'routing' ? p.subject : null;
  });

  /** The identity lens's side panel: the review, its routers, or a router policy. */
  readonly identityPanelOpen = computed(() => !!(this.reviewing() || this.routing() || this.routerPolicy()));

  /** The service details panel. */
  /** The service whose details are open — any service on the canvas. */
  readonly showingService = computed(() => {
    const p = this.panel();
    return p?.kind === 'service' ? p.serviceId : null;
  });

  readonly panelOpen = computed(
    () =>
      !!(
        this.reviewing() ||
        this.editingId() ||
        this.gap() ||
        this.posture() ||
        this.checkView() ||
        this.strategyEdit() ||
        this.hostEdit() ||
        this.testsOpen() ||
        this.historyOpen() ||
        this.membersOf() ||
        this.tagging() ||
        this.showingService() ||
        this.routerPolicy() ||
        this.routing()
      ),
  );

  /**
   * "Committed 2 changes to live." / "Discarded 2 changes · Undo" — shown until the
   * draft changes again, it is dismissed, or its time is up (whichever comes first),
   * then gone for good. Tied to the ops it was shown with: any other ops clear it.
   */
  private readonly message = signal<{ msg: BarMessage; ops: readonly DraftOp[] } | null>(null);
  readonly barMessage = computed(() => {
    const m = this.message();
    return m && m.ops === this.draft.ops() ? m.msg : null;
  });
  private messageTimer: ReturnType<typeof setTimeout> | undefined;

  private showMessage(msg: BarMessage, ms: number): void {
    clearTimeout(this.messageTimer);
    const shown = { msg, ops: this.draft.ops() };
    this.message.set(shown);
    this.messageTimer = setTimeout(() => {
      if (this.message() === shown) this.message.set(null);
    }, ms);
  }

  dismissMessage(): void {
    clearTimeout(this.messageTimer);
    this.message.set(null);
  }


  /**
   * The draft bar's notice of live changes made outside the builder while the draft is
   * open — the latest one ("users-gitlab changed in live · Dana (admin) · 10:42"), how
   * many came before it, and whether any of them conflicts with the draft. Null: none.
   */
  readonly liveNotice = computed(() => {
    const changes = this.draft.liveSinceDraft();
    const last = changes.at(-1);
    if (!last) return null;
    const conflicted = new Set(this.draft.conflicts().map((c) => c.key));
    const names = last.entities.map((e) => e.name).join(', ');
    return {
      text: `${names} changed in live · ${last.actor} · ${formatDate(last.at, 'HH:mm', 'en-US')}`,
      earlier: changes.length - 1,
      conflict: changes.some((c) => c.entities.some((e) => conflicted.has(entityKey(e.target, e.id)))),
    };
  });

  readonly changeCount = computed(() => {
    const n = this.draft.ops().length;
    return `${n} ${n === 1 ? 'change' : 'changes'}`;
  });

  constructor() {
    // Any draft change clears the bar message for good.
    effect(() => {
      const ops = this.draft.ops();
      untracked(() => {
        if (this.message() && this.message()!.ops !== ops) this.dismissMessage();
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.messageTimer));

    // Submitting locks the draft: any editor closes, and so does the assistant.
    effect(() => {
      if (!this.locked()) return;
      untracked(() => {
        if (this.panel() && !['review', 'history', 'tests', 'service', 'members'].includes(this.panel()!.kind)) this.panel.set(null);
        this.assist.discardProposal();
        this.assist.open.set(false);
      });
    });

    // A new focused service (Change service, the list, a service link) closes the
    // side panel — it was about the old one. The draft review is about the whole
    // draft, so it stays. Secondary services come and go via `?with=` and leave it.
    let shown: string | null | undefined;
    effect(() => {
      const id = this.selectedId();
      untracked(() => {
        if (shown !== undefined && id !== shown && this.panel()?.kind !== 'review') this.panel.set(null);
        shown = id;
      });
    });
    // Another identity in the lens (or leaving it) closes its panel — the review excepted.
    let lensed: string | null | undefined;
    effect(() => {
      const id = this.selectedIdentityId();
      untracked(() => {
        if (lensed !== undefined && id !== lensed && this.panel()?.kind !== 'review') this.panel.set(null);
        lensed = id;
      });
    });
    // `?erp=<id>` / `?serp=<id>` (the Policies tabs' Edit): that router policy in its
    // editor, once — on the service given with it, or on the service list.
    effect(() => {
      const erp = this.erp();
      const serp = this.serp();
      if (!erp && !serp) return;
      untracked(() => {
        const w = this.draft.draftWorld();
        const target = erp ? 'edgeRouterPolicy' : 'serviceEdgeRouterPolicy';
        const list: readonly { id: string }[] = erp ? w.edgeRouterPolicies : w.serviceEdgeRouterPolicies;
        const id = (erp ?? serp)!;
        if (list.some((p) => p.id === id)) this.openRouterPolicy({ target, policyId: id });
        this.router.navigate([], { queryParams: { erp: null, serp: null }, queryParamsHandling: 'merge', replaceUrl: true });
      });
    });
    // `?policy=<id>` (the Policies table's Edit): open it in the editor once, then
    // drop the param so closing the editor or reloading doesn't reopen it.
    effect(() => {
      const id = this.policy();
      if (!id || !this.selectedId()) return;
      untracked(() => {
        if (this.draft.draftWorld().policies.some((p) => p.id === id)) this.edit(id);
        this.router.navigate([], { queryParams: { policy: null }, queryParamsHandling: 'merge', replaceUrl: true });
      });
    });
  }

  edit(policyId: string, focus?: 'expires'): void {
    if (this.locked()) return; // submitted for review: editors stay shut
    this.assist.discardProposal(); // editing a policy retires an unaccepted proposal
    this.assist.open.set(false); // side panels minimise the assistant
    this.panel.set({ kind: 'edit', policyId, ...(focus ? { focus } : {}) });
  }

  openServiceDetails(serviceId: string): void {
    this.assist.open.set(false);
    this.panel.set({ kind: 'service', serviceId });
  }

  openReview(): void {
    this.assist.open.set(false);
    this.panel.set({ kind: 'review' });
  }

  /** A gap on any service on the canvas; without a service (the assist), the focused one. */
  openGap(e: Omit<GapRequest, 'serviceId'> & { serviceId?: string }): void {
    const serviceId = e.serviceId ?? this.selectedId();
    if (!serviceId) return;
    this.assist.open.set(false);
    this.panel.set({ kind: 'gap', groupId: e.groupId, gapKind: e.kind, serviceId });
  }

  openPosture(e: { groupId: string; serviceId: string }): void {
    this.assist.open.set(false);
    this.panel.set({ kind: 'posture', groupId: e.groupId, serviceId: e.serviceId });
  }

  /** A posture fix: the policy in the editor with the check added, not in the draft yet. */
  reviewPostureFix(e: OpenPostureFix): void {
    if (this.locked()) return; // submitted for review: editors stay shut
    this.edit(e.policyId);
    this.panel.set({ kind: 'edit', policyId: e.policyId, pending: e.pending, highlight: e.highlight });
  }

  /** A posture check's read-only summary — open even while the draft is locked: it edits nothing. */
  openCheck(checkId: string): void {
    this.assist.open.set(false);
    this.panel.set({ kind: 'check', checkId });
  }

  openStrategy(serviceId: string): void {
    if (this.locked()) return; // submitted for review: editors stay shut
    this.assist.open.set(false);
    this.panel.set({ kind: 'strategy', serviceId });
  }

  openHost(identityId: string): void {
    if (this.locked()) return; // submitted for review: editors stay shut
    this.assist.open.set(false);
    this.panel.set({ kind: 'host', identityId });
  }

  /** The editor's "Tag identities": every identity, ready to add `attribute`. */
  openTagging(attribute: string): void {
    if (this.locked()) return; // submitted for review: editors stay shut
    this.assist.open.set(false);
    this.panel.set({ kind: 'tag', attribute });
  }

  openMembers(groupId: string): void {
    this.assist.open.set(false);
    this.panel.set({ kind: 'members', groupId });
  }

  openTests(): void {
    this.assist.open.set(false);
    this.panel.set({ kind: 'tests' });
  }

  /** The editor's "Add test": the tests panel with a new test filled in, on the focused service. */
  openTestForm(prefill: TestPrefill): void {
    this.assist.open.set(false);
    this.panel.set({ kind: 'tests', prefill: { ...prefill, serviceId: prefill.serviceId ?? this.selectedId() ?? undefined } });
  }

  openHistory(): void {
    this.assist.open.set(false);
    this.panel.set({ kind: 'history' });
  }

  /** A check or policy named in a failing test's reason: its editor. */
  openReasonLink(l: ReasonLink): void {
    if (l.kind === 'check') this.openCheck(l.id);
    else if (l.kind === 'policy') this.edit(l.id, l.focus);
    else this.openRouterPolicy({ target: l.target, policyId: l.id });
  }

  openRouterPolicy(e: OpenRouterPolicy): void {
    if (this.locked()) return; // submitted for review: editors stay shut
    this.assist.open.set(false);
    this.panel.set({ kind: 'router', ...e });
  }

  /** "Edit routing" on a service's routing line, a group's ⋯ → Routers, the identity lens's "Routers". */
  openRouting(subject: RoutingSubject): void {
    if (this.locked()) return; // submitted for review: editors stay shut
    this.assist.open.set(false);
    this.panel.set({ kind: 'routing', subject });
  }

  /** From a coverage popover: put a service on the canvas (a full canvas or one
   *  already there is left alone). */
  addService(id: string): void {
    const ids = this.withIds();
    if (ids.includes(id) || id === this.selectedId() || ids.length >= MAX_SERVICES - 1) return;
    this.setWith([...ids, id]);
  }

  removeService(id: string): void {
    // Its gap or details panel goes with it.
    const p = this.panel();
    const onIt = !!p && 'serviceId' in p && p.serviceId === id;
    if (onIt) this.panel.set(null);
    this.setWith(this.withIds().filter((x) => x !== id));
  }

  private setWith(ids: string[]): void {
    this.router.navigate([], { queryParams: { with: ids.length ? ids.join(',') : null }, queryParamsHandling: 'merge' });
  }

  closePanel(): void {
    this.panel.set(null);
  }

  onCommitted(n: number): void {
    this.panel.set(null);
    this.showMessage({ kind: 'committed', text: `Committed ${plural(n)} to live.` }, COMMITTED_MS);
  }

  /** "Approved by Dana · Commit" in the draft bar. */
  readonly commitError = signal<string | null>(null);
  commitApproved(): void {
    const n = this.draft.ops().length;
    try {
      this.draft.commit();
      this.commitError.set(null);
      this.onCommitted(n);
    } catch (e) {
      this.commitError.set(e instanceof Error ? e.message : String(e));
    }
  }

  withdraw(): void {
    this.approval.withdraw();
  }

  addRule(lane: Lane, serviceId: string): void {
    if (this.locked()) return;
    this.edit(this.draft.createForService(lane, serviceId));
  }

  /** Empties the draft, offering Undo for DISCARDED_MS. */
  discard(): void {
    if (this.locked()) return;
    const snapshot = this.draft.discard();
    if (!snapshot.ops.length) return;
    this.showMessage({ kind: 'discarded', text: `Discarded ${plural(snapshot.ops.length)}`, snapshot }, DISCARDED_MS);
  }

  /** Puts the discarded draft back exactly (a revert keeps its commit). */
  undoDiscard(): void {
    const msg = this.barMessage();
    if (msg?.kind !== 'discarded') return;
    this.dismissMessage();
    this.draft.restore(msg.snapshot);
  }

  /** Leaves the identity lens; `?service=` (if any) is still there to return to. */
  backFromIdentity(): void {
    this.router.navigate([], { queryParams: { identity: null }, queryParamsHandling: 'merge' });
  }

  /** Back to the service list. The draft is kept; only the review panel stays open
   *  (the selectedId effect closes the rest). */
  changeService(): void {
    this.assist.discardProposal();
    this.router.navigate([], { queryParams: { service: null, with: null }, queryParamsHandling: 'merge' });
  }
}
