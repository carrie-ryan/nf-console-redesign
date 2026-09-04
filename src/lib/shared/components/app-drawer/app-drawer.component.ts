import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { DrawerService } from '../../services/drawer.service';
import { DialLogsContentComponent } from '../../../features/dial-logs/dial-logs-content.component';
import { OnboardingHelpContentComponent } from '../../../features/onboarding/onboarding-help-content.component';
import { PolicyProvenanceContentComponent } from '../../../features/authorization/policy-provenance-content.component';
import { SegmentProvenanceContentComponent } from '../../../features/authorization/segment-provenance-content.component';
import { ServiceProvenanceContentComponent } from '../../../features/authorization/service-provenance-content.component';
import { FlowDetailContentComponent } from '../../../features/discovery/flow-detail-content.component';
import { ConcernListContentComponent } from '../../../features/dashboard/concern-list-content.component';

/**
 * App-level slide-in drawer (Agora/CC pattern). A single instance mounted at
 * the console shell; content is driven by DrawerService's entityRef rather than
 * routing. Slides in from the right over a backdrop; Esc and backdrop-click
 * close it. The header mirrors CC's side-panel-header structure (back arrow,
 * entity avatar + name + sub-line, close), and the body dispatches on
 * entityRef.type — today only 'service-activity',
 * which hosts the reusable grouped dial-log activity table.
 */
@Component({
  selector: 'app-drawer',
  standalone: true,
  imports: [
    DialLogsContentComponent,
    OnboardingHelpContentComponent,
    PolicyProvenanceContentComponent,
    SegmentProvenanceContentComponent,
    ServiceProvenanceContentComponent,
    FlowDetailContentComponent,
    ConcernListContentComponent,
  ],
  templateUrl: './app-drawer.component.html',
  styleUrl: './app-drawer.component.css',
})
export class AppDrawerComponent {
  private readonly drawer = inject(DrawerService);

  readonly entityRef = this.drawer.entityRef;
  readonly isOpen = this.drawer.isOpen;

  /** Header avatar icon, chosen from the open drawer's type. */
  readonly avatarIcon = computed(() => {
    const ref = this.entityRef();
    switch (ref?.type) {
      case 'onboarding-help':
        return 'fa-solid fa-circle-info';
      case 'policy-provenance':
        return 'fa-solid fa-diagram-project';
      case 'segment-provenance':
        return 'fa-solid fa-diagram-project';
      case 'service-provenance':
        return 'fa-solid fa-cube';
      case 'flow-detail':
        return 'fa-solid fa-share-nodes';
      case 'concern-list':
        return 'fa-solid fa-triangle-exclamation';
      default:
        return 'fa-solid fa-arrow-right-arrow-left';
    }
  });

  /** Back arrow is for a future list↔detail flow; hidden until a list mode
   *  exists. Rendered (per CC's structure) but off by default. */
  readonly showBack = signal(false);

  close(): void {
    this.drawer.close();
  }

  back(): void {
    // no-op until a list mode drives showBack.
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.close();
  }
}
