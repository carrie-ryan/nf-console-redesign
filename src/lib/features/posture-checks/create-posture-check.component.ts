import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LowerCasePipe } from '@angular/common';
import {
  DEFAULT_MAX_AGE_SECONDS, DEFAULT_UNAVAILABLE_POLICY, MockDataService, PostureCheck, PostureCheckType, PostureCondition, UnavailablePolicy,
} from '../../shared/services/mock-data.service';
import { UserPrefsService } from '../../shared/services/user-prefs.service';
import { ApiCallsPanelComponent } from '../../shared/components/api-calls-panel/api-calls-panel.component';
import { POSTURE_CHECK_TYPES } from './posture-check-types';
import { builderReturn } from './return-to';
import { ConnectionPickerComponent } from './connection-picker.component';
import { UnavailablePolicyEditorComponent } from './unavailable-policy-editor.component';
import { ProviderPickerComponent } from './provider-picker.component';
import { OptionPickerComponent } from './option-picker.component';
import { ProviderConnectionFormComponent } from './provider-connection-form.component';
import { connectionSummary, modeLabel, needsAttention } from './connection-summary';
import { PROVIDER_CATALOG, providerSpec } from './provider-catalog';
import type {
  ConnectionMode, ProviderAttribute, ProviderConnection, ProviderSpec, ProviderType,
} from './provider-connection.models';

/**
 * Editable state for one provider attribute's condition. Every kind's fields
 * live side by side; conditionFor() reads only the ones its kind uses.
 */
interface ConditionDraft {
  /** Only consulted for multi providers — single-attribute providers are always on. */
  included: boolean;
  /** range / count operator. */
  op: string;
  num: number | null;
  /** Upper bound when op is 'between'. */
  num2: number | null;
  /** enum: allowed values. */
  selected: string[];
  bool: boolean;
  /** freshness window. */
  window: string;
  text: string;
}

const NUMERIC_OPS: { value: string; label: string }[] = [
  { value: 'gte',     label: '≥' },
  { value: 'lte',     label: '≤' },
  { value: 'eq',      label: '=' },
  { value: 'between', label: 'is between' },
];

/**
 * Starting values where the generic per-kind default would read wrong, keyed
 * `<providerType>.<attributeId>`. (Requiring infected = Yes would deny every clean device.)
 */
const DRAFT_OVERRIDES: Record<string, Partial<ConditionDraft>> = {
  'CrowdStrike.overall':  { num: 70 },
  'SentinelOne.infected': { bool: false },
};

@Component({
  selector: 'app-create-posture-check',
  standalone: true,
  imports: [RouterLink, FormsModule, LowerCasePipe, ApiCallsPanelComponent, ConnectionPickerComponent,
    UnavailablePolicyEditorComponent, ProviderPickerComponent, OptionPickerComponent, ProviderConnectionFormComponent],
  templateUrl: './create-posture-check.component.html',
  styleUrl: './create-posture-check.component.css'
})
export class CreatePostureCheckComponent implements OnInit {
  /** Route param `:id` on posture-checks/:id/edit; absent when creating. */
  readonly id = input<string>();
  /** `?returnTo=`: opened from the Policy Builder — the list it returns to keeps the way back. */
  readonly returnTo = input<string>();
  /** The list's query params: the builder return, when there is one. */
  readonly listParams = computed(() => {
    const back = builderReturn(this.returnTo());
    return back ? { returnTo: back } : {};
  });
  /** The saved check being edited, loaded in ngOnInit; undefined when creating. */
  editingCheck: PostureCheck | undefined;

  readonly prefs = inject(UserPrefsService);
  private router = inject(Router);
  private data = inject(MockDataService);

  name = '';
  attributeInput = '';
  readonly attributes = signal<string[]>([]);
  checkType: PostureCheckType | '' = '';

  readonly typeOptions = POSTURE_CHECK_TYPES;

  get selectedTypeDescription(): string {
    return POSTURE_CHECK_TYPES.find(t => t.value === this.checkType)?.description ?? '';
  }

  // ─── ServiceProvider sub-form ───────────────────────────────────
  readonly providerOptions = PROVIDER_CATALOG;
  readonly modeLabel = modeLabel;
  readonly needsAttention = needsAttention;
  readonly connectionSummary = connectionSummary;

