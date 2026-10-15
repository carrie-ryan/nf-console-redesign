import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PolicyDraftStore } from './draft/policy-draft.store';
import type { DraftOp } from './draft/policy-draft';
import { SearchPickerComponent, attributeItems, type PickerItem } from './search-picker.component';
import {
  MEMBER_FILTERS,
  STATUS_TEXT,
  allIdentitiesDrawer,
  filterCounts,
  filterMembers,
  memberDrawer,
  type MemberFilter,
  type MemberStatus,
} from './member-drawer.model';

/** Fixed row height: the list renders only the rows in view (plus OVERSCAN each side). */
export const ROW_HEIGHT = 52;
const OVERSCAN = 8;

/**
 * Side panel listing ONE group's members — opened by a group node's "+N more", so a
 * long member list never expands on the canvas. A search box (name or attribute) and
 * status chips (any chosen status, on any service) narrow it; each row shows the
 * member's status on every canvas service the group reaches, numbered in canvas
 * order. Names open the identity lens. Rows are virtualised: thousands of members
 * cost only the few dozen rows on screen.
 *
 * Without a group it lists EVERY identity (no statuses) — the tagging list.
 *
 * SELECTION MODE ("Select", or opened with `tagAttribute`): a checkbox per row, "Select
 * all N matching" for the filtered list, then "Add attribute" / "Remove attribute"
 * (picked or typed, e.g. #kiosks). Applying adds ONE bulk-tagging draft op for the
 * selected identities it changes (those missing it / carrying it). Opened with
 * `tagAttribute`, the drawer starts in selection mode with "Add #x" ready.
 */
@Component({
  selector: 'app-member-drawer',
  standalone: true,
  imports: [RouterLink, SearchPickerComponent],
  templateUrl: './member-drawer.component.html',
  styleUrls: ['./router-gap.component.css', './tag-input.css', './member-drawer.component.css'],
})
export class MemberDrawerComponent {
  private readonly store = inject(PolicyDraftStore);
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');

  /** null: every identity (the tagging list). */
  readonly groupId = input<string | null>(null);
  /** The services on the canvas, focus first. */
  readonly serviceIds = input<readonly string[]>([]);
  /** Open in selection mode with "Add <attribute>" ready. */
  readonly tagAttribute = input<string | null>(null);
  readonly closed = output<void>();

  readonly drawer = computed(() => {
    const id = this.groupId();
    return id ? memberDrawer(this.store.draftWorld(), id, this.serviceIds()) : allIdentitiesDrawer(this.store.draftWorld());
  });

  /** What the drawer is opened on — its search, chips and selection reset when it changes. */
  private readonly opened = computed(() => `${this.groupId() ?? '*'}|${this.tagAttribute() ?? ''}`);

  /** Search and chips — reset when another group opens. */
  readonly query = linkedSignal<string, string>({ source: this.opened, computation: () => '' });
  readonly chips = linkedSignal<string, ReadonlySet<MemberFilter>>({ source: this.opened, computation: () => new Set() });

  // ─── selection and tagging ──────────────────────────────────────────────
  readonly selecting = linkedSignal<string, boolean>({ source: this.opened, computation: () => !!this.tagAttribute() });
  readonly selected = linkedSignal<string, ReadonlySet<string>>({ source: this.opened, computation: () => new Set() });
  readonly action = linkedSignal<string, 'add' | 'remove' | null>({ source: this.opened, computation: () => (this.tagAttribute() ? 'add' : null) });
  readonly attribute = linkedSignal<string, string>({ source: this.opened, computation: () => this.tagAttribute() ?? '' });
  /** "Added #kiosks to 3 identities" — the last bulk action; or why nothing was done. */
  readonly tagResult = linkedSignal<string, { ok: boolean; text: string } | null>({ source: this.opened, computation: () => null });

  /** Every identity attribute, for "Add"; for "Remove", those the selection carries. */
  readonly attributeOptions = computed<readonly PickerItem[]>(() => {
    const ids = this.store.draftWorld().identities;
    if (this.action() !== 'remove') return attributeItems(ids, { one: 'identity', many: 'identities' });
    const sel = this.selected();
    return attributeItems(ids.filter((i) => sel.has(i.id)), { one: 'selected', many: 'selected' });
  });

