import { Component, computed, input, signal } from '@angular/core';
import { ModalShellComponent } from '../../../shared/components/modal-shell/modal-shell.component';
import { Mute } from '../alerts.models';
import { formatAlertTimestamp } from '../alerts.logic';

type RescheduleChoice = '1h' | '4h' | '24h' | 'never';

/**
 * "Move the end of this mute" dialog. Presentational: it picks a new end instant
 * and hands it back through the callback inputs — the parent owns the mute
 * mutation. Extend-only (no "end sooner"); Revoke covers stopping now. Renders
 * inside the shared <app-modal-shell>.
 *
 * Callback-input convention (matches the rest of the alerts feature — no
 * output()); `this` is bound by the parent when it passes the methods in.
 */
@Component({
  selector: 'app-reschedule-mute-modal',
  standalone: true,
  imports: [ModalShellComponent],
  templateUrl: './reschedule-mute-modal.component.html',
  styleUrl: './reschedule-mute-modal.component.css',
})
export class RescheduleMuteModalComponent {
  readonly mute = input.required<Mute>();
  readonly onConfirm = input.required<(ends: string | null) => void>();
  readonly onCancel = input.required<() => void>();

  /** The chosen new end; defaults to the first pill ("In 1 hour"). */
  readonly choice = signal<RescheduleChoice>('1h');

  readonly choiceOptions: { key: RescheduleChoice; label: string }[] = [
    { key: '1h', label: 'In 1 hour' },
    { key: '4h', label: 'In 4 hours' },
    { key: '24h', label: 'In 24 hours' },
    { key: 'never', label: 'Never' },
  ];

  /** Current end, formatted for the read-only "Ends now" block. */
  readonly currentEnds = computed<string>(() => {
    const ends = this.mute().ends;
    return ends === null ? 'Indefinite' : formatAlertTimestamp(ends);
  });

  pick(choice: RescheduleChoice): void {
    this.choice.set(choice);
  }

  confirm(): void {
    this.onConfirm()(this.build());
  }

  cancel(): void {
    this.onCancel()();
  }

  /** The chosen end as an ISO instant, or null for "Never" (indefinite).
   *  Stamped here so "in N hours" is measured from submit time. */
  private build(): string | null {
    const hours = this.choiceHours(this.choice());
    if (hours === null) return null;
    return new Date(Date.now() + hours * 3_600_000).toISOString();
  }

  private choiceHours(choice: RescheduleChoice): number | null {
    switch (choice) {
      case '1h':  return 1;
      case '4h':  return 4;
      case '24h': return 24;
      case 'never': return null;
    }
  }
}