  providerType: ProviderType | '' = '';
  /** The connection the check will reference — set only once a real connection is chosen or saved. */
  connectionId: string | null = null;
  /** Pass / fail per unavailable-data condition; always the full five keys. Check-level, not per connection. */
  unavailablePolicy: UnavailablePolicy = { ...DEFAULT_UNAVAILABLE_POLICY };
  /** Staleness threshold for onStale, in seconds. Check-level, alongside unavailablePolicy. */
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS;
  /** User chose "＋ New connection…" while existing connections are available. */
  creatingConnection = false;
  /** Connection loaded into the connection form for editing; null when creating (or the form is closed). */
  editingConnectionId: string | null = null;
  /**
   * Bumped whenever the connection form closes, so the next opening renders a fresh form
   * (blank, or loaded from the connection being edited) rather than reusing the last one's state.
   */
  connectionFormSession = 0;

  /** Condition editor state keyed by attribute id; rebuilt whenever the provider changes. */
  conditionDrafts: Record<string, ConditionDraft> = {};

  get activeProvider(): ProviderSpec | undefined {
    return this.providerType ? providerSpec(this.providerType) : undefined;
  }

  get existingConnections(): ProviderConnection[] {
    return this.data.providerConnections().filter(c => c.providerType === this.providerType);
  }

  get selectedConnection(): ProviderConnection | undefined {
    return this.data.providerConnections().find(c => c.id === this.connectionId);
  }

  get showCredentialForm(): boolean {
    return !!this.activeProvider
      && (this.existingConnections.length === 0 || this.creatingConnection || this.editingConnectionId !== null);
  }

  get editingConnection(): ProviderConnection | undefined {
    return this.data.providerConnections().find(c => c.id === this.editingConnectionId);
  }

  /** Confirmation under the connection summary after a save; cleared when the connection form reopens. */
  connectionSavedNote: string | null = null;

  // ─── Edit mode ──────────────────────────────────────────────────

  ngOnInit(): void {
    const id = this.id();
    if (!id) return;
    const check = this.data.postureChecks().find(c => c.id === id);
    if (!check) {
      this.router.navigate(['/posture-checks'], { queryParams: this.listParams() });
      return;
    }
    this.editingCheck = check;
    this.name = check.name;
    this.attributes.set([...check.attributes]);
    this.checkType = check.type;
    if (check.type !== 'ServiceProvider') return;
    this.unavailablePolicy = { ...DEFAULT_UNAVAILABLE_POLICY, ...check.unavailablePolicy };
    this.maxAgeSeconds = check.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    // A dangling connectionId leaves the provider unset, so the user re-picks one.
    const conn = this.data.providerConnections().find(c => c.id === check.connectionId);
    if (!conn) return;
    this.providerType = conn.providerType;
    this.connectionId = conn.id;
    this.conditionDrafts = this.draftsFromConditions(this.activeProvider, check.conditions ?? []);
  }

  /** buildDrafts() with each saved condition written back into its attribute's draft — the reverse of conditionFor(). */
  private draftsFromConditions(spec: ProviderSpec | undefined, conditions: PostureCondition[]): Record<string, ConditionDraft> {
    const drafts = this.buildDrafts(spec);
    if (!spec) return drafts;
    for (const d of Object.values(drafts)) d.included = false;
    for (const c of conditions) {
      const attr = spec.attributes.find(a => a.id === c.attribute);
      const d = drafts[c.attribute];
      if (!attr || !d) continue;
      d.included = true;
      const v = c.value;
      switch (attr.kind) {
        case 'range':
        case 'count':
          if (c.op === 'between' && Array.isArray(v)) {
            d.op = 'between';
            [d.num, d.num2] = v as (number | null)[];
          } else {
            d.op = c.op;
            d.num = typeof v === 'number' ? v : null;
          }
          break;
        case 'enum': {
          // Saved as `in` [values] by this form; a seeded `eq` scalar reads the same way.
          const values = (Array.isArray(v) ? v : [v]).map(String);
          d.selected = (attr.values ?? []).filter(x => values.includes(x));
          break;
        }
        case 'bool':      d.bool = !!v; break;
        case 'freshness': d.window = String(v); break;
        case 'text':      d.text = String(v ?? ''); break;
      }
    }
    return drafts;
  }

