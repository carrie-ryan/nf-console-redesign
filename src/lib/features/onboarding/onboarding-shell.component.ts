import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingMapComponent } from './onboarding-map.component';
import { AppDrawerComponent } from '../../shared/components/app-drawer/app-drawer.component';

/**
 * Focused, full-screen setup shell. Replaces the normal console nav during
 * onboarding with a left-rail vertical checklist + a content outlet for the
 * Overview and step screens. Modeled on Customer Connect's setup guide.
 */
@Component({
  selector: 'app-onboarding-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, OnboardingMapComponent, AppDrawerComponent],
  templateUrl: './onboarding-shell.component.html',
  styleUrl: './onboarding-shell.component.css',
})
export class OnboardingShellComponent {
  readonly state = inject(OnboardingStateService);
}
