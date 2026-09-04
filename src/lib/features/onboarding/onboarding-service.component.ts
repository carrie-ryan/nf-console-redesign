import { Component, WritableSignal, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AttachedConfigDraft, CreatedPolicy, OnboardingStateService, ServiceSimpleDraft } from './onboarding-state.service';
import { OnboardingServiceAdvancedComponent } from './onboarding-service-advanced.component';
import { CURATED_TEMPLATES, ServiceTemplate } from './service-templates';
import { DrawerService } from '../../shared/services/drawer.service';
import { UserTemplatesService } from '../../shared/services/user-templates.service';

/**
 * Create Service — the third real onboarding step (designed-but-shallow).
 *
 * The step opens on the SIMPLE / ADVANCED branch point (the choice that resolves
 * the rail's placeholder tail). Picking ADVANCED reveals the advanced form inline
 * (a dedicated child component); picking SIMPLE reveals the full "Create a Simple
 * Service" form inline, mirroring the real console's single-Save layout:
 *  - Section 1 Service Details (name + attributes)
 *  - Section 2 Accessing Configuration (who dials + how it's reached) → becomes
 *    the dial policy + intercept
 *  - Section 3 Hosting Configuration (who hosts + where traffic goes) → becomes
 *    the bind policy + host
 * Everything shows at once; one Save. On Save (shallow — no persistence) a
 * confirmation surfaces that the service was created AND that the dial + bind
 * service policies were auto-generated — which is why the Simple path skips the
 * Policy step and goes straight to Verify.
 * A "Learn more" affordance opens the shared drawer with the service concept.
 */
@Component({
  selector: 'app-onboarding-service',
  standalone: true,
  imports: [FormsModule, OnboardingServiceAdvancedComponent],
  templateUrl: './onboarding-service.component.html',
  styleUrl: './onboarding-service.component.css',
})
export class OnboardingServiceComponent {
  private readonly router = inject(Router);
  private readonly drawer = inject(DrawerService);
  readonly state = inject(OnboardingStateService);
  private readonly userTemplatesService = inject(UserTemplatesService);

  private readonly stepId = 'service';

  // Phase gating — the branch point resolves into the Simple form or the
  // Advanced form (a dedicated child component), both inline on this step.
  readonly showChoice = computed(() => this.state.branch() === 'unset');
  readonly showSimpleForm = computed(() => this.state.branch() === 'simple');
  readonly showAdvancedForm = computed(() => this.state.branch() === 'advanced');

  // ── Template path (local, transient) ─────────────────────────────────────
  // "Start from a template" is an ACTION into the advanced branch, not a
  // persistent OnboardingBranch value (per the audit) — the branch stays 'unset'
  // while picking, so this sub-flow lives in local component state that sits
  // between the chooser and the advanced form. 'choice' shows the three branch
  // tiles; 'picker' shows the template library. There is a SINGLE template
  // action: selecting a card pre-fills the advanced form and enters the branch
  // directly — no intermediate mode choice.
  readonly serviceMode = signal<'choice' | 'picker'>('choice');
  /** The curated library, read straight from the data module (no redefinition). */
  readonly curatedTemplates = CURATED_TEMPLATES;

  /** Enter the template picker from the chooser tile. Does NOT set a branch. */
  chooseTemplate(): void {
    this.serviceMode.set('picker');
  }

  /** Leave the template picker, back to the Simple/Advanced/Template tiles. */
  backToChoice(): void {
    this.serviceMode.set('choice');
  }

  /** Short human summary of what a template creates, e.g. "intercept + host
   *  config" — derived from the template's config types. */
  templateConfigSummary(t: ServiceTemplate): string {
    const shortNames = t.configs.map((c) => this.shortConfigRole(c.type));
    const noun = shortNames.length === 1 ? 'config' : 'configs';
    return `${shortNames.join(' + ')} ${noun}`;
  }

  /** 'intercept.v1' -> 'intercept', 'host.v1' -> 'host' (drops the .vN suffix). */
  private shortConfigRole(type: string): string {
    return type.replace(/\.v\d+$/, '');
  }

