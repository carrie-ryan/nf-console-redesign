import { Component, WritableSignal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IdentityDraft, OnboardingStateService } from './onboarding-state.service';
import { DrawerService } from '../../shared/services/drawer.service';

/**
 * Create Identity — the first real onboarding step (designed-but-shallow).
 *
 * In-console parts are real-looking form fields (name + attribute pills + a
 * Create action, then a Download-JWT affordance) but do NOT persist. The
 * outside-console parts (enroll the token in a tunneler, verify the device is
 * online) are FAKE link-outs — they represent work that happens off-console.
 * A "Learn more" affordance opens the shared drawer with the identity concept.
 */
@Component({
  selector: 'app-onboarding-identity',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './onboarding-identity.component.html',
  styleUrl: './onboarding-identity.component.css',
})
export class OnboardingIdentityComponent {
  private readonly router = inject(Router);
  private readonly drawer = inject(DrawerService);
  readonly state = inject(OnboardingStateService);

  private readonly stepId = 'identity';

  /** Per-step draft in the store — source of truth for field state so it
   *  survives back/forward route navigation. */
  private readonly draft: WritableSignal<IdentityDraft> = this.state.identityDraft();

  /** Transient chip-input buffer (uncommitted text — not persisted). */
  attributeInput = '';

  readonly hasBack = this.state.prevPath(this.stepId) !== null;

  // ── Draft-backed field accessors ─────────────────────────────────────────
  get identityName(): string { return this.draft().identityName; }
  set identityName(v: string) { this.draft.update((d) => ({ ...d, identityName: v })); }

  attributes(): string[] { return this.draft().attributes; }

  /** Shallow POC — only "Default" is offered; real auth policies aren't wired. */
  get authPolicy(): string { return this.draft().authPolicy; }
  set authPolicy(v: string) { this.draft.update((d) => ({ ...d, authPolicy: v })); }

  get externalId(): string { return this.draft().externalId; }
  set externalId(v: string) { this.draft.update((d) => ({ ...d, externalId: v })); }

  /** Shallow "created" state — flips the screen to the enrollment affordances. */
  saved(): boolean { return this.draft().saved; }

  onAttributeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    const raw = this.attributeInput.trim().replace(/,+$/, '');
    if (!raw) return;
    const vals = raw.split(',').map((v) => v.trim()).filter(Boolean);
    this.draft.update((d) => ({ ...d, attributes: [...new Set([...d.attributes, ...vals])] }));
    this.attributeInput = '';
  }

  removeAttribute(attr: string): void {
    this.draft.update((d) => ({ ...d, attributes: d.attributes.filter((a) => a !== attr) }));
  }

  /** Shallow create — no entity persistence; just reveal the enrollment
   *  affordances by flipping the draft to saved. */
  createIdentity(): void {
    if (!this.identityName.trim()) return;
    this.draft.update((d) => ({ ...d, saved: true }));
  }

  openHelp(): void {
    this.drawer.open({
      type: 'onboarding-help',
      data: {
        title: 'About Identities',
        subtitle: 'Concept · Enroll Identity',
        topic: 'identity',
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
