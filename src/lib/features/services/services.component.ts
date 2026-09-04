import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { PillComponent } from '../../shared/components/pill/pill.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

@Component({
  selector: 'app-services',
  standalone: true,
  imports: [RouterLink, PillComponent, EmptyStateComponent],
  templateUrl: './services.component.html',
  styleUrl: './services.component.css'
})
export class ServicesComponent {
  readonly data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);
  activeTab: 'all' | 'configs' | 'config-types' | 'terminators' = 'all';
}