  /**
   * THE template path (single action): pre-fill the advanced form from
   * `template`, fully editable, then enter the advanced branch. Each template
   * config lands as an ATTACHED 'created' config (so it gets the pencil /
   * remove / edit-in-place affordances for free, just like a user-authored
   * one), NOT reopened in the authoring card. Templates simply give a head start
   * on the advanced form — every seeded field is a normal editable field. Field
   * states (locked/blank) are NOT enforced here; 'blank' fields seed empty and
   * show their existing static "Required" label, identical to a hand-built
   * config's empty field. The advanced component hydrates from this draft on
   * construction, so the draft is written BEFORE chooseBranch flips the view.
   */
  startFromTemplate(template: ServiceTemplate): void {
    const attached: AttachedConfigDraft[] = template.configs.map((cfg, i) => ({
      // Match the advanced form's own id scheme (cfg-new-N) so a subsequently
      // user-created config (id from nextConfigId) never collides.
      id: `cfg-new-${i}`,
      name: `${template.name} ${this.shortConfigRole(cfg.type)}`,
      type: cfg.type,
      origin: 'created',
      data: { ...cfg.data },
    }));

    // Replace (not append): a template start is a clean slate. Only the fields
    // a template owns are touched — attachedConfigs, the id counter, and any
    // service-level attribute defaults (curated set has none, but wire it).
    this.state.serviceAdvancedDraft().update((d) => ({
      ...d,
      attachedConfigs: attached,
      nextConfigId: attached.length,
      attributes: template.serviceDefaults?.attributes
        ? [...template.serviceDefaults.attributes]
        : d.attributes,
    }));

    // Enter the advanced branch (which renders the pre-attached configs). Leave
    // serviceMode as 'picker' so Back out of the advanced form returns to the
    // template picker it was launched from (clearBranch → showChoice → picker),
    // not the top-level chooser tiles.
    this.state.chooseBranch('advanced');
  }

  // ── "Saved by you" — user templates (Part 4a: CRUD only) ──────────────────
  /** The user's saved templates (localStorage-backed, survive reload). */
  readonly userTemplates = this.userTemplatesService.templates;

  /** Id of the template being renamed inline (null = none). */
  readonly renamingTemplateId = signal<string | null>(null);
  /** Working text for the inline rename field. */
  renameInput = '';

  startRename(t: ServiceTemplate): void {
    this.renamingTemplateId.set(t.id);
    this.renameInput = t.name;
  }

  commitRename(): void {
    const id = this.renamingTemplateId();
    if (!id) return;
    this.userTemplatesService.rename(id, this.renameInput);
    this.renamingTemplateId.set(null);
    this.renameInput = '';
  }

  cancelRename(): void {
    this.renamingTemplateId.set(null);
    this.renameInput = '';
  }

  deleteTemplate(t: ServiceTemplate): void {
    if (!confirm(`Delete template “${t.name}”? This can't be undone.`)) return;
    this.userTemplatesService.remove(t.id);
    if (this.renamingTemplateId() === t.id) this.cancelRename();
  }

  /**
   * Apply a saved user template — restore the WHOLE captured setup, not just
   * configs. REPLACES current draft state (a template start is a clean slate):
   *   1. Service attributes ← template.serviceAttributes (write-through).
   *   2. Captured policies → policyStepDraft().createdPolicies, in the EXACT
   *      shape the Policy step builds by hand (pol-${n} ids, tags/extra), so they
   *      land as already-created cards the user reviews — no re-save.
   *   3. Configs + enter the advanced branch via startFromTemplate (chooseBranch
   *      last), which for a user template leaves the attributes set in step 1
   *      intact (its serviceDefaults is undefined).
   *
   * Policy-step visibility falls out of the existing rule, no new trigger:
   * populating createdPolicies makes hasPolicies true, and
   * showPolicyStep = !hasServiceAttrs || hasPolicies — so the step appears
   * whenever there are captured policies, even alongside restored attributes.
   * An EMPTY capturedPolicies (advanced+attributes path — policies auto-generated)
   * leaves createdPolicies empty, so the step correctly does NOT appear and the
   * policies auto-generate as normal.
   */
  applyUserTemplate(t: ServiceTemplate): void {
    // 1. Service attributes — REPLACE (empty template → clears any prior attrs).
    this.state.serviceAdvancedDraft().update((d) => ({
      ...d,
      attributes: t.serviceAttributes ? [...t.serviceAttributes] : [],
    }));

    // 2. Captured policies → createdPolicies, mirroring onboarding-policy-step's
    //    onCreate shape. REPLACE the whole list (never append to stale state).
    const captured = t.capturedPolicies ?? [];
    const createdPolicies: CreatedPolicy[] = captured.map((cp, i) => ({
      id: `pol-${i}`,
      type: cp.type,
      name: cp.name,
      // semantic is 'AnyOf' | 'AllOf' at the source; CapturedPolicy widens it to
      // string for storage, so narrow it back here.
      semantic: cp.semantic as CreatedPolicy['semantic'],
      attrA: [...cp.attrA],
      attrB: [...cp.attrB],
      // Not captured (Part 4a) — restore empty, matching a hand-created policy.
      tags: [],
      // dialBind exists only on Service Policies → the `extra` field. Router /
      // service-edge-router carry none; leave undefined (never fabricate one).
      extra: cp.dialBind,
    }));
    this.state.policyStepDraft().set({
      createdPolicies,
      // Continue the monotonic scheme past the restored ids (pol-0..pol-(n-1)).
      nextPolicyId: createdPolicies.length,
    });

    // 3. Configs + branch entry (chooseBranch last). serviceDefaults is undefined
    //    for user templates, so this preserves the attributes set in step 1.
    this.startFromTemplate(t);
  }

