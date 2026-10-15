import { Component, input, output } from '@angular/core';
import type { ReasonLink, ReasonPart } from './access-tests';

/**
 * A failing test's reason, inline: its check and policy names are links that open
 * their editors ("blocked by posture — fails <require-mfa>, added to <users-gitlab>
 * in this draft"). A deleted policy is plain text — there is nothing left to open.
 */
@Component({
  selector: 'app-test-reason',
  standalone: true,
  template: `@for (p of parts(); track $index) {@if (linked() && p.link; as l) {<button type="button" class="tr-link" (click)="open.emit(l)">{{ p.text }}</button>} @else {{{ p.text }}}}`,
  styles: `
    .tr-link {
      display: inline;
      padding: 0;
      border: none;
      border-radius: var(--radius-sm);
      background: none;
      font: inherit;
      color: var(--brand-primary);
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .tr-link:hover { color: var(--brand-primary-hover, var(--brand-primary)); }
    .tr-link:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--color-focus-ring); }
  `,
})
export class TestReasonComponent {
  readonly parts = input.required<ReasonPart[]>();
  /** false where no editor can open (no canvas): the names stay plain text. */
  readonly linked = input(true);
  readonly open = output<ReasonLink>();
}
