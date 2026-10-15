import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SearchPickerComponent, attributeItems, entityItems } from './search-picker.component';
import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { entityMatchesRoles } from '../authorization/authorization-resolver';
import type { Policy } from '../../shared/services/mock-data.service';
import { PolicyDraftStore } from './draft/policy-draft.store';
import type { DraftOp, PolicyPatch } from './draft/policy-draft';
import { LazyDiffs } from './draft/lazy-diffs';
import { indexFor } from '../authorization/world-index';
import type { TrifectaWorld } from '../authorization/trifecta-resolver';
import { previewFromDiff, previewText } from './posture-panel.model';
import { broadHostWarnings } from './hosting';
import { newConflictWarnings } from './intercepts';
import type { TestPrefill } from './access-tests-panel.component';
import { DemoClock } from './demo-clock';
import { EXPIRY_PRESETS, expiryDate, presetTime, type ExpiryChoice } from './expiry';
import { ExpiryPillComponent } from './expiry-pill.component';

type Side = 'identity' | 'service' | 'posture';

/** "!kiosks", "-#kiosks", "not kiosks" (after an optional '#'): an attempt to exclude. */
const EXCLUSION = /^#?\s*(?:!|-|not\s+)\s*#?([\w.-]*)/i;

interface Entity {
  id: string;
  name: string;
  attributes?: readonly string[];
  /** Identities: the edge router a router identity belongs to. */
  routerId?: string;
}

/** A named (@) role resolved to the entity it points at, for display. */
interface NamedChip {
  role: string;
  name: string;
  found: boolean;
  /** A router identity: shown with the router icon. */
  router: boolean;
  /** Identity entries: when the scheduler removes it; null if never. */
  expiresAt: string | null;
}

/** A Date as a datetime-local value ("2026-10-14T18:00"), in local time. */
function localValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ROLE_KEY: Record<Side, 'identityRoles' | 'serviceRoles' | 'postureCheckRoles'> = {
  identity: 'identityRoles',
  service: 'serviceRoles',
  posture: 'postureCheckRoles',
};

const NOUN: Record<Side, { title: string; one: string; many: string; pick: string; icon: string }> = {
  identity: { title: 'Identities', one: 'identity', many: 'identities', pick: 'an identity', icon: 'fa-user' },
  service: { title: 'Services', one: 'service', many: 'services', pick: 'a service', icon: 'fa-cube' },
  posture: { title: 'Posture checks', one: 'check', many: 'checks', pick: 'a check', icon: 'fa-shield-halved' },
};

/** Matched names listed before "+N more", which expands to all. */
const MATCH_SAMPLE = 3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Side panel editing ONE policy of the draft world. Every change goes straight to
 * PolicyDraftStore.upsertUpdate, so the service view and the diff follow along
 * while editing. The type is fixed on an existing policy and shown read-only.
 *
 * PENDING mode (`pending` set): a posture fix under review — the policy with a check
 * added (`highlight`), not in the draft yet, with a preview of its effect. Edits
 * change only the local copy; "Add to draft" folds the changed fields into the
 * policy's update; "Cancel" leaves the draft untouched.
 *
 * Named identities and posture checks are written as @<name>, named services as
 * @<id>, matching the seed's own policies (pol-004: @server-build-01 / @svc-004).
 */
@Component({
  selector: 'app-policy-editor',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, SearchPickerComponent, ExpiryPillComponent],
  templateUrl: './policy-editor.component.html',
  styleUrls: ['./policy-editor.component.css', './tag-input.css'],
})
export class PolicyEditorComponent {
  private readonly store = inject(PolicyDraftStore);
  private readonly clock = inject(DemoClock);

  readonly policyId = input.required<string>();
  /** A fix under review, not yet in the draft. */
  readonly pending = input<Policy | null>(null);
  /** Roles the fix adds — marked on their chips while pending. */
  readonly highlight = input<readonly string[]>([]);
  /** Open on this control ('expires': the Expires select, from the revert warning). */
  readonly focus = input<'expires' | null>(null);
  readonly closed = output<void>();
  /** A required check's name: show it read-only (checks are defined on the Posture Checks page). */
  readonly viewCheck = output<string>();

  private readonly router = inject(Router);
  /** Back to this builder view (service, ?with=) after Posture Checks. */
  readonly returnTo = () => this.router.url;

  /** The posture picker: every existing check (by @name, found by name or attribute) and the
   *  attributes checks carry. No free text — a check is created on the Posture Checks page. */
  readonly checkItems = computed(() => {
    const checks = this.world().postureChecks ?? [];
    return [...entityItems(checks, 'name'), ...attributeItems(checks, { one: 'posture check', many: 'posture checks' })];
  });
  /** "Add test" under the can't-exclude note: a must-not test for that attribute. */
  readonly addTest = output<TestPrefill>();
  /** "Tag identities" for an attribute no identity has: open the tagging list for it. */
  readonly tagIdentities = output<string>();

