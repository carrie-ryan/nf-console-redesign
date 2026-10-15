import { Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { scaleSummary, summarizeMatches, zitiSideCoverage } from './device-matching';
import { DISPLAY_SCALE, MATCH_SAMPLE } from './device-matching.fixture';
import { joinZitiSide } from './connection-summary';
import type { IdentityMapping, MatchKey } from './provider-connection.models';

/**
 * Config-time preview for the connection form's MATCH ON choice: the join it makes,
 * and what's knowable about how identities match — recomputed live as the key or
 * tag name changes. Not shown for 'manual' (the mapping table stands in for it).
 *
 * Before the connection has polled, only Ziti-side facts are known (tag coverage,
 * service identities), so it shows coverage and no rate. Once polled, it shows the
 * full match rate, computed the same way as the device-matching overview.
 * Own component so the create form's stylesheet stays under its size budget.
 */
@Component({
  selector: 'app-match-key-preview',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './match-key-preview.component.html',
  styleUrl: './match-key-preview.component.css',
})
export class MatchKeyPreviewComponent {
  readonly matchKey = input.required<MatchKey>();
  /** Typed tag name; only read when matchKey is 'tag'. */
  readonly matchTagKey = input('');
  readonly providerLabel = input.required<string>();
  /** Whether provider device records exist yet (the connection has tested & polled). */
  readonly polled = input(false);
  /** The connection's saved pins — they match under every key, as on the overview. */
  readonly manualMappings = input<IdentityMapping[]>([]);

  readonly tagKey = computed(() => this.matchTagKey().trim());

  /** Ziti side of the join, or null when there's nothing to preview yet. */
  readonly zitiSide = computed(() => joinZitiSide(this.matchKey(), this.tagKey()));

  /** Sample match outcome under the current key, scaled for display. Only shown whole once polled. */
  readonly summary = computed(() =>
    this.zitiSide() === null ? null
      : scaleSummary(summarizeMatches(MATCH_SAMPLE, this.matchKey(), {
          matchTagKey: this.tagKey(),
          manualMappings: this.manualMappings(),
        }), DISPLAY_SCALE));

  /** The pre-poll view of summary(): Ziti-side reasons only, no rate. */
  readonly coverage = computed(() => {
    const s = this.summary();
    return s ? zitiSideCoverage(s) : null;
  });

  readonly tagMissing = computed(() => this.coverage()?.reasons.find(r => r.reason === 'tag-not-set') ?? null);
  readonly services = computed(() => this.coverage()?.reasons.find(r => r.reason === 'service-identity') ?? null);
}
