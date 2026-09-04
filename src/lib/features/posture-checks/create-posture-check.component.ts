import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MockDataService, PostureCheck, PostureCheckType } from '../../shared/services/mock-data.service';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

@Component({
  selector: 'app-create-posture-check',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './create-posture-check.component.html',
  styleUrl: './create-posture-check.component.css'
})
export class CreatePostureCheckComponent {
  readonly prefs = inject(UserPrefsService);
  private router = inject(Router);
  private data = inject(MockDataService);

  name = '';
  attributeInput = '';
  readonly attributes = signal<string[]>([]);
  checkType: PostureCheckType | '' = '';

  readonly typeOptions: { value: PostureCheckType; label: string; description: string }[] = [
    { value: 'OS',            label: 'OS Check',       description: 'Verify the operating system type and version on the device' },
    { value: 'MFA',           label: 'MFA Check',      description: 'Require multi-factor authentication before granting access' },
    { value: 'Process',       label: 'Process Check',  description: 'Ensure a specific process or application is running on the device' },
    { value: 'Domain',        label: 'Domain Check',   description: 'Verify the device is joined to a specific domain' },
    { value: 'MAC',           label: 'MAC Check',      description: 'Allow or deny access based on the device MAC address' },
    { value: 'WindowsDomain', label: 'Windows Domain', description: 'Verify the device is joined to a Windows Active Directory domain' },
  ];

  get selectedTypeDescription(): string {
    return this.typeOptions.find(t => t.value === this.checkType)?.description ?? '';
  }

  get canSave(): boolean {
    return this.name.trim().length > 0 && this.checkType !== '';
  }

  get jsonPreview(): string {
    return JSON.stringify({
      name: this.name,
      typeId: {},
      tags: {},
    }, null, 2);
  }

  readonly apiUrl = 'https://gateway.production.netfoundry.io/core/v3/posture-checks';

  onAttributeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    const raw = this.attributeInput.trim().replace(/,+$/, '');
    if (!raw) return;
    this.attributes.update(list => [...new Set([...list, ...raw.split(',').map(v => v.trim()).filter(Boolean)])]);
    this.attributeInput = '';
  }

  removeAttribute(attr: string): void {
    this.attributes.update(list => list.filter(a => a !== attr));
  }

  copyAsCLI(): void {
    const body = JSON.stringify({ name: this.name, typeId: {}, tags: {} });
    const curl = `curl -s -X POST "${this.apiUrl}" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
    navigator.clipboard.writeText(curl).catch(() => {});
  }

  save(): void {
    if (!this.canSave) return;
    const check: PostureCheck = {
      id: 'pc-' + Date.now(),
      name: this.name.trim(),
      type: this.checkType as PostureCheckType,
      attributes: this.attributes(),
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.data.postureChecks.update(list => [...list, check]);
    this.router.navigate(['/posture-checks']);
  }

  cancel(): void {
    this.router.navigate(['/posture-checks']);
  }
}
