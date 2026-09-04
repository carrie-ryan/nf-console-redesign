import { Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-metrics-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './metrics-nav.component.html',
  styleUrl: './metrics-nav.component.css'
})
export class MetricsNavComponent {
  pageTitle = input.required<string>();
}
