import { Component, computed, inject, signal } from '@angular/core';
import { ExportReportButtonComponent } from './export-report-button.component';
import type { ReportScope } from './access-report';
import { RouterLink } from '@angular/router';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { InViewDirective } from './in-view.directive';
import { filterServiceList, policyCountText, serviceListRows } from './service-list.layout';
import { verdictFor } from './service-view.layout';

/**
 * The policy builder's entry state (no `?service=`): a searchable list of every
 * service, from the draft world. Each row links to `?service=<id>`.
 *
 * Rows render without their verdicts; a row's verdict is computed when it first
 * nears the viewport (verdictFor, cached per world), and offscreen rows skip
 * rendering work (content-visibility). So the list opens at once at any size.
 */
@Component({
  selector: 'app-service-list',
  standalone: true,
  imports: [RouterLink, InViewDirective, ExportReportButtonComponent],
  templateUrl: './service-list.component.html',
  styleUrl: './service-list.component.css',
})
export class ServiceListComponent {
  private readonly store = inject(PolicyDraftStore);

  readonly query = signal('');
  readonly rows = computed(() => serviceListRows(this.store.draftWorld()));
  readonly shown = computed(() => filterServiceList(this.rows(), this.query()));

  /** The export covers the services listed: all, or the filtered ones. */
  readonly exportScope = computed<ReportScope>(() =>
    this.query().trim() ? { kind: 'services', ids: this.shown().map((r) => r.id) } : { kind: 'all' },
  );

  /** Rows that have come into view — their verdicts are computed. */
  private readonly seen = signal<ReadonlySet<string>>(new Set());

  markSeen(id: string): void {
    if (!this.seen().has(id)) this.seen.update((s) => new Set(s).add(id));
  }

  /** null until the row has been in view. */
  verdict(id: string) {
    return this.seen().has(id) ? verdictFor(id, this.store.draftWorld()) : null;
  }

  readonly countText = policyCountText;
}
