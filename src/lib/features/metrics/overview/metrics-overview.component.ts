import { Component } from '@angular/core';
import { MetricsNavComponent } from '../metrics-nav/metrics-nav.component';

@Component({
  selector: 'app-metrics-overview',
  standalone: true,
  imports: [MetricsNavComponent],
  templateUrl: './metrics-overview.component.html',
  styleUrl: './metrics-overview.component.css'
})
export class MetricsOverviewComponent {}