  // ─── Condition editor ───────────────────────────────────────────

  private buildDrafts(spec: ProviderSpec | undefined): Record<string, ConditionDraft> {
    const drafts: Record<string, ConditionDraft> = {};
    spec?.attributes.forEach((a, i) => {
      const min = a.min ?? 0;
      const values = a.values ?? [];
      drafts[a.id] = {
        // Multi providers start with their first attribute included so the editor is never empty.
        included: i === 0,
        op: a.kind === 'count' ? 'lte' : 'gte',
        num: a.kind === 'range' && a.max !== undefined ? Math.round(min + (a.max - min) * 0.7) : 0,
        num2: a.max ?? null,
        selected: values.slice(0, 1),
        bool: true,
        window: values.includes('24 hours') ? '24 hours' : values[0] ?? '',
        text: '',
        ...DRAFT_OVERRIDES[`${spec.providerType}.${a.id}`],
      };
    });
    return drafts;
  }

  isIncluded(spec: ProviderSpec, attr: ProviderAttribute): boolean {
    return !spec.multi || !!this.conditionDrafts[attr.id]?.included;
  }

  numericOps(attr: ProviderAttribute) {
    return attr.kind === 'range' ? NUMERIC_OPS : NUMERIC_OPS.filter(o => o.value !== 'between');
  }

  /** Lower bound for a numeric input: the attribute's min, or 0 for counts. */
  numMin(attr: ProviderAttribute): number | null {
    return attr.min ?? (attr.kind === 'count' ? 0 : null);
  }

  toggleEnumValue(attr: ProviderAttribute, draft: ConditionDraft, value: string): void {
    const next = draft.selected.includes(value)
      ? draft.selected.filter(v => v !== value)
      : [...draft.selected, value];
    // Keep catalog order so the emitted value is stable regardless of click order.
    draft.selected = (attr.values ?? []).filter(v => next.includes(v));
  }

  /** Why an included attribute can't produce a condition yet, or null when it's complete. */
  attrError(attr: ProviderAttribute, d: ConditionDraft): string | null {
    switch (attr.kind) {
      case 'range':
      case 'count': {
        const min = this.numMin(attr);
        const max = attr.max ?? null;
        const nums = d.op === 'between' ? [d.num, d.num2] : [d.num];
        if (nums.some(n => n === null || !Number.isFinite(n))) return 'Enter a number.';
        if (nums.some(n => (min !== null && n! < min) || (max !== null && n! > max))) {
          return max !== null ? `Must be between ${min} and ${max}.` : `Must be ${min} or more.`;
        }
        if (d.op === 'between' && d.num2! < d.num!) return 'The upper bound must be at least the lower bound.';
        return null;
      }
      case 'enum': return d.selected.length ? null : 'Choose at least one value.';
      case 'text': return d.text.trim() ? null : 'Enter a value.';
      default: return null;
    }
  }

  private conditionFor(attr: ProviderAttribute, d: ConditionDraft): PostureCondition {
    const attribute = attr.id;
    switch (attr.kind) {
      case 'range':
      case 'count':
        return d.op === 'between'
          ? { attribute, op: 'between', value: [d.num, d.num2] }
          : { attribute, op: d.op, value: d.num };
      case 'enum':      return { attribute, op: 'in', value: [...d.selected] };
      case 'bool':      return { attribute, op: 'eq', value: d.bool };
      case 'freshness': return { attribute, op: 'seen_within', value: d.window };
      case 'text':      return { attribute, op: 'eq', value: d.text.trim() };
      case 'fixed':     return { attribute, op: 'eq', value: 'compliant' };
    }
  }

  private get includedAttributes(): ProviderAttribute[] {
    const spec = this.activeProvider;
    return spec ? spec.attributes.filter(a => this.isIncluded(spec, a)) : [];
  }

  /** Conditions from every included attribute that is complete. All are AND-ed by the policy engine. */
  get conditions(): PostureCondition[] {
    return this.includedAttributes
      .filter(a => this.attrError(a, this.conditionDrafts[a.id]) === null)
      .map(a => this.conditionFor(a, this.conditionDrafts[a.id]));
  }

