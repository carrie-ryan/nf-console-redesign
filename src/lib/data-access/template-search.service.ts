import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { FABRIC_LATENCY_FIXTURE } from './fixtures/fabric-latency.fixture';
import { DIAL_LOGS_FIXTURE } from './fixtures/dial-logs.fixture';
import { UTILIZATION_FIXTURE } from './fixtures/utilization.fixture';

/**
 * Query parameters for the fabric link-latency reporting template
 * (nclinklatency_fabric_latency_v8_tmpl).
 *
 * networkGroupId + networkId are REQUIRED and come from NetworkContextService.
 * The time-range field names below are the Phase 1 best guess — if the
 * /reporting call returns an empty aggregation (rather than a 401), these are
 * the first thing to correct against the template's real contract.
 */
export interface FabricLinkLatencyTemplateQueryParameter {
  networkGroupId: string;
  networkId: string;
  /**
   * OpenSearch index the template runs against. REQUIRED — omitting it makes
   * the reporting API return 400 "Invalid indexName". For fabric latency this
   * is 'nclinklatency'.
   */
  indexName: string;
  /**
   * ES date_histogram bucket size as a duration string, e.g. "1h", "5m".
   * REQUIRED — the template substitutes this into the histogram's
   * fixed_interval; omitting it throws x_content_parse_exception on
   * [fixed_interval]. The real fabric-latency client sends ONLY `interval`
   * (no calendar_interval) for this template.
   */
  interval?: string;
  /**
   * Raw-hit count. Sent as 0 for aggregation-only calls (we want the
   * template's aggregation, not the underlying documents), mirroring the
   * reference client's `size ?? 0` default.
   */
  size?: number;
  /**
   * Terms-aggregation bucket count. REQUIRED — this is the field ES errors on
   * ("[terms] failed to parse field [size]") when the template can't resolve
   * a bucket count. Reference client defaults it to 10.
   */
  aggTermSize?: number;
  /**
   * Start of the window. Param name `gte` per the CC reference. Value is an
   * ISO 8601 string (e.g. 2026-07-08T...Z) — this template rejects epoch ms
   * with "cannot parse empty datetime" and wants ISO, matching the sibling
   * controller-latency v8 template's ISO default.
   */
  gte?: string;
  /** End of the window. See `gte` — same param-name / ISO value-format. */
  lte?: string;
  /**
   * The ACTUAL date-range fields this template reads (gte/lte are decoys for
   * nclinklatency_fabric_latency_v8_tmpl). ISO 8601, SECOND precision with a
   * literal Z (e.g. 2026-07-09T00:00:00Z) — NO milliseconds. Confirmed by the
   * netfoundry-ui fabric-latency component audit.
   */
  dayFilterMin?: string;
  dayFilterMax?: string;
  /** Latency variant — 'mean' | 'max' | 'p99'. */
  latencyType?: string;
  /** Allow additional template-specific params without widening every caller. */
  [key: string]: string | number | boolean | undefined;
}

/**
 * Query parameters for the service-endpoint dial-logs template
 * (ncfabriccircuits_service_endpoint_dial_logs_v8_tmpl).
 *
 * IMPORTANT — this template does NOT follow the fabric-latency conventions
 * (confirmed by the netfoundry-ui `getFabricCircuitTemplateQuery` audit):
 *   • date range is `gte`/`lte` as epoch MILLISECONDS (numbers, via
 *     `startTime.valueOf()`) — NOT ISO, NOT dayFilterMin/Max.
 *   • `size` is '500' (a raw-hit count) — the response is `hits.hits`, not an
 *     aggregation, so size gates the record count. size:0 would return NOTHING.
 *   • there is NO aggTermSize (no terms aggregation on this template).
 * The endpoint/service/identity fields are optional filters — omitted here to
 * pull ALL dial logs for the network.
 */
export interface FabricCircuitTemplateQueryParameter {
  indexName: string;
  networkGroupId: string;
  networkId: string;
  /** Epoch milliseconds. */
  gte?: number;
  /** Epoch milliseconds. */
  lte?: number;
  /** Raw-hit count as a string, e.g. '500'. */
  size?: string;
  endpointId?: string;
  serviceId?: string;
  serviceName?: string;
  endpointName?: string;
  identity_name?: string;
  networkEventType?: string;
  /** Allow additional template-specific params without widening every caller. */
  [key: string]: string | number | boolean | undefined;
}

/**
 * Raw `_source` of one ncfabriccircuits dial-log hit, as the reporting
 * template returns it (snake_case, mixed field presence). This is the wire
 * shape; the parser (`parseDialLogs`) maps it to the camelCase `DialLogRecord`
 * the UI consumes. Fields mirror the ones the CloudZiti dial-log decoder
 * actually reads — successful dials omit `failure_cause`.
 */
