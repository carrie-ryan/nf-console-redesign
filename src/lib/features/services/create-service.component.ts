import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MockDataService, Service } from '../../shared/services/mock-data.service';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

@Component({
  selector: 'app-create-service',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './create-service.component.html',
  styleUrl: './create-service.component.css'
})
export class CreateServiceComponent {
  name = '';
  protocol: Service['protocol'] = 'tcp';
  interceptAddress = '';
  hostAddress = '';
  showJsonPreview = false;

  private router = inject(Router);
  private data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);

  get jsonPreview(): string {
    return JSON.stringify({ name: this.name, protocol: this.protocol, interceptAddress: this.interceptAddress, hostAddress: this.hostAddress }, null, 2);
  }

  save(): void {
    const svc: Service = {
      id: 'svc-' + Date.now(),
      name: this.name,
      protocol: this.protocol,
      interceptAddress: this.interceptAddress,
      hostAddress: this.hostAddress,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.data.services.update(list => [...list, svc]);
    this.router.navigate(['/services']);
  }
}
