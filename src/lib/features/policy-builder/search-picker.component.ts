import { Component, ElementRef, computed, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';

/** One pickable entry: an identity, service, router or posture check — or an attribute. */
export interface PickerItem {
  /** What `picked` emits (a role like '@laptop-alice', or '#team-03'). */
  value: string;
  /** The name shown, and matched first. */
  label: string;
  /** Shown next to the name: the entity's attributes. */
  attributes: readonly string[];
  /** A note at the row's end — e.g. "312 identities" for an attribute. */
  meta?: string;
  /** Lower-case label and attributes — what the search matches. */
  hay: string;
  /** 'router': a router identity — a router icon and tag, and the "Routers only" filter. */
  kind?: 'router';
}

/** The router icon, wherever a router identity is shown. */
export const ROUTER_ICON = 'fa-tower-broadcast';

/** Results listed at once; past this, "Showing 50 of 812 — keep typing". */
export const PICKER_LIMIT = 50;

type Entity = { id: string; name: string; attributes?: readonly string[]; routerId?: string };

/** An entity as a picker item: router identities carry their kind (and match "router"). */
function itemOf(e: Entity, value: string): PickerItem {
  const attributes = e.attributes ?? [];
  const router = !!e.routerId; // linked to its edge router — not just typed 'router'
  const hay = [e.name, ...attributes, ...(router ? ['router'] : [])].join('\n').toLowerCase();
  return { value, label: e.name, attributes, hay, ...(router ? { kind: 'router' as const } : {}) };
}

const entityCache = new WeakMap<readonly Entity[], Map<string, PickerItem[]>>();
const attrCache = new WeakMap<readonly Entity[], Map<string, PickerItem[]>>();

const cached = (cache: WeakMap<readonly Entity[], Map<string, PickerItem[]>>, xs: readonly Entity[], key: string, make: () => PickerItem[]) => {
  let m = cache.get(xs);
  if (!m) cache.set(xs, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key)!;
};

/** Entities as picker items emitting a named role — '@<id>' or '@<name>' (cached per collection). */
export function entityItems(entities: readonly Entity[], by: 'id' | 'name'): PickerItem[] {
  return cached(entityCache, entities, by, () => entities.map((e) => itemOf(e, `@${by === 'id' ? e.id : e.name}`)));
}

/** Entities' plain names as picker items (free-text name lists). */
export function nameItems(entities: readonly Entity[]): PickerItem[] {
  return cached(entityCache, entities, 'plain', () => entities.map((e) => itemOf(e, e.name)));
}

/** The attributes in use on `entities`, sorted, each with how many carry it ("312 identities"); cached. */
export function attributeItems(entities: readonly Entity[], noun: { one: string; many: string }): PickerItem[] {
  return cached(attrCache, entities, noun.many, () => {
    const counts = new Map<string, number>();
    for (const e of entities) for (const a of e.attributes ?? []) counts.set(a, (counts.get(a) ?? 0) + 1);
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([a, n]) => ({ value: a, label: a, attributes: [], meta: `${n.toLocaleString('en-US')} ${n === 1 ? noun.one : noun.many}`, hay: a.toLowerCase() }));
  });
}

/** Matches for `query`: names starting with it, then names containing it, then attribute
 *  matches — each in item order; the first PICKER_LIMIT, and how many there are. */
