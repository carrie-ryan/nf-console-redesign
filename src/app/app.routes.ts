import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { ConsoleShellComponent } from '../lib/shared/components/console-shell/console-shell.component';
import { OnboardingShellComponent } from '../lib/features/onboarding/onboarding-shell.component';
import { OnboardingOverviewComponent } from '../lib/features/onboarding/onboarding-overview.component';
import { OnboardingIdentityComponent } from '../lib/features/onboarding/onboarding-identity.component';
import { OnboardingRouterComponent } from '../lib/features/onboarding/onboarding-router.component';
import { OnboardingServiceComponent } from '../lib/features/onboarding/onboarding-service.component';
import { OnboardingPolicyStepComponent } from '../lib/features/onboarding/onboarding-policy-step.component';
import { OnboardingVerifyComponent } from '../lib/features/onboarding/onboarding-verify.component';
import { requireOnboarded, requireNotOnboarded, requirePolicyStep } from '../lib/features/onboarding/onboarding.guards';
import { DashboardComponent } from '../lib/features/dashboard/dashboard.component';
import { IdentitiesComponent } from '../lib/features/identities/identities.component';
import { CreateIdentityComponent } from '../lib/features/identities/create-identity.component';
import { ServicesComponent } from '../lib/features/services/services.component';
import { SelectServiceTypeComponent } from '../lib/features/services/select-service-type.component';
import { CreateSimpleServiceComponent } from '../lib/features/services/create-simple-service.component';
import { CreateAdvancedServiceComponent } from '../lib/features/services/create-advanced-service.component';
import { PoliciesComponent } from '../lib/features/policies/policies.component';
import { CreatePolicyComponent } from '../lib/features/policies/create-policy.component';
import { PolicyBuilderComponent } from '../lib/features/policy-builder/policy-builder.component';
import { PostureChecksComponent } from '../lib/features/posture-checks/posture-checks.component';
import { CreatePostureCheckComponent } from '../lib/features/posture-checks/create-posture-check.component';
import { ExternalProvidersComponent } from '../lib/features/external-providers/external-providers.component';
import { ProviderDetailComponent } from '../lib/features/external-providers/provider-detail.component';
import { AddProviderComponent } from '../lib/features/external-providers/add-provider.component';
import { EditProviderComponent } from '../lib/features/external-providers/edit-provider.component';
import { RoutersComponent } from '../lib/features/routers/routers.component';
import { MetricsOverviewComponent } from '../lib/features/metrics/overview/metrics-overview.component';
import { FabricLatencyComponent } from '../lib/features/metrics/fabric-latency/fabric-latency.component';
import { ControllerLatencyComponent } from '../lib/features/metrics/controller-latency/controller-latency.component';
import { LatencyTimeoutsComponent } from '../lib/features/metrics/latency-timeouts/latency-timeouts.component';
import { TrafficAnalysisComponent } from '../lib/features/metrics/traffic-analysis/traffic-analysis.component';
import { SessionsComponent } from '../lib/features/sessions/sessions.component';
import { SessionDetailComponent } from '../lib/features/sessions/session-detail.component';
import { DialLogsPageComponent } from '../lib/features/dial-logs/dial-logs-page.component';
import { UsersComponent } from '../lib/features/users/users.component';
import { RoleTemplateFormComponent } from '../lib/features/users/role-template-form.component';
import { SegmentViewComponent } from '../lib/features/authorization/segment-view.component';
import { AlertsComponent } from '../lib/features/alerts/alerts.component';
import { AttributeExplorerComponent } from '../lib/features/attribute-explorer/attribute-explorer.component';

