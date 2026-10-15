import { Component, computed, inject, input } from '@angular/core';
import { AccessReportExporter } from './access-report.exporter';
import type { ReportScope } from './access-report';

let nextKey = 0;

/**
 * "Export access report" — a CSV of who may reach what in `scope`, from LIVE. While it
 * generates, the button shows its progress ("Exporting… 40 of 200 services").
 */
@Component({
  selector: 'app-export-report-button',
  standalone: true,
  template: `<button type="button" class="btn btn-secondary btn-sm er-btn" [class.er-compact]="compact()" [disabled]="busy() || disabled()"
    [attr.aria-busy]="busy()" (click)="$event.stopPropagation(); run()" [title]="title()">
    <i class="fa-solid" [class]="busy() ? 'fa-spinner fa-spin' : 'fa-file-csv'" aria-hidden="true"></i>
    <span>{{ label() }}</span>
  </button>
  @if (busy()) {<span class="visually-hidden" role="status">{{ label() }}</span>}`,
  styles: `
    :host { display: inline-flex; }
    .er-btn { display: inline-flex; align-items: center; gap: 0.375rem; white-space: nowrap; }
    .er-compact { padding: 0.0625rem 0.375rem; border: none; background: none; font-size: 0.6875rem; color: var(--brand-primary); }
    .er-compact:hover:not(:disabled) { text-decoration: underline; background: none; }
    .visually-hidden {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
  `,
})
export class ExportReportButtonComponent {
  private readonly exporter = inject(AccessReportExporter);
  private readonly key = `export-${nextKey++}`;

  readonly scope = input.required<ReportScope>();
  /** Names the file: "all-services", "git-repo", "bob". */
  readonly slug = input.required<string>();
  /** What the report covers, for the tooltip: "git-repo". */
  readonly what = input('');
  /** A text-link look, for inside a node. */
  readonly compact = input(false);
  /** Services in scope, shown in the idle label: "Export access report (12 services)". */
  readonly count = input<number | null>(null);
  readonly disabled = input(false);

  readonly busy = computed(() => this.exporter.running()?.key === this.key);
  readonly label = computed(() => {
    const run = this.exporter.running();
    if (run?.key !== this.key) {
      const n = this.count();
      return n === null ? 'Export access report' : `Export access report (${n.toLocaleString('en-US')} ${n === 1 ? 'service' : 'services'})`;
    }
    if (run.writing) return `Writing CSV… ${run.writing.done.toLocaleString('en-US')} of ${run.writing.total.toLocaleString('en-US')} rows`;
    const { done, total } = run.progress;
    return total > 1 ? `Exporting… ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} services` : 'Exporting…';
  });
  readonly title = computed(() => `Download a CSV of who may dial or host ${this.what() || 'these services'}, from live (not the draft)`);

  run(): void {
    void this.exporter.export(this.key, this.scope(), this.slug());
  }
}
