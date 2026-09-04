import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CreatedPolicy, OnboardingStateService, PolicyType } from './onboarding-state.service';
import { DrawerService } from '../../shared/services/drawer.service';
import { AuthoredPolicy, PolicyFormComponent, PolicyFormConfig } from './policy-form.component';

/** Chooser + form metadata for one policy type. */
interface PolicyTypeMeta {
  type: PolicyType;
  /** Chooser + chip label. */
  label: string;
  /** Chooser icon (Font Awesome class). */
  icon: string;
  /** Chooser description. */
  desc: string;
  /** Field-level config handed to the embedded PolicyFormComponent. */
  formConfig: PolicyFormConfig;
}

/**
 * Per-type configs. Router Policy is real (carried over from the old
 * routerPolicyConfig field values). Service Policy and Service Edge Router Policy
 * are STUBS for Part 2 — placeholder strings only; their real labels/hints (and
 * Service Policy's Dial|Bind extra field) are filled in Part 4.
 */
const POLICY_TYPE_META: Record<PolicyType, PolicyTypeMeta> = {
  router: {
    type: 'router',
    label: 'Router Policy',
    icon: 'fa-solid fa-shield-halved',
    desc: 'Grant identities permission to use edge routers to reach the overlay.',
    formConfig: {
      namePlaceholder: 'Name this edge router policy',
      attrALabel: 'Edge Router Attributes',
      attrAPlaceholder: 'Select edge router attributes',
      attrAHint: 'Press Enter or comma to add. Use #role or @edge-router attributes.',
      attrBLabel: 'Identity Attributes',
      attrBPlaceholder: 'Select identity attributes',
      attrBHint: 'Press Enter or comma to add. Use #role or @identity attributes.',
      attributesRequired: true,
    },
  },
  service: {
    type: 'service',
    label: 'Service Policy',
    icon: 'fa-solid fa-shield-halved',
    desc: 'Authorize which identities may dial or bind your services.',
    formConfig: {
      namePlaceholder: 'Name this service policy',
      attrALabel: 'Service Attributes',
      attrAPlaceholder: 'Select service attributes',
      attrAHint: 'Press Enter or comma to add. Use #role or @service attributes.',
      attrBLabel: 'Identity Attributes',
      attrBPlaceholder: 'Select identity attributes',
      attrBHint: 'Press Enter or comma to add. Use #role or @identity attributes.',
      // Onboarding convention: both selectors required (a no-attribute policy
      // grants nothing) — an intentional divergence from the console, where the
      // Service Policy selectors are optional. Applied to all three types.
      attributesRequired: true,
      // Dial | Bind — a value-only dropdown beside Semantic (Bind default), as in
      // the console; picking it changes no other field. Maps to the policy `type`.
      // NOTE: the console form also has an optional Posture Check Attributes
      // selector — deliberately OMITTED for this POC (known fidelity gap).
      extraField: {
        key: 'type',
        label: 'Type',
        type: 'select',
        options: [
          { value: 'Bind', label: 'Bind' },
          { value: 'Dial', label: 'Dial' },
        ],
        default: 'Bind',
        required: true,
      },
    },
  },
  'service-edge-router': {
    type: 'service-edge-router',
    label: 'Service Edge Router Policy',
    icon: 'fa-solid fa-diagram-project',
    desc: 'Optionally limit which edge routers carry this service (any router can by default).',
    formConfig: {
      namePlaceholder: 'Name this service edge router policy',
      attrALabel: 'Service Attributes',
      attrAPlaceholder: 'Select service attributes',
      attrAHint: 'Press Enter or comma to add. Use #role or @service attributes.',
      attrBLabel: 'Edge Router Attributes',
      attrBPlaceholder: 'Select edge router attributes',
      attrBHint: 'Press Enter or comma to add. Use #role or @edge-router attributes.',
      attributesRequired: true,
    },
  },
};

