import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { UserPrefsService } from '../../shared/services/user-prefs.service';

@Component({
  selector: 'app-session-detail',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './session-detail.component.html',
  styleUrl: './session-detail.component.css'
})
export class SessionDetailComponent {
  readonly data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly showJson = signal(false);
  readonly copiedField = signal<string | null>(null);

  readonly session = computed(() => {
    const id = this.route.snapshot.paramMap.get('id');
    return this.data.sessions().find(s => s.id === id) ?? null;
  });

  copy(field: string, value: string): void {
    navigator.clipboard.writeText(value).then(() => {
      this.copiedField.set(field);
      setTimeout(() => this.copiedField.set(null), 1500);
    });
  }

  back(): void {
    this.router.navigate(['/sessions']);
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  jsonString(): string {
    const s = this.session();
    return s ? JSON.stringify(s, null, 2) : '';
  }
}