export interface DialLogHitSource {
  /** ISO-8601 timestamp of the circuit event. */
  timestamp: string;
  /** Circuit event type: 'dialed' (success), 'failed', 'pathUpdated', … */
  network_event_type: string;
  /** Ziti name of the terminator (hosting) side of the circuit. */
  host_name?: string;
  /** Ziti name of the dialing identity (client) side of the circuit. */
  endpoint_name?: string;
  service_id?: string;
  service_name?: string;
  /** Address the terminator was configured to forward to ("host:port"). */
  terminator_remote_addr?: string;
  /** Router/terminator failure code on failed events (e.g. NO_TERMINATORS). */
  failure_cause?: string;
  port?: number;
  url?: string;
}

/** OpenSearch `hits.hits` envelope for the dial-logs template search. */
export interface DialLogTemplateResponse {
  took?: number;
  timed_out?: boolean;
  hits: {
    hits: { _source: DialLogHitSource }[];
    total: { value: number };
  };
}

/**
 * One decoded dial-log record — the camelCase shape the drawer binds to.
 * `success` is derived from `networkEventType` ('dialed' → true, 'failed' →
 * false, anything else → undefined so state-only events don't count as
 * either). All other fields carry through from the raw `_source`.
 */
export interface DialLogRecord {
  /** Epoch milliseconds (parsed from the raw ISO `timestamp`). */
  timestampMs: number;
  success?: boolean;
  networkEventType: string;
  hostName?: string;
  endpointName?: string;
  serviceId?: string;
  serviceName?: string;
  terminatorRemote?: string;
  failureCause?: string;
  port?: number;
  url?: string;
}

/**
 * Response shape of the nclinklatency_fabric_latency_v8_tmpl template search.
 *
 * A standard OpenSearch template-search body: `hits` is empty (this is an
 * aggregation-only query, size:0) and the real payload lives under
 * `aggregations.links`. The nesting mirrors the template's aggregation tree:
 *   links → source_routers → destination_routers → intervals (date_histogram)
 * and each interval bucket carries the metric under `latency.value`.
 *
 * IMPORTANT: `latency.value` is in NANOSECONDS. The chart wants milliseconds,
 * so the parser below divides by 1e6.
 */
export interface FabricLatencyIntervalBucket {
  /** ISO 8601 hour, e.g. 2026-07-12T00:00:00Z. */
  key_as_string: string;
  /** Epoch milliseconds for the same instant. */
  key: number;
  /** Mean/max/p99 latency for the hour, in NANOSECONDS. */
  latency: { value: number };
}

export interface FabricLatencyDestinationRouterBucket {
  /** Destination router name. */
  key: string;
  intervals: { buckets: FabricLatencyIntervalBucket[] };
}

export interface FabricLatencySourceRouterBucket {
  /** Source router name. */
  key: string;
  destination_routers: { buckets: FabricLatencyDestinationRouterBucket[] };
}

export interface FabricLatencyLinkBucket {
  /** Link key (the fabric link identifier). */
  key: string;
  source_routers: { buckets: FabricLatencySourceRouterBucket[] };
}

export interface FabricLatencyTemplateResponse {
  took: number;
  timed_out: boolean;
  _shards: {
    total: number;
    successful: number;
    skipped: number;
    failed: number;
  };
  hits: { hits: unknown[]; total: { value: number } };
  aggregations: {
    links: { buckets: FabricLatencyLinkBucket[] };
  };
}

/**
 * One rendered series for the fabric-latency chart: a single source→dest path
 * on one link, with its hourly latency samples already converted to
 * MILLISECONDS. This is the shape the component binds to — the parser flattens
 * the nested aggregation tree into a flat list of these leaves (one per
 * link × source × dest), so a two-link fixture yields the two-series view.
 */
export interface FabricLatencySeries {
  linkKey: string;
  sourceRouter: string;
  destinationRouter: string;
  /** Hourly latency samples in MILLISECONDS (raw ns ÷ 1e6). */
  latenciesMs: number[];
}

/**
 * ⚠️ INFERRED / POC — see utilization.fixture.ts. The ncutilization index has
 * never been queried live from this project; these shapes are a reasonable
 * guess to unblock the Insights "High Utilization" panel and MUST be verified
 * (and corrected together with the fixture + parser) once live access lands.
 *
 * Query parameters for the (inferred) entity-utilization template. indexName
 * is 'ncutilization'; networkGroupId + networkId come from NetworkContextService.
 */
