import { Component, computed, input, output } from '@angular/core';
import { DisclosurePicker } from './disclosure-picker';

/** An option is either a bare value (shown as its own label) or a value/label pair. */
export type PickerOption<T extends string> = T | { value: T; label: string };

/**
 * Plain value chooser for the posture check form — a styled stand-in for a native
 * <select> (Type, Match on, Polling frequency, attribute operators). CONTROLLED —
 * the parent owns the value; this only emits picks. Shares the connection picker's
 * look (same stylesheet) and DisclosurePicker behavior.
 */
@Component({
  selector: 'app-option-picker',
  standalone: true,
  templateUrl: './option-picker.component.html',
  styleUrl: './connection-picker.component.css',
})
export class OptionPickerComponent<T extends string = string> extends DisclosurePicker {
  readonly options = input.required<readonly PickerOption<T>[]>();
  readonly value = input<T | '' | null>(null);
  /** id for the trigger button, so the field's <label for> points at it. */
  readonly triggerId = input.required<string>();
  /** Accessible name for the trigger when no <label for> points at it. */
  readonly ariaLabel = input<string | null>(null);
  /** aria-label for the open panel. */
  readonly panelLabel = input('Options');
  readonly placeholder = input('Select…');
  /** Size to content instead of filling the row — for inline controls like attribute operators. */
  readonly inline = input(false);

  readonly picked = output<T>();

  readonly items = computed(() =>
    this.options().map(o => (typeof o === 'string' ? { value: o, label: o } : o)));
  readonly selected = computed(() => this.items().find(o => o.value === this.value()));

  pick(value: T): void {
    this.close();
    if (value !== this.value()) this.picked.emit(value);
  }
}