/**
 * Unified Policy step — create MANY policies of any type on one screen. Owns the
 * chrome (header, Learn more, Back/Continue, right rail). Layout mirrors the
 * advanced service's attachedConfigs arrangement: the created-policies list sits
 * on top, and a chooser + embedded PolicyFormComponent for authoring the NEXT one
 * sits below. Selecting a type in the chooser swaps in that type's form config;
 * the form's (create) output appends to the list (write-through to
 * OnboardingStateService.policyStepDraft) and resets the chooser for another.
 */
@Component({
  selector: 'app-onboarding-policy-step',
  standalone: true,
  imports: [PolicyFormComponent],
  templateUrl: './onboarding-policy-step.component.html',
  styleUrl: './onboarding-policy-step.component.css',
})
export class OnboardingPolicyStepComponent {
  private readonly router = inject(Router);
  private readonly drawer = inject(DrawerService);
  readonly state = inject(OnboardingStateService);

  /** This step's fixed id — matches the `policy` route + rail/completion state. */
  private readonly stepId = 'policy';

  /** The type currently being authored (null = the chooser is showing). */
  readonly selectedType = signal<PolicyType | null>(null);

  /** Id of the policy being edited (null = create mode). Transient/component-local
   *  — never persisted to the draft, so navigating away and back never reopens
   *  mid-edit (a fresh component resets it to null). */
  readonly editingId = signal<string | null>(null);

  /** Chooser options, in display order. */
  readonly typeOptions: PolicyTypeMeta[] = [
    POLICY_TYPE_META.service,
    POLICY_TYPE_META.router,
    POLICY_TYPE_META['service-edge-router'],
  ];

  /** The write-through create-many draft on the store. */
  private readonly draft = this.state.policyStepDraft();
  readonly createdPolicies = computed(() => this.draft().createdPolicies);

  /** Field values fed to the sub-form when editing (null in create mode). Memoized
   *  so the `initial` input reference is stable across change detection — it only
   *  changes when the edit target or the underlying policy changes. */
  readonly editingInitial = computed<AuthoredPolicy | null>(() => {
    const id = this.editingId();
    if (!id) return null;
    const p = this.createdPolicies().find((c) => c.id === id);
    if (!p) return null;
    return {
      name: p.name,
      semantic: p.semantic,
      attrA: p.attrA,
      attrB: p.attrB,
      tags: p.tags,
      extra: p.extra,
    };
  });

  /**
   * Non-blocking completeness caution, keyed off the TYPES created (not the
   * count). A working circuit usually needs both a Service Policy and a Router
   * Policy; if >=1 policy exists but one of that pair is missing, warn (Continue
   * stays enabled). Service Edge Router Policy is situational — never gated on.
   */
  readonly completenessCaution = computed<string | null>(() => {
    const policies = this.createdPolicies();
    if (policies.length === 0) return null; // the Continue gate handles empty
    const hasService = policies.some((p) => p.type === 'service');
    const hasRouter = policies.some((p) => p.type === 'router');
    if (hasService && hasRouter) return null;
    if (hasService && !hasRouter) {
      return "You've created a Service Policy but no Router Policy. Traffic may not flow without both.";
    }
    if (hasRouter && !hasService) {
      return "You've created a Router Policy but no Service Policy. Traffic may not flow without both.";
    }
    // Neither of the pair (e.g. only a Service Edge Router Policy).
    return "You've created a Service Edge Router Policy but no Service Policy or Router Policy. Traffic may not flow without both.";
  });

  /** True when the advanced service was saved with service attributes — then
   *  NetFoundry auto-creates policies from them, coexisting with any created here. */
  readonly serviceHasAttributes = computed(
    () => this.state.serviceAdvancedDraft()().attributes.length > 0,
  );

  /** Back-button visibility, derived live from the (conditional) step list. */
  get hasBack(): boolean {
    return this.state.prevPath(this.stepId) !== null;
  }

