import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalShellComponent } from '../../../shared/components/modal-shell/modal-shell.component';
import { Alert } from '../alerts.models';
import { componentDisplayName } from '../alerts.logic';

/**
 * Claim-an-alert dialog. Presentational: it collects an optional note and hands
 * the raw string back through the callback inputs — the parent owns the actual
 * ack mutation and current-user attribution. Renders inside the shared
 * <app-modal-shell> (frame + Escape/backdrop/focus-trap behavior).
 *
 * Callback-input convention (matches the rest of the alerts feature — no
 * output()); `this` is bound by the parent when it passes the methods in.
 */
@Component({
  selector: 'app-claim-alert-modal',
  standalone: true,
  imports: [ModalShellComponent, FormsModule],
  templateUrl: './claim-alert-modal.component.html',
  styleUrl: './claim-alert-modal.component.css',
})
export class ClaimAlertModalComponent {
  readonly alert = input.required<Alert>();
  readonly onConfirm = input.required<(note: string) => void>();
  readonly onCancel = input.required<() => void>();

  /** The note textarea, held locally until Claim hands it to onConfirm. */
  readonly note = signal('');

  /** "You are taking" line — the alert's human type + component name, e.g.
   *  "Router flapping on flap-2". Component name falls back to the raw type
   *  when there's no resolvable component. */
  readonly takingLine = computed<string>(() => {
    const alert = this.alert();
    const component = componentDisplayName(alert);
    return component ? `${this.alertTypeDisplay(alert.alertType)} on ${component}` : this.alertTypeDisplay(alert.alertType);
  });

  claim(): void {
    this.onConfirm()(this.note());
  }

  cancel(): void {
    this.onCancel()();
  }

  /** Human display for a raw alertType code (sentence case). */
  private alertTypeDisplay(alertType: string): string {
    switch (alertType) {
      case 'ziti.router.flapping':     return 'Router flapping';
      case 'ziti.service.unreachable': return 'Service unreachable';
      default: {
        const tail = alertType.split('.').pop() ?? alertType;
        const words = tail.replace(/[-_]/g, ' ');
        return words.charAt(0).toUpperCase() + words.slice(1);
      }
    }
  }
}
