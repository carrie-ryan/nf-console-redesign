import { Component, HostListener, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { UserPrefsService } from '../../services/user-prefs.service';
import { MockDataService } from '../../services/mock-data.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.css'
})
export class AppHeaderComponent {
  userMenuOpen = false;

  private router = inject(Router);
  readonly prefs = inject(UserPrefsService);
  private readonly data = inject(MockDataService);

  toggleUserMenu(): void {
    this.userMenuOpen = !this.userMenuOpen;
  }

  /** Dev-only: clear the onboarded flag, then send the user back through the
   *  onboarding flow. Reset MUST happen before navigating — otherwise the
   *  requireNotOnboarded guard on /onboarding bounces to /dashboard. */
  resetOnboarding(): void {
    this.userMenuOpen = false;
    this.data.isOnboarded.set(false);
    this.router.navigate(['/onboarding']);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('#user-menu-container')) {
      this.userMenuOpen = false;
    }
  }
}
