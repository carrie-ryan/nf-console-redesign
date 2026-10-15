import { Directive, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';

/**
 * Shared behavior for the ServiceProvider form's custom dropdowns (connection and
 * provider pickers): a trigger button that discloses a panel of buttons.
 *
 * Deliberately a disclosure of buttons, not an ARIA listbox: a listbox option can't
 * contain another interactive element, and connection rows need two (pick, edit).
 * Tab walks every button; ↑/↓/Home/End move between the `[data-cp-pick]` buttons.
 *
 * Subclass templates need a `#trigger` button and mark each pickable button `data-cp-pick`.
 * Its sole state is `open`.
 */
@Directive()
export abstract class DisclosurePicker {
  readonly open = signal(false);

  protected readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  toggle(event: Event): void {
    event.stopPropagation();
    this.open.update(o => !o);
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    this.open.set(true);
    // Wait for the panel to render before moving focus into it.
    setTimeout(() => this.focusPick(event.key === 'ArrowDown' ? 0 : -1));
  }

  onPanelKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const picks = this.pickButtons();
    const current = picks.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? -1
      : current === -1 ? 0
      : current + (event.key === 'ArrowDown' ? 1 : -1);
    this.focusPick(next);
  }

  /** Close once focus leaves the picker entirely (e.g. Tab past the last button). */
  onFocusOut(event: FocusEvent): void {
    const to = event.relatedTarget as Node | null;
    if (this.open() && to && !this.host.nativeElement.contains(to)) this.open.set(false);
  }

  /** Close and return focus to the trigger — after a pick, or on Escape. */
  protected close(): void {
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  private pickButtons(): HTMLButtonElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[data-cp-pick]')];
  }

  /** Focus the pick button at `index`, wrapping; -1 is the last. */
  private focusPick(index: number): void {
    const picks = this.pickButtons();
    if (picks.length === 0) return;
    picks[(index % picks.length + picks.length) % picks.length].focus();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    if (this.open()) this.close();
  }
}
