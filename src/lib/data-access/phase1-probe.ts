import { inject } from '@angular/core';
import { environment } from '../../environments/environment.local';
import { NetworkContextService } from './network-context.service';
import { ManagementApiService } from './management-api.service';
import {
  TemplateSearchService,
  FabricLinkLatencyTemplateQueryParameter,
  FabricCircuitTemplateQueryParameter,
} from './template-search.service';

/**
 * PHASE 1 DIAGNOSTIC — temporary. Wired via provideAppInitializer.
 *
 * Fires ONE raw call against EACH backend dialect to prove both authenticate
 * and return a real body, with no component changes and no aggregation
 * parsing:
 *   • Tier 2 / REST      → ManagementApiService.getEndpointPage()
 *   • Tier 1 / reporting → TemplateSearchService.apiTemplateSearch(fabric latency)
 *
 * Go/no-go: a real body from BOTH means Phases 2–3 are mechanical. If /core
 * works but /reporting 401s, reporting needs a different scope than core —
 * the one thing Phase 0.5 didn't prove. Each error handler below calls that
 * out explicitly in the console.
 */
export function phase1Probe(): void {
  const ctx = inject(NetworkContextService);
  const management = inject(ManagementApiService);
  const templates = inject(TemplateSearchService);

  if (!environment.auth0Token) {
    console.warn(
      '[phase1-probe] environment.local.ts has no auth0Token — skipping both dialect probes.',
    );
    return;
  }

  // ── Tier 2 / REST proof ─────────────────────────────────────────────
  // Endpoints are per-network; getEndpointPage scopes by networkId (query
  // param first, network-scoped path as 404 fallback) and logs which worked.
  management.getEndpointPage(ctx.networkId, { size: 10 }).subscribe({
    // Raw body + which scoping form worked is logged inside getEndpointPage().
    next: () =>
      console.log('[phase1-probe] ✓ /core (Tier 2 / REST) returned a body.'),
    error: (err) => {
      console.error(
        '[phase1-probe] ✗ /core/v3/endpoints FAILED. Status:',
        err?.status,
        err,
      );
      if (err?.status === 401 || err?.status === 403) {
        console.error(
          '[phase1-probe] /core auth rejected — token missing/expired/wrong audience.',
        );
      }
    },
  });

  // ── Tier 1 / reporting proof ────────────────────────────────────────
  // Minimal query: required network coordinates + a basic 24h time range.
  const now = Date.now();
  const startMs = now - 24 * 60 * 60 * 1000;
  // ISO 8601 at SECOND precision with a literal Z (strip toISOString's .000).
  // The fabric-latency template's real date fields (dayFilterMin/Max) want
  // this exact format — 2026-07-09T00:00:00Z, no milliseconds.
  const isoSec = (ms: number) =>
    new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const params: FabricLinkLatencyTemplateQueryParameter = {
    networkGroupId: ctx.networkGroupId,
    networkId: ctx.networkId,
    // REQUIRED — without it the reporting API returns 400 "Invalid indexName".
    indexName: 'nclinklatency',
    // REQUIRED — feeds the date_histogram's fixed_interval. The real
    // fabric-latency client sends ONLY interval (no calendar_interval).
    interval: '1h',
    // size=0: aggregation-only (no raw hits). aggTermSize=500 = terms bucket
    // count, matching the real fabric-latency client.
    size: 0,
    aggTermSize: 500,
    latencyType: 'mean',
    // gte/lte are decoys for THIS template (kept for parity); the date range
    // is actually read from dayFilterMin/dayFilterMax below.
    gte: new Date(startMs).toISOString(),
    lte: new Date(now).toISOString(),
    // The ACTUAL date-range fields, ISO second-precision Z.
    dayFilterMin: isoSec(startMs),
    dayFilterMax: isoSec(now),
  };

  templates
    .apiTemplateSearch('nclinklatency_fabric_latency_v8_tmpl', params)
    .subscribe({
      next: (res) => {
        console.log(
          '[phase1-probe] RAW /reporting template-search response (NOT parsed):',
          res,
        );
        console.log(
          '[phase1-probe] ✓ /reporting (Tier 1) returned a body. If the aggregation ' +
            'is empty, the time-range param names are the first thing to correct.',
        );
      },
      error: (err) => {
        console.error(
          '[phase1-probe] ✗ /reporting/v1/template-search FAILED. Status:',
          err?.status,
          err,
        );
        if (err?.status === 401 || err?.status === 403) {
          console.error(
            '[phase1-probe] /reporting auth rejected while /core may work — ' +
              'reporting likely needs a DIFFERENT scope than core. STOP and report this.',
          );
        }
      },
    });

  // ── Tier 1 / reporting proof #2: dial logs (the drawer's real source) ──
  // Per the netfoundry-ui audit, dial logs uses DIFFERENT conventions than
  // fabric-latency: gte/lte as epoch MS numbers, size='500' (raw hits), and
  // no aggTermSize. Response is hits.hits, not an aggregation.
  const dialParams: FabricCircuitTemplateQueryParameter = {
    indexName: 'ncfabriccircuits',
    networkGroupId: ctx.networkGroupId,
    networkId: ctx.networkId,
    gte: startMs,
    lte: now,
    size: '500',
  };

  templates
    .apiTemplateSearch(
      'ncfabriccircuits_service_endpoint_dial_logs_v8_tmpl',
      dialParams,
    )
    .subscribe({
      next: (res) => {
        const hits = (res as { hits?: { hits?: unknown[] } })?.hits?.hits;
        console.log('[phase1-probe] RAW dial-logs response:', res);
        console.log('[phase1-probe] dial-logs hits.hits length:', hits?.length);
        if (hits?.length) {
          console.log(
            '[phase1-probe] ✓ dial logs returned real records — populated data ' +
              "on the drawer's actual source.",
          );
        } else {
          console.log(
            '[phase1-probe] dial logs returned 0 hits — network has no dial-log ' +
              'data; pivot to fixtures for the UI.',
          );
        }
      },
      error: (err) => {
        console.error(
          '[phase1-probe] ✗ dial-logs template-search FAILED. Status:',
          err?.status,
          err,
        );
      },
    });
}
