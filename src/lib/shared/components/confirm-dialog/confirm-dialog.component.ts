import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.css'
})
export class ConfirmDialogComponent {
  title = input<string>('Confirm');
  message = input<string>('Are you sure?');
  confirmLabel = input<string>('Confirm');
  cancelLabel = input<string>('Cancel');
  danger = input<boolean>(false);

  confirmed = output<void>();
  cancelled = output<void>();
}
