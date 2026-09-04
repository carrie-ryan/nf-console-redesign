import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { MockDataService } from '../../shared/services/mock-data.service';

/** Which path the user chose at the Create Service step. */
export type OnboardingBranch = 'unset' | 'simple' | 'advanced';

export interface OnboardingStep {
  id: string;
  label: string;
  icon: string;
  /** Route segment under /onboarding, or null for a greyed placeholder tail item. */
  path: string | null;
  /** True for the generic greyed tail shown before the Simple/Advanced choice. */
  placeholder?: boolean;
}

// ─── Per-step draft models ───────────────────────────────────────────────
// Field data used to be component-local and was destroyed on route navigation
// (returning to a step showed a blank form). Drafts relocate that field data
// here — keyed by step id — so a step reads its draft on init and writes through
// on change, surviving back/forward. In-memory only (POC): resets on full reload.
//
// One interface per step shape. router-policy (the reusable policy step) is the
// reference implementation; the remaining step drafts are added as each step is
// converted.

/** A name/value metadata tag pair on a policy. */
export interface PolicyTagPair {
  name: string;
  value: string;
}

/** The policy types the unified Policy step can create. */
export type PolicyType = 'service' | 'router' | 'service-edge-router';

/** A policy created on the unified Policy step — the accumulated result the step
 *  lists. Chrome-agnostic: the step maps each type to its own form config. */
export interface CreatedPolicy {
  id: string;
  type: PolicyType;
  name: string;
  semantic: 'AnyOf' | 'AllOf';
  attrA: string[];
  attrB: string[];
  tags: PolicyTagPair[];
  /** Value of the type's config-driven extra field (e.g. Service Policy Dial|Bind). */
  extra?: string;
}

/** Draft for the unified Policy step — the accumulated created-policy list plus a
 *  monotonic id counter. WRITE-THROUGH: updated live on every add/remove (the
 *  component calls .update() on this signal), so a computed steps() can react to
 *  createdPolicies.length. NOT the advanced service's persist-at-destroy pattern. */
export interface PolicyStepDraft {
  createdPolicies: CreatedPolicy[];
  nextPolicyId: number;
}

/** Draft for the Simple service form (Service Details + Accessing + Hosting).
 *  Address/Port fields are only required when their side's SDK-Only toggle is
 *  off; the draft carries all of them plus the saved + validation UI state so a
 *  previously-saved step returns to its confirmation view, not a blank form. */
export interface ServiceSimpleDraft {
  serviceName: string;
  attributes: string[];
  accessIdentities: string[];
  sdkOnlyAccess: boolean;
  accessAddress: string;
  accessPort: number | null;
  hostIdentities: string[];
  sdkOnlyHost: boolean;
  hostProtocol: 'tcp' | 'udp';
  hostAddress: string;
  hostPort: number | null;
  saved: boolean;
  submitted: boolean;
  touched: ReadonlySet<string>;
}

/** Draft for the Create Identity step. `saved` reveals the enrollment/JWT
 *  affordances (and the off-console link-outs). */
export interface IdentityDraft {
  identityName: string;
  attributes: string[];
  authPolicy: string;
  externalId: string;
  saved: boolean;
}

/** A single router in the Add Router step's list. `id` keys the map's nodes.
 *  `saved` reveals the registration panel + hosting choice; `hostingType` then
 *  drives self-deploy vs NetFoundry fields. The pre-provisioned NetFoundry router
 *  is NF-hosted + saved from the start (it already exists); a manually-added
 *  second router walks the create-then-choose-hosting flow. */
export interface RouterEntry {
  id: string;
  routerName: string;
  attributes: string[];
  hostingType: 'self' | 'netfoundry';
  cloudProvider: string;
  location: string;
  linkListener: boolean;
  wssListener: boolean;
  advertisedName: string;
  saved: boolean;
}

/** Draft for the Add Router step — a LIST of routers (POC-capped at two). The
 *  list is seeded with one pre-provisioned NetFoundry router; the user may add a
 *  second. Map compatibility (Part 1): the map reads routers[0] only. */
export interface RouterDraft {
  routers: RouterEntry[];
}

/** Draft for the Verify step — the per-item self-confirm checklist state, plus
 *  `finished` (the "Setup complete" view). */
export interface VerifyDraft {
  checked: boolean[];
  finished: boolean;
}

/** Whether an attached config was authored here ('created') or attached from an
 *  existing network config ('existing'). Only 'created' configs are editable. */
export type AttachedConfigOrigin = 'created' | 'existing';

