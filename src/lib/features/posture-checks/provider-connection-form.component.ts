import { Component, ElementRef, OnInit, computed, effect, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe } from '@angular/common';
import { MockDataService } from '../../shared/services/mock-data.service';
import { IdentityTypeaheadComponent } from './identity-typeahead.component';
import { ImportMappingsModalComponent } from './import-mappings-modal.component';
import { CopyFieldComponent } from './copy-field.component';
import { OptionPickerComponent } from './option-picker.component';
import { MatchKeyPreviewComponent } from './match-key-preview.component';
import { unmatchedIdentities } from './device-matching';
import { MATCH_SAMPLE } from './device-matching.fixture';
import { ACQUISITION_OPTIONS, MATCH_OPTIONS, MODE_OPTIONS, POLL_OPTIONS, generatedEventEndpoint } from './connection-summary';
import { providerSpec } from './provider-catalog';
import type {
  AcquisitionMode, ConnectionMode, CredentialField, IdentityMapping, MatchKey, ProviderConnection, ProviderType,
} from './provider-connection.models';

/** How many identities pre-fill the manual mapping table (POC seed). */
const MAPPING_SEED_COUNT = 3;

/** Mock receive token for a new event connection's generated endpoint (its id isn't known until save). */
function newEventToken(): string {
  return 'evt-' + Math.random().toString(16).slice(2, 14);
}

/**
 * Creates or edits one provider connection: name, credentials, acquisition, mode and device
 * matching, ending in Test & save. It builds the ProviderConnection and emits it; the host
 * decides where it goes. State is loaded once on init, so the host renders a fresh instance
 * each time it opens the form.
 */
@Component({
  selector: 'app-provider-connection-form',
  standalone: true,
  imports: [FormsModule, UpperCasePipe, IdentityTypeaheadComponent, ImportMappingsModalComponent,
    MatchKeyPreviewComponent, OptionPickerComponent, CopyFieldComponent],
  templateUrl: './provider-connection-form.component.html',
  styleUrl: './provider-connection-form.component.css'
})
export class ProviderConnectionFormComponent implements OnInit {
  readonly providerType = input.required<ProviderType>();
  /** The saved connection to edit; absent when creating. Pass the live one so a mode flip elsewhere reaches the form. */
  readonly connection = input<ProviderConnection>();
  /** Whether to offer Cancel (the host has somewhere to go back to). */
  readonly cancellable = input(true);
  /** Whether the edit card notes how many checks use the connection; off when the host shows its own. */
  readonly showUsage = input(true);

  /** The connection to store — new, or the edited one rebuilt. Secrets are never on it. */
  readonly saved = output<ProviderConnection>();
  readonly cancelled = output<void>();

