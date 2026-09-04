import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MockDataService, Identity } from '../../shared/services/mock-data.service';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

interface TagEntry { key: string; value: string; }

@Component({
  selector: 'app-create-identity',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './create-identity.component.html',
  styleUrl: './create-identity.component.css'
})
export class CreateIdentityComponent {
  readonly prefs = inject(UserPrefsService);
  private router = inject(Router);
  private data = inject(MockDataService);

  // Wizard navigation
  currentStep = 1;
  readonly totalSteps = 3;
  readonly steps = [
    { id: 1, label: 'Identity Details', optional: false },
    { id: 2, label: 'Auth & Access', optional: false },
    { id: 3, label: 'Advanced Options', optional: true },
  ];

  // Step 1
  name = '';
  identityType: 'device' | 'router' | 'service' = 'device';
  attributeInput = '';
  readonly attributes = signal<string[]>([]);

  readonly typeDescriptions: Record<string, string> = {
    device: 'An endpoint such as a laptop, phone, or IoT device that connects to the network.',
    router: 'A network router that forwards traffic within the zero-trust fabric.',
    service: 'A backend application or service that accepts connections from identities.',
  };

  // Step 2
  authPolicy = 'default';
  externalId = '';

  // Step 3
  enrollmentType: 'ott' | 'ottca' | 'updb' = 'ott';
  isAdmin = false;
  hostingCost = 0;
  hostingPrecedence = 'default';
  tagKey = '';
  tagValue = '';
  readonly tags = signal<TagEntry[]>([]);
  appData = '{}';

  // Developer Tools panel
  devPanelOpen = true;

  get jsonPreview(): string {
    return JSON.stringify({
      name: this.name,
      type: this.identityType,
      appData: {},
      isAdmin: this.isAdmin,
      roleAttributes: this.attributes(),
      authPolicyId: this.authPolicy,
      externalId: this.externalId,
      defaultHostingCost: this.hostingCost,
      defaultHostingPrecedence: this.hostingPrecedence,
      tags: Object.fromEntries(this.tags().map(t => [t.key, t.value])),
      enrollment: { [this.enrollmentType]: true },
    }, null, 2);
  }

  get canProceed(): boolean {
    return this.currentStep !== 1 || this.name.trim().length > 0;
  }

  onAttributeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    const raw = this.attributeInput.trim().replace(/,+$/, '');
    if (!raw) return;
    const vals = raw.split(',').map(v => v.trim()).filter(Boolean);
    this.attributes.update(list => [...new Set([...list, ...vals])]);
    this.attributeInput = '';
  }

  removeAttribute(attr: string): void {
    this.attributes.update(list => list.filter(a => a !== attr));
  }

  addTag(): void {
    if (!this.tagKey.trim()) return;
    this.tags.update(list => [...list, { key: this.tagKey.trim(), value: this.tagValue.trim() }]);
    this.tagKey = '';
    this.tagValue = '';
  }

  removeTag(index: number): void {
    this.tags.update(list => list.filter((_, i) => i !== index));
  }

  goToStep(step: number): void {
    if (step < this.currentStep) this.currentStep = step;
  }

  next(): void {
    if (this.currentStep < this.totalSteps) this.currentStep++;
  }

  back(): void {
    if (this.currentStep > 1) this.currentStep--;
  }

  save(): void {
    const tagsObj = Object.fromEntries(this.tags().map(t => [t.key, t.value]));
    const identity: Identity = {
      id: 'id-' + Date.now(),
      name: this.name.trim(),
      type: this.identityType,
      attributes: this.attributes(),
      authPolicy: this.authPolicy,
      externalId: this.externalId || undefined,
      isAdmin: this.isAdmin,
      enrollmentType: this.enrollmentType,
      hostingCost: this.hostingCost,
      hostingPrecedence: this.hostingPrecedence,
      tags: Object.keys(tagsObj).length ? tagsObj : undefined,
      appData: this.appData !== '{}' ? this.appData : undefined,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.data.identities.update(list => [...list, identity]);
    this.router.navigate(['/identities']);
  }

  cancel(): void {
    this.router.navigate(['/identities']);
  }
}
