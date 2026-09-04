import { Component, OnDestroy, WritableSignal, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AttachedConfigData, AttachedConfigOrigin, OnboardingStateService, ServiceAdvancedDraft } from './onboarding-state.service';
import { DrawerService } from '../../shared/services/drawer.service';

/** The seven Ziti config types selectable in the Advanced service form. */
const CONFIG_TYPES = [
  'host.v1',
  'host.v2',
  'intercept.v1',
  'interfaces.v1',
  'proxy.v1',
  'ziti-tunneler-client.v1',
  'ziti-tunneler-server.v1',
] as const;
type ConfigType = (typeof CONFIG_TYPES)[number];

/** A config already on the network the user can attach without re-authoring. */
interface ExistingConfig {
  id: string;
  name: string;
  type: ConfigType;
}

/** Shallow mock of pre-existing configs, so "attach an existing config" is real. */
const EXISTING_CONFIGS: ExistingConfig[] = [
  { id: 'cfg-intercept-demo', name: 'demo-intercept', type: 'intercept.v1' },
  { id: 'cfg-host-demo', name: 'demo-host', type: 'host.v1' },
];

/** A config attached to the service being built. Carries a per-config data
 *  snapshot + origin so authored ('created') configs can be edited in place;
 *  'existing' configs are attached as-is and are not editable here. */
interface AttachedConfig {
  id: string;
  name: string;
  type: ConfigType;
  origin: AttachedConfigOrigin;
  data: AttachedConfigData;
}

/**
 * Create Service — ADVANCED path (designed-but-shallow).
 *
 * Reached when the user picks Advanced at the step-3 branch point. Deliberately
 * reuses the SIMPLE form's LIGHT section styling rather than the current
 * console's dark nested config blocks (a known audit finding — advanced should
 * not look like a different product). Single page, one Save:
 *  - Section 1 Service Details (name + attributes) — same as simple
 *  - Section 2 Add Configurations — an explicit two-mode add: Create new (the
 *    config type drives which data-schema fields are revealed) or Attach existing
 *    (a config that already carries its type). NOT the console's single dropdown
 *    that overloads both. intercept.v1 + host.v1 have full data sub-forms; the
 *    other five are shallow "coming soon" stubs that still attach. A real
 *    advanced service needs at least an intercept + a host, so multiple attach.
 *  - Section 3 Show More Options (collapsed) — terminatorStrategy, encryption, tags
 * Optional groups are collapsed accordions badged OPTIONAL. No FORM|JSON toggle
 * and no API CALLS panel — those are Power-User surfaces that don't belong here.
 *
 * Unlike Simple, Advanced does NOT auto-generate policies: on Save the
 * confirmation points the user to the Service / Edge Router / Service-Edge-Router
 * policy steps that make up the advanced tail.
 */
@Component({
  selector: 'app-onboarding-service-advanced',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './onboarding-service-advanced.component.html',
  styleUrl: './onboarding-service-advanced.component.css',
})
export class OnboardingServiceAdvancedComponent implements OnDestroy {
  private readonly router = inject(Router);
  private readonly drawer = inject(DrawerService);
  readonly state = inject(OnboardingStateService);

  private readonly stepId = 'service';
  readonly configTypes = CONFIG_TYPES;

  /**
   * Per-step draft in the store, so this form's field state survives back/forward
   * route navigation (notably the attached-config list). Given the ~40 fields
   * here, rather than draft-backing each via a getter/setter (the pattern the
   * smaller steps use), this component keeps its local field signals and syncs
   * them to the draft at the edges: hydrate() from the draft in the constructor,
   * persist() back to it on destroy (route nav destroys the routed parent, and
   * with it this child). In-memory only (POC): resets on full reload.
   */
  private readonly draft: WritableSignal<ServiceAdvancedDraft> = this.state.serviceAdvancedDraft();

  constructor() {
    this.hydrate(this.draft());
  }

  ngOnDestroy(): void {
    this.persist();
  }

