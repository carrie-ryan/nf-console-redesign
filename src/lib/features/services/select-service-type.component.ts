import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-select-service-type',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './select-service-type.component.html',
  styleUrl: './select-service-type.component.css'
})
export class SelectServiceTypeComponent {
  private router = inject(Router);

  selectSimple(): void {
    this.router.navigate(['/services/simple']);
  }

  selectAdvanced(): void {
    this.router.navigate(['/services/advanced']);
  }
}
