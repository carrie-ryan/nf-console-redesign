import { Component, WritableSignal, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { OnboardingStateService, VerifyDraft } from './onboarding-state.service';
import { DrawerService } from '../../shared/services/drawer.service';
import { UserTemplatesService } from '../../shared/services/user-templates.service';
import { CapturedPolicy, ConfigType, TemplateConfig } from './service-templates';

/** One self-confirm item in the verification checklist. */
interface VerifyItem {
  lead: string;
  body: string;
  /** Optional external link the user opens to check (e.g. eth0.me). */
  link?: { href: string; label: string };
}

/**
 * Verify — the final step of the Simple path. Deliberately NOT a form: there is
 * no console data-entry here. End-to-end verification happens OUTSIDE the console
 * (the desktop tunneler app + a browser), so this is an honest, guided
 * self-confirm checklist of the real steps from the get-started docs — no
 * "Test Connection" button, no simulated result the POC can't back.
 *
 * The user ticks each item as they confirm it themselves; Finish unlocks only
 * once all four are checked. Finishing marks the step + the whole flow complete
 * (flipping the isOnboarded flag the shell gates on) and shows a "Setup complete"
 * confirmation, from which the user exits to the normal console dashboard.
 */
@Component({
  selector: 'app-onboarding-verify',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './onboarding-verify.component.html',
  styleUrl: './onboarding-verify.component.css',
})
export class OnboardingVerifyComponent {
  private readonly router = inject(Router);
  private readonly drawer = inject(DrawerService);
  readonly state = inject(OnboardingStateService);
  private readonly templates = inject(UserTemplatesService);

  private readonly stepId = 'verify';

  /** The four verification steps, grounded in the get-started "Test and verify
   *  data flow" docs. The IP changing (enabled) then reverting (disabled) is the
   *  proof — both halves are kept; the revert is what actually proves the tunnel. */
  readonly checklist: VerifyItem[] = [
    {
      lead: 'Confirm your identity is online',
      body: 'In the desktop tunneler app, check that your client identity is enrolled and shows as enabled and online.',
    },
    {
      lead: 'Confirm the service is available to it',
      body: 'Open your identity in the tunneler and confirm the service (e.g. “what is my ip”) is now listed and visible to it.',
    },
    {
      lead: 'Check your public IP changed',
      body: 'With the identity enabled, open eth0.me in a browser. Your public IP should now show the remote router’s location — not your own.',
      link: { href: 'https://eth0.me/', label: 'eth0.me' },
    },
    {
      lead: 'Confirm it reverts when disabled',
      body: 'Disable the client identity in the desktop app and refresh eth0.me. Your IP should revert to your local home IP — which is what actually proves the tunnel carried your traffic.',
      link: { href: 'https://eth0.me/', label: 'eth0.me' },
    },
  ];

  /** Per-step draft in the store — the per-item checked state (sized to
   *  `checklist`) + the finished flag, so ticks survive back/forward navigation. */
  private readonly draft: WritableSignal<VerifyDraft> = this.state.verifyDraft(this.checklist.length);

  allChecked(): boolean { return this.draft().checked.every(Boolean); }

  /** Flips to the "Setup complete" confirmation once the user hits Finish. */
  finished(): boolean { return this.draft().finished; }

  readonly hasBack = this.state.prevPath(this.stepId) !== null;

  /** Ordered summary of what onboarding built, shown on completion. */
  readonly built = [
    { icon: 'fa-solid fa-user-plus', label: 'Identity' },
    { icon: 'fa-solid fa-network-wired', label: 'Router' },
    { icon: 'fa-solid fa-server', label: 'Service' },
    { icon: 'fa-solid fa-shield-halved', label: 'Router Policy' },
    { icon: 'fa-solid fa-circle-check', label: 'Verified' },
  ];

  isChecked(i: number): boolean {
    return this.draft().checked[i];
  }

  toggle(i: number): void {
    this.draft.update((d) => ({
      ...d,
      checked: d.checked.map((v, idx) => (idx === i ? !v : v)),
    }));
  }

  openHelp(): void {
    this.drawer.open({
      type: 'onboarding-help',
      data: {
        title: 'About Verification',
        subtitle: 'Concept · Verify',
        topic: 'verify',
      },
    });
  }

  back(): void {
    const prev = this.state.prevPath(this.stepId);
    if (prev) this.router.navigate(['/onboarding', prev]);
  }

  /** Finish — only reachable once all items are checked. Marks the step and the
   *  whole flow complete (flips isOnboarded), then reveals the confirmation. */
  finish(): void {
    if (!this.allChecked()) return;
    this.state.markComplete(this.stepId);
    this.state.finish();
    this.draft.update((d) => ({ ...d, finished: true }));
  }

  // ── Save as template (Part 4a) ─────────────────────────────────────────────
  // An OPTIONAL action on the completion view: capture the just-built ADVANCED
  // service (its configs + attributes + policies) into a reusable user template
  // stored in localStorage. State is fully intact here — finish() clears nothing
  // (per the audit). Never gates finishing/onboarding; purely additive.

  /** Only the Advanced path maps onto the template model — Simple has no attached
   *  configs (audit finding), so the action is hidden for it. */
  readonly canSaveTemplate = computed(() => this.state.branch() === 'advanced');

  /** Inline name-entry open? */
  readonly savingTemplate = signal(false);
  /** Name typed for the new template (transient). */
  templateName = '';
  /** Name of the template just saved — reveals the inline confirmation. */
  readonly savedTemplateName = signal<string | null>(null);

  /** Open the inline name field. Seeds a sensible default from the service name. */
  startSaveTemplate(): void {
    this.templateName = this.state.serviceAdvancedDraft()().serviceName || '';
    this.savingTemplate.set(true);
  }

  cancelSaveTemplate(): void {
    this.savingTemplate.set(false);
    this.templateName = '';
  }

  /** Capture the completed advanced flow from the store and persist it as a user
   *  template. Reads createdPolicies UNCONDITIONALLY (the audit's sticky edge
   *  case: an attributes-present service can still carry manually-created
   *  policies). An empty policy list is correct for the advanced+attributes path
   *  where policies are auto-generated — on apply (Part 4b) those regenerate from
   *  serviceAttributes. */
  saveAsTemplate(): void {
    const name = this.templateName.trim();
    if (!name || !this.canSaveTemplate()) return;

    const adv = this.state.serviceAdvancedDraft()();
    const policyDraft = this.state.policyStepDraft()();

    const configs: TemplateConfig[] = adv.attachedConfigs.map((c) => ({
      type: c.type as ConfigType,
      data: { ...c.data },
      // Captured configs are all editable defaults — no locked/blank pattern.
      fieldStates: {},
    }));

    const capturedPolicies: CapturedPolicy[] = policyDraft.createdPolicies.map((p) => ({
      type: p.type,
      name: p.name,
      semantic: p.semantic,
      attrA: [...p.attrA],
      attrB: [...p.attrB],
      // A Service Policy's extra field is its Dial|Bind value; other types have none.
      dialBind: p.extra === 'Dial' || p.extra === 'Bind' ? p.extra : undefined,
    }));

    this.templates.add({
      name,
      description: this.templateSummary(configs),
      icon: 'fa-solid fa-bookmark',
      configs,
      serviceAttributes: [...adv.attributes],
      capturedPolicies,
      createdAt: Date.now(),
    });

    this.savedTemplateName.set(name);
    this.savingTemplate.set(false);
    this.templateName = '';
  }

  /** One-line description for a captured template, from its config roles. */
  private templateSummary(configs: TemplateConfig[]): string {
    const roles = configs.map((c) => c.type.replace(/\.v\d+$/, ''));
    return roles.length
      ? `Saved from your service — ${roles.join(' + ')}.`
      : 'Saved from your service.';
  }

  /** Leave the focused onboarding shell for the normal console. */
  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }
}
