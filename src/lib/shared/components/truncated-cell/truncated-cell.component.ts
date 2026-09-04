import { Component, input, signal } from '@angular/core';

@Component({
  selector: 'app-truncated-cell',
  standalone: true,
  templateUrl: './truncated-cell.component.html',
  styleUrl: './truncated-cell.component.css',
  host: { class: 'truncated-cell-host' }
})
export class TruncatedCellComponent {
  readonly value = input.required<string>();
  readonly copied = signal(false);

  copy(event: MouseEvent): void {
    event.stopPropagation();
    navigator.clipboard.writeText(this.value()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }
}
