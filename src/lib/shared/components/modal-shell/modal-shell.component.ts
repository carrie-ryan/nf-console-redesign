import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  afterNextRender,
  inject,
  output,
} from '@angular/core';

/** Process-wide counter → a unique, stable id per modal instance so
 *  aria-labelledby is valid even with several shells mounted at once. */
let modalSeq = 0;

/**
 * Shared modal frame for the alerts action modals — the canonical version of
 * the .dialog-* skeleton the feature copies used to paste inline.
 *
 * Presentational only: it owns the frame (backdrop, centered panel, header/
 * body/footer regions) and the behavior the copies lacked (Escape-to-close,
 * focus trap, focus restore). ALL content is projected:
 *   • [modal-title]  → the <h2> in the header
 *   • default slot   → the body
 *   • [modal-footer] → the footer (buttons)
 *
 * output() is used (not the callback-input convention) to match the sibling
 * confirm-dialog — this is a shared presentational component.
 */
@Component({
  selector: 'app-modal-shell',
  standalone: true,
  templateUrl: './modal-shell.component.html',
  styleUrl: './modal-shell.component.css',
})
export class ModalShellComponent implements OnDestroy {
  /** Fired on backdrop click OR Escape. The consumer decides what dismiss means. */
  readonly dismissed = output<void>();

  /** Unique per instance so multiple modals keep valid aria-labelledby links. */
  readonly titleId = `modal-title-${modalSeq++}`;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The element focused before the modal opened — restored on destroy so
   *  keyboard users land back where they were. */
  private readonly previouslyFocused = document.activeElement as HTMLElement | null;

  constructor() {
    // Move focus into the panel once it's in the DOM (first focusable, else the panel).
    afterNextRender(() => {
      const focusables = this.focusable();
      (focusables[0] ?? this.panel())?.focus();
    });
  }

  ngOnDestroy(): void {
    this.previouslyFocused?.focus?.();
  }

  onBackdrop(): void {
    this.dismissed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dismissed.emit();
  }

  /** Trap Tab/Shift+Tab within the panel — wrap at the first/last focusable. */
  @HostListener('document:keydown.tab', ['$event'])
  @HostListener('document:keydown.shift.tab', ['$event'])
  onTab(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    const focusables = this.focusable();
    if (focusables.length === 0) {
      // Nothing focusable inside — keep focus on the panel itself.
      event.preventDefault();
      this.panel()?.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inPanel = this.panel()?.contains(active) ?? false;

    if (keyEvent.shiftKey) {
      if (active === first || !inPanel) {
        keyEvent.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !inPanel) {
        keyEvent.preventDefault();
        first.focus();
      }
    }
  }

  private panel(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.dialog-panel');
  }

  /** Visible, tabbable elements within the panel, in DOM order. */
  private focusable(): HTMLElement[] {
    const panel = this.panel();
    if (!panel) return [];
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), ' +
      'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }
}
