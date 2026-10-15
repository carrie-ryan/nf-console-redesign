import { Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { CanvasLayers, type CanvasLayer } from './canvas-layers';
import { LEGEND_SECTIONS, type LegendEntry } from './canvas-legend';
import { DemoClock } from './demo-clock';
import { ExpiryPillComponent } from './expiry-pill.component';

const HOUR = 3_600_000;

/**
 * The canvas LEGEND card (after Customer Connect's Live Audit legend): pinned to the
 * bottom-left of the visible canvas, a "LEGEND" header with ×, small uppercase section
 * headings and compact rows. Each row shows the real chip, marker or line from the
 * canvas (canvas-marks.css) and a short label. By default only entries present on the
 * canvas are listed; "Show all" lists every one (a hidden layer's entries say so).
 *
 * Hovering or focusing a row asks the canvas to isolate what carries it (`entryEnter`
 * / `entryLeave`). "SHOW ON CANVAS" switches the layers (CanvasLayers, persisted).
 * × collapses the card to a "Legend" button in the same corner; that state persists too.
 */
@Component({
  selector: 'app-canvas-legend',
  standalone: true,
  imports: [ExpiryPillComponent],
  templateUrl: './canvas-legend.component.html',
  styleUrls: ['./canvas-marks.css', './canvas-legend.component.css'],
})
export class CanvasLegendComponent {
  protected readonly layers = inject(CanvasLayers);
  private readonly clock = inject(DemoClock);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Every entry, with what the canvas has. */
  readonly entries = input.required<readonly LegendEntry[]>();
  /** A compact canvas: "Edges at rest" defaults off. */
  readonly compact = input(false);

  /** A row was hovered (`focus` false) or focused: isolate what carries it. */
  readonly entryEnter = output<{ id: string; focus: boolean }>();
  readonly entryLeave = output<{ id: string; focus: boolean }>();

  /** "Show all": every entry, not only those on the canvas. */
  readonly showAll = signal(false);

  /** The sections with something to list. */
  readonly sections = computed(() => {
    const all = this.showAll();
    return LEGEND_SECTIONS.map((s) => ({
      ...s,
      entries: this.entries().filter((e) => e.section === s.id && (all || e.present)),
    })).filter((s) => s.entries.length);
  });

  /** Samples for the countdown pills: hours away, and inside the hour (amber). */
  readonly expiryLater = computed(() => new Date(this.clock.nowMs() + 5 * HOUR).toISOString());
  readonly expirySoon = computed(() => new Date(this.clock.nowMs() + 0.5 * HOUR).toISOString());

  readonly toggles: readonly { layer: CanvasLayer; label: string }[] = [
    { layer: 'posture', label: 'Posture details' },
    { layer: 'hosts', label: 'Host markers' },
    { layer: 'expiry', label: 'Expiry pills' },
  ];

  enter(e: LegendEntry, focus: boolean): void {
    if (e.present) this.entryEnter.emit({ id: e.id, focus });
  }

  leave(e: LegendEntry, focus: boolean): void {
    this.entryLeave.emit({ id: e.id, focus });
  }

  setLayer(layer: CanvasLayer, ev: Event): void {
    this.layers.setLayer(layer, (ev.target as HTMLInputElement).checked);
  }

  setEdges(ev: Event): void {
    this.layers.setEdgesAtRest(this.compact(), (ev.target as HTMLInputElement).checked);
  }

  /** × / "Legend": focus follows to the control that replaces the one used. */
  setOpen(open: boolean): void {
    this.layers.setLegendOpen(open);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(open ? '.lg-x' : '.lg-open')?.focus(), {
      injector: this.injector,
    });
  }
}
