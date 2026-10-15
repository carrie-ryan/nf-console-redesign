import { Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MockDataService } from '../../shared/services/mock-data.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { providerSpec } from './provider-catalog';
import { joinZitiSide } from './connection-summary';
import { matchIdentity, matchOptionsFor, scaleSummary, summarizeMatches, unmatchedIdentities } from './device-matching';
import { UnmatchedIdentitiesTableComponent } from './unmatched-identities-table.component';
import { DISPLAY_SCALE, MATCH_SAMPLE } from './device-matching.fixture';
import type { ConnectionMode, IdentityMapping } from './provider-connection.models';

/**
 * Device matching overview for one ProviderConnection: under the connection's
 * committed matchKey, how many in-scope Ziti identities join to a provider
 * device and why the rest don't. The key is set in the connection's config,
 * not here. Computed live from MATCH_SAMPLE; counts are scaled by
 * DISPLAY_SCALE for display only.
 *
 * Rendered as the provider detail page's Device matching tab, which heads the page
 * with the connection's name, status and mode.
 *
 * In observe mode the same numbers are framed as a dry run ("would match" /
 * "would not match"); only wording and the observe banner differ by mode.
 */
@Component({
  selector: 'app-device-matching-overview',
  standalone: true,
  imports: [RouterLink, DecimalPipe, EmptyStateComponent, UnmatchedIdentitiesTableComponent],
  templateUrl: './device-matching-overview.component.html',
  styleUrl: './device-matching-overview.component.css',
})
export class DeviceMatchingOverviewComponent {
  private readonly data = inject(MockDataService);

  /** The connection's id. */
  readonly id = input.required<string>();

  readonly displayScale = DISPLAY_SCALE;

  readonly connection = computed(() => this.data.providerConnections().find(c => c.id === this.id()));
  readonly providerLabel = computed(() => {
    const conn = this.connection();
    return conn ? providerSpec(conn.providerType)?.label ?? conn.providerType : '';
  });

  /** Observe-mode connection: results are a dry run, so the page reads "would match" / "would not match". */
  readonly observe = computed(() => this.connection()?.mode === 'observe');

  /** The connection's configured key — everything below computes for it. */
  readonly matchKey = computed(() => this.connection()?.matchKey ?? 'identityName');
  /** Tag joined on when matchKey is 'tag'. */
  readonly matchTagKey = computed(() => this.connection()?.matchTagKey);
  private readonly matchOpts = computed(() => matchOptionsFor(this.connection()));
  /** Ziti side of the committed join; null for 'manual'. */
  readonly joinSide = computed(() => joinZitiSide(this.matchKey(), this.matchTagKey()));

  /** Real counts from the sample, then scaled for display. */
  readonly summary = computed(() =>
    scaleSummary(summarizeMatches(MATCH_SAMPLE, this.matchKey(), this.matchOpts()), DISPLAY_SCALE));

  /** The real (unscaled) sample rows that miss under the active strategy. */
  readonly unmatched = computed(() =>
    unmatchedIdentities(MATCH_SAMPLE, this.matchKey(), this.matchOpts()));

  /** Identities matched only because they're pinned (would miss on the key alone), scaled for display. */
  readonly pinnedCount = computed(() => {
    const opts = this.matchOpts();
    if (!opts.manualMappings?.length) return 0;
    const key = this.matchKey();
    const unpinned = { ...opts, manualMappings: [] };
    return MATCH_SAMPLE.filter(i =>
      !matchIdentity(i, key, unpinned).matched && matchIdentity(i, key, opts).matched).length * DISPLAY_SCALE;
  });

  /** For the 'tag' key: the group missing the tag, and whether it's the largest miss. */
  readonly missingAttribute = computed(() => {
    const reasons = this.summary().reasons;
    const group = reasons.find(r => r.reason === 'tag-not-set');
    return group ? { ...group, dominant: group === reasons[0] } : null;
  });

  /** Deliberate observe ↔ enforce flip; affects every check that reads from this connection. */
  setMode(connectionId: string, mode: ConnectionMode): void {
    this.data.providerConnections.update(list => list.map(c => c.id !== connectionId ? c : { ...c, mode }));
  }

  /** Add or replace each mapping in the connection's manualMappings; the summary and table recompute from the signal. */
  mapIdentities(connectionId: string, mappings: IdentityMapping[]): void {
    const ids = new Set(mappings.map(m => m.identityId));
    this.data.providerConnections.update(list => list.map(c => c.id !== connectionId ? c : {
      ...c,
      manualMappings: [...(c.manualMappings ?? []).filter(m => !ids.has(m.identityId)), ...mappings],
    }));
  }
}