  /** "N of M included" for multi providers once a connection is chosen; null otherwise. */
  get includedSummary(): string | null {
    const spec = this.activeProvider;
    if (!spec?.multi || this.connectionId === null) return null;
    return `${this.includedAttributes.length} of ${spec.attributes.length} included`;
  }

  private get conditionsComplete(): boolean {
    return this.includedAttributes.every(a => this.attrError(a, this.conditionDrafts[a.id]) === null);
  }

  onProviderChange(): void {
    this.conditionDrafts = this.buildDrafts(this.activeProvider);
    this.connectionId = null;
    this.closeConnectionForm();
  }

  onPickConnection(id: string): void {
    this.closeConnectionForm();
    this.connectionId = id;
  }

  onCreateConnection(): void {
    this.closeConnectionForm();
    this.creatingConnection = true;
    this.connectionId = null;
  }

  /** Select a connection and open it in the connection form. */
  startEdit(id: string): void {
    if (!this.activeProvider || !this.data.providerConnections().some(c => c.id === id)) return;
    this.closeConnectionForm();
    this.connectionId = id;
    this.editingConnectionId = id;
  }

  /** The connection form built a connection: store it (replacing the edited one) and select it. */
  onConnectionSaved(conn: ProviderConnection): void {
    const editing = this.editingConnectionId !== null;
    this.data.providerConnections.update(list =>
      editing ? list.map(c => c.id === conn.id ? conn : c) : [...list, conn]);
    this.closeConnectionForm();
    this.connectionId = conn.id;
    this.connectionSavedNote = editing ? `Saved changes to “${conn.name}”.` : `Saved “${conn.name}”.`;
  }

  /** Deliberate observe ↔ enforce flip on a saved connection; affects every check that reads from it. */
  setConnectionMode(conn: ProviderConnection, mode: ConnectionMode): void {
    // An open edit form follows the flip itself (it reads the live connection).
    this.data.providerConnections.update(list => list.map(c => c.id === conn.id ? { ...c, mode } : c));
    this.connectionSavedNote = mode === 'enforce'
      ? `“${conn.name}” now enforces — failing checks block access.`
      : `“${conn.name}” is back in observe — results are recorded, nothing is blocked.`;
  }

  /** Cancel keeps whatever connection is selected — including the one that was being edited. */
  cancelNewConnection(): void {
    this.closeConnectionForm();
  }

  private closeConnectionForm(): void {
    this.connectionSavedNote = null;
    this.creatingConnection = false;
    this.editingConnectionId = null;
    this.connectionFormSession++;
  }

  get canSave(): boolean {
    if (this.name.trim().length === 0 || this.checkType === '') return false;
    if (this.checkType === 'ServiceProvider') {
      return this.connectionId !== null && this.conditions.length > 0 && this.conditionsComplete;
    }
    return true;
  }

  get jsonPreview(): string {
    if (this.checkType === 'ServiceProvider') {
      return JSON.stringify({
        name: this.name,
        typeId: 'ServiceProvider',
        connectionId: this.connectionId,
        conditions: this.conditions,
        unavailablePolicy: this.unavailablePolicy,
        maxAgeSeconds: this.maxAgeSeconds,
        tags: {},
      }, null, 2);
    }
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

  save(): void {
    if (!this.canSave) return;
    const editing = this.editingCheck;
    const check: PostureCheck = {
      id: editing?.id ?? 'pc-' + Date.now(),
      name: this.name.trim(),
      type: this.checkType as PostureCheckType,
      attributes: this.attributes(),
      status: editing?.status ?? 'active',
      createdAt: editing?.createdAt ?? new Date().toISOString(),
      ...(this.checkType === 'ServiceProvider' && this.connectionId
        ? {
            connectionId: this.connectionId,
            conditions: this.conditions,
            unavailablePolicy: { ...this.unavailablePolicy },
            maxAgeSeconds: this.maxAgeSeconds,
          }
        : {}),
    };
    // Built fresh, so switching an edited check away from ServiceProvider drops its connection and conditions.
    this.data.postureChecks.update(list =>
      editing ? list.map(c => c.id === editing.id ? check : c) : [...list, check]);
    this.router.navigate(['/posture-checks'], { queryParams: this.listParams() });
  }

  cancel(): void {
    this.router.navigate(['/posture-checks'], { queryParams: this.listParams() });
  }
}
