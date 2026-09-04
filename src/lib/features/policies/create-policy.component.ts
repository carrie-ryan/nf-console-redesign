import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MockDataService, Policy } from '../../shared/services/mock-data.service';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

@Component({
  selector: 'app-create-policy',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './create-policy.component.html',
  styleUrl: './create-policy.component.css'
})
export class CreatePolicyComponent {
  readonly prefs = inject(UserPrefsService);
  private router = inject(Router);
  readonly data = inject(MockDataService);

  // Wizard navigation
  currentStep = 1;
  readonly totalSteps = 3;
  readonly steps = [
    { id: 1, label: 'Policy Details', optional: false },
    { id: 2, label: 'Attributes', optional: true },
    { id: 3, label: 'Review', optional: false },
  ];

  // Step 1
  name = '';
  policyType: 'dial' | 'bind' = 'dial';
  semantic: 'AnyOf' | 'AllOf' = 'AnyOf';

  readonly typeDescriptions: Record<string, string> = {
    dial: 'Allows identities to access the service',
    bind: 'Allows identities to host the service',
  };

  // Step 2
  serviceAttrInput = '';
  readonly serviceAttrs = signal<string[]>([]);
  identityAttrInput = '';
  readonly identityAttrs = signal<string[]>([]);
  postureAttrInput = '';
  readonly postureAttrs = signal<string[]>([]);

  devPanelOpen = true;

  get canProceed(): boolean {
    return this.currentStep !== 1 || this.name.trim().length > 0;
  }

  get jsonPreview(): string {
    return JSON.stringify({
      name: this.name,
      appData: '',
      serviceRoles: this.serviceAttrs(),
      identityRoles: this.identityAttrs(),
      postureCheckRoles: this.postureAttrs(),
      semantic: this.semantic,
      type: this.policyType === 'dial' ? 'Dial' : 'Bind',
      tags: {},
    }, null, 2);
  }

  readonly apiUrl = 'https://gateway.production.netfoundry.io/core/v3/service-policies';

  readonly associatedServices = computed(() => {
    const roles = this.serviceAttrs();
    if (roles.length === 0) return [];
    if (roles.includes('#all')) return this.data.services();
    return this.data.services().filter(s => s.attributes?.some(a => roles.includes(a)));
  });

  readonly associatedIdentities = computed(() => {
    const roles = this.identityAttrs();
    if (roles.length === 0) return [];
    if (roles.includes('#all')) return this.data.identities();
    return this.data.identities().filter(i => i.attributes.some(a => roles.includes(a)));
  });

  readonly associatedPostureChecks = computed(() => {
    const roles = this.postureAttrs();
    if (roles.length === 0) return [];
    if (roles.includes('#all')) return this.data.postureChecks();
    return this.data.postureChecks().filter(p => p.attributes.some(a => roles.includes(a)));
  });

  onServiceAttrKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    const raw = this.serviceAttrInput.trim().replace(/,+$/, '');
    if (!raw) return;
    this.serviceAttrs.update(list => [...new Set([...list, ...raw.split(',').map(v => v.trim()).filter(Boolean)])]);
    this.serviceAttrInput = '';
  }

  removeServiceAttr(attr: string): void {
    this.serviceAttrs.update(list => list.filter(a => a !== attr));
  }

  onIdentityAttrKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    const raw = this.identityAttrInput.trim().replace(/,+$/, '');
    if (!raw) return;
    this.identityAttrs.update(list => [...new Set([...list, ...raw.split(',').map(v => v.trim()).filter(Boolean)])]);
    this.identityAttrInput = '';
  }

  removeIdentityAttr(attr: string): void {
    this.identityAttrs.update(list => list.filter(a => a !== attr));
  }

  onPostureAttrKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    const raw = this.postureAttrInput.trim().replace(/,+$/, '');
    if (!raw) return;
    this.postureAttrs.update(list => [...new Set([...list, ...raw.split(',').map(v => v.trim()).filter(Boolean)])]);
    this.postureAttrInput = '';
  }

  removePostureAttr(attr: string): void {
    this.postureAttrs.update(list => list.filter(a => a !== attr));
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

  copyAsCLI(): void {
    const body = JSON.stringify({
      name: this.name,
      serviceRoles: this.serviceAttrs(),
      identityRoles: this.identityAttrs(),
      postureCheckRoles: this.postureAttrs(),
      semantic: this.semantic,
      type: this.policyType === 'dial' ? 'Dial' : 'Bind',
      tags: {},
    });
    const curl = `curl -s -X POST "${this.apiUrl}" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
    navigator.clipboard.writeText(curl).catch(() => {});
  }

  save(): void {
    const policy: Policy = {
      id: 'pol-' + Date.now(),
      name: this.name.trim(),
      type: this.policyType,
      semantic: this.semantic,
      serviceRoles: this.serviceAttrs(),
      identityRoles: this.identityAttrs(),
      postureCheckRoles: this.postureAttrs(),
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.data.policies.update(list => [...list, policy]);
    this.router.navigate(['/policies']);
  }

  cancel(): void {
    this.router.navigate(['/policies']);
  }
}
