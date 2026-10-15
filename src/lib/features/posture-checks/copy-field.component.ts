import { Component, input, signal } from '@angular/core';

/**
 * A read-only value with a Copy button that briefly reads "Copied" — used for a connection's
 * generated event endpoint on the create form and the provider detail page.
 */
@Component({
  selector: 'app-copy-field',
  standalone: true,
  template: `
    <input [id]="inputId()" class="form-control" readonly [value]="value()" spellcheck="false"
      [attr.aria-describedby]="describedBy() || null" />
    <button type="button" class="btn btn-secondary btn-sm" (click)="copy()">
      <i class="fa-solid" [class.fa-check]="copied()" [class.fa-copy]="!copied()" aria-hidden="true"></i>
      {{ copied() ? 'Copied' : 'Copy' }}
    </button>
  `,
  styles: `:host { display: flex; gap: 0.5rem; align-items: center; }`,
})
export class CopyFieldComponent {
  readonly value = input.required<string>();
  /** id for the input, so a <label for> can point at it. */
  readonly inputId = input<string>('');
  readonly describedBy = input<string>('');

  readonly copied = signal(false);

  copy(): void {
    navigator.clipboard?.writeText(this.value()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }, () => {});
  }
}
