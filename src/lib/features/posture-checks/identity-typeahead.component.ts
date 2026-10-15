import { Component, ElementRef, HostListener, OnDestroy, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import type { Identity } from '../../shared/services/mock-data.service';

let nextId = 0;

/**
 * Single-identity typeahead for one row of the manual mapping table — an ARIA
 * combobox over `identities`, two-way bound to the chosen `identityId`.
 *
 * Typing filters by name and inline-completes the first name that starts with
 * the typed text (the completed tail is left selected, so typing on replaces
 * it). Enter or a click picks the active suggestion; on blur, text that
 * exactly names an identity selects it, empty text clears the selection, and
 * anything else reverts to the current selection.
 *
 * Not discovery's IdentitySearchSelectComponent: that one is a controlled
 * multi-select of @refs and #roles that clears its text after each pick. The
 * fixed-position menu is borrowed from it — the table wrapper scrolls
 * horizontally, which would clip an absolutely positioned menu.
 */
@Component({
  selector: 'app-identity-typeahead',
  standalone: true,
  templateUrl: './identity-typeahead.component.html',
  styleUrl: './identity-typeahead.component.css',
})
export class IdentityTypeaheadComponent implements OnDestroy {
  readonly identities = input.required<Identity[]>();
  readonly identityId = model<string>('');
  readonly ariaLabel = input('Ziti identity');
  readonly placeholder = input('Search identities…');

  readonly listboxId = `ita-list-${nextId++}`;
  /** Suggestions shown at once; the list scrolls beyond that. */
  private static readonly MAX_RESULTS = 50;

  /**
   * Text the user has typed since focusing — null while not editing. Deliberately NOT bound to the
   * field's value: re-rendering it would overwrite the inline completion. The template binds only
   * the selected name; while editing, the field is written directly (onInput / syncField).
   */
  readonly query = signal<string | null>(null);
  readonly open = signal(false);
  readonly activeIndex = signal(0);

  readonly selectedName = computed(() => this.identities().find(i => i.id === this.identityId())?.name ?? '');

  readonly matches = computed(() => {
    const q = (this.query() ?? '').trim().toLowerCase();
    const all = this.identities();
    const hits = q === '' ? all : all.filter(i => i.name.toLowerCase().includes(q));
    // Names starting with the query first, so inline completion and the top suggestion agree.
    return [...hits.filter(i => i.name.toLowerCase().startsWith(q)), ...hits.filter(i => !i.name.toLowerCase().startsWith(q))]
      .slice(0, IdentityTypeaheadComponent.MAX_RESULTS);
  });

  readonly menuTop = signal(0);
  readonly menuLeft = signal(0);
  readonly menuWidth = signal(0);
  readonly menuMaxHeight = signal(240);

  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly doc = inject(DOCUMENT);

  constructor() {
    // Capture phase: the form scrolls in an inner panel, not the window.
    this.doc.addEventListener('scroll', this.reposition, true);
  }

  ngOnDestroy(): void {
    this.doc.removeEventListener('scroll', this.reposition, true);
  }

  optionId(index: number): string {
    return `${this.listboxId}-opt-${index}`;
  }

  /** Split a name around the typed text so the match can be emphasised. */
  parts(name: string): { pre: string; hit: string; post: string } {
    const q = (this.query() ?? '').trim();
    const at = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
    return at < 0
      ? { pre: name, hit: '', post: '' }
      : { pre: name.slice(0, at), hit: name.slice(at, at + q.length), post: name.slice(at + q.length) };
  }

  onFocus(): void {
    // Select the current name so typing replaces it rather than appending.
    this.inputEl().nativeElement.select();
  }

  onInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const typed = el.value;
    this.query.set(typed);
    this.activeIndex.set(0);
    this.openMenu();
    // Inline-complete on typing (never on delete, or backspace could never remove the completion).
    const inserting = (event as InputEvent).inputType?.startsWith('insert');
    const first = this.matches()[0];
    if (inserting && typed && first && first.name.toLowerCase().startsWith(typed.toLowerCase())) {
      el.value = typed + first.name.slice(typed.length);
      el.setSelectionRange(typed.length, first.name.length);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.matches().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) { this.openMenu(); return; }
        if (count === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.activeIndex.set((this.activeIndex() + step + count) % count);
        this.doc.getElementById(this.optionId(this.activeIndex()))?.scrollIntoView({ block: 'nearest' });
        return;
      }
      case 'Enter':
        if (this.open() && count > 0) {
          event.preventDefault();
          this.pick(this.matches()[this.activeIndex()]);
        }
        return;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          this.revert();
        }
        return;
    }
  }

  /** Commit what the field says: an exact name selects, empty clears, anything else reverts. */
  onBlur(): void {
    if (this.query() !== null) {
      const text = this.inputEl().nativeElement.value.trim().toLowerCase();
      const exact = this.identities().find(i => i.name.toLowerCase() === text);
      if (exact) this.identityId.set(exact.id);
      else if (text === '') this.identityId.set('');
    }
    this.query.set(null);
    this.open.set(false);
    this.syncField();
  }

  pick(identity: Identity): void {
    this.identityId.set(identity.id);
    this.query.set(null);
    this.open.set(false);
    this.syncField();
  }

  private revert(): void {
    this.query.set(null);
    this.open.set(false);
    this.syncField();
    this.inputEl().nativeElement.select();
  }

  /** The field is written directly during inline completion, so put the selection's name back explicitly. */
  private syncField(): void {
    this.inputEl().nativeElement.value = this.selectedName();
  }

  private openMenu(): void {
    this.updateMenuPosition();
    this.open.set(true);
  }

  private readonly reposition = (): void => {
    if (this.open()) this.updateMenuPosition();
  };

  @HostListener('window:resize')
  onResize(): void {
    this.reposition();
  }

  /** Place the fixed menu under the field, capped to the space left above the viewport bottom. */
  private updateMenuPosition(): void {
    const r = this.inputEl().nativeElement.getBoundingClientRect();
    const top = r.bottom + 4;
    this.menuTop.set(top);
    this.menuLeft.set(r.left);
    this.menuWidth.set(Math.max(r.width, 224));
    this.menuMaxHeight.set(Math.max(140, Math.min(280, this.doc.defaultView!.innerHeight - top - 12)));
  }
}
