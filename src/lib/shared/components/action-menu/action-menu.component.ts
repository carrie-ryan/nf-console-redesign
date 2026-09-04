import { Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';

/**
 * One item in a row-action overflow menu. `onClick` is the whole behavior — this
 * component owns no feature logic, it just renders and dispatches.
 */
export interface ActionMenuItem {
  /** Visible label, e.g. 'Claim'. */
  label: string;
  /** Full Font Awesome class, e.g. 'fa-solid fa-user-plus'. */
  icon: string;
  /** Invoked when the item is chosen (unless disabled). */
  onClick: () => void;
  /** Destructive styling (red text/icon) → .dropdown-item--danger. */
  danger?: boolean;
  /** Greyed out and non-clickable. */
  disabled?: boolean;
}

/**
 * Shared, data-driven row-action overflow menu (the ⋮ kebab). Replaces the
 * copy-pasted static kebab pattern in identities/sessions/routers — those hard-code
 * item rows and have no disabled support. Consumers pass an `items` array whose
 * membership can be state-dependent (e.g. Claim vs Release on a given row).
 *
 * Self-contained: open/close is a local signal, and it closes itself on an
 * outside click (host-contains check) or Escape — no container handler required
 * from the consumer. When `items` is empty the trigger is omitted entirely: a row
 * with no available actions shouldn't show a ⋮.
 */
@Component({
  selector: 'app-action-menu',
  standalone: true,
  templateUrl: './action-menu.component.html',
  styleUrl: './action-menu.component.css',
})
export class ActionMenuComponent {
  readonly items = input.required<ActionMenuItem[]>();
  readonly ariaLabel = input<string>('Actions');

  readonly open = signal(false);

  private readonly host = inject(ElementRef<HTMLElement>);

  /** Trigger click: stopPropagation so the document:click self-close doesn't
   *  immediately re-close what this click just opened. */
  toggle(event: Event): void {
    event.stopPropagation();
    this.open.update((o) => !o);
  }

  select(item: ActionMenuItem): void {
    if (item.disabled) return;
    item.onClick();
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!this.host.nativeElement.contains(target)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
