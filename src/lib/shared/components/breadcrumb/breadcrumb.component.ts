import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { MockDataService } from '../../services/mock-data.service';

interface Crumb {
  label: string;
  tooltip: string | null;
  path: string;
  isLast: boolean;
}

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './breadcrumb.component.html',
  styleUrl: './breadcrumb.component.css'
})
export class BreadcrumbComponent {
  private router = inject(Router);
  private data = inject(MockDataService);

  private url = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(e => (e as NavigationEnd).urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  crumbs = computed<Crumb[]>(() => {
    const parts = this.url().split(/[?#]/)[0].split('/').filter(Boolean);
    const result: Crumb[] = [
      { label: 'Network', tooltip: null, path: '/dashboard', isLast: parts.length === 0 }
    ];
    let cumulativePath = '';
    parts.forEach((part, i) => {
      cumulativePath += '/' + part;
      const named = this.namedLabel(parts, i);
      const isLong = !named && part.length > 12;
      result.push({
        label: named ?? (isLong ? part.slice(0, 12) + '…' : this.prettify(part)),
        tooltip: isLong ? part : null,
        path: cumulativePath,
        isLast: i === parts.length - 1,
      });
    });
    return result;
  });

  /** A segment whose crumb isn't its prettified text: a fixed label, or an id resolved to its name. */
  private namedLabel(parts: string[], i: number): string | null {
    if (parts[i] === 'external-providers') return 'External providers';
    if (parts[i - 1] === 'external-providers') {
      if (parts[i] === 'new') return 'New provider';
      return this.data.providerConnections().find(c => c.id === parts[i])?.name ?? null;
    }
    return null;
  }

  private prettify(s: string): string {
    return s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
}