  /** An exclusion typed into an attribute rule ("!kiosks", "-kiosks", "not kiosks"): not
   *  added — Ziti can't exclude — and explained under that side's rule. Reset per policy. */
  readonly exclusion = linkedSignal<string, { side: Side; attribute: string } | null>({
    source: () => this.policyId(),
    computation: () => null,
  });

  /** The last edit the store rejected; cleared by the next accepted one. */
  readonly editError = signal<string | null>(null);

  /** The pending policy until it's added; null once it's in the draft. */
  private readonly local = linkedSignal(() => this.pending());
  readonly isPending = computed(() => this.local() !== null);

  private readonly draftPolicy = computed(() => this.store.draftWorld().policies.find((p) => p.id === this.policyId()));
  readonly policy = computed(() => this.local() ?? this.draftPolicy());
  readonly mark = computed(() => (this.isPending() ? null : (this.store.marks().get(this.policyId()) ?? null)));

  private readonly world = this.store.draftWorld;
  private readonly entities = (side: Side): readonly Entity[] =>
    side === 'identity' ? this.world().identities : side === 'service' ? this.world().services : (this.world().postureChecks ?? []);

  readonly sides = computed(() => {
    const p = this.policy();
    if (!p) return null;
    return {
      identity: this.sideModel('identity', p),
      service: this.sideModel('service', p),
      posture: this.sideModel('posture', p),
    };
  });

  /** "A dialer passes if any one granting policy's checks all pass." */
  readonly postureNote = computed(
    () => `${this.policy()?.type === 'bind' ? 'A host' : 'A dialer'} passes if any one granting policy's checks all pass.`,
  );

  /** While pending: the fields it changes, as one update. */
  private readonly pendingPatch = computed<PolicyPatch | null>(() => {
    const local = this.local();
    if (!local) return null;
    const current = this.draftPolicy() as unknown as Record<string, unknown> | undefined;
    return Object.fromEntries(
      Object.entries(local).filter(([k, v]) => k !== 'id' && JSON.stringify(v) !== JSON.stringify(current?.[k])),
    ) as PolicyPatch;
  });

  /** While pending: the one update it would add. */
  private readonly previewOps = computed<DraftOp[] | null>(() => {
    const patch = this.pendingPatch();
    return patch && Object.keys(patch).length ? [{ kind: 'update', policyId: this.policyId(), patch }] : null;
  });

  /** The preview's ops against the draft — null when there is nothing to preview. */
  private readonly previewJob = computed<{ world: TrifectaWorld; ops: DraftOp[] } | null>(() => {
    const ops = this.previewOps();
    return ops ? { world: this.world(), ops } : null;
  });
  private readonly previews = new LazyDiffs<string[]>();

  /** Its effect if added, per service: [] with nothing to preview, null while calculating. */
  readonly preview = computed<string[] | null>(() => (this.previewJob() ? (this.previews.results().get('preview') ?? null) : []));

  /**
   * Editing a Bind rule: the services it makes broadly hosted (past BROAD_HOSTS, or by
   * more) — as the review would warn, limited to this policy. Pending, the fix's copy
   * stands in for the draft's.
   */
  readonly hostWarnings = computed(() => {
    const p = this.policy();
    if (!p || p.type !== 'bind') return [];
    const world = this.editedWorld();
    const reach = indexFor(world).serviceIdsMatching(p.serviceRoles, p.semantic);
    return broadHostWarnings(this.store.live(), world, [...reach]).filter((w) => w.policies.some((x) => x.id === p.id));
  });

  /** Editing a Dial rule: the intercept conflicts it creates — as the review would warn,
   *  limited to this policy. */
  readonly conflictWarnings = computed(() => {
    const p = this.policy();
    if (!p || p.type !== 'dial') return [];
    return newConflictWarnings(this.store.live(), this.editedWorld()).filter((w) => w.policies.some((x) => x.id === p.id));
  });

  /** The draft — pending, with the fix's copy standing in for the draft's policy. */
  private readonly editedWorld = computed(() => {
    const draft = this.world();
    const local = this.local();
    return local ? { ...draft, policies: draft.policies.map((x) => (x.id === local.id ? local : x)) } : draft;
  });

  constructor() {
    this.startPreviews();
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    effect(() => {
      if (this.focus() !== 'expires') return;
      this.policyId();
      afterNextRender(() => {
        const el = host.nativeElement.querySelector<HTMLElement>('#pe-expires');
        el?.scrollIntoView?.({ block: 'center' });
        el?.focus();
      }, { injector: this.injector });
    });
  }
  private readonly injector = inject(Injector);