export interface UtilizationTemplateQueryParameter {
  indexName: string;
  networkGroupId: string;
  networkId: string;
  size?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Raw `_source` of one inferred ncutilization hit. usage/capacity are raw
 * counters (e.g. Mbps, connections, sessions — units TBD); the utilization %
 * is DERIVED by the parser, not returned pre-computed.
 */
export interface UtilizationHitSource {
  entity_name: string;
  /** 'service' | 'identity' | 'router' — inferred enumeration. */
  entity_type: string;
  usage: number;
  capacity: number;
}

/** Inferred hits.hits envelope for the ncutilization template search. */
export interface UtilizationTemplateResponse {
  took?: number;
  timed_out?: boolean;
  hits: {
    hits: { _source: UtilizationHitSource }[];
    total: { value: number };
  };
}

/** Entity utilization types the UI recognizes. */
export type UtilizationEntityType = 'service' | 'identity' | 'router';

/**
 * One decoded utilization record — the camelCase shape the panel binds to.
 * `utilizationPct` is derived (usage / capacity × 100, rounded). `entityType`
 * is narrowed to the known set; anything unrecognized falls back to 'service'.
 */
export interface UtilizationRecord {
  entityName: string;
  entityType: UtilizationEntityType;
  utilizationPct: number;
}

/**
 * Data-source mode for the reporting-backed metrics.
 *   • 'fixture' — return the canned, real-shaped fixture (no network call),
 *     run through the SAME parser as live data. Default for now.
 *   • 'live'    — hit the real /reporting template-search endpoint.
 * Flipping this one field is the entire fixture→live cutover.
 */
export type TemplateSearchMode = 'fixture' | 'live';

/**
 * Tier 1 / reporting dialect — the analytics gateway at /reporting/v1/*.
 *
 * A "template search" runs a named, server-side OpenSearch template and
 * returns its aggregation. Unlike Tier 2 this is NOT HATEOAS: every param is
 * a flat query-string value and the response is a template-shaped aggregation
 * body (parsed later, in Phase 3 — not here).
 */
@Injectable({ providedIn: 'root' })
export class TemplateSearchService {
  private readonly http = inject(HttpClient);

  /**
   * Data-source mode. Defaults to 'fixture' so the render pipeline is exercised
   * against the real response shape with no live network. Flip to 'live' to
   * cut over to the real /reporting call — this is the one flag.
   */
  mode: TemplateSearchMode = 'fixture';

  /**
   * Fabric link-latency for the chart, as parsed per-link ms series.
   *
   * In 'fixture' mode this emits the canned fixture (wrapped in an Observable
   * exactly like the http call would be); in 'live' mode it runs the real
   * template search. EITHER WAY the response goes through the SAME parser, so
   * fixture mode proves the live parse path end-to-end.
   */
  getFabricLatency(
    params: FabricLinkLatencyTemplateQueryParameter,
  ): Observable<FabricLatencySeries[]> {
    const response$: Observable<unknown> =
      this.mode === 'fixture'
        ? of(FABRIC_LATENCY_FIXTURE)
        : this.apiTemplateSearch(
            'nclinklatency_fabric_latency_v8_tmpl',
            params,
          );

    return response$.pipe(
      map((res) => this.parseFabricLatency(res as FabricLatencyTemplateResponse)),
    );
  }

  /**
   * Flatten a fabric-latency template response into per-link ms series.
   *
   * Walks aggregations.links.buckets → source_routers.buckets →
   * destination_routers.buckets → intervals.buckets, emitting one
   * FabricLatencySeries per source→dest leaf with each interval's
   * latency.value converted from NANOSECONDS to milliseconds (÷ 1e6).
   *
   * This is the real parser — it runs against live data unchanged.
   */
  parseFabricLatency(
    response: FabricLatencyTemplateResponse,
  ): FabricLatencySeries[] {
    const linkBuckets = response?.aggregations?.links?.buckets ?? [];
    const series: FabricLatencySeries[] = [];

    for (const link of linkBuckets) {
      for (const source of link.source_routers?.buckets ?? []) {
        for (const dest of source.destination_routers?.buckets ?? []) {
          const latenciesMs = (dest.intervals?.buckets ?? []).map(
            (interval) => interval.latency.value / 1e6,
          );
          series.push({
            linkKey: link.key,
            sourceRouter: source.key,
            destinationRouter: dest.key,
            latenciesMs,
          });
        }
      }
    }

    return series;
  }