export function searchItems(items: readonly PickerItem[], query: string): { shown: PickerItem[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { shown: items.slice(0, PICKER_LIMIT), total: items.length };
  const starts: PickerItem[] = [];
  const named: PickerItem[] = [];
  const other: PickerItem[] = [];
  for (const it of items) {
    if (!it.hay.includes(q)) continue;
    const label = it.label.toLowerCase();
    (label.startsWith(q) ? starts : label.includes(q) ? named : other).push(it);
  }
  const all = [...starts, ...named, ...other];
  return { shown: all.slice(0, PICKER_LIMIT), total: all.length };
}

let nextId = 0;

/**
 * SEARCH PICKER — the one way the editors pick identities, services, routers, posture
 * checks and attributes. Type to search by name or attribute; each result shows its
 * attributes. At most PICKER_LIMIT results ("Showing 50 of 812 — keep typing").
 * Entries already chosen are marked and can't be added again. Arrow keys move,
 * Enter adds, Escape closes. With `allowFree` (attribute rules, free-text lists)
 * Enter, a comma or leaving the field adds the typed text when no result is chosen.
 * Router identities show a router icon and tag; when the items include any, a
 * "Routers only" toggle above the list narrows it to them (it takes focus without
 * closing the list, and hands it back to the input).
 *
 * A combobox (input) controlling a listbox; focus stays in the input throughout.
 */
@Component({
  selector: 'app-search-picker',
  standalone: true,
  templateUrl: './search-picker.component.html',
  styleUrl: './search-picker.component.css',
})
export class SearchPickerComponent {
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  readonly items = input.required<readonly PickerItem[]>();
  /** Values already chosen: marked, not addable. */
  readonly selected = input<ReadonlySet<string>>(new Set());
  readonly inputId = input.required<string>();
  readonly placeholder = input('');
  /** Accept typed text that matches no result (attribute terms, free-text lists). */
  readonly allowFree = input(false);
  /** "identities" — in "Showing 50 of 812 identities — keep typing". */
  readonly noun = input('results');
  readonly picked = output<string>();

  readonly listId = `sp-list-${nextId++}`;
  readonly query = signal('');
  readonly open = signal(false);

  /** The items include router identities: offer "Routers only". */
  readonly hasRouters = computed(() => this.items().some((it) => it.kind === 'router'));
  readonly routersOnly = signal(false);
  private readonly pool = computed(() =>
    this.routersOnly() && this.hasRouters() ? this.items().filter((it) => it.kind === 'router') : this.items(),
  );

  readonly results = computed(() => searchItems(this.pool(), this.query()));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  toggleRouters(): void {
    this.routersOnly.update((v) => !v);
    this.field().nativeElement.focus();
  }

  /** The highlighted result. Typing resets it: the first result — or, free text allowed,
   *  only an exact match (so Enter adds what was typed). */
  readonly active = linkedSignal<{ shown: PickerItem[] }, number>({
    source: this.results,
    computation: ({ shown }) => {
      const q = this.query().trim().toLowerCase();
      if (!q || !shown.length) return -1;
      if (!this.allowFree()) return 0;
      return shown.findIndex((it) => it.label.toLowerCase() === q || it.label.toLowerCase() === `#${q}`);
    },
  });

  readonly status = computed(() => {
    const { shown, total } = this.results();
    if (!total) {
      const q = this.query().trim();
      return q && this.allowFree() ? `No matches — Enter adds “${q}”` : 'No matches';
    }
    return total > shown.length ? `Showing ${shown.length} of ${total.toLocaleString('en-US')} ${this.noun()} — keep typing` : null;
  });

  optionId(i: number): string {
    return `${this.listId}-${i}`;
  }

  isSelected(it: PickerItem): boolean {
    return this.selected().has(it.value);
  }

  onInput(text: string): void {
    this.query.set(text);
    this.open.set(true);
  }

  onKeydown(e: KeyboardEvent): void {
    const n = this.results().shown.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.open.set(true);
        if (n) this.active.set((this.active() + 1) % n);
        this.scrollActive();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.open.set(true);
        if (n) this.active.set(this.active() <= 0 ? n - 1 : this.active() - 1);
        this.scrollActive();
        break;
      case 'Enter': {
        e.preventDefault();
        const it = this.open() ? this.results().shown[this.active()] : undefined;
        if (it) this.choose(it);
        else this.commitFree();
        break;
      }
      case ',':
        if (this.allowFree()) {
          e.preventDefault();
          this.commitFree();
        }
        break;
      case 'Escape':
        if (this.open()) {
          e.preventDefault();
          e.stopPropagation(); // close the list, not the panel around it
          this.open.set(false);
        }
        break;
    }
  }

  /** Leaving the field closes the list (a typed free term is kept, as before) — unless
   *  focus moved into the list's own controls (the "Routers only" toggle). */
  onBlur(e?: FocusEvent): void {
    const to = e?.relatedTarget as Node | null;
    if (to && this.host.nativeElement.contains(to)) return;
    this.open.set(false);
    this.commitFree();
  }

  /** A result clicked (mousedown keeps focus in the input). */
  choose(it: PickerItem): void {
    if (this.isSelected(it)) return;
    this.picked.emit(it.value);
    this.reset();
  }

  private commitFree(): void {
    const q = this.query().trim().replace(/,+$/, '').trim();
    if (!q || !this.allowFree()) return;
    this.picked.emit(q);
    this.reset();
  }

  private reset(): void {
    this.query.set('');
    this.field().nativeElement.value = '';
  }

  private scrollActive(): void {
    queueMicrotask(() => document.getElementById(this.optionId(this.active()))?.scrollIntoView?.({ block: 'nearest' }));
  }
}