  private startPreviews(): void {
    effect(() => {
      const job = this.previewJob();
      untracked(() =>
        this.previews.run(
          job ? [{ key: 'preview', world: job.world, ops: job.ops, map: (diff) => previewFromDiff(job.world, diff).map(previewText) }] : [],
        ),
      );
    });
    inject(DestroyRef).onDestroy(() => this.previews.cancel());
  }

  /** A pending role the fix added, shown highlighted. */
  isAdded(role: string): boolean {
    return this.isPending() && this.highlight().includes(role);
  }

  /** The reviewed fix goes into the draft as an update of the fields it changed. */
  addToDraft(): void {
    const patch = this.pendingPatch();
    if (!patch) return;
    try {
      this.store.upsertUpdate(this.policyId(), patch);
      this.editError.set(null);
      this.local.set(null);
    } catch (e) {
      this.editError.set(e instanceof Error ? e.message : String(e));
    }
  }

  private sideModel(side: Side, p: Policy) {
    const roles = p[ROLE_KEY[side]];
    const all = this.entities(side);
    const named: NamedChip[] = roles
      .filter((r) => r.startsWith('@'))
      .map((role) => {
        const hit = all.find((e) => entityMatchesRoles([role], 'AnyOf', e.attributes ?? [], e.name, e.id));
        const expiresAt = side === 'identity' ? (p.expiringEntries?.find((e) => e.role === role)?.expiresAt ?? null) : null;
        return { role, name: hit?.name ?? role.slice(1), found: !!hit, router: !!hit?.routerId, expiresAt };
      });
    const terms = roles.filter((r) => r.startsWith('#'));
    const matched = all.filter((e) => entityMatchesRoles(roles, p.semantic, e.attributes ?? [], e.name, e.id));
    // Identities: an attribute rule matching nobody names the attributes no identity has ('#all' always matches).
    const ruleMatchesNobody =
      side === 'identity' && terms.length > 0 && !all.some((e) => entityMatchesRoles(terms, p.semantic, e.attributes ?? [], e.name, e.id));
    const untagged = ruleMatchesNobody ? terms.filter((t) => t !== '#all' && !all.some((e) => e.attributes?.includes(t))) : [];
    const n = NOUN[side];
    return {
      side,
      noun: n,
      named,
      terms,
      // The pickers: every entity (by @name, services by @id) and the attributes in use on this side;
      // what the policy already has is marked.
      nameItems: entityItems(all, side === 'service' ? 'id' : 'name'),
      attrItems: attributeItems(all, n),
      chosen: new Set(roles),
      untagged,
      count: `${plural(matched.length, n.one, n.many)} ${matched.length === 1 ? 'matches' : 'match'}`,
      names: matched.map((e) => e.name),
      matched: matched.map((e) => ({ id: e.id, name: e.name })),
      more: Math.max(0, matched.length - MATCH_SAMPLE),
    };
  }

  /** Sides whose match list was expanded past "+N more"; reset per policy. */
  readonly expandedSides = linkedSignal<string, ReadonlySet<Side>>({
    source: this.policyId,
    computation: () => new Set(),
  });

  shownNames(side: Side, names: readonly string[]): readonly string[] {
    return this.expandedSides().has(side) ? names : names.slice(0, MATCH_SAMPLE);
  }

  toggleMatches(side: Side): void {
    this.expandedSides.update((s) => {
      const next = new Set(s);
      if (!next.delete(side)) next.add(side);
      return next;
    });
  }

  // ─── edits ──────────────────────────────────────────────────────────────────

  private edit(patch: PolicyPatch): void {
    const local = this.local();
    if (local) {
      this.local.set({ ...local, ...patch, id: local.id } as Policy);
      return;
    }
    try {
      this.store.upsertUpdate(this.policyId(), patch);
      this.editError.set(null);
    } catch (e) {
      this.editError.set(e instanceof Error ? e.message : String(e));
    }
  }

  private setRoles(side: Side, roles: string[]): void {
    this.edit({ [ROLE_KEY[side]]: roles });
  }

  private roles(side: Side): string[] {
    return [...(this.policy()?.[ROLE_KEY[side]] ?? [])];
  }

  rename(name: string): void {
    this.edit({ name });
  }

  setSemantic(semantic: Policy['semantic']): void {
    this.edit({ semantic });
  }

