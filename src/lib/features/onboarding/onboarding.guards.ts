import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { OnboardingStateService } from './onboarding-state.service';

/**
 * Console shell guard: while the network is not yet set up, take the user to the
 * focused onboarding flow instead of the normal console.
 */
export const requireOnboarded: CanMatchFn = () => {
  const data = inject(MockDataService);
  const router = inject(Router);
  return data.isOnboarded() ? true : router.parseUrl('/onboarding');
};

/**
 * Onboarding guard: once the network is set up, the flow is done — send the user
 * on to the dashboard rather than back into setup.
 */
export const requireNotOnboarded: CanMatchFn = () => {
  const data = inject(MockDataService);
  const router = inject(Router);
  return data.isOnboarded() ? router.parseUrl('/dashboard') : true;
};

/**
 * /policy guard: the unified Policy step exists only when the visibility rule
 * holds — advanced branch AND (no service attributes OR at least one policy
 * already created). Otherwise send the user straight to Verify. Covers deep-link,
 * back-button, and refresh entry when Policy isn't part of the flow; live changes
 * made while already on the step are handled reactively in the component.
 */
export const requirePolicyStep: CanMatchFn = () => {
  const state = inject(OnboardingStateService);
  const router = inject(Router);
  return state.showPolicyStep() ? true : router.parseUrl('/onboarding/verify');
};
