import { Component, computed, inject, input } from '@angular/core';
import { DemoClock } from './demo-clock';
import { expiryPill } from './expiry';

/**
 * A countdown to a time-limited access's expiry: "expires in 7 h 59 m", amber under
 * an hour. Ticks with the demo clock. `prefix` goes before it in the accessible text
 * ("bob@corp.com's access …"); `short` drops "expires in" (inside a chip).
 */
@Component({
  selector: 'app-expiry-pill',
  standalone: true,
  template: `<i class="fa-regular fa-clock" aria-hidden="true"></i>{{ text() }}`,
  host: {
    class: 'expiry-pill',
    '[class.soon]': 'pill().soon',
    '[attr.title]': 'pill().title',
    '[attr.data-expires-at]': 'expiresAt()',
  },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      flex-shrink: 0;
      padding: 0 0.375rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full);
      background: var(--color-surface-2);
      font-size: 0.8125rem;
      font-weight: 600;
      line-height: 1.125rem;
      white-space: nowrap;
      color: var(--color-text-2);
    }
    :host(.soon) {
      border-color: var(--color-warning);
      background: var(--color-warning-bg);
      color: var(--color-text);
    }
    i { font-size: 0.625rem; }
    :host(.soon) i { color: var(--color-warning-text); }
  `,
})
export class ExpiryPillComponent {
  private readonly clock = inject(DemoClock);
  readonly expiresAt = input.required<string>();
  readonly short = input(false);

  readonly pill = computed(() => expiryPill(this.expiresAt(), this.clock.nowMs()));
  readonly text = computed(() => (this.short() ? this.pill().text.replace(/^expires in /, '') : this.pill().text));
}