  /** A picked role ('@name' / '@id' / '#attribute'); typed attribute text gets its '#'.
   *  An exclusion isn't added: it opens the can't-exclude note instead. */
  addRole(side: Side, value: string): void {
    const excluded = value.startsWith('@') ? null : EXCLUSION.exec(value.trim());
    if (excluded) {
      this.exclusion.set({ side, attribute: excluded[1] ? `#${excluded[1]}` : '' });
      return;
    }
    this.exclusion.set(null);
    const role = value.startsWith('@') || value.startsWith('#') ? value : `#${value}`;
    const roles = this.roles(side);
    if (!roles.includes(role)) this.setRoles(side, [...roles, role]);
  }

  /** The note's "Add test": a must-not test on this policy's track for the attribute. */
  addExclusionTest(): void {
    const ex = this.exclusion();
    const p = this.policy();
    if (!ex || !p) return;
    this.addTest.emit({ kind: p.type === 'bind' ? 'mustNotHost' : 'mustNotDial', attributes: ex.attribute ? [ex.attribute] : [] });
    this.exclusion.set(null);
  }

  removeRole(side: Side, role: string): void {
    const roles = this.roles(side).filter((r) => r !== role);
    const entries = this.policy()?.expiringEntries ?? [];
    if (side === 'identity' && entries.some((e) => e.role === role)) {
      // Its expiry goes with it.
      if (this.entryMenu() === role) this.entryMenu.set(null);
      this.edit({ identityRoles: roles, expiringEntries: this.withoutEntry(entries, role) });
      return;
    }
    this.setRoles(side, roles);
  }

  // ─── time-limited access (prototype: a NetFoundry scheduler; Ziti has no expiry) ───

  readonly presets = EXPIRY_PRESETS;
  readonly expiryDate = expiryDate;

  /** The preset last picked for this policy, so the select keeps showing it. */
  private readonly pickedPreset = linkedSignal<string, ExpiryChoice | null>({ source: () => this.policyId(), computation: () => null });
  /** "On a date…" chosen before a date is. */
  private readonly policyDateOpen = linkedSignal<string, boolean>({ source: () => this.policyId(), computation: () => false });

  /** The Expires select's value. */
  readonly expiryChoice = computed<ExpiryChoice>(() => {
    const at = this.policy()?.expiresAt;
    if (!at) return this.policyDateOpen() ? 'date' : 'never';
    return this.pickedPreset() ?? 'date';
  });
  readonly showPolicyDate = computed(() => this.expiryChoice() === 'date');

  /** The earliest pickable time: now (demo clock). */
  readonly minDate = computed(() => localValue(new Date(this.clock.nowMs())));
  dateValue(iso: string | null | undefined): string {
    return iso ? localValue(new Date(iso)) : '';
  }

  setPolicyExpiry(choice: ExpiryChoice): void {
    this.pickedPreset.set(choice === 'never' || choice === 'date' ? null : choice);
    this.policyDateOpen.set(choice === 'date');
    if (choice === 'date') return; // waits for a date
    this.edit({ expiresAt: choice === 'never' ? undefined : presetTime(choice, this.clock.now()) });
  }

  /** A datetime-local value: local time → stored ISO. Ignored when empty or invalid. */
  setPolicyDate(value: string): void {
    const t = value ? new Date(value) : null;
    if (!t || Number.isNaN(t.getTime())) return;
    this.pickedPreset.set(null);
    this.edit({ expiresAt: t.toISOString() });
  }

  /** The named entry whose expiry menu is open; reset per policy. */
  readonly entryMenu = linkedSignal<string, string | null>({ source: () => this.policyId(), computation: () => null });

  toggleEntryMenu(role: string): void {
    this.entryMenu.update((r) => (r === role ? null : role));
  }

  private withoutEntry(entries: readonly { role: string; expiresAt: string }[], role: string) {
    const left = entries.filter((e) => e.role !== role);
    return left.length ? left : undefined;
  }

  /** Sets (or, with null, clears) one named entry's expiry. */
  private setEntryExpiry(role: string, expiresAt: string | null): void {
    const entries = this.withoutEntry(this.policy()?.expiringEntries ?? [], role) ?? [];
    const next = expiresAt ? [...entries, { role, expiresAt }] : entries;
    this.edit({ expiringEntries: next.length ? next : undefined });
  }

  setEntryPreset(role: string, choice: Exclude<ExpiryChoice, 'date'>): void {
    this.setEntryExpiry(role, choice === 'never' ? null : presetTime(choice, this.clock.now()));
    this.entryMenu.set(null);
  }

  setEntryDate(role: string, value: string): void {
    const t = value ? new Date(value) : null;
    if (!t || Number.isNaN(t.getTime())) return;
    this.setEntryExpiry(role, t.toISOString());
  }

  deletePolicy(): void {
    try {
      this.store.deletePolicy(this.policyId());
      this.closed.emit();
    } catch (e) {
      this.editError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
