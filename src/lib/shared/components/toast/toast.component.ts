import { Component, input, output, OnInit } from '@angular/core';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

@Component({
  selector: 'app-toast',
  standalone: true,
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.css'
})
export class ToastComponent implements OnInit {
  message = input.required<string>();
  variant = input<ToastVariant>('info');
  duration = input<number>(4000);

  dismissed = output<void>();

  private timer?: ReturnType<typeof setTimeout>;

  readonly iconMap: Record<ToastVariant, string> = {
    success: 'fa-solid fa-circle-check',
    error:   'fa-solid fa-circle-xmark',
    warning: 'fa-solid fa-triangle-exclamation',
    info:    'fa-solid fa-circle-info',
  };

  ngOnInit(): void {
    if (this.duration() > 0) {
      this.timer = setTimeout(() => this.dismissed.emit(), this.duration());
    }
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.dismissed.emit();
  }
}
