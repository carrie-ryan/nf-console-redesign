import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { describeOps, effectRows, signed, type Delta } from './draft/draft-summary';
import { type ReasonLink } from './access-tests';
import { DraftChecks } from './draft/draft-checks';
import { TestReasonComponent } from './test-reason.component';
import { requirementWarnings } from './draft/loosening';
import { broadHostWarnings } from './hosting';
import { newConflictWarnings } from './intercepts';
import { valueText, type EntityConflict } from './draft/conflicts';
import type { VerdictReason } from './service-view.layout';
import { DemoClock } from './demo-clock';
import { expiryDate, expiryTestWarnings, openExpiredRestores } from './expiry';
import { ApprovalStore } from './draft/approval.store';
import { DatePipe } from '@angular/common';

/**
 * Side panel reviewing the whole draft: one line per op, warnings for requirements
 * it removes, the access tests it fails, then its effect on every affected service
 * (current one first), then one Commit button that writes it to live. Commit is
 * disabled while any access test fails. A failed commit shows the store's message
 * and keeps the draft.
 *
 * The effects, hosting lines and tests come from DraftChecks, which computes them off
 * the edit path: until they're ready the panel says "Checking N of M services…" and
 * Commit stays disabled. The scope note and count are synchronous (affectedServices).
 */
@Component({
  selector: 'app-draft-review',
  standalone: true,
  imports: [NgTemplateOutlet, TestReasonComponent, DatePipe],
  templateUrl: './draft-review.component.html',
  styleUrl: './draft-review.component.css',
})
export class DraftReviewComponent {
  private readonly store = inject(PolicyDraftStore);
  private readonly checks = inject(DraftChecks);
  private readonly clock = inject(DemoClock);
  /** Required review (demo): submit / withdraw / approve / request changes. */
  readonly approval = inject(ApprovalStore);

  /** The service shown in the view; its row comes first. */
  readonly serviceId = input.required<string>();
  readonly closed = output<void>();
  /** After a successful commit, with the number of changes committed. */
  readonly committed = output<number>();
  /** A check or policy named in a failing test's reason. */
  readonly openLink = output<ReasonLink>();
  /** false where no editor can open beside the review (identity lens, service list). */
  readonly reasonLinks = input(true);

  readonly commitError = signal<string | null>(null);

  /** Set when this draft reverts a commit: which, and the entities it left out. */
  readonly reverting = this.store.reverting;

  readonly changes = computed(() => {
    try {
      return describeOps(this.store.live(), this.store.ops(), this.clock.nowMs());
    } catch {
      return []; // store.error is shown instead
    }
  });

  readonly changeCount = computed(() => {
    const n = this.store.ops().length;
    return `${n} ${n === 1 ? 'change' : 'changes'}`;
  });

  /** The draft checks' result — null while checking. A draft that doesn't apply has
   *  nothing to check (draftWorld is live), so it never waits: commit reports why. */
  private readonly result = computed(() => this.checks.state().result);
  readonly checking = computed(() => !this.store.error() && this.checks.state().status === 'checking');
  /** "Checking 3 of 62 services…" */
  readonly progress = computed(() => {
    const s = this.checks.state();
    return `Checking ${s.done} of ${s.total} ${s.total === 1 ? 'service' : 'services'}…`;
  });

  readonly rows = computed(() => {
    const r = this.result();
    return r && !this.store.error() ? effectRows(r.diff, this.store.live(), this.serviceId()) : [];
  });

  /** Access tests the draft world fails. None while the draft doesn't apply: draftWorld
   *  is then live, and commit reports the real problem. */
  readonly failures = computed(() => (this.store.error() ? [] : (this.result()?.tests.filter((r) => !r.pass) ?? [])));
  readonly testCount = computed(() => this.store.draftWorld().accessTests?.length ?? 0);

  // ─── conflicts: touched entities changed in live since the draft first touched them ───
  readonly conflicts = this.store.conflicts;
  /** Per conflict, per field both sides changed: the user's pick. */
  readonly picks = signal<Readonly<Record<string, Readonly<Record<string, 'theirs' | 'mine'>>>>>({});
  readonly conflictError = signal<{ key: string; message: string } | null>(null);
  readonly valueText = valueText;

  pickOf(c: EntityConflict, field: string): 'theirs' | 'mine' | null {
    return this.picks()[c.key]?.[field] ?? null;
  }

  pick(c: EntityConflict, field: string, side: 'theirs' | 'mine'): void {
    this.picks.update((p) => ({ ...p, [c.key]: { ...p[c.key], [field]: side } }));
  }

  /** Reapply waits for a pick on every field both sides changed. */
  canReapply(c: EntityConflict): boolean {
    return c.canReapply && c.clashes.every((x) => this.pickOf(c, x.field));
  }

  /** My change on top of the latest; the diff, tests and warnings follow the new draft. */
  reapply(c: EntityConflict): void {
    this.resolve(c, () => this.store.reapply(c.key, this.picks()[c.key] ?? {}));
  }

  dropChange(c: EntityConflict): void {
    this.resolve(c, () => this.store.dropChange(c.key));
  }

  private resolve(c: EntityConflict, act: () => void): void {
    try {
      act();
      this.conflictError.set(null);
      this.picks.update(({ [c.key]: _, ...rest }) => rest);
    } catch (e) {
      this.conflictError.set({ key: c.key, message: e instanceof Error ? e.message : String(e) });
    }
  }

