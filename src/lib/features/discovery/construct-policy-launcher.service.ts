import { Injectable, computed, signal } from '@angular/core';
import type { SelectedDestination } from './construct-policy-modal.component';

/** What to launch the construct-policy modal with — the pre-shaped per-destination
 *  selection and the flow count for the modal's lede. */
export interface ConstructPolicyLaunch {
  destinations: SelectedDestination[];
  flowCount: number;
}

/**
 * Singleton launcher for the shared ConstructPolicyModalComponent, mounted ONCE
 * at the console shell (next to the app-drawer) — the same providedIn-root +
 * signal pattern as DrawerService.
 *
 * Why a shell-level host rather than launching the modal inside the caller:
 * the flow-detail drawer that triggers "Create service policy" is a
 * `transform: translateX` side panel (its own containing block, z-index 950),
 * so a `position: fixed` modal rendered *inside* it would be clipped into the
 * drawer and sit beneath it. Hosting the modal at the shell — outside the
 * drawer's transformed context — lets the caller close the drawer and open a
 * full-screen modal cleanly. Raw-traffic still launches the modal locally (it
 * isn't inside a transformed ancestor); this service is only the escape hatch
 * for callers that are.
 */
@Injectable({ providedIn: 'root' })
export class ConstructPolicyLauncherService {
  private readonly state = signal<ConstructPolicyLaunch | null>(null);

  /** The pending launch payload, or null when the modal is closed. */
  readonly launch = this.state.asReadonly();
  /** True while the shell-hosted modal is open. */
  readonly isOpen = computed(() => this.state() !== null);

  open(launch: ConstructPolicyLaunch): void {
    this.state.set(launch);
  }

  close(): void {
    this.state.set(null);
  }
}
