import { Component, input } from '@angular/core';

export type PillVariant = 'online' | 'offline' | 'warning' | 'pending' | 'inactive' | 'active' | 'degraded' | 'provisioning'
  | 'severity-critical' | 'severity-major' | 'severity-minor' | 'severity-info';

@Component({
  selector: 'app-pill',
  standalone: true,
  templateUrl: './pill.component.html',
  styleUrl: './pill.component.css'
})
export class PillComponent {
  variant = input.required<PillVariant>();
  label = input<string>('');
}
