import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MockDataService, Service } from '../../shared/services/mock-data.service';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

@Component({
  selector: 'app-create-simple-service',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './create-simple-service.component.html',
  styleUrl: './create-simple-service.component.css'
})
export class CreateSimpleServiceComponent {
  private router = inject(Router);
  private data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);

  // Section 1: Service Details
  name = '';
  attributeInput = '';
  readonly attributes = signal<string[]>([]);

  // Section 2: Accessing Configuration
  accessIdentityInput = '';
  readonly accessIdentities = signal<string[]>([]);
  sdkOnlyAccess = false;
  accessAddress = '';
  accessPort = 443;

  // Section 3: Hosting Configuration
  hostIdentityInput = '';
  readonly hostIdentities = signal<string[]>([]);
  sdkOnlyHost = false;
  hostProtocol: 'tcp' | 'udp' = 'tcp';
  hostAddress = '';
  hostPort = 0;

  devPanelOpen = true;

  get canSave(): boolean {
    return this.name.trim().length > 0;
  }

  get jsonPreview(): string {
    return JSON.stringify({
      name: this.name,
      roleAttributes: this.attributes(),
      encryptionRequired: true,
      terminatorStrategy: '',
      tags: {},
    }, null, 2);
  }

  onAttrKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const raw = this.attributeInput.trim().replace(/,+$/, '');
    if (!raw) return;
    this.attributes.update(l => [...new Set([...l, ...raw.split(',').map(v => v.trim()).filter(Boolean)])]);
    this.attributeInput = '';
  }

  removeAttribute(a: string): void {
    this.attributes.update(l => l.filter(x => x !== a));
  }

  onAccessIdentityKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const raw = this.accessIdentityInput.trim().replace(/,+$/, '');
    if (!raw) return;
    this.accessIdentities.update(l => [...new Set([...l, ...raw.split(',').map(v => v.trim()).filter(Boolean)])]);
    this.accessIdentityInput = '';
  }

  removeAccessIdentity(a: string): void {
    this.accessIdentities.update(l => l.filter(x => x !== a));
  }

  onHostIdentityKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const raw = this.hostIdentityInput.trim().replace(/,+$/, '');
    if (!raw) return;
    this.hostIdentities.update(l => [...new Set([...l, ...raw.split(',').map(v => v.trim()).filter(Boolean)])]);
    this.hostIdentityInput = '';
  }

  removeHostIdentity(a: string): void {
    this.hostIdentities.update(l => l.filter(x => x !== a));
  }

  save(): void {
    const interceptAddress = this.sdkOnlyAccess
      ? 'sdk-only'
      : `${this.accessAddress}:${this.accessPort}`;
    const hostAddress = this.sdkOnlyHost
      ? 'sdk-only'
      : `${this.hostAddress}:${this.hostPort}`;

    const svc: Service = {
      id: 'svc-' + Date.now(),
      name: this.name.trim(),
      protocol: this.hostProtocol,
      interceptAddress,
      hostAddress,
      attributes: this.attributes(),
      encryptionRequired: true,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.data.services.update(l => [...l, svc]);
    this.router.navigate(['/services']);
  }

  cancel(): void {
    this.router.navigate(['/services']);
  }
}
