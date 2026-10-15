import { Injectable, inject } from '@angular/core';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { adminEditOps, terraformOps, type LiveChange } from './draft/live-changes';
import { DemoClock } from './demo-clock';
import { BindingSimulator } from './binding-simulator';
import { ExpiryScheduler } from './expiry-scheduler';
import { ApprovalStore } from './draft/approval.store';

export type DemoScenarioId = 'adminEdit' | 'terraform' | 'clock';

export interface DemoScenario {
  id: DemoScenarioId;
  label: string;
  /** What it does, in a line. */
  detail: string;
  icon: string;
}

export const ADMIN_ACTOR = 'Dana (admin)';
export const TERRAFORM_ACTOR = 'Terraform';

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'adminEdit',
    label: 'Another admin edits users-gitlab',
    detail: `${ADMIN_ACTOR} adds an attribute to its identity roles, in live.`,
    icon: 'fa-user-pen',
  },
  {
    id: 'terraform',
    label: 'Terraform run',
    detail: 'Adds (or removes) the HQ router in servers-public-routers and git-repo-public-routers.',
    icon: 'fa-code',
  },
  {
    id: 'clock',
    label: 'Advance clock 1 hour',
    detail: 'Moves the demo clock: change times use it, and access set to expire by then is removed.',
    icon: 'fa-clock',
  },
];

/**
 * DEMO — changes from outside the builder, on demand: the Demo panel's scenarios.
 * Each edit goes to live through PolicyDraftStore.applyLiveChange under its actor's
 * name, exactly as a real outside change would arrive.
 */
@Injectable({ providedIn: 'root' })
export class DemoControls {
  private readonly store = inject(PolicyDraftStore);
  readonly clock = inject(DemoClock);
  /** Simulated binding after commits ("Hosts bind after commit"). */
  readonly binding = inject(BindingSimulator);
  /** Time-limited access: removals the clock jump makes due. */
  readonly expiry = inject(ExpiryScheduler);
  /** "Require review before commit" and "View as". */
  readonly approval = inject(ApprovalStore);

  /** Runs one scenario; returns the live change it made (for the clock: the expiry it ran, if any). */
  run(id: DemoScenarioId): LiveChange | null {
    switch (id) {
      case 'adminEdit':
        return this.store.applyLiveChange(adminEditOps(this.store.live()), ADMIN_ACTOR);
      case 'terraform':
        return this.store.applyLiveChange(terraformOps(this.store.live()), TERRAFORM_ACTOR);
      case 'clock':
        this.clock.advance();
        this.binding.runDue(); // bindings the jump made due
        return this.expiry.runDue(); // expiries it passed (their unbinding is due BIND_DELAY_MS later)
    }
  }
}