  /** Copy the stored draft into the local field signals/properties on init. */
  private hydrate(d: ServiceAdvancedDraft): void {
    this.serviceName = d.serviceName;
    // attributes is draft-backed (write-through) — nothing to hydrate; it reads
    // live from the draft that `d` already is.

    this.configMode = d.configMode;
    this.pickerType = d.pickerType as ConfigType | '';
    // Treat a rehydrated type as the current value, not a user change, so the
    // <select>'s post-hydrate ngModelChange no-ops instead of wiping the draft.
    this.prevPickerType = this.pickerType;
    this.newConfigName = d.newConfigName;
    this.existingPick = d.existingPick;
    this.attachedConfigs.set(
      d.attachedConfigs.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type as ConfigType,
        origin: c.origin ?? 'created',
        data: c.data ?? this.blankConfigData(),
      })),
    );
    this.nextConfigId = d.nextConfigId;

    this.ic_portRanges = d.ic_portRanges;
    this.ic_addresses = d.ic_addresses;
    this.ic_allowedSource = d.ic_allowedSource;
    this.ic_protoTcp = d.ic_protoTcp;
    this.ic_protoUdp = d.ic_protoUdp;
    this.ic_sourceIp = d.ic_sourceIp;

    this.h_protocol = d.h_protocol;
    this.h_address = d.h_address;
    this.h_port = d.h_port;
    this.h_forwardProtocol.set(d.h_forwardProtocol);
    this.h_forwardAddress.set(d.h_forwardAddress);
    this.h_forwardPort.set(d.h_forwardPort);
    this.h_allowedSource = d.h_allowedSource;
    this.h_forwardTranslations = d.h_forwardTranslations;
    this.h_http_url = d.h_http_url;
    this.h_http_method = d.h_http_method;
    this.h_http_status = d.h_http_status;
    this.h_http_interval = d.h_http_interval;
    this.h_listen_bindEdge.set(d.h_listen_bindEdge);
    this.h_listen_identity = d.h_listen_identity;
    this.h_listen_connectTimeout = d.h_listen_connectTimeout;
    this.h_listen_maxConn = d.h_listen_maxConn;
    this.h_portcheck_address = d.h_portcheck_address;
    this.h_portcheck_interval = d.h_portcheck_interval;
    this.h_portcheck_timeout = d.h_portcheck_timeout;
    this.h_proxy_type = d.h_proxy_type;
    this.h_proxy_address = d.h_proxy_address;

    this.terminatorStrategy = d.terminatorStrategy;
    this.encryptionRequired.set(d.encryptionRequired);
    this.tags.set([...d.tags]);

    this.openPanels.set(new Set(d.openPanels));
    this.saved.set(d.saved);
    this.submitted.set(d.submitted);
    this.configSubmitted.set(d.configSubmitted);
    this.touched.set(new Set(d.touched));
  }

  /** Snapshot the current local field state back into the stored draft. */
  private persist(): void {
    this.draft.set({
      serviceName: this.serviceName,
      // attributes is already live in the draft (write-through); pass the current
      // value through so this full-object set() doesn't clobber it.
      attributes: [...this.attributes()],
      configMode: this.configMode,
      pickerType: this.pickerType,
      newConfigName: this.newConfigName,
      existingPick: this.existingPick,
      attachedConfigs: this.attachedConfigs().map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        origin: c.origin,
        data: { ...c.data },
      })),
      nextConfigId: this.nextConfigId,
      ic_portRanges: this.ic_portRanges,
      ic_addresses: this.ic_addresses,
      ic_allowedSource: this.ic_allowedSource,
      ic_protoTcp: this.ic_protoTcp,
      ic_protoUdp: this.ic_protoUdp,
      ic_sourceIp: this.ic_sourceIp,
      h_protocol: this.h_protocol,
      h_address: this.h_address,
      h_port: this.h_port,
      h_forwardProtocol: this.h_forwardProtocol(),
      h_forwardAddress: this.h_forwardAddress(),
      h_forwardPort: this.h_forwardPort(),
      h_allowedSource: this.h_allowedSource,
      h_forwardTranslations: this.h_forwardTranslations,
      h_http_url: this.h_http_url,
      h_http_method: this.h_http_method,
      h_http_status: this.h_http_status,
      h_http_interval: this.h_http_interval,
      h_listen_bindEdge: this.h_listen_bindEdge(),
      h_listen_identity: this.h_listen_identity,
      h_listen_connectTimeout: this.h_listen_connectTimeout,
      h_listen_maxConn: this.h_listen_maxConn,
      h_portcheck_address: this.h_portcheck_address,
      h_portcheck_interval: this.h_portcheck_interval,
      h_portcheck_timeout: this.h_portcheck_timeout,
      h_proxy_type: this.h_proxy_type,
      h_proxy_address: this.h_proxy_address,
      terminatorStrategy: this.terminatorStrategy,
      encryptionRequired: this.encryptionRequired(),
      tags: [...this.tags()],
      openPanels: new Set(this.openPanels()),
      saved: this.saved(),
      submitted: this.submitted(),
      configSubmitted: this.configSubmitted(),
      touched: new Set(this.touched()),
    });
  }

  // ── Section 1: Service Details ─────────────────────────────────────────
  serviceName = '';
  attributeInput = '';
  /** Service attributes — draft-backed (WRITE-THROUGH) so the store reflects
   *  edits live on every add/remove, letting a computed steps() react to the
   *  service-attribute count for the conditional Policy step. Unlike the other
   *  advanced-form fields (still hydrate/persist at the edges), this one is never
   *  held locally — it reads/writes state.serviceAdvancedDraft().attributes. */
  attributes(): string[] { return this.draft().attributes; }

  // ── Section 2: Add Configurations ──────────────────────────────────────
  /** Explicit two-mode add-config model — NOT the console's overloaded single
   *  dropdown. 'create' authors a new config (type drives the schema); 'existing'
   *  attaches one that already exists (it already carries its type). */
  configMode: 'create' | 'existing' = 'create';

  /** Create mode: the config type whose data-schema fields are revealed. */
  pickerType: ConfigType | '' = '';
  /** Last committed pickerType, so onTypeChange resets the draft only on a real
   *  user change — the <select> also re-emits ngModelChange on rehydrate/teardown. */
  private prevPickerType: ConfigType | '' = '';
  newConfigName = '';

  /** Attach-existing mode: the chosen existing config's id. */
  existingPick = '';

  readonly attachedConfigs = signal<AttachedConfig[]>([]);
  private nextConfigId = 0;

  /** Id of the attached config being edited (null = creating a new one). Transient
   *  and component-local — never written to the draft, so navigating away and back
   *  never reopens mid-edit. Only 'created' configs are editable. */
  readonly editingConfigId = signal<string | null>(null);

  /** Existing configs (any type) not already attached — labelled "name (type)".
   *  While editing an attached-existing config, its own entry stays selectable so
   *  the dropdown can show the current pick (and swapping it is the edit). */
  availableExisting(): ExistingConfig[] {
    const editingId = this.editingConfigId();
    const attachedIds = new Set(
      this.attachedConfigs().map((c) => c.id).filter((id) => id !== editingId),
    );
    return EXISTING_CONFIGS.filter((c) => !attachedIds.has(c.id));
  }

  // intercept.v1 config data
  ic_portRanges = '';
  ic_addresses = '';
  ic_allowedSource = '';
  ic_protoTcp = false;
  ic_protoUdp = false;
  ic_sourceIp = '';

  // host.v1 config data
  h_protocol: 'tcp' | 'udp' = 'tcp';
  h_address = '';
  h_port: number | null = null;
  readonly h_forwardProtocol = signal(false);
  readonly h_forwardAddress = signal(false);
  readonly h_forwardPort = signal(false);
  h_allowedSource = '';
  h_forwardTranslations = '';
  // host.v1 optional accordions (shallow)
  h_http_url = '';
  h_http_method = 'GET';
  h_http_status: number | null = null;
  h_http_interval = '';
  readonly h_listen_bindEdge = signal(false);
  h_listen_identity = '';
  h_listen_connectTimeout = '';
  h_listen_maxConn: number | null = null;
  h_portcheck_address = '';
  h_portcheck_interval = '';
  h_portcheck_timeout = '';
  h_proxy_type = '';
  h_proxy_address = '';

  // ── Section 3: Show More Options ───────────────────────────────────────
  terminatorStrategy = '';
  readonly encryptionRequired = signal(true);
  tagInput = '';
  readonly tags = signal<string[]>([]);

  // ── Collapsed accordion state ──────────────────────────────────────────
  private readonly openPanels = signal<ReadonlySet<string>>(new Set());
  isOpen(key: string): boolean {
    return this.openPanels().has(key);
  }
  togglePanel(key: string): void {
    const next = new Set(this.openPanels());
    next.has(key) ? next.delete(key) : next.add(key);
    this.openPanels.set(next);
  }

  toggle(sig: WritableSignal<boolean>): void {
    sig.update((v) => !v);
  }

  /** Shallow "created" state — reveals the confirmation panel. */
  readonly saved = signal(false);
  /** Always shown: Back returns to the branch chooser on this same step, which
   *  is always reachable — the advanced form is only ever entered from it. */
  readonly hasBack = true;

  // ── Validation ─────────────────────────────────────────────────────────
  readonly submitted = signal(false);
  /** Config-create sub-form submit flag (independent of the whole-form Save). */
  readonly configSubmitted = signal(false);
  readonly touched = signal<ReadonlySet<string>>(new Set());

  markTouched(field: string): void {
    if (this.touched().has(field)) return;
    const next = new Set(this.touched());
    next.add(field);
    this.touched.set(next);
  }

  /** Red error border — only after a Save/create attempt or a blur, never on
   *  first render. Only Service Name and (when authoring) Config Name gate. */
  showError(field: string): boolean {
    switch (field) {
      case 'name':
        return this.serviceName.trim().length === 0
          && (this.submitted() || this.touched().has('name'));
      case 'configName':
        return this.configMode === 'create' && this.newConfigName.trim().length === 0
          && (this.configSubmitted() || this.touched().has('configName'));
      default:
        return false;
    }
  }

  /** After a Save attempt, flag the "attach at least one config" requirement. */
  readonly noConfigsError = computed(
    () => this.submitted() && this.attachedConfigs().length === 0,
  );

  get canSave(): boolean {
    return this.serviceName.trim().length > 0 && this.attachedConfigs().length > 0;
  }

  // ── Tag-chip inputs (attributes + tags) ────────────────────────────────
  private addTags(raw: string, target: WritableSignal<string[]>): boolean {
    const val = raw.trim().replace(/,+$/, '');
    if (!val) return false;
    const vals = val.split(',').map((v) => v.trim()).filter(Boolean);
    target.update((list) => [...new Set([...list, ...vals])]);
    return true;
  }

  onAttributeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    // Write through to the store draft immediately (not via the local-signal
    // addTags path) so state.serviceAdvancedDraft().attributes updates live.
    const val = this.attributeInput.trim().replace(/,+$/, '');
    if (!val) return;
    const vals = val.split(',').map((v) => v.trim()).filter(Boolean);
    this.draft.update((d) => ({ ...d, attributes: [...new Set([...d.attributes, ...vals])] }));
    this.attributeInput = '';
  }
  removeAttribute(attr: string): void {
    this.draft.update((d) => ({ ...d, attributes: d.attributes.filter((a) => a !== attr) }));
  }

  onTagKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    if (this.addTags(this.tagInput, this.tags)) this.tagInput = '';
  }
  removeTag(tag: string): void {
    this.tags.update((list) => list.filter((t) => t !== tag));
  }

  // ── Config attach flow ─────────────────────────────────────────────────
  /** Reset the working config-data whenever the selected type changes. */
  onTypeChange(): void {
    // The <select> re-emits ngModelChange on rehydrate and on teardown, not only
    // on real user edits. Reset the working config-draft ONLY when the type
    // actually changed to a different value; a same-value re-emit is a no-op.
    if (this.pickerType === this.prevPickerType) return;
    this.resetConfigDraft();
    this.prevPickerType = this.pickerType;
  }

  /** Switch add-config mode, clearing the other mode's transient state. */
  setConfigMode(mode: 'create' | 'existing'): void {
    this.configMode = mode;
    this.pickerType = '';
    this.prevPickerType = '';
    this.existingPick = '';
    this.resetConfigDraft();
  }

  private resetConfigDraft(): void {
    this.newConfigName = '';
    this.configSubmitted.set(false);
    this.applyConfigData(this.blankConfigData());
  }

  /** Default (empty) config-data snapshot — the create-new blank form. */
  private blankConfigData(): AttachedConfigData {
    return {
      ic_portRanges: '', ic_addresses: '', ic_allowedSource: '',
      ic_protoTcp: false, ic_protoUdp: false, ic_sourceIp: '',
      h_protocol: 'tcp', h_address: '', h_port: null,
      h_forwardProtocol: false, h_forwardAddress: false, h_forwardPort: false,
      h_allowedSource: '', h_forwardTranslations: '',
      h_http_url: '', h_http_method: 'GET', h_http_status: null, h_http_interval: '',
      h_listen_bindEdge: false, h_listen_identity: '', h_listen_connectTimeout: '', h_listen_maxConn: null,
      h_portcheck_address: '', h_portcheck_interval: '', h_portcheck_timeout: '',
      h_proxy_type: '', h_proxy_address: '',
    };
  }

  /** Read the working config-data fields into a snapshot (stored per config). */
  private snapshotConfigData(): AttachedConfigData {
    return {
      ic_portRanges: this.ic_portRanges,
      ic_addresses: this.ic_addresses,
      ic_allowedSource: this.ic_allowedSource,
      ic_protoTcp: this.ic_protoTcp,
      ic_protoUdp: this.ic_protoUdp,
      ic_sourceIp: this.ic_sourceIp,
      h_protocol: this.h_protocol,
      h_address: this.h_address,
      h_port: this.h_port,
      h_forwardProtocol: this.h_forwardProtocol(),
      h_forwardAddress: this.h_forwardAddress(),
      h_forwardPort: this.h_forwardPort(),
      h_allowedSource: this.h_allowedSource,
      h_forwardTranslations: this.h_forwardTranslations,
      h_http_url: this.h_http_url,
      h_http_method: this.h_http_method,
      h_http_status: this.h_http_status,
      h_http_interval: this.h_http_interval,
      h_listen_bindEdge: this.h_listen_bindEdge(),
      h_listen_identity: this.h_listen_identity,
      h_listen_connectTimeout: this.h_listen_connectTimeout,
      h_listen_maxConn: this.h_listen_maxConn,
      h_portcheck_address: this.h_portcheck_address,
      h_portcheck_interval: this.h_portcheck_interval,
      h_portcheck_timeout: this.h_portcheck_timeout,
      h_proxy_type: this.h_proxy_type,
      h_proxy_address: this.h_proxy_address,
    };
  }

  /** Write a config-data snapshot into the working fields (on edit / reset). */
  private applyConfigData(d: AttachedConfigData): void {
    this.ic_portRanges = d.ic_portRanges;
    this.ic_addresses = d.ic_addresses;
    this.ic_allowedSource = d.ic_allowedSource;
    this.ic_protoTcp = d.ic_protoTcp;
    this.ic_protoUdp = d.ic_protoUdp;
    this.ic_sourceIp = d.ic_sourceIp;
    this.h_protocol = d.h_protocol;
    this.h_address = d.h_address;
    this.h_port = d.h_port;
    this.h_forwardProtocol.set(d.h_forwardProtocol);
    this.h_forwardAddress.set(d.h_forwardAddress);
    this.h_forwardPort.set(d.h_forwardPort);
    this.h_allowedSource = d.h_allowedSource;
    this.h_forwardTranslations = d.h_forwardTranslations;
    this.h_http_url = d.h_http_url;
    this.h_http_method = d.h_http_method;
    this.h_http_status = d.h_http_status;
    this.h_http_interval = d.h_http_interval;
    this.h_listen_bindEdge.set(d.h_listen_bindEdge);
    this.h_listen_identity = d.h_listen_identity;
    this.h_listen_connectTimeout = d.h_listen_connectTimeout;
    this.h_listen_maxConn = d.h_listen_maxConn;
    this.h_portcheck_address = d.h_portcheck_address;
    this.h_portcheck_interval = d.h_portcheck_interval;
    this.h_portcheck_timeout = d.h_portcheck_timeout;
    this.h_proxy_type = d.h_proxy_type;
    this.h_proxy_address = d.h_proxy_address;
  }

  /** After an attach, reset the add-config area back to the default (create new). */
  private resetPicker(): void {
    this.configMode = 'create';
    this.pickerType = '';
    this.prevPickerType = '';
    this.existingPick = '';
    this.resetConfigDraft();
  }

  /** Attach the existing config chosen in the attach-existing picker. Attached
   *  as-is (origin 'existing', blank data) — not editable here. */
  attachExisting(): void {
    const cfg = EXISTING_CONFIGS.find((c) => c.id === this.existingPick);
    if (!cfg) return;
    this.attachedConfigs.update((list) => [
      ...list,
      { ...cfg, origin: 'existing', data: this.blankConfigData() },
    ]);
    this.resetPicker();
  }

  /** Author + attach a new config — snapshotting its data so it can be edited. */
  createAndAttach(): void {
    if (!this.pickerType) return;
    if (this.newConfigName.trim().length === 0) {
      this.configSubmitted.set(true);
      return;
    }
    this.attachedConfigs.update((list) => [
      ...list,
      {
        id: `cfg-new-${this.nextConfigId++}`,
        name: this.newConfigName.trim(),
        type: this.pickerType as ConfigType,
        origin: 'created',
        data: this.snapshotConfigData(),
      },
    ]);
    this.resetPicker();
  }

  // ── Edit an attached config in place ──────────────────────────────────────
  /** Reopen an attached config for editing. A 'created' config reopens its
   *  authoring card (type fixed, schema populated); an 'existing' config reopens
   *  the attach-existing picker preselected, so it can be swapped for another. */
  startEditConfig(c: AttachedConfig): void {
    this.editingConfigId.set(c.id);
    if (c.origin === 'existing') {
      this.configMode = 'existing';
      this.existingPick = c.id;
      return;
    }
    this.configMode = 'create';
    this.pickerType = c.type;
    this.prevPickerType = c.type; // so a stray ngModelChange no-ops
    this.newConfigName = c.name;
    this.configSubmitted.set(false);
    this.applyConfigData(c.data);
  }

  /** Save edits — REPLACE the matching config by id. For a 'created' config this
   *  keeps its id + type and updates name + data; for an 'existing' config it
   *  swaps in the newly-picked existing config (new id/name/type). */
  saveConfigEdit(): void {
    const id = this.editingConfigId();
    if (!id) return;

    if (this.configMode === 'existing') {
      const cfg = EXISTING_CONFIGS.find((c) => c.id === this.existingPick);
      if (!cfg) return; // nothing valid picked — Save is disabled in this case
      this.attachedConfigs.update((list) =>
        list.map((c) =>
          c.id === id ? { ...cfg, origin: 'existing' as const, data: this.blankConfigData() } : c,
        ),
      );
      this.editingConfigId.set(null);
      this.resetPicker();
      return;
    }

    if (this.newConfigName.trim().length === 0) {
      this.configSubmitted.set(true);
      return;
    }
    const name = this.newConfigName.trim();
    const data = this.snapshotConfigData();
    this.attachedConfigs.update((list) =>
      list.map((c) => (c.id === id ? { ...c, name, data } : c)),
    );
    this.editingConfigId.set(null);
    this.resetPicker();
  }

  /** Discard an in-progress edit — leave the original config untouched. */
  cancelConfigEdit(): void {
    this.editingConfigId.set(null);
    this.resetPicker();
  }

  removeConfig(id: string): void {
    this.attachedConfigs.update((list) => list.filter((c) => c.id !== id));
    // If the removed config was mid-edit, drop back to the create-new card.
    if (this.editingConfigId() === id) {
      this.editingConfigId.set(null);
      this.resetPicker();
    }
  }

  // ── Save / nav / help ──────────────────────────────────────────────────
  save(): void {
    if (!this.canSave) {
      this.submitted.set(true);
      return;
    }
    this.saved.set(true);
  }

  /** Re-open the form from the confirmation view. Flips saved back to false with
   *  every field intact (save never clears them), so the populated form returns
   *  and is fully re-savable. Distinct from Back, which leaves the step for the
   *  previous one. Clears the submit flag so the already-valid form doesn't flash
   *  validation errors on reopen. */
  edit(): void {
    this.submitted.set(false);
    this.saved.set(false);
  }

  openHelp(): void {
    this.drawer.open({
      type: 'onboarding-help',
      data: {
        title: 'About Advanced Services',
        subtitle: 'Concept · Create Service (Advanced)',
        topic: 'advanced-service',
      },
    });
  }

  /** Return to the Simple / Advanced / Template chooser (same step) rather than
   *  leaving for the previous step — the chooser is where this form was entered
   *  from (directly or via a template). The draft persists on destroy, so the
   *  attached configs survive the round-trip. From the chooser, its own Back
   *  leaves for the previous step. */
  back(): void {
    this.state.clearBranch();
  }

  continue(): void {
    this.state.markComplete(this.stepId);
    const next = this.state.nextPath(this.stepId);
    if (next) this.router.navigate(['/onboarding', next]);
  }
}