  private data = inject(MockDataService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly spec = computed(() => providerSpec(this.providerType()));

  readonly pollOptions = POLL_OPTIONS.map(p => ({ value: p.value, label: `Every ${p.label}` }));
  readonly acquisitionOptions = ACQUISITION_OPTIONS;
  readonly matchOptions = MATCH_OPTIONS;
  readonly modeOptions = MODE_OPTIONS;

  newConnName = '';
  /**
   * Entered credential values keyed by CredentialField.key. Held only until the connection is saved:
   * non-secret values are kept on the connection (`settings`), secret ones are discarded.
   */
  newConnCredentials: Record<string, string> = {};
  /** New connections are polled unless switched to event. */
  newConnAcquisition: AcquisitionMode = 'poll';
  newConnPoll = '15m';
  /**
   * Generated, read-only receive URL the provider pushes to; persisted only when newConnAcquisition is 'event'.
   * Generated on first switching to event and kept across Poll ↔ Event toggles.
   */
  newConnEventEndpoint = '';
  /** New connections roll out in observe; flipped to enforce by hand. */
  newConnMode: ConnectionMode = 'observe';
  newConnMatchKey: MatchKey = 'identityName';
  /** Tag joined on when newConnMatchKey is 'tag' (required then); cleared on switching to another key. */
  newConnMatchTagKey = '';
  /**
   * Mock: the connection has tested & polled, so provider device records exist and the match
   * preview can show a rate. False for a new connection until Test & save; an edited connection
   * starts polled if it has ever verified.
   */
  newConnPolled = false;
  /** Rows of the manual mapping table; only persisted when newConnMatchKey is 'manual'. */
  newConnMappings: IdentityMapping[] = [];

  /** "Test & save" was clicked with fields missing — turns the hint into an error and marks those fields. */
  connectionSubmitAttempted = false;

  /** Manual mapping's "Import CSV…" dialog is open. */
  importOpen = false;

  constructor() {
    // Keep the form's mode in step with a flip made outside it, so Test & save doesn't revert it.
    const liveMode = computed(() => this.connection()?.mode);
    effect(() => {
      const mode = liveMode();
      if (mode) this.newConnMode = mode;
    });
  }

  ngOnInit(): void {
    const conn = this.connection();
    if (conn) this.load(conn);
    else this.reset();
  }

  /** Identities offered in the manual mapping table's left column. */
  get identityOptions() {
    return this.data.identities();
  }

  /** Manual rows with both sides filled in — the ones that get saved. */
  private get completeMappings(): IdentityMapping[] {
    return this.newConnMappings
      .map(m => ({ identityId: m.identityId, externalDeviceId: m.externalDeviceId.trim() }))
      .filter(m => m.identityId && m.externalDeviceId);
  }

  /** How many saved posture checks read from a connection — they all see an edit to it. */
  usageCount(connectionId: string): number {
    return this.data.postureChecks().filter(c => c.connectionId === connectionId).length;
  }

  /** When editing, a blank secret keeps the saved credential, so secrets become optional. */
  isOptional(f: CredentialField): boolean {
    return !!f.secret && !!this.connection();
  }

  get canSaveConnection(): boolean {
    const spec = this.spec();
    return !!spec
      && this.newConnName.trim().length > 0
      && spec.credentialFields.every(f => this.isOptional(f) || (this.newConnCredentials[f.key] ?? '').trim().length > 0)
      && (this.newConnMatchKey !== 'manual' || this.completeMappings.length > 0)
      && (this.newConnMatchKey !== 'tag' || this.newConnMatchTagKey.trim().length > 0);
  }

  /** What's stopping "Test & save" — shown beside the disabled button so it never fails silently. */
  get connectionBlockers(): string[] {
    const spec = this.spec();
    if (!spec) return [];
    const missing = spec.credentialFields
      .filter(f => !this.isOptional(f) && !(this.newConnCredentials[f.key] ?? '').trim())
      .map(f => f.label);
    return [
      ...(this.newConnName.trim() ? [] : ['a connection name']),
      ...missing,
      ...(this.newConnMatchKey === 'manual' && this.completeMappings.length === 0
        ? ['at least one identity mapped to a device ID'] : []),
      ...(this.newConnMatchKey === 'tag' && !this.newConnMatchTagKey.trim() ? ['a tag name'] : []),
    ];
  }

  /** Whether to flag a connection-form field as missing (only after a save attempt). */
  isMissing(value: string | undefined, optional = false): boolean {
    return this.connectionSubmitAttempted && !optional && !(value ?? '').trim();
  }

  /** Manual mapping needs at least one complete row — flag the blank device cells until it has one. */
  get mappingsMissing(): boolean {
    return this.connectionSubmitAttempted && this.newConnMatchKey === 'manual' && this.completeMappings.length === 0;
  }

  /** Event-only providers (Cloudflare) can't be polled — the Poll | Event control is locked on Event. */
  get acquisitionLocked(): boolean {
    return !!this.spec()?.eventOnly;
  }

  setAcquisition(mode: AcquisitionMode): void {
    if (this.acquisitionLocked) return;
    this.newConnAcquisition = mode;
    if (mode === 'event' && !this.newConnEventEndpoint) {
      this.newConnEventEndpoint = generatedEventEndpoint(newEventToken());
    }
  }

  onMatchKeyChange(): void {
    // The tag name only means something under 'tag' — drop it rather than keep it hidden.
    if (this.newConnMatchKey !== 'tag') this.newConnMatchTagKey = '';
    if (this.newConnMatchKey === 'manual' && this.newConnMappings.length === 0) {
      this.newConnMappings = this.identityOptions
        .slice(0, MAPPING_SEED_COUNT)
        .map(i => ({ identityId: i.id, externalDeviceId: '' }));
    }
  }

  /**
   * What the create form's import pins: sample device identities not yet in a complete row.
   * Limited to ones in the identity list, so each imported row shows a name in the table.
   */
  get importableIdentities() {
    const known = new Set(this.identityOptions.map(i => i.id));
    return unmatchedIdentities(MATCH_SAMPLE, 'manual', { manualMappings: this.completeMappings })
      .map(r => r.identity)
      .filter(i => known.has(i.id));
  }

  /** Merge an imported batch into the table: an imported pair replaces any row for the same identity. */
  onImported(batch: IdentityMapping[]): void {
    this.importOpen = false;
    const ids = new Set(batch.map(m => m.identityId));
    this.newConnMappings = [...this.newConnMappings.filter(m => !ids.has(m.identityId)), ...batch.map(m => ({ ...m }))];
  }

  addMapping(): void {
    this.newConnMappings = [...this.newConnMappings, { identityId: '', externalDeviceId: '' }];
  }

  removeMapping(index: number): void {
    this.newConnMappings = this.newConnMappings.filter((_, i) => i !== index);
  }

  /** Load a saved connection for editing. Secrets start blank — they're never stored. */
  private load(conn: ProviderConnection): void {
    const spec = this.spec();
    if (!spec) return;
    const saved: Record<string, string> = {
      ...(conn.endpoint ? { api_url: conn.endpoint } : {}),
      ...(conn.customerId ? { customer_id: conn.customerId } : {}),
      ...conn.settings,
    };
    this.newConnName = conn.name;
    this.newConnCredentials = Object.fromEntries(
      spec.credentialFields.map(f => [f.key, f.secret ? '' : saved[f.key] ?? '']),
    );
    this.newConnAcquisition = spec.eventOnly ? 'event' : conn.acquisition;
    this.newConnPoll = conn.pollFrequency ?? '15m';
    this.newConnEventEndpoint = conn.eventEndpoint
      ?? (this.newConnAcquisition === 'event' ? generatedEventEndpoint(conn.id) : '');
    this.newConnMode = conn.mode;
    this.newConnMatchKey = conn.matchKey;
    this.newConnMatchTagKey = conn.matchTagKey ?? '';
    this.newConnPolled = conn.lastVerifiedAt !== null;
    this.newConnMappings = (conn.manualMappings ?? []).map(m => ({ ...m }));
  }

  private reset(): void {
    this.newConnName = '';
    this.newConnCredentials = {};
    this.newConnAcquisition = 'poll';
    this.newConnPoll = '15m';
    this.newConnEventEndpoint = '';
    // Event-only providers start (and stay) on event, with their receive URL already generated.
    if (this.acquisitionLocked) {
      this.newConnAcquisition = 'event';
      this.newConnEventEndpoint = generatedEventEndpoint(newEventToken());
    }
    this.newConnMode = 'observe';
    this.newConnMatchKey = 'identityName';
    this.newConnMatchTagKey = '';
    this.newConnPolled = false;
    this.newConnMappings = [];
  }

  /** POC: there is no real verify call — the connection is accepted as-is. */
  testAndSaveConnection(): void {
    const spec = this.spec();
    if (!spec) return;
    if (!this.canSaveConnection) {
      // Validate on click rather than a silently disabled button: show the error, then focus the first missing field.
      this.connectionSubmitAttempted = true;
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    // The mock test & poll: provider device records are now available.
    this.newConnPolled = true;
    const now = new Date().toISOString();
    const value = (key: string) => (this.newConnCredentials[key] ?? '').trim();
    const customerId = value('customer_id');
    // Everything the form configures. Secrets are left out: they're discarded, never stored.
    const fields = {
      name: this.newConnName.trim(),
      // Providers without an api_url credential (Kolide, Intune, Uptycs) have no endpoint to record.
      endpoint: value('api_url'),
      ...(customerId ? { customerId } : {}),
      settings: Object.fromEntries(
        spec.credentialFields.filter(f => !f.secret && value(f.key)).map(f => [f.key, value(f.key)]),
      ),
      acquisition: this.newConnAcquisition,
      // Only the chosen mode's field is kept.
      ...(this.newConnAcquisition === 'poll'
        ? { pollFrequency: this.newConnPoll }
        : { eventEndpoint: this.newConnEventEndpoint }),
      mode: this.newConnMode,
      matchKey: this.newConnMatchKey,
      ...(this.newConnMatchKey === 'tag' ? { matchTagKey: this.newConnMatchTagKey.trim() } : {}),
      ...(this.newConnMatchKey === 'manual' ? { manualMappings: this.completeMappings } : {}),
      status: 'active' as const,
      lastVerifiedAt: now,
    };
    // Opaque placeholder handle standing in for wherever the secret would really be stored.
    const newCredentialRef = () => 'cred-' + Math.random().toString(16).slice(2, 8);

    const c = this.connection();
    if (c) {
      const secretReentered = spec.credentialFields.some(f => f.secret && value(f.key));
      // Rebuilt rather than merged so optional fields the form cleared (customerId) drop out.
      this.saved.emit({
        id: c.id,
        providerType: c.providerType,
        createdAt: c.createdAt,
        // Pins made from Device matching (Map / import) are overrides under an automatic key — keep them.
        ...(c.manualMappings?.length ? { manualMappings: c.manualMappings } : {}),
        ...fields,
        credentialRef: secretReentered ? newCredentialRef() : c.credentialRef,
      });
    } else {
      this.saved.emit({
        id: 'conn-' + Date.now(), providerType: spec.providerType, createdAt: now, ...fields, credentialRef: newCredentialRef(),
      });
    }
  }
}
