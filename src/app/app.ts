import { Component, afterNextRender, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LiveWarmup } from '../lib/features/policy-builder/draft/live-warmup';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  styles: [`:host { display: block; }`]
})
export class App {
  constructor() {
    // Background: warm live's diff side once the page has loaded and is idle.
    const warmup = inject(LiveWarmup);
    afterNextRender(() => warmup.start());
  }
}
