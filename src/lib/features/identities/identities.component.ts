import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SlicePipe } from '@angular/common';
import { MockDataService } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

@Component({
  selector: 'app-identities',
  standalone: true,
  imports: [RouterLink, SlicePipe, EmptyStateComponent],
  templateUrl: './identities.component.html',
  styleUrl: './identities.component.css'
})
export class IdentitiesComponent {
  readonly data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);
  readonly openMenuId = signal<string | null>(null);

  toggleMenu(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.update(current => current === id ? null : id);
  }

  closeMenu(): void {
    this.openMenuId.set(null);
  }
}