  /**
   * Dial logs for the drawer, as parsed DialLogRecord[].
   *
   * Same fixture/live cutover as getFabricLatency: 'fixture' mode emits the
   * canned ncfabriccircuits response, 'live' mode runs the real template
   * search. Both paths run through the SAME parser (`parseDialLogs`), so
   * fixture mode exercises the live hits.hits → DialLogRecord parse end-to-end.
   */
  getDialLogs(
    params: FabricCircuitTemplateQueryParameter,
  ): Observable<DialLogRecord[]> {
    const response$: Observable<unknown> =
      this.mode === 'fixture'
        ? of(DIAL_LOGS_FIXTURE)
        : this.apiTemplateSearch(
            'ncfabriccircuits_service_endpoint_dial_logs_v8_tmpl',
            params,
          );

    return response$.pipe(
      map((res) => this.parseDialLogs(res as DialLogTemplateResponse)),
    );
  }

  /**
   * Map an ncfabriccircuits template response's hits.hits → DialLogRecord[].
   *
   * Each hit's `_source` (snake_case wire shape) becomes one camelCase record.
   * `success` is derived from `network_event_type`: 'dialed' → true, 'failed'
   * → false, anything else → undefined (state-only events count as neither).
   * The raw ISO `timestamp` is parsed to epoch ms once here so downstream
   * grouping/sorting is pure arithmetic. This is the real parser — it runs
   * against live data unchanged.
   */
  parseDialLogs(response: DialLogTemplateResponse): DialLogRecord[] {
    const hits = response?.hits?.hits ?? [];
    return hits.map((hit) => {
      const s = hit._source;
      const net = s.network_event_type;
      const success =
        net === 'dialed' ? true : net === 'failed' ? false : undefined;
      return {
        timestampMs: Date.parse(s.timestamp),
        success,
        networkEventType: net,
        hostName: s.host_name,
        endpointName: s.endpoint_name,
        serviceId: s.service_id,
        serviceName: s.service_name,
        terminatorRemote: s.terminator_remote_addr,
        failureCause: s.failure_cause,
        port: s.port,
        url: s.url,
      };
    });
  }

  /**
   * ⚠️ INFERRED / POC — entity utilization for the Insights "High Utilization"
   * panel, as parsed UtilizationRecord[]. Same fixture/live cutover as the
   * siblings: 'fixture' mode emits the canned (inferred) ncutilization response,
   * 'live' mode would run the real template search. Both paths run through the
   * SAME parser. The template name is a GUESS — correct it against the real
   * ncutilization contract when live access is available.
   */
  getUtilization(
    params: UtilizationTemplateQueryParameter,
  ): Observable<UtilizationRecord[]> {
    const response$: Observable<unknown> =
      this.mode === 'fixture'
        ? of(UTILIZATION_FIXTURE)
        : this.apiTemplateSearch(
            'ncutilization_entity_usage_v8_tmpl',
            params,
          );

    return response$.pipe(
      map((res) => this.parseUtilization(res as UtilizationTemplateResponse)),
    );
  }

  /**
   * Map an (inferred) ncutilization response's hits.hits → UtilizationRecord[].
   *
   * Each hit's `_source` becomes one record with the utilization % derived as
   * usage / capacity × 100 (rounded; guarded against a zero/absent capacity).
   * `entity_type` is narrowed to the known set, defaulting to 'service' for any
   * unrecognized value. INFERRED parser — verify against live data.
   */
  parseUtilization(response: UtilizationTemplateResponse): UtilizationRecord[] {
    const hits = response?.hits?.hits ?? [];
    return hits.map((hit) => {
      const s = hit._source;
      const cap = s.capacity > 0 ? s.capacity : 0;
      const pct = cap > 0 ? Math.round((s.usage / cap) * 100) : 0;
      const entityType: UtilizationEntityType =
        s.entity_type === 'identity' || s.entity_type === 'router'
          ? s.entity_type
          : 'service';
      return {
        entityName: s.entity_name,
        entityType,
        utilizationPct: pct,
      };
    });
  }

  /**
   * GET /reporting/v1/template-search/{templateName} with every field of
   * `params` flattened onto the query string. Headers are intentionally empty
   * — the auth interceptor attaches the bearer for /reporting calls.
   */
  apiTemplateSearch(
    templateName: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Observable<unknown> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      httpParams = httpParams.set(key, String(value));
    }

    const path = `/reporting/v1/template-search/${templateName}`;
    // Log the fully-flattened request URL so we can see EXACTLY which params
    // made it onto the query string (walking the server's required-param list).
    console.log(
      '[template-search] apiTemplateSearch final URL:',
      `${path}?${httpParams.toString()}`,
    );
    console.log(
      '[template-search] apiTemplateSearch emitted param keys:',
      httpParams.keys(),
    );

    return this.http.get<unknown>(path, {
      params: httpParams,
      headers: new HttpHeaders(),
    });
  }
}