  toggleSelecting(): void {
    this.selecting.update((v) => !v);
    if (!this.selecting()) this.selected.set(new Set());
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggleRow(id: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Everyone the search and chips leave — not just the rows on screen. */
  selectAllMatching(): void {
    this.selected.update((s) => new Set([...s, ...this.rows().map((r) => r.id)]));
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  /** "Add #kiosks" / "Remove #users" — with what it would do to the selection. */
  setAction(a: 'add' | 'remove'): void {
    this.action.set(this.action() === a ? null : a);
    this.attribute.set('');
    this.tagResult.set(null);
  }

  pickAttribute(value: string): void {
    const v = value.trim().replace(/^#*/, '');
    this.attribute.set(v ? `#${v}` : '');
  }

  /** The selected identities the action would change: missing the attribute (add) or carrying it (remove). */
  readonly changing = computed(() => {
    const attr = this.attribute();
    const action = this.action();
    if (!attr || !action) return [];
    const sel = this.selected();
    return this.store
      .draftWorld()
      .identities.filter((i) => sel.has(i.id) && (action === 'add') !== (i.attributes ?? []).includes(attr))
      .map((i) => i.id);
  });

  /** "Add #kiosks to 3 identities". */
  readonly applyLabel = computed(() => {
    const n = this.changing().length;
    const verb = this.action() === 'remove' ? 'Remove' : 'Add';
    const prep = this.action() === 'remove' ? 'from' : 'to';
    return `${verb} ${this.attribute()} ${prep} ${n.toLocaleString('en-US')} ${n === 1 ? 'identity' : 'identities'}`;
  });

  /** "2 of the 5 selected already have #kiosks" — why the count is smaller. */
  readonly skipNote = computed(() => {
    const sel = this.selected().size;
    const skip = sel - this.changing().length;
    if (!this.attribute() || !skip) return null;
    const has = this.action() === 'remove' ? "don't have" : 'already have';
    return `${skip.toLocaleString('en-US')} of the ${sel.toLocaleString('en-US')} selected ${has} ${this.attribute()}`;
  });

  /** One bulk-tagging op for the identities it changes. */
  applyTag(): void {
    const ids = this.changing();
    const attr = this.attribute();
    const action = this.action();
    if (!ids.length || !attr || !action) return;
    const op: DraftOp = { kind: 'tag', target: 'identityAttributes', identityIds: ids, add: action === 'add' ? [attr] : [], remove: action === 'remove' ? [attr] : [] };
    try {
      this.store.addOp(op);
      const n = ids.length;
      const who = `${n.toLocaleString('en-US')} ${n === 1 ? 'identity' : 'identities'}`;
      this.tagResult.set({ ok: true, text: `${action === 'add' ? `Added ${attr} to` : `Removed ${attr} from`} ${who} — in the draft.` });
      this.selected.set(new Set());
    } catch (e) {
      this.tagResult.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Rows matching the search; the chips' counts are over these. */
  private readonly searched = computed(() => filterMembers(this.drawer()?.rows ?? [], this.query(), new Set()));
  readonly counts = computed(() => filterCounts(this.searched()));
  readonly rows = computed(() => filterMembers(this.searched(), '', this.chips()));

  /** The chips that apply to this lane (serving / standby are host states). */
  readonly filters = computed(() => {
    const d = this.drawer();
    if (!d?.group) return []; // the tagging list has no statuses
    const bind = d.group.lane === 'bind';
    return MEMBER_FILTERS.filter((f) => bind || (f !== 'serving' && f !== 'standby')).map((f) => ({ key: f, label: STATUS_TEXT[f] }));
  });

  toggleChip(f: MemberFilter): void {
    this.chips.update((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
    this.toTop();
  }

  search(text: string): void {
    this.query.set(text);
    this.toTop();
  }

  /** A new filter starts the list from the top. */
  private toTop(): void {
    this.scrollTop.set(0);
    const el = this.viewport()?.nativeElement;
    if (el) el.scrollTop = 0;
  }

  // ─── virtual list ───────────────────────────────────────────────────────
  readonly scrollTop = signal(0);
  readonly viewHeight = signal(600);
  readonly rowHeight = ROW_HEIGHT;

  /** The slice of rows in view, and the space above it. */
  readonly window = computed(() => {
    const rows = this.rows();
    const first = Math.max(0, Math.floor(this.scrollTop() / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((this.scrollTop() + this.viewHeight()) / ROW_HEIGHT) + OVERSCAN);
    return { rows: rows.slice(first, last), offset: first * ROW_HEIGHT, first };
  });

  onScroll(e: Event): void {
    this.scrollTop.set((e.target as HTMLElement).scrollTop);
  }

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.viewport()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => this.viewHeight.set(el.clientHeight || 600));
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  readonly statusText = STATUS_TEXT;

  readonly subtitle = computed(() => {
    const d = this.drawer();
    if (!d) return '';
    if (!d.group) {
      const n = d.rows.length;
      return `${n.toLocaleString('en-US')} ${n === 1 ? 'identity' : 'identities'}`;
    }
    const n = d.group.memberCount;
    return `${d.group.policyName} · ${n.toLocaleString('en-US')} ${n === 1 ? 'member' : 'members'}`;
  });

  /** "1,204 of 3,000 members". */
  readonly shownText = computed(() => {
    const total = this.drawer()?.rows.length ?? 0;
    const shown = this.rows().length;
    const f = (n: number) => n.toLocaleString('en-US');
    const noun = this.drawer()?.group ? 'members' : 'identities';
    return shown === total ? `${f(total)} ${noun}` : `${f(shown)} of ${f(total)} ${noun}`;
  });

  /** A row's statuses for its aria-label: "on service-0004: serving; on …". */
  statusLabel(statuses: readonly MemberStatus[]): string {
    const services = this.drawer()?.services ?? [];
    return statuses.map((s, i) => `on ${services[i]?.name}: ${STATUS_TEXT[s]}`).join('; ');
  }
}