  /** The per-step draft in the store — source of truth for all Simple-service
   *  field state, so it survives back/forward route navigation. */
  private readonly draft: WritableSignal<ServiceSimpleDraft> = this.state.serviceSimpleDraft();

  // ── Transient chip-input buffers (not persisted — uncommitted text) ───────
  attributeInput = '';
  accessIdentityInput = '';
  hostIdentityInput = '';

  readonly hasBack = this.state.prevPath(this.stepId) !== null;

  // ── Draft-backed field accessors ─────────────────────────────────────────
  // Read through the draft signal (so the template reacts) and write every
  // change back to it (so it survives navigation). Method-shaped getters keep
  // the template's existing `attributes()` / `saved()` call syntax unchanged.
  get serviceName(): string { return this.draft().serviceName; }
  set serviceName(v: string) { this.draft.update((d) => ({ ...d, serviceName: v })); }

  attributes(): string[] { return this.draft().attributes; }

  accessIdentities(): string[] { return this.draft().accessIdentities; }
  sdkOnlyAccess(): boolean { return this.draft().sdkOnlyAccess; }
  get accessAddress(): string { return this.draft().accessAddress; }
  set accessAddress(v: string) { this.draft.update((d) => ({ ...d, accessAddress: v })); }
  get accessPort(): number | null { return this.draft().accessPort; }
  set accessPort(v: number | null) { this.draft.update((d) => ({ ...d, accessPort: v })); }

  hostIdentities(): string[] { return this.draft().hostIdentities; }
  sdkOnlyHost(): boolean { return this.draft().sdkOnlyHost; }
  get hostProtocol(): 'tcp' | 'udp' { return this.draft().hostProtocol; }
  set hostProtocol(v: 'tcp' | 'udp') { this.draft.update((d) => ({ ...d, hostProtocol: v })); }
  get hostAddress(): string { return this.draft().hostAddress; }
  set hostAddress(v: string) { this.draft.update((d) => ({ ...d, hostAddress: v })); }
  get hostPort(): number | null { return this.draft().hostPort; }
  set hostPort(v: number | null) { this.draft.update((d) => ({ ...d, hostPort: v })); }

  /** Shallow "created" state — reveals the confirmation panel. */
  saved(): boolean { return this.draft().saved; }
  submitted(): boolean { return this.draft().submitted; }
  touched(): ReadonlySet<string> { return this.draft().touched; }

  // ── Required-field validation ───────────────────────────────────────────
  /** The required fields. Address/Port are only required when their side's
   *  SDK Only toggle is OFF, so `isRequired` resolves them off the live draft. */
  private readonly requiredFields = [
    'name', 'accessIds', 'hostIds', 'accessAddr', 'accessPort', 'hostAddr', 'hostPort',
  ] as const;

  markTouched(field: string): void {
    if (this.draft().touched.has(field)) return;
    this.draft.update((d) => ({ ...d, touched: new Set([...d.touched, field]) }));
  }

  /** Whether a field is required right now (Address/Port depend on SDK Only). */
  private isRequired(field: string): boolean {
    switch (field) {
      case 'accessAddr':
      case 'accessPort': return !this.sdkOnlyAccess();
      case 'hostAddr':
      case 'hostPort':   return !this.sdkOnlyHost();
      default:           return true; // name + both attribute selectors: always
    }
  }