  /** "Commit is blocked: 1 test fails — anyone with #kiosks must not host api-prod." */
  readonly blockedMessage = computed(() => {
    const cs = this.conflicts();
    if (cs.length) {
      return `Commit is blocked: ${cs.length === 1 ? '1 entity has' : `${cs.length} entities have`} changed in live since you started editing — ${cs.map((c) => c.name).join(', ')}. Reapply or drop each change above.`;
    }
    const f = this.failures();
    if (!f.length) return null;
    return `Commit is blocked: ${f.length} ${f.length === 1 ? 'test fails' : 'tests fail'} — ${f.map((r) => r.text).join('; ')}.`;
  });

  /** Requirements the draft removes outright (a deleted check, check roles dropped). */
  readonly warnings = computed(() => requirementWarnings(this.store.live(), this.store.draftWorld()));

  /** Services the draft makes broadly hosted (past BROAD_HOSTS, or by more), naming the
   *  Bind policy responsible — a warning, not a block. Synchronous, over the draft's reach. */
  readonly hostWarnings = computed(() =>
    this.store.error() ? [] : broadHostWarnings(this.store.live(), this.store.draftWorld(), this.affected()),
  );

  /** Offender names a failure lists before "+N more". */
  readonly OFFENDERS_SHOWN = 4;

  /** Per service: the sentence about serving hosts the draft stops, if any. */
  readonly hosting = computed(() => new Map((this.result()?.hosting ?? []).map((c) => [c.serviceId, c])));

  /** Intercept conflicts the draft creates (not live's own), one per service pair, naming
   *  the Dial policy responsible — a warning, not a block. */
  readonly conflictWarnings = computed(() =>
    this.store.error() ? [] : newConflictWarnings(this.store.live(), this.store.draftWorld()),
  );

  /** Time-limited access: access tests that pass now but would fail once the expiries
   *  this draft sets have run (evaluated on the world after expiry) — a warning. */
  readonly expiryWarnings = computed(() =>
    this.store.error() ? [] : expiryTestWarnings(this.store.live(), this.store.draftWorld(), this.clock.nowMs()),
  );

  /** A revert that restores time-limited access whose expiry passed: it comes back
   *  with no expiry — until the draft sets a new one. */
  readonly expiredRestores = computed(() => {
    const r = this.store.reverting();
    return r ? openExpiredRestores(r.expired, this.store.draftWorld()) : [];
  });
  readonly expiryDate = expiryDate;

  // ─── required review ─────────────────────────────────────────────────────
  readonly reviewNote = signal('');
  readonly reviewError = signal<string | null>(null);
  /** Approve also waits for the checks, and for every access test to pass. */
  readonly approveBlocked = computed(() => {
    const why = this.approval.approveBlocked();
    if (why) return why;
    if (this.checking()) return 'Checks are still running';
    if (this.failures().length) return 'Access tests fail — request changes instead';
    return null;
  });

  private act(fn: () => void): void {
    try {
      fn();
      this.reviewError.set(null);
    } catch (e) {
      this.reviewError.set(e instanceof Error ? e.message : String(e));
    }
  }

  submit(): void {
    if (this.checking() || this.blockedMessage()) return;
    this.act(() => this.approval.submit());
  }

  withdraw(): void {
    this.act(() => this.approval.withdraw());
  }

  approve(): void {
    if (this.approveBlocked()) return;
    this.act(() => this.approval.approve(this.failures().length > 0));
  }

  requestChanges(): void {
    this.act(() => {
      this.approval.requestChanges(this.reviewNote());
      this.reviewNote.set('');
    });
  }

  /** Synchronous: the services the draft's ops can reach. */
  readonly affected = this.checks.affected;
  /** "62 services affected" — the review count, in the header. */
  readonly affectedCount = computed(() => {
    const n = this.affected().length;
    return `${n} ${n === 1 ? 'service' : 'services'} affected`;
  });

  /** "This draft also affects N other services." — or, when the current service isn't touched, says so. */
  readonly scopeNote = computed(() => {
    const ids = this.affected();
    const others = ids.filter((id) => id !== this.serviceId()).length;
    const svc = (n: number) => `${n} ${n === 1 ? 'service' : 'services'}`;
    if (ids.length && !ids.includes(this.serviceId())) return `This draft doesn't change this service; it affects ${svc(others)}.`;
    return others ? `This draft also affects ${others} other ${others === 1 ? 'service' : 'services'}.` : null;
  });

  /** CSS class for a delta: d-up / d-down / d-same. */
  tone(d: Delta): string {
    return d.delta > 0 ? 'd-up' : d.delta < 0 ? 'd-down' : 'd-same';
  }

  delta(d: Delta): string {
    return d.delta === 0 ? `±0 (${d.after})` : `${signed(d.delta)} (${d.before} → ${d.after})`;
  }

  /** A null reason means people can connect. */
  reasonText(r: VerdictReason | null): string {
    return r ?? 'can connect';
  }

  commit(): void {
    if (this.checking() || this.blockedMessage()) return;
    const n = this.store.ops().length;
    try {
      this.store.commit();
      this.commitError.set(null);
      this.committed.emit(n);
    } catch (e) {
      this.commitError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