/** Snapshot of a config's data-schema fields (intercept.v1 / host.v1), stored per
 *  attached config so an authored config can be reopened and edited in place. */
export interface AttachedConfigData {
  ic_portRanges: string;
  ic_addresses: string;
  ic_allowedSource: string;
  ic_protoTcp: boolean;
  ic_protoUdp: boolean;
  ic_sourceIp: string;
  h_protocol: 'tcp' | 'udp';
  h_address: string;
  h_port: number | null;
  h_forwardProtocol: boolean;
  h_forwardAddress: boolean;
  h_forwardPort: boolean;
  h_allowedSource: string;
  h_forwardTranslations: string;
  h_http_url: string;
  h_http_method: string;
  h_http_status: number | null;
  h_http_interval: string;
  h_listen_bindEdge: boolean;
  h_listen_identity: string;
  h_listen_connectTimeout: string;
  h_listen_maxConn: number | null;
  h_portcheck_address: string;
  h_portcheck_interval: string;
  h_portcheck_timeout: string;
  h_proxy_type: string;
  h_proxy_address: string;
}

/** A config attached to the advanced service being built. Carries a per-config
 *  data snapshot + origin so authored configs can be edited in place. */
export interface AttachedConfigDraft {
  id: string;
  name: string;
  type: string;
  origin: AttachedConfigOrigin;
  data: AttachedConfigData;
}

/** Draft for the Advanced service form. Large by nature — Service Details, the
 *  attached-config list + the working config-draft fields (intercept.v1 /
 *  host.v1 schemas), Show More Options, and the accordion/validation UI state —
 *  so nothing (notably the attached configs) is lost on navigation. */
export interface ServiceAdvancedDraft {
  serviceName: string;
  attributes: string[];

  configMode: 'create' | 'existing';
  pickerType: string;
  newConfigName: string;
  existingPick: string;
  attachedConfigs: AttachedConfigDraft[];
  nextConfigId: number;

  // intercept.v1 config data
  ic_portRanges: string;
  ic_addresses: string;
  ic_allowedSource: string;
  ic_protoTcp: boolean;
  ic_protoUdp: boolean;
  ic_sourceIp: string;

  // host.v1 config data
  h_protocol: 'tcp' | 'udp';
  h_address: string;
  h_port: number | null;
  h_forwardProtocol: boolean;
  h_forwardAddress: boolean;
  h_forwardPort: boolean;
  h_allowedSource: string;
  h_forwardTranslations: string;
  h_http_url: string;
  h_http_method: string;
  h_http_status: number | null;
  h_http_interval: string;
  h_listen_bindEdge: boolean;
  h_listen_identity: string;
  h_listen_connectTimeout: string;
  h_listen_maxConn: number | null;
  h_portcheck_address: string;
  h_portcheck_interval: string;
  h_portcheck_timeout: string;
  h_proxy_type: string;
  h_proxy_address: string;

  // Show More Options
  terminatorStrategy: string;
  encryptionRequired: boolean;
  tags: string[];

  // UI state
  openPanels: ReadonlySet<string>;
  saved: boolean;
  submitted: boolean;
  configSubmitted: boolean;
  touched: ReadonlySet<string>;
}