  constructor() {
    // Live visibility: the route guard covers entry, but if the rule stops
    // holding WHILE the user is here (e.g. they remove their only policy while
    // the advanced service has attributes), don't strand them on a dead Policy
    // screen — send them to Verify.
    effect(() => {
      if (!this.state.showPolicyStep()) {
        this.router.navigate(['/onboarding', 'verify']);
      }
    });
  }

  // ── Chooser + authoring ───────────────────────────────────────────────────
  chooseType(type: PolicyType): void {
    this.selectedType.set(type);
  }

  /** Back out of the open form to the type chooser (does not leave the step). */
  cancelChoice(): void {
    this.selectedType.set(null);
  }

  configFor(type: PolicyType): PolicyFormConfig {
    return POLICY_TYPE_META[type].formConfig;
  }

  labelFor(type: PolicyType): string {
    return POLICY_TYPE_META[type].label;
  }

  iconFor(type: PolicyType): string {
    return POLICY_TYPE_META[type].icon;
  }

  /** Type label plus the extra-field value when present (e.g. "Service Policy · Bind"). */
  typeSummary(p: CreatedPolicy): string {
    const base = POLICY_TYPE_META[p.type].label;
    return p.extra ? `${base} · ${p.extra}` : base;
  }

  /** Sub-form Added a policy — append it to the list (write-through) and reset
   *  the chooser so the user can add another. */
  onCreate(policy: AuthoredPolicy): void {
    const type = this.selectedType();
    if (!type) return;
    this.draft.update((d) => ({
      ...d,
      createdPolicies: [
        ...d.createdPolicies,
        {
          id: `pol-${d.nextPolicyId}`,
          type,
          name: policy.name,
          semantic: policy.semantic,
          attrA: policy.attrA,
          attrB: policy.attrB,
          tags: policy.tags,
          extra: policy.extra,
        },
      ],
      nextPolicyId: d.nextPolicyId + 1,
    }));
    this.selectedType.set(null);
    this.state.markComplete(this.stepId);
  }

  /** Open an existing policy in the authoring form, in edit mode. Reopens
   *  directly into that policy's type — no chooser (changing type = remove + add). */
  startEdit(p: CreatedPolicy): void {
    this.editingId.set(p.id);
    this.selectedType.set(p.type);
  }

  /** Sub-form saved edits — REPLACE the matching policy by id (type preserved),
   *  then collapse the edit slot back to the chooser. */
  onSave(policy: AuthoredPolicy): void {
    const id = this.editingId();
    if (!id) return;
    this.draft.update((d) => ({
      ...d,
      createdPolicies: d.createdPolicies.map((c) =>
        c.id === id
          ? {
              ...c, // keep id + type
              name: policy.name,
              semantic: policy.semantic,
              attrA: policy.attrA,
              attrB: policy.attrB,
              tags: policy.tags,
              extra: policy.extra,
            }
          : c,
      ),
    }));
    this.editingId.set(null);
    this.selectedType.set(null);
  }

  /** Cancel an in-progress edit — leave the original untouched, restore the chooser. */
  cancelEditing(): void {
    this.editingId.set(null);
    this.selectedType.set(null);
  }

  removePolicy(id: string): void {
    this.draft.update((d) => ({
      ...d,
      createdPolicies: d.createdPolicies.filter((c) => c.id !== id),
    }));
    // If the removed item was mid-edit, drop back to the chooser.
    if (this.editingId() === id) {
      this.editingId.set(null);
      this.selectedType.set(null);
    }
  }

  // ── Chrome ────────────────────────────────────────────────────────────────
  openHelp(): void {
    this.drawer.open({
      type: 'onboarding-help',
      data: {
        title: 'About Policies',
        subtitle: 'Concept · Policy',
        topic: 'policy',
      },
    });
  }

  back(): void {
    const prev = this.state.prevPath(this.stepId);
    if (prev) this.router.navigate(['/onboarding', prev]);
  }

  continue(): void {
    this.state.markComplete(this.stepId);
    const next = this.state.nextPath(this.stepId);
    if (next) this.router.navigate(['/onboarding', next]);
  }
}
