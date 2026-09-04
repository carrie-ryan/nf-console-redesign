import { Component, WritableSignal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { OnboardingStateService, RouterDraft, RouterEntry } from './onboarding-state.service';
import { DrawerService } from '../../shared/services/drawer.service';

type HostingType = 'self' | 'netfoundry';

/**
 * Add Router — the second real onboarding step (designed-but-shallow).
 *
 * Two distinct router paths, reflecting the real product:
 *  1. PRE-PROVISIONED router (routers[0]) — NetFoundry ships every network a
 *     hosted edge router. It exists + is saved from load (that decision was made
 *     at provisioning), so the top card is purely INFORMATIONAL — an already-in-use
 *     fact, not a selection. The map shows it immediately (saved:true).
 *  2. Optional SECOND router (routers[1]) — added via the classic create-then-
 *     choose-hosting flow (name + attributes → Add Router → self vs NetFoundry
 *     hosting). POC-capped at two total.
 *
 * Field edits write through to routers[1] via the state helpers, so they survive
 * back/forward navigation. A "Learn more" affordance opens the shared drawer.
 */
@Component({
  selector: 'app-onboarding-router',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './onboarding-router.component.html',
  styleUrl: './onboarding-router.component.css',
})
export class OnboardingRouterComponent {
  private readonly router = inject(Router);
  private readonly drawer = inject(DrawerService);
  readonly state = inject(OnboardingStateService);

  private readonly stepId = 'router';

  /** The router list in the store — source of truth so field state survives
   *  route navigation. */
  private readonly draft: WritableSignal<RouterDraft> = this.state.routerDraft();

  /** Transient chip-input buffer (uncommitted text — not persisted). */
  attributeInput = '';

  readonly hasBack = this.state.prevPath(this.stepId) !== null;

  // ── List accessors ────────────────────────────────────────────────────────
  /** The pre-provisioned NetFoundry router — always present (seeded). */
  preprovisioned(): RouterEntry { return this.draft().routers[0]; }
  /** The optional manually-added second router, or undefined before it's added. */
  second(): RouterEntry | undefined { return this.draft().routers[1]; }
  hasSecond(): boolean { return this.draft().routers.length > 1; }
  /** Whether another router may still be added (below the POC cap). */
  canAddRouter(): boolean { return this.draft().routers.length < this.state.maxRouters; }

  /** Patch the second router by its id — no-op if it doesn't exist yet. */
  private patchSecond(patch: Partial<RouterEntry>): void {
    const s = this.second();
    if (s) this.state.updateRouter(s.id, patch);
  }

  // ── Second-router field accessors (write through to routers[1]) ────────────
  get routerName(): string { return this.second()?.routerName ?? ''; }
  set routerName(v: string) { this.patchSecond({ routerName: v }); }

  attributes(): string[] { return this.second()?.attributes ?? []; }

  /** Where the second router runs — Self-hosted is the default; drives whether the
   *  user sees deploy-it-yourself steps or NetFoundry hosting fields. */
  hostingType(): HostingType { return this.second()?.hostingType ?? 'self'; }

  get cloudProvider(): string { return this.second()?.cloudProvider ?? 'AWS'; }
  set cloudProvider(v: string) { this.patchSecond({ cloudProvider: v }); }
  get location(): string { return this.second()?.location ?? 'us-east-1'; }
  set location(v: string) { this.patchSecond({ location: v }); }
  linkListener(): boolean { return this.second()?.linkListener ?? true; }
  wssListener(): boolean { return this.second()?.wssListener ?? false; }
  get advertisedName(): string { return this.second()?.advertisedName ?? ''; }
  set advertisedName(v: string) { this.patchSecond({ advertisedName: v }); }

  /** Shallow "created" state for the second router — reveals its saved panel. */
  saved(): boolean { return this.second()?.saved ?? false; }

  // ── Add / remove the second router ────────────────────────────────────────
  addSecondRouter(): void { this.state.addRouter(); }

  removeSecondRouter(): void {
    const s = this.second();
    if (s) this.state.removeRouter(s.id);
  }

  // ── Second-router field editing ───────────────────────────────────────────
  onAttributeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    const raw = this.attributeInput.trim().replace(/,+$/, '');
    if (!raw) return;
    const vals = raw.split(',').map((v) => v.trim()).filter(Boolean);
    this.patchSecond({ attributes: [...new Set([...this.attributes(), ...vals])] });
    this.attributeInput = '';
  }

  removeAttribute(attr: string): void {
    this.patchSecond({ attributes: this.attributes().filter((a) => a !== attr) });
  }

  /** Post-create choice — pick where the second router runs. */
  chooseHosting(type: HostingType): void {
    this.patchSecond({ hostingType: type });
  }

  toggleLinkListener(): void { this.patchSecond({ linkListener: !this.linkListener() }); }
  toggleWssListener(): void { this.patchSecond({ wssListener: !this.wssListener() }); }

  /** Shallow create for the second router — flip its draft to saved to reveal the
   *  registration panel + hosting choice. */
  createRouter(): void {
    if (!this.routerName.trim()) return;
    this.patchSecond({ saved: true });
  }

  openHelp(): void {
    this.drawer.open({
      type: 'onboarding-help',
      data: {
        title: 'About Routers',
        subtitle: 'Concept · Add Router',
        topic: 'router',
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
