import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MetricsNavComponent } from '../metrics-nav/metrics-nav.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { NetworkContextService } from '../../../data-access/network-context.service';
import {
  TemplateSearchService,
  FabricLinkLatencyTemplateQueryParameter,
} from '../../../data-access/template-search.service';

@Component({
  selector: 'app-fabric-latency',
  standalone: true,
  imports: [FormsModule, MetricsNavComponent, EmptyStateComponent],
  templateUrl: './fabric-latency.component.html',
  styleUrl: './fabric-latency.component.css'
})
export class FabricLatencyComponent implements OnInit {
  private readonly templates = inject(TemplateSearchService);
  private readonly ctx = inject(NetworkContextService);
  // temp: hide the chart pending redesign; flip to true to restore the original chart.
  readonly SHOW_FABRIC_LATENCY_CHART = false;
  // Chart geometry (viewBox 560 x 260)
  readonly C = { vbW: 560, vbH: 260, padL: 55, padR: 15, padT: 15, padB: 55 } as const;
  get plotW() { return this.C.vbW - this.C.padL - this.C.padR; } // 490
  get plotH() { return this.C.vbH - this.C.padT - this.C.padB; } // 190

  readonly yMax = 18;
  readonly yTicks = [0, 3, 6, 9, 12, 15, 18];
  readonly xTickHours = [0, 4, 8, 12, 16, 20, 24];

  // 25 hourly data points (hours 0–24) for two links — the MOCK fallback.
  readonly link1 = [10,10,10,10, 6, 6, 4,16,15,15, 6,11, 4, 5,10,10, 6,10, 9,12,10,11,10,11,15];
  readonly link2 = [ 8, 8, 8, 8, 5, 5, 3,13,12,12, 5, 9, 3, 4, 8, 8, 5, 8, 7,10, 8, 9, 8, 9,12];

  // Mock flag. false → the hardcoded link1/link2 arrays above (mock fallback).
  // true  → fetch from TemplateSearchService (fixture mode by default) and
  //         render the parsed, real-shaped per-link ms series in the SVG.
  useServiceData = true;

  // Parsed per-link ms series from the service (null until fetched / when the
  // mock flag is off). Two series map to the two-link view.
  readonly serviceLink1 = signal<number[] | null>(null);
  readonly serviceLink2 = signal<number[] | null>(null);

  // Chart binds to these: service data when available, hardcoded arrays as the
  // fallback. Keeps the mock arrays live whenever useServiceData is off or the
  // fetch hasn't resolved.
  get chartLink1(): number[] {
    const svc = this.serviceLink1();
    const branch = this.useServiceData && svc ? 'service' : 'mock';
    console.log('[fabric-latency] chartLink1 getter →', branch, '| first 3:', (branch === 'service' ? svc! : this.link1).slice(0, 3));
    return this.useServiceData ? (svc ?? this.link1) : this.link1;
  }
  get chartLink2(): number[] {
    const svc = this.serviceLink2();
    const branch = this.useServiceData && svc ? 'service' : 'mock';
    console.log('[fabric-latency] chartLink2 getter →', branch, '| first 3:', (branch === 'service' ? svc! : this.link2).slice(0, 3));
    return this.useServiceData ? (svc ?? this.link2) : this.link2;
  }

  // Filters
  sourceRouter = 'AWS US-WEST-2 EDGE ROUTER 1';
  selectedType = 'P99';
  selectedDate = 'Today';
  targetRouters = signal<string[]>(['carrie-ryan']);
  allRouters = true;

  readonly sourceRouters = ['AWS US-WEST-2 EDGE ROUTER 1', 'carrie-ryan controller access'];
  readonly types = ['Mean', 'P50', 'P95', 'P99'];
  readonly dateOptions = ['Today', 'Last 7 days', 'Last 30 days', 'Custom Range'];
  readonly routerOptions = ['carrie-ryan', 'aws-us-west-2', 'us-east-1', 'eu-west-1'];

  ngOnInit(): void {
    if (this.useServiceData) {
      this.loadFabricLatency();
    }
  }

  /**
   * Pull fabric latency through TemplateSearchService and bind the first two
   * parsed series to the chart. In the service's default 'fixture' mode this
   * runs the fixture through the real parser; flipping the service to 'live'
   * makes this same call hit /reporting — no change here.
   */
  private loadFabricLatency(): void {
    const params: FabricLinkLatencyTemplateQueryParameter = {
      networkGroupId: this.ctx.networkGroupId,
      networkId: this.ctx.networkId,
      indexName: 'nclinklatency',
      interval: '1h',
      size: 0,
      aggTermSize: 500,
      latencyType: this.selectedType.toLowerCase(),
    };

    this.templates.getFabricLatency(params).subscribe({
      next: (series) => {
        console.log('[fabric-latency] parsed series count:', series.length);
        console.log(
          '[fabric-latency] series[0] length:',
          series[0]?.latenciesMs.length,
          '| first 3:',
          series[0]?.latenciesMs.slice(0, 3),
        );
        if (series[0]) this.serviceLink1.set(series[0].latenciesMs);
        if (series[1]) this.serviceLink2.set(series[1].latenciesMs);
      },
      error: (err) =>
        console.error('[fabric-latency] getFabricLatency failed:', err),
    });
  }

  xScale(i: number): number {
    return this.C.padL + (i / 24) * this.plotW;
  }

  yScale(v: number): number {
    return this.C.padT + this.plotH - (v / this.yMax) * this.plotH;
  }

  polylinePoints(data: number[]): string {
    return data.map((v, i) => `${this.xScale(i).toFixed(1)},${this.yScale(v).toFixed(1)}`).join(' ');
  }

  circleData(data: number[]): Array<{ cx: number; cy: number }> {
    return data.map((v, i) => ({ cx: this.xScale(i), cy: this.yScale(v) }));
  }

  formatHour(h: number): string {
    return `${String(h % 24).padStart(2, '0')}:00`;
  }

  removeRouter(r: string) {
    this.targetRouters.update(prev => prev.filter(x => x !== r));
  }

  addRouter(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    if (val && this.targetRouters().length < 10 && !this.targetRouters().includes(val)) {
      this.targetRouters.update(prev => [...prev, val]);
    }
    (e.target as HTMLSelectElement).value = '';
  }
}
