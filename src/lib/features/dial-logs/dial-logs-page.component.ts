import { Component, OnInit, inject, signal } from '@angular/core';
import { NetworkContextService } from '../../data-access/network-context.service';
import {
  TemplateSearchService,
  DialLogRecord,
  FabricCircuitTemplateQueryParameter,
} from '../../data-access/template-search.service';
import { DialLogsContentComponent } from './dial-logs-content.component';

/**
 * Standalone /dial-logs page — fetches dial logs (fixture/live flag) and hosts
 * the reusable grouped activity table. The same content component is embedded
 * in the slide-in drawer (B3); this route keeps a full-page view working.
 */
@Component({
  selector: 'app-dial-logs-page',
  standalone: true,
  imports: [DialLogsContentComponent],
  templateUrl: './dial-logs-page.component.html',
  styleUrl: './dial-logs-page.component.css',
})
export class DialLogsPageComponent implements OnInit {
  private readonly templates = inject(TemplateSearchService);
  private readonly ctx = inject(NetworkContextService);

  readonly loading = signal(true);
  readonly records = signal<DialLogRecord[]>([]);

  ngOnInit(): void {
    const params: FabricCircuitTemplateQueryParameter = {
      indexName: 'ncfabriccircuits',
      networkGroupId: this.ctx.networkGroupId,
      networkId: this.ctx.networkId,
      size: '500',
    };
    this.templates.getDialLogs(params).subscribe((recs) => {
      this.records.set(recs);
      this.loading.set(false);
    });
  }
}
