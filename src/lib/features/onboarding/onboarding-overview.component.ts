import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { OnboardingStateService } from './onboarding-state.service';

interface RoadmapCard {
  icon: string;
  title: string;
  desc: string;
}

/**
 * First screen of the flow — states the objective + end result, shows a
 * horizontal "Setup Roadmap" so the user sees what's involved up front, then a
 * primary button that advances to step 1 (Create Identity).
 */
@Component({
  selector: 'app-onboarding-overview',
  standalone: true,
  templateUrl: './onboarding-overview.component.html',
  styleUrl: './onboarding-overview.component.css',
})
export class OnboardingOverviewComponent {
  private readonly router = inject(Router);
  readonly state = inject(OnboardingStateService);

  /** Fixed, generic roadmap (Policies stays generic until the branch is chosen). */
  readonly roadmap: RoadmapCard[] = [
    { icon: 'fa-solid fa-user-plus',     title: 'Identity', desc: 'Enroll an identity' },
    { icon: 'fa-solid fa-network-wired', title: 'Router',   desc: 'Add an edge router' },
    { icon: 'fa-solid fa-server',        title: 'Service',  desc: 'Define a service to connect' },
    { icon: 'fa-solid fa-shield-halved', title: 'Policies', desc: 'Authorize the access' },
    { icon: 'fa-solid fa-circle-check',  title: 'Verify',   desc: 'Confirm traffic flows' },
  ];

  start(): void {
    this.state.markComplete('overview');
    this.router.navigate(['/onboarding', 'identity']);
  }
}
