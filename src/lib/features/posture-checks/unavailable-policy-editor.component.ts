import { Component, computed, model } from '@angular/core';
import type {
  UnavailableCondition, UnavailableOutcome, UnavailablePolicy,
} from '../../shared/services/mock-data.service';

/** Plain-language row labels, in display order. */
const CONDITION_ROWS: { key: UnavailableCondition; label: string }[] = [
  { key: 'onUnmapped',     label: "Identity isn't mapped to a device" },
  { key: 'onNoRecord',     label: 'Provider has no record for the device' },
  { key: 'onStale',        label: "Data is stale or hasn't arrived yet" },
  { key: 'onNoValue',      label: 'Required field is missing from the record' },
  { key: 'onTypeMismatch', label: 'Field is present but the wrong type' },
];

/** "15 min", "1 hr", "1 hr 30 min" — readable echo of the stored seconds. */
function humanizeSeconds(total: number): string {
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h && `${h} hr`, m && `${m} min`, s && `${s} s`].filter(Boolean).join(' ');
}

/**
 * Pass / fail per UnavailableCondition for a ServiceProvider check, two-way bound
 * to the check's full five-key `policy`. The onStale row also carries the check's
 * `maxAgeSeconds` — the threshold that defines "stale". Own component (rather than more rules in the
 * create form's stylesheet) to keep that stylesheet under its size budget.
 */
@Component({
  selector: 'app-unavailable-policy-editor',
  standalone: true,
  templateUrl: './unavailable-policy-editor.component.html',
  styleUrl: './unavailable-policy-editor.component.css',
})
export class UnavailablePolicyEditorComponent {
  readonly policy = model.required<UnavailablePolicy>();
  /** Stored in seconds; the UI edits seconds and echoes a friendlier unit. */
  readonly maxAgeSeconds = model.required<number>();
  readonly maxAgeLabel = computed(() => humanizeSeconds(this.maxAgeSeconds()));

  readonly rows = CONDITION_ROWS;
  readonly outcomes: UnavailableOutcome[] = ['pass', 'fail'];

  set(key: UnavailableCondition, outcome: UnavailableOutcome): void {
    this.policy.update(p => ({ ...p, [key]: outcome }));
  }

  /** Only whole positive values reach the model; anything else is left in the box until blur. */
  setMaxAge(raw: string): void {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1) this.maxAgeSeconds.set(n);
  }

  /** Snap an invalid / cleared entry back to the last valid value. */
  resetMaxAgeInput(el: HTMLInputElement): void {
    el.value = String(this.maxAgeSeconds());
  }
}
