import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalShellComponent } from '../../../shared/components/modal-shell/modal-shell.component';
import { Alert, Matcher, MuteRequest } from '../alerts.models';
import { identifyingLabels } from '../alerts.logic';

type MuteScope = 'A' | 'B' | 'C';
type MuteDuration = '1h' | '4h' | '24h' | 'forever';

/**
 * Mute-create dialog. Presentational: it composes a MuteRequest from the form
 * state and hands it back through the callback inputs — the parent (3b) owns the
 * actual mute creation. Renders inside the shared <app-modal-shell>.
 *
 * `alert` NULL is the "mute everything" entry point (the header's Mute-all):
 * there's no single alert to scope to, so the form forces scope C and disables
 * the per-alert options.
 *
 * Callback-input convention (matches the rest of the alerts feature — no
 * output()); `this` is bound by the parent when it passes the methods in.
 */
@Component({
  selector: 'app-mute-alert-modal',
  standalone: true,
  imports: [ModalShellComponent, FormsModule],
  templateUrl: './mute-alert-modal.component.html',
  styleUrl: './mute-alert-modal.component.css',
})
export class MuteAlertModalComponent {
  readonly alert = input<Alert | null>(null);
  readonly onConfirm = input.required<(req: MuteRequest) => void>();
  readonly onCancel = input.required<() => void>();

  // ─── form state ──────────────────────────────────────────────────────
  /** The user's scope pick — only honored when there's an alert; see effectiveScope. */
  private readonly scopePick = signal<MuteScope>('A');
  readonly startMode = signal<'now' | 'later'>('now');
  /** datetime-local value ("2026-09-02T15:00"), empty until picked. */
  readonly startLater = signal('');
  readonly duration = signal<MuteDuration>('1h');
  readonly reason = signal('');

  /** Duration pills, in display order. */
  readonly durationOptions: MuteDuration[] = ['1h', '4h', '24h', 'forever'];

  /** With no alert, scope is forced to C (nothing to scope to); otherwise the
   *  user's pick stands. */
  readonly effectiveScope = computed<MuteScope>(() => (this.alert() ? this.scopePick() : 'C'));
  /** A/B are meaningful only when there IS an alert. */
  readonly perAlertDisabled = computed<boolean>(() => this.alert() === null);

  pickScope(scope: MuteScope): void {
    this.scopePick.set(scope);
  }

  // ─── labels / display ────────────────────────────────────────────────
  /** Human, sentence-case display for the alert's type ("Router flapping"). */
  readonly typeDisplay = computed<string>(() => {
    const a = this.alert();
    return a ? this.alertTypeDisplay(a.alertType) : '';
  });

  /** The identifying EQ matchers for "just this alert" (may be empty). */
  readonly identifyingMatchers = computed<Matcher[]>(() => {
    const a = this.alert();
    return a ? identifyingLabels(a) : [];
  });

  // ─── option copy (Option B's label needs the type name) ──────────────
  readonly optionBLabel = computed<string>(() =>
    this.typeDisplay() ? `Every ${this.typeDisplay()} alert` : 'Every alert of this type',
  );

  // ─── live preview ────────────────────────────────────────────────────
  /** "This will silence …" — the scope line, recomputed from the selection. */
  readonly previewScopeLine = computed<string>(() => {
    switch (this.effectiveScope()) {
      case 'A': {
        const matchers = this.identifyingMatchers();
        if (matchers.length === 0) {
          return `Only ${this.typeDisplay()} alerts on this alert's component (no stable identifier — this may be broad).`;
        }
        const text = matchers.map((m) => `${m.label}=${m.value}`).join(', ');
        return `Only ${this.typeDisplay()} alerts matching ${text}`;
      }
      case 'B':
        return `All ${this.typeDisplay()} alerts across the network.`;
      case 'C':
        return 'Every alert on this network. Nobody will be paged for anything.';
    }
  });

  /** The timing line — "Now → 1 hour" / "Starts 9/2 3:00 PM → indefinite". */
  readonly previewTimingLine = computed<string>(() => {
    const start =
      this.startMode() === 'now'
        ? 'Now'
        : this.startLater()
          ? `Starts ${this.formatLocal(this.startLater())}`
          : 'Starts (pick a time)';
    const end = this.duration() === 'forever' ? 'indefinite' : this.durationLabel(this.duration());
    return `${start} → ${end}`;
  });

  /** Later-with-no-time-picked is incomplete — block submit until it's chosen. */
  readonly submitDisabled = computed<boolean>(
    () => this.startMode() === 'later' && this.startLater().trim() === '',
  );

  // ─── build + emit ────────────────────────────────────────────────────
  mute(): void {
    this.onConfirm()(this.build());
  }

  cancel(): void {
    this.onCancel()();
  }

  /** Compose the MuteRequest from the current form state. `now`/`ends` are
   *  stamped here (event-driven) so the window is measured at submit time. */
  private build(): MuteRequest {
    const scope = this.effectiveScope();
    const a = this.alert();

    let matchers: Matcher[] = [];
    let alertTypes: string[] = [];
    if (scope === 'A' && a) {
      matchers = identifyingLabels(a);
      alertTypes = [a.alertType];
    } else if (scope === 'B' && a) {
      alertTypes = [a.alertType];
    }
    // scope C leaves both empty — every type, whole network.

    const startsDate =
      this.startMode() === 'later' && this.startLater() ? new Date(this.startLater()) : null;
    const starts = startsDate ? startsDate.toISOString() : null;

    const base = startsDate ?? new Date();
    const ends =
      this.duration() === 'forever'
        ? null
        : new Date(base.getTime() + this.durationHours(this.duration()) * 3_600_000).toISOString();

    const reason = this.reason().trim() || null;
    return { matchers, alertTypes, starts, ends, reason };
  }

  private durationHours(d: MuteDuration): number {
    switch (d) {
      case '1h':  return 1;
      case '4h':  return 4;
      case '24h': return 24;
      case 'forever': return 0;
    }
  }

  durationLabel(d: MuteDuration): string {
    switch (d) {
      case '1h':  return '1 hour';
      case '4h':  return '4 hours';
      case '24h': return '24 hours';
      case 'forever': return 'Until I revoke it';
    }
  }

  /** "9/2 3:00 PM" from a datetime-local value. */
  private formatLocal(v: string): string {
    const d = new Date(v);
    const date = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${date} ${time}`;
  }

  /** Sentence-case display for a raw alertType code. */
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
