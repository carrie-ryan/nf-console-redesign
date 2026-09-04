import { Component, input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.css'
})
export class EmptyStateComponent {
  icon = input<string>('fa-solid fa-inbox');
  title = input<string>('Nothing here yet');
  message = input<string>('');
}
