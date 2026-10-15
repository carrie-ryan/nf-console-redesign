/**
 * What the canvas shows, as the legend card's "SHOW ON CANVAS" toggles set it, plus
 * whether the legend card is open. Persisted in this browser (one localStorage key).
 *
 * A layer that is off is hidden everywhere on the canvas — its chips and markers are
 * not rendered — but nothing it would have shown stops being counted: status lines,
 * verdicts and aria-labels read the same.
 *
 * Edges at rest have a default per canvas kind: on, except on a compact canvas (a lane
 * with more than COMPACT_AFTER groups), where only an isolation draws its edges. The
 * choice is remembered per kind, so turning them on at scale doesn't change the default
 * for small canvases, and the reverse.
 */

import { Injectable, signal } from '@angular/core';

export type CanvasLayer = 'posture' | 'hosts' | 'expiry';

interface Saved {
  legendOpen: boolean;
  posture: boolean;
  hosts: boolean;
  expiry: boolean;
  edgesFull: boolean;
  edgesCompact: boolean;
}

export const CANVAS_KEY = 'nf.policyBuilder.canvas';

const DEFAULTS: Saved = { legendOpen: true, posture: true, hosts: true, expiry: true, edgesFull: true, edgesCompact: false };

function read(): Saved {
  try {
    const raw = localStorage.getItem(CANVAS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof Saved)[]) if (typeof parsed[k] === 'boolean') out[k] = parsed[k];
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

@Injectable({ providedIn: 'root' })
export class CanvasLayers {
  private readonly saved = signal<Saved>(read());

  /** The legend card is open (else collapsed to its "Legend" button). */
  readonly legendOpen = () => this.saved().legendOpen;
  /** Shield chips, bypassed chips and "blocked by posture" phrases. */
  readonly posture = () => this.saved().posture;
  /** Host markers (serving / standby / blocked) and hosting-defaults sliders. */
  readonly hosts = () => this.saved().hosts;
  /** Countdown pills on time-limited access. */
  readonly expiry = () => this.saved().expiry;

  layer(l: CanvasLayer): boolean {
    return this.saved()[l];
  }

  /** Edges drawn with nothing isolated, on a compact canvas or a full one. */
  edgesAtRest(compact: boolean): boolean {
    return compact ? this.saved().edgesCompact : this.saved().edgesFull;
  }

  setLegendOpen(open: boolean): void {
    this.write({ legendOpen: open });
  }

  setLayer(l: CanvasLayer, on: boolean): void {
    this.write({ [l]: on });
  }

  setEdgesAtRest(compact: boolean, on: boolean): void {
    this.write(compact ? { edgesCompact: on } : { edgesFull: on });
  }

  private write(patch: Partial<Saved>): void {
    this.saved.update((s) => ({ ...s, ...patch }));
    try {
      localStorage.setItem(CANVAS_KEY, JSON.stringify(this.saved()));
    } catch {
      // no storage: the choice lasts for this page only
    }
  }
}
