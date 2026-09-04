import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MockDataService, Service } from '../../shared/services/mock-data.service';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

interface TagEntry { key: string; value: string; }

interface HttpCheck {
  body: string;
  expectBody: string;
  expectStatus: string;
  interval: string;
  method: string;
  timeout: string;
  url: string;
}

interface PortCheck {
  address: string;
  interval: string;
  timeout: string;
}

@Component({
  selector: 'app-create-advanced-service',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './create-advanced-service.component.html',
  styleUrl: './create-advanced-service.component.css'
})
export class CreateAdvancedServiceComponent {
  readonly prefs = inject(UserPrefsService);
  private router = inject(Router);
  private data = inject(MockDataService);

  // ── Wizard navigation ────────────────────────────────────────────
  currentStep = 1;
  readonly totalSteps = 4;
  readonly steps = [
    { id: 1, label: 'Service Details', optional: false },
    { id: 2, label: 'Configurations',  optional: true  },
    { id: 3, label: 'Access & Policies', optional: false },
    { id: 4, label: 'Advanced Settings', optional: true  },
  ];

  // ── Step 1: Service Details ──────────────────────────────────────
  name = '';
  attributeInput = '';
  readonly attributes = signal<string[]>([]);

  // ── Step 2: Configurations ───────────────────────────────────────
  configType = 'host.v1';
  configName = '';

  // Config data
  protocol: 'tcp' | 'udp' = 'tcp';
  address = '';
  port = 0;
  forwardProtocol = false;
  forwardAddress = false;
  forwardPort = false;
  allowedSourceAddresses = '';
  forwardAddressTranslations = '';

  // Accordions state
  httpChecksOpen = false;
  listenOptionsOpen = false;
  portChecksOpen = false;
  proxyOpen = false;
  httpActionsOpen = false;
  portActionsOpen = false;

  // HTTP Checks
  readonly httpChecks = signal<HttpCheck[]>([]);
  httpBody = '';
  httpExpectBody = '';
  httpExpectStatus = '';
  httpInterval = '';
  httpMethod = '';
  httpTimeout = '';
  httpUrl = '';

  // Listen Options
  bindUsingEdgeIdentity = false;
  listenConnectTimeout = '';
  listenConnectTimeoutSeconds = '';
  listenCost = '';
  listenIdentity = '';
  listenMaxConnections = '';
  listenPrecedence = '';

  // Port Checks
  readonly portChecks = signal<PortCheck[]>([]);
  portCheckAddress = '';
  portCheckInterval = '';
  portCheckTimeout = '';

  // Proxy
  proxyAddress = '';
  proxyType = '';

  // ── Step 3: Access & Policies ────────────────────────────────────
  dialRoleInput = '';
  readonly dialRoles = signal<string[]>([]);
  bindRoleInput = '';
  readonly bindRoles = signal<string[]>([]);
  postureInput = '';
  readonly postureChecks = signal<string[]>([]);

  // ── Step 4: Advanced Settings ────────────────────────────────────
  terminatorStrategy = '';
  encryptionRequired = true;
  tagKey = '';
  tagValue = '';
  readonly tags = signal<TagEntry[]>([]);

  // Dev panel
  devPanelOpen = true;

  // ── Computed ─────────────────────────────────────────────────────
  get hasIdentities(): boolean {
    return this.data.identities().length > 0;
  }

  get canProceed(): boolean {
    return this.currentStep !== 1 || this.name.trim().length > 0;
  }

  get jsonPreview(): string {
    return JSON.stringify({
      name: this.name,
      roleAttributes: this.attributes(),
      configs: this.configName ? [{ type: this.configType, name: this.configName }] : [],
      encryptionRequired: this.encryptionRequired,
      terminatorStrategy: this.terminatorStrategy,
      tags: Object.fromEntries(this.tags().map(t => [t.key, t.value])),
    }, null, 2);
  }

  // ── Tag-chip helpers ─────────────────────────────────────────────
  private addChips(
    input: string,
    sig: ReturnType<typeof signal<string[]>>,
    clearFn: () => void
  ): void {
    const raw = input.trim().replace(/,+$/, '');
    if (!raw) return;
    sig.update(l => [...new Set([...l, ...raw.split(',').map(v => v.trim()).filter(Boolean)])]);
    clearFn();
  }

  onAttrKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    this.addChips(this.attributeInput, this.attributes, () => { this.attributeInput = ''; });
  }
  removeAttribute(a: string): void { this.attributes.update(l => l.filter(x => x !== a)); }

  onDialRoleKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    this.addChips(this.dialRoleInput, this.dialRoles, () => { this.dialRoleInput = ''; });
  }
  removeDialRole(a: string): void { this.dialRoles.update(l => l.filter(x => x !== a)); }

  onBindRoleKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    this.addChips(this.bindRoleInput, this.bindRoles, () => { this.bindRoleInput = ''; });
  }
  removeBindRole(a: string): void { this.bindRoles.update(l => l.filter(x => x !== a)); }

  onPostureKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    this.addChips(this.postureInput, this.postureChecks, () => { this.postureInput = ''; });
  }
  removePosture(a: string): void { this.postureChecks.update(l => l.filter(x => x !== a)); }

  // ── HTTP Checks ──────────────────────────────────────────────────
  addHttpCheck(): void {
    if (!this.httpUrl.trim()) return;
    this.httpChecks.update(l => [...l, {
      body: this.httpBody,
      expectBody: this.httpExpectBody,
      expectStatus: this.httpExpectStatus,
      interval: this.httpInterval,
      method: this.httpMethod,
      timeout: this.httpTimeout,
      url: this.httpUrl,
    }]);
    this.httpBody = '';
    this.httpExpectBody = '';
    this.httpExpectStatus = '';
    this.httpInterval = '';
    this.httpMethod = '';
    this.httpTimeout = '';
    this.httpUrl = '';
  }

  removeHttpCheck(i: number): void {
    this.httpChecks.update(l => l.filter((_, idx) => idx !== i));
  }

  // ── Port Checks ──────────────────────────────────────────────────
  addPortCheck(): void {
    if (!this.portCheckAddress.trim()) return;
    this.portChecks.update(l => [...l, {
      address: this.portCheckAddress,
      interval: this.portCheckInterval,
      timeout: this.portCheckTimeout,
    }]);
    this.portCheckAddress = '';
    this.portCheckInterval = '';
    this.portCheckTimeout = '';
  }

  removePortCheck(i: number): void {
    this.portChecks.update(l => l.filter((_, idx) => idx !== i));
  }

  // ── Custom Tags ──────────────────────────────────────────────────
  addTag(): void {
    if (!this.tagKey.trim()) return;
    this.tags.update(l => [...l, { key: this.tagKey.trim(), value: this.tagValue.trim() }]);
    this.tagKey = '';
    this.tagValue = '';
  }

  removeTag(i: number): void {
    this.tags.update(l => l.filter((_, idx) => idx !== i));
  }

  // ── Navigation ───────────────────────────────────────────────────
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
    const svc: Service = {
      id: 'svc-' + Date.now(),
      name: this.name.trim(),
      protocol: this.protocol,
      interceptAddress: `${this.address}:${this.port}`,
      hostAddress: `${this.address}:${this.port}`,
      attributes: this.attributes(),
      encryptionRequired: this.encryptionRequired,
      terminatorStrategy: this.terminatorStrategy || undefined,
      tags: this.tags().length
        ? Object.fromEntries(this.tags().map(t => [t.key, t.value]))
        : undefined,
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
