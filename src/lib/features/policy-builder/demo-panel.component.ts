import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { DatePipe, formatDate } from '@angular/common';
import { DEMO_SCENARIOS, DemoControls, type DemoScenario } from './demo-controls';

/**
 * DEMO — the page header's "Demo" button and its panel: scenarios that change live
 * from outside the builder (another admin, a Terraform run) and a demo clock. The
 * panel stays open between runs; Escape, ×, or a click outside closes it. The last
 * run is reported in the panel (a polite live region).
 */
@Component({
  selector: 'app-demo-panel',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './demo-panel.component.html',
  styleUrl: './demo-panel.component.css',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'close(true)',
  },
})
export class DemoPanelComponent {
  private readonly demo = inject(DemoControls);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly scenarios = DEMO_SCENARIOS;
  readonly binding = this.demo.binding;
  readonly approval = this.demo.approval;
  readonly open = signal(false);
  /** "users-gitlab changed in live · Dana (admin)" — the last run's outcome. */
  readonly lastRun = signal<string | null>(null);

  /** The demo clock's time (re-read whenever it moves). */
  readonly time = computed(() => {
    this.demo.clock.offsetMs();
    return this.demo.clock.now();
  });
  readonly advanced = this.demo.clock.hoursAdvanced;

  toggle(): void {
    this.open.update((o) => !o);
  }

  close(refocus = false): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.host.nativeElement.querySelector<HTMLElement>('.demo-btn')?.focus();
  }

  onDocumentClick(e: MouseEvent): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.close();
  }

  run(s: DemoScenario): void {
    try {
      const change = this.demo.run(s.id);
      const names = change?.entities.map((e) => e.name).join(', ');
      this.lastRun.set(
        s.id === 'clock'
          ? `Clock advanced to ${formatDate(this.time(), 'HH:mm', 'en-US')}${change ? ` · access expired in ${names}` : ''}`
          : change
            ? `${names} changed in live · ${change.actor}`
            : `"${s.label}" changed nothing`,
      );
    } catch (e) {
      this.lastRun.set(`Couldn't run "${s.label}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