export const routes: Routes = [
  // Focused onboarding flow — takes over the full screen (no console nav) until
  // the network is set up. requireNotOnboarded bounces onboarded users out.
  {
    path: 'onboarding',
    component: OnboardingShellComponent,
    canMatch: [requireNotOnboarded],
    children: [
      { path: '',          redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview',  component: OnboardingOverviewComponent },
      { path: 'identity',  component: OnboardingIdentityComponent },
      { path: 'router',    component: OnboardingRouterComponent },
      { path: 'service',   component: OnboardingServiceComponent },
      // Unified Policy step — advanced-only + conditional. requirePolicyStep
      // redirects to verify when the visibility rule doesn't hold (deep-link,
      // back-button, refresh); live changes while on it are handled in-component.
      { path: 'policy',    component: OnboardingPolicyStepComponent, canMatch: [requirePolicyStep] },
      { path: 'verify',    component: OnboardingVerifyComponent },
    ],
  },
  // Normal console — requireOnboarded redirects to /onboarding until setup is done.
  {
    path: '',
    component: ConsoleShellComponent,
    canMatch: [requireOnboarded],
    children: [
      { path: '',                          redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard',                 component: DashboardComponent },
      { path: 'identities',                component: IdentitiesComponent },
      { path: 'identities/new',            component: CreateIdentityComponent },
      { path: 'services',                  component: ServicesComponent },
      { path: 'services/new',              component: SelectServiceTypeComponent },
      { path: 'services/simple',           component: CreateSimpleServiceComponent },
      { path: 'services/advanced',         component: CreateAdvancedServiceComponent },
      { path: 'policies',                  component: PoliciesComponent },
      { path: 'segments',                  component: SegmentViewComponent },
      { path: 'attribute-explorer',        component: AttributeExplorerComponent },
      { path: 'policies/new',              component: CreatePolicyComponent },
      { path: 'policy-builder',            component: PolicyBuilderComponent },
      { path: 'posture-checks',            component: PostureChecksComponent },
      { path: 'posture-checks/new',        component: CreatePostureCheckComponent },
      { path: 'posture-checks/:id/edit',   component: CreatePostureCheckComponent },
      // Connections moved to External providers; the old URLs redirect there.
      { path: 'posture-checks/connections', redirectTo: 'external-providers', pathMatch: 'full' },
      { path: 'posture-checks/connections/:id', redirectTo: 'external-providers/:id', pathMatch: 'full' },
      { path: 'posture-checks/connections/:id/matching', pathMatch: 'full',
        redirectTo: ({ params }) => inject(Router).createUrlTree(['/external-providers', params['id']], { queryParams: { tab: 'matching' } }) },
      { path: 'external-providers',        component: ExternalProvidersComponent },
      // Before :id, so "new" isn't read as a connection id.
      { path: 'external-providers/new',    component: AddProviderComponent },
      { path: 'external-providers/:id',    component: ProviderDetailComponent },
      { path: 'external-providers/:id/edit', component: EditProviderComponent },
      { path: 'integrations',              redirectTo: 'external-providers', pathMatch: 'full' },
      { path: 'routers',                   component: RoutersComponent },
      { path: 'alerts',                    component: AlertsComponent },
      { path: 'sessions',                  component: SessionsComponent },
      { path: 'sessions/:id',              component: SessionDetailComponent },
      // Org administration — console users, roles, invitations (in-page subtabs).
      { path: 'users',                     component: UsersComponent },
      { path: 'users/role-templates/new',  component: RoleTemplateFormComponent },
      // Dial-logs standalone page — hosts the reusable grouped activity table.
      { path: 'dial-logs',                 component: DialLogsPageComponent },
      // Metrics — flat routes, each page owns its own tab bar via MetricsNavComponent
      { path: 'metrics',                   redirectTo: 'metrics/fabric-latency', pathMatch: 'full' },
      { path: 'metrics/overview',          component: MetricsOverviewComponent },
      { path: 'metrics/fabric-latency',    component: FabricLatencyComponent },
      { path: 'metrics/controller-latency',component: ControllerLatencyComponent },
      { path: 'metrics/latency-timeouts',  component: LatencyTimeoutsComponent },
      { path: 'metrics/traffic-analysis',  component: TrafficAnalysisComponent },
    ]
  },
];