/**
 * Holds the guided-setup flow state (branch + completed steps + per-step field
 * drafts) as signals so it persists across the individual step screens. The
 * rail's tail resolves from the `branch` signal once the user picks Simple or
 * Advanced at the Service step.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingStateService {
  private readonly data = inject(MockDataService);

  readonly branch = signal<OnboardingBranch>('unset');
  readonly completed = signal<ReadonlySet<string>>(new Set());

  /** Per-step field drafts, keyed by step id. Lazily created via the typed
   *  accessors below; each holds a WritableSignal of that step's draft. */
  private readonly drafts = new Map<string, WritableSignal<unknown>>();

  /** Lazily get (or create with `factory`) the draft signal for `key`. */
  private draftSignal<T>(key: string, factory: () => T): WritableSignal<T> {
    let sig = this.drafts.get(key) as WritableSignal<T> | undefined;
    if (!sig) {
      sig = signal<T>(factory());
      this.drafts.set(key, sig);
    }
    return sig;
  }

  /** Draft accessor for the unified Policy step (single shared list). */
  policyStepDraft(): WritableSignal<PolicyStepDraft> {
    return this.draftSignal<PolicyStepDraft>('policy-step', () => ({
      createdPolicies: [],
      nextPolicyId: 0,
    }));
  }

  /** Draft accessor for the Simple service form. */
  serviceSimpleDraft(): WritableSignal<ServiceSimpleDraft> {
    return this.draftSignal<ServiceSimpleDraft>('service-simple', () => ({
      serviceName: '',
      attributes: [],
      accessIdentities: [],
      sdkOnlyAccess: false,
      accessAddress: '',
      accessPort: null,
      hostIdentities: [],
      sdkOnlyHost: false,
      hostProtocol: 'tcp',
      hostAddress: '',
      hostPort: null,
      saved: false,
      submitted: false,
      touched: new Set<string>(),
    }));
  }

  /** Draft accessor for the Create Identity step. */
  identityDraft(): WritableSignal<IdentityDraft> {
    return this.draftSignal<IdentityDraft>('identity', () => ({
      identityName: '',
      attributes: [],
      authPolicy: 'Default',
      externalId: '',
      saved: false,
    }));
  }

  /** POC cap on routers: one pre-provisioned + one optional manually-added. */
  readonly maxRouters = 2;

  /** Draft accessor for the Add Router step. Seeded with ONE pre-provisioned
   *  NetFoundry router — NF-hosted and saved from load (it already exists, so it
   *  skips the create/hosting sequence). */
  routerDraft(): WritableSignal<RouterDraft> {
    return this.draftSignal<RouterDraft>('router', () => ({
      routers: [
        {
          id: 'router-preprovisioned',
          routerName: 'default-edge-router',
          attributes: [],
          hostingType: 'netfoundry',
          cloudProvider: 'AWS',
          location: 'us-east-1',
          linkListener: true,
          wssListener: false,
          advertisedName: '',
          saved: true,
        },
      ],
    }));
  }

  /** A blank, self-hosted, unsaved router — the manual add path's starting point. */
  private blankRouter(id: string): RouterEntry {
    return {
      id,
      routerName: '',
      attributes: [],
      hostingType: 'self',
      cloudProvider: 'AWS',
      location: 'us-east-1',
      linkListener: true,
      wssListener: false,
      advertisedName: '',
      saved: false,
    };
  }

  /** Append a second RouterEntry (the manual add path). No-op at the cap. */
  addRouter(): void {
    this.routerDraft().update((d) => {
      if (d.routers.length >= this.maxRouters) return d;
      return { routers: [...d.routers, this.blankRouter(`router-${d.routers.length + 1}`)] };
    });
  }

  /** Remove a router entry by id (the pre-provisioned one is never removed by UI). */
  removeRouter(id: string): void {
    this.routerDraft().update((d) => ({ routers: d.routers.filter((r) => r.id !== id) }));
  }

  /** Patch a single router entry by id — write-through for the step's field edits. */
  updateRouter(id: string, patch: Partial<RouterEntry>): void {
    this.routerDraft().update((d) => ({
      routers: d.routers.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }

  /** Draft accessor for the Verify step. `checked` is sized by the caller on
   *  first read (the checklist length is owned by the component). */
  verifyDraft(itemCount: number): WritableSignal<VerifyDraft> {
    return this.draftSignal<VerifyDraft>('verify', () => ({
      checked: Array.from({ length: itemCount }, () => false),
      finished: false,
    }));
  }

  /** Draft accessor for the Advanced service form. */
  serviceAdvancedDraft(): WritableSignal<ServiceAdvancedDraft> {
    return this.draftSignal<ServiceAdvancedDraft>('service-advanced', () => ({
      serviceName: '',
      attributes: [],
      configMode: 'create',
      pickerType: '',
      newConfigName: '',
      existingPick: '',
      attachedConfigs: [],
      nextConfigId: 0,
      ic_portRanges: '',
      ic_addresses: '',
      ic_allowedSource: '',
      ic_protoTcp: false,
      ic_protoUdp: false,
      ic_sourceIp: '',
      h_protocol: 'tcp',
      h_address: '',
      h_port: null,
      h_forwardProtocol: false,
      h_forwardAddress: false,
      h_forwardPort: false,
      h_allowedSource: '',
      h_forwardTranslations: '',
      h_http_url: '',
      h_http_method: 'GET',
      h_http_status: null,
      h_http_interval: '',
      h_listen_bindEdge: false,
      h_listen_identity: '',
      h_listen_connectTimeout: '',
      h_listen_maxConn: null,
      h_portcheck_address: '',
      h_portcheck_interval: '',
      h_portcheck_timeout: '',
      h_proxy_type: '',
      h_proxy_address: '',
      terminatorStrategy: '',
      encryptionRequired: true,
      tags: [],
      openPanels: new Set<string>(),
      saved: false,
      submitted: false,
      configSubmitted: false,
      touched: new Set<string>(),
    }));
  }

  /** Fixed head of the flow — always present, always in this order. */
  private readonly headSteps: OnboardingStep[] = [
    { id: 'overview', label: 'Overview',        icon: 'fa-solid fa-map',           path: 'overview' },
    { id: 'identity', label: 'Enroll Identity', icon: 'fa-solid fa-user-plus',     path: 'identity' },
    { id: 'router',   label: 'Add Router',      icon: 'fa-solid fa-network-wired', path: 'router' },
    { id: 'service',  label: 'Create Service',  icon: 'fa-solid fa-server',        path: 'service' },
  ];

  /** Greyed placeholders shown before the Simple/Advanced choice is made. */
  private readonly placeholderTail: OnboardingStep[] = [
    { id: 'policies-ph', label: 'Policies', icon: 'fa-solid fa-shield-halved', path: null, placeholder: true },
    { id: 'verify-ph',   label: 'Verify',   icon: 'fa-solid fa-circle-check',  path: null, placeholder: true },
  ];

  /** The unified Policy step (advanced-only + conditional — see showPolicyStep). */
  private readonly policyStep: OnboardingStep =
    { id: 'policy', label: 'Policy', icon: 'fa-solid fa-shield-halved', path: 'policy' };

  /** Verify — always the last step of any resolved tail. */
  private readonly verifyStep: OnboardingStep =
    { id: 'verify', label: 'Verify', icon: 'fa-solid fa-circle-check', path: 'verify' };

  /**
   * Whether the unified Policy step is shown. Advanced-only; shown when the
   * service has NO service attributes (nothing to auto-generate policies from) OR
   * the user has already created >=1 policy (STICKY — never discard their work).
   * Reads live signals (branch, advanced-service attributes, created policies) so
   * steps() and the /policy route guard react as the user edits.
   */
  readonly showPolicyStep = computed<boolean>(() => {
    if (this.branch() !== 'advanced') return false;
    // Accessors return the WritableSignal; call again to read the live value.
    const hasServiceAttrs = this.serviceAdvancedDraft()().attributes.length > 0;
    const hasPolicies = this.policyStepDraft()().createdPolicies.length > 0;
    return !hasServiceAttrs || hasPolicies;
  });

  /**
   * The rail's ordered step list. Before a branch is chosen the greyed
   * placeholder tail shows; after, the tail is [verify] — with the conditional
   * Policy step inserted before it when showPolicyStep() holds.
   */
  readonly steps = computed<OnboardingStep[]>(() => {
    if (this.branch() === 'unset') {
      return [...this.headSteps, ...this.placeholderTail];
    }
    const tail = this.showPolicyStep()
      ? [this.policyStep, this.verifyStep]
      : [this.verifyStep];
    return [...this.headSteps, ...tail];
  });

  /** Steps that are real, navigable screens (excludes greyed placeholders). */
  readonly navigableSteps = computed<OnboardingStep[]>(() =>
    this.steps().filter((s) => s.path !== null),
  );

  isComplete(id: string): boolean {
    return this.completed().has(id);
  }

  markComplete(id: string): void {
    const next = new Set(this.completed());
    next.add(id);
    this.completed.set(next);
  }

  chooseBranch(branch: 'simple' | 'advanced'): void {
    this.branch.set(branch);
  }

  /** Return to the Simple / Advanced / Template chooser by un-choosing the
   *  branch. The rail tail reverts to its placeholder until a branch is
   *  re-picked; per-step drafts are left intact, so re-entering a branch (or
   *  re-applying a template) restores the user's work. */
  clearBranch(): void {
    this.branch.set('unset');
  }

  /** Path of the step after `id` in navigable order, or null if it's the last. */
  nextPath(id: string): string | null {
    const steps = this.navigableSteps();
    const i = steps.findIndex((s) => s.id === id);
    return i >= 0 && i < steps.length - 1 ? steps[i + 1].path : null;
  }

  /** Path of the step before `id` in navigable order, or null if it's the first. */
  prevPath(id: string): string | null {
    const steps = this.navigableSteps();
    const i = steps.findIndex((s) => s.id === id);
    return i > 0 ? steps[i - 1].path : null;
  }

  /** Mark the flow done and flip the app into its onboarded (normal console) state. */
  finish(): void {
    this.data.isOnboarded.set(true);
  }

  /** Reset the flow — for a future "run setup again" re-entry link. */
  reset(): void {
    this.branch.set('unset');
    this.completed.set(new Set());
    this.drafts.clear();
  }
}
