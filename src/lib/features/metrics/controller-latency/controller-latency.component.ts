import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MetricsNavComponent } from '../metrics-nav/metrics-nav.component';

@Component({
  selector: 'app-controller-latency',
  standalone: true,
  imports: [FormsModule, MetricsNavComponent],
  templateUrl: './controller-latency.component.html',
  styleUrl: './controller-latency.component.css'
})
export class ControllerLatencyComponent {
  // Chart geometry (viewBox 560 x 260)
  readonly C = { vbW: 560, vbH: 260, padL: 55, padR: 15, padT: 15, padB: 55 } as const;
  get plotW() { return this.C.vbW - this.C.padL - this.C.padR; } // 490
  get plotH() { return this.C.vbH - this.C.padT - this.C.padB; } // 190

  readonly yMax = 4;
  readonly yTicks = [0, 1, 2, 3, 4];
  readonly xTickHours = [0, 4, 8, 12, 16, 20, 24];

  // 25 hourly data points — two stable controller latency lines
  readonly series1 = [3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3];
  readonly series2 = [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2];

  // Filters
  selectedType = 'Mean';
  selectedDate = 'Today';
  targetRouters = signal<string[]>(['aws-us-west-2', 'carrie-ryan']);
  allRouters = true;

  readonly types = ['Mean', 'P50', 'P95', 'P99'];
  readonly dateOptions = ['Today', 'Last 7 days', 'Last 30 days', 'Custom Range'];
  readonly routerOptions = ['carrie-ryan', 'aws-us-west-2', 'us-east-1', 'eu-west-1'];

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
