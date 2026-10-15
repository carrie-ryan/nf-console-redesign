import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppHeaderComponent } from '../app-header/app-header.component';
import { SideNavComponent } from '../side-nav/side-nav.component';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb.component';
import { AppDrawerComponent } from '../app-drawer/app-drawer.component';
import { ToastComponent } from '../toast/toast.component';
import { ToastService } from '../../services/toast.service';
import { ConstructPolicyModalComponent } from '../../../features/discovery/construct-policy-modal.component';
import { ConstructPolicyLauncherService } from '../../../features/discovery/construct-policy-launcher.service';

@Component({
  selector: 'app-console-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    AppHeaderComponent,
    SideNavComponent,
    BreadcrumbComponent,
    AppDrawerComponent,
    ConstructPolicyModalComponent,
    ToastComponent,
  ],
  templateUrl: './console-shell.component.html',
  styleUrl: './console-shell.component.css'
})
export class ConsoleShellComponent {
  /** Shell-hosted construct-policy modal — opened by callers inside transformed
   *  contexts (the flow-detail drawer) that can't host a fixed modal themselves. */
  readonly policyLauncher = inject(ConstructPolicyLauncherService);
  /** App-wide toast (see ToastService) — hosted here so it outlives route changes. */
  readonly toasts = inject(ToastService);
}
