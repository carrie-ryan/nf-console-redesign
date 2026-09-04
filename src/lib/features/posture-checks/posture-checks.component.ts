import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

@Component({
  selector: 'app-posture-checks',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent],
  templateUrl: './posture-checks.component.html',
  styleUrl: './posture-checks.component.css'
})
export class PostureChecksComponent {
  readonly data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);
  readonly openMenuId = signal<string | null>(null);

  toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.update(current => current === id ? null : id);
  }

  closeMenu(): void {
    this.openMenuId.set(null);
  }
}
