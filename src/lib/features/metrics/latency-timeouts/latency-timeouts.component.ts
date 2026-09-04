import { Component } from '@angular/core';
import { MetricsNavComponent } from '../metrics-nav/metrics-nav.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-latency-timeouts',
  standalone: true,
  imports: [MetricsNavComponent, EmptyStateComponent],
  templateUrl: './latency-timeouts.component.html',
  styleUrl: './latency-timeouts.component.css'
})
export class LatencyTimeoutsComponent {}
