import { Directive, ElementRef, afterNextRender, inject, output, DestroyRef } from '@angular/core';

/**
 * Emits `appInView` once, when its element first comes within 300px of the viewport
 * — so a long list computes per-row data for the rows someone can see. Where
 * IntersectionObserver isn't available (tests, old browsers) it emits at once.
 */
@Directive({ selector: '[appInView]', standalone: true })
export class InViewDirective {
  readonly appInView = output<void>();

  constructor() {
    const el = inject(ElementRef<HTMLElement>);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        this.appInView.emit();
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            this.appInView.emit();
            io.disconnect();
          }
        },
        { rootMargin: '300px 0px' },
      );
      io.observe(el.nativeElement);
      destroyRef.onDestroy(() => io.disconnect());
    });
  }
}