  private isFilled(field: string): boolean {
    switch (field) {
      case 'name':        return this.serviceName.trim().length > 0;
      case 'accessIds':   return this.accessIdentities().length > 0;
      case 'hostIds':     return this.hostIdentities().length > 0;
      case 'accessAddr':  return this.accessAddress.trim().length > 0;
      case 'accessPort':  return this.accessPort != null;
      case 'hostAddr':    return this.hostAddress.trim().length > 0;
      case 'hostPort':    return this.hostPort != null;
      default:            return true;
    }
  }

  /** Show the red error border? Only for a required-but-empty field, and only
   *  after a Save attempt or once that field has been blurred — so the form
   *  doesn't open covered in red. */
  showError(field: string): boolean {
    return this.isRequired(field) && !this.isFilled(field)
      && (this.submitted() || this.touched().has(field));
  }

  get canSave(): boolean {
    return this.requiredFields.every((f) => !this.isRequired(f) || this.isFilled(f));
  }

  // ── Branch point ────────────────────────────────────────────────────────
  /** Simple: auto-creates the dial + bind policies — reveal the form, stay here. */
  chooseSimple(): void {
    this.state.chooseBranch('simple');
  }

  /** Advanced: define each config + policy by hand — reveal the advanced form. */
  chooseAdvanced(): void {
    this.state.chooseBranch('advanced');
  }

  // ── Tag-chip inputs (attributes + identity-attribute pickers) ───────────
  /** Add comma/Enter-delimited values to a draft chip list; true if any added. */
  private addToDraft(
    raw: string,
    key: 'attributes' | 'accessIdentities' | 'hostIdentities',
  ): boolean {
    const val = raw.trim().replace(/,+$/, '');
    if (!val) return false;
    const vals = val.split(',').map((v) => v.trim()).filter(Boolean);
    this.draft.update((d) => ({ ...d, [key]: [...new Set([...d[key], ...vals])] }));
    return true;
  }

  onAttributeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    if (this.addToDraft(this.attributeInput, 'attributes')) this.attributeInput = '';
  }
  removeAttribute(attr: string): void {
    this.draft.update((d) => ({ ...d, attributes: d.attributes.filter((a) => a !== attr) }));
  }

  onAccessIdentityKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    if (this.addToDraft(this.accessIdentityInput, 'accessIdentities')) this.accessIdentityInput = '';
  }
  removeAccessIdentity(id: string): void {
    this.draft.update((d) => ({ ...d, accessIdentities: d.accessIdentities.filter((a) => a !== id) }));
  }

  onHostIdentityKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    if (this.addToDraft(this.hostIdentityInput, 'hostIdentities')) this.hostIdentityInput = '';
  }
  removeHostIdentity(id: string): void {
    this.draft.update((d) => ({ ...d, hostIdentities: d.hostIdentities.filter((a) => a !== id) }));
  }

  toggleSdkOnlyAccess(): void {
    this.draft.update((d) => ({ ...d, sdkOnlyAccess: !d.sdkOnlyAccess }));
  }
  toggleSdkOnlyHost(): void {
    this.draft.update((d) => ({ ...d, sdkOnlyHost: !d.sdkOnlyHost }));
  }

  /** Shallow save — no entity persistence; flip the draft to saved to reveal the
   *  confirmation panel. On an invalid form, flag the submit attempt (revealing
   *  every empty-field error) and stay put. */
  save(): void {
    if (!this.canSave) {
      this.draft.update((d) => ({ ...d, submitted: true }));
      return;
    }
    this.draft.update((d) => ({ ...d, saved: true }));
  }

  /** Re-open the form from the confirmation view. Flips the draft back to
   *  unsaved with every field intact, so the populated form returns and is fully
   *  re-savable. Distinct from Back, which leaves the step for the previous one. */
  edit(): void {
    this.draft.update((d) => ({ ...d, saved: false }));
  }

  openHelp(): void {
    this.drawer.open({
      type: 'onboarding-help',
      data: {
        title: 'About Services',
        subtitle: 'Concept · Create Service',
        topic: 'service',
      },
    });
  }

  back(): void {
    // From a branch form (Simple), Back returns to the chooser on this same
    // step; from the chooser itself, Back leaves for the previous step.
    if (this.state.branch() !== 'unset') {
      this.state.clearBranch();
      return;
    }
    const prev = this.state.prevPath(this.stepId);
    if (prev) this.router.navigate(['/onboarding', prev]);
  }

  continue(): void {
    this.state.markComplete(this.stepId);
    const next = this.state.nextPath(this.stepId);
    if (next) this.router.navigate(['/onboarding', next]);
  }
}
