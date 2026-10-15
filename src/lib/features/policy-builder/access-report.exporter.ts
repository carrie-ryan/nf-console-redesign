import { Injectable, inject, signal } from '@angular/core';
import { MockDataService } from '../../shared/services/mock-data.service';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { runChunked } from './draft/draft-diff';
import { accessReportAsync, accessReportCsvSteps, configurationLine, reportFileName, scopeLabel, type ReportProgress, type ReportScope } from './access-report';

export interface ExportRun {
  /** Which export button started it. */
  key: string;
  progress: ReportProgress;
  /** Set once the rows are done and the CSV is being written. */
  writing?: { done: number; total: number };
}

export interface ExportResult {
  key: string;
  fileName: string;
  /** "All services" / "Services: git-repo" / "Identities: bob@corp.com" */
  scope: string;
  /** The file, joined on first read (at scale it is hundreds of MB — the download uses the parts). */
  readonly csv: string;
  rows: number;
  ms: number;
}

/**
 * Runs an access report export: always against LIVE (a pending draft never changes
 * it), in time slices with progress, then hands the CSV to the browser as a download.
 * One export at a time; starting another cancels the running one.
 */
@Injectable({ providedIn: 'root' })
export class AccessReportExporter {
  private readonly store = inject(PolicyDraftStore);
  private readonly data = inject(MockDataService);

  readonly running = signal<ExportRun | null>(null);
  /** The last finished export — what it covered, not its CSV (at scale that is hundreds
   *  of MB; the caller of export() gets it). */
  readonly last = signal<Omit<ExportResult, 'csv'> | null>(null);
  private token = 0;

  /** Generates the report for `scope`; `slug` names the file. Resolves with the result,
   *  or null when cancelled by a newer export. */
  async export(key: string, scope: ReportScope, slug: string): Promise<ExportResult | null> {
    const token = ++this.token;
    const world = this.store.live();
    const started = performance.now();
    const generatedAt = new Date().toISOString();
    this.running.set({ key, progress: { done: 0, total: 0, rows: 0 } });
    const rows = await accessReportAsync(
      world,
      scope,
      (p) => token === this.token && this.running.set({ key, progress: p }),
      () => token !== this.token,
    );
    if (!rows || token !== this.token) return null;
    const latest = this.store.history()[0] ?? null;
    const meta = {
      generatedAt,
      network: this.data.network().name,
      configuration: configurationLine(latest),
      scope: scopeLabel(world, scope),
    };
    const last = { key, progress: { done: 0, total: 0, rows: rows.length } };
    const parts = await runChunked(
      accessReportCsvSteps(rows, meta),
      (done) => token === this.token && this.running.set({ ...last, writing: { done, total: rows.length } }),
      () => token !== this.token,
    );
    if (!parts || token !== this.token) return null;
    let joined: string | null = null;
    const result: ExportResult = {
      key,
      fileName: reportFileName(meta, slug),
      scope: meta.scope,
      get csv() {
        return (joined ??= parts.join(''));
      },
      rows: rows.length,
      ms: Math.round(performance.now() - started),
    };
    this.running.set(null);
    this.last.set({ key, fileName: result.fileName, scope: result.scope, rows: result.rows, ms: result.ms });
    download(result.fileName, parts);
    return result;
  }
}

function download(fileName: string, parts: readonly string[]): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return; // no browser (specs)
  const url = URL.createObjectURL(new Blob(parts as string[], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
