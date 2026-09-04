import type { DialLogTemplateResponse } from '../template-search.service';

/**
 * Canned ncfabriccircuits_service_endpoint_dial_logs_v8_tmpl response, matching
 * the REAL template-search shape confirmed in Phase 1: this template is NOT an
 * aggregation — the payload is raw `hits.hits`, each carrying a `_source`
 * dial-circuit record (size:'500' worth of hits in production).
 *
 * 12 records across 3 CloudZiti services so grouping and failure decoding both
 * exercise:
 *   • web-app-prod   — 5 dials, 1 failed (ROUTER_ERR_CONN_REFUSED)
 *   • postgres-db    — 4 dials, 2 failed (ROUTER_ERR_DIAL_TIMED_OUT, NO_TERMINATORS)
 *   • rdp-gateway    — 3 dials, all successful (clean group)
 *
 * Successful dials ('dialed') omit `failure_cause`; failures ('failed') carry a
 * real router/terminator code plus the terminator address they were reaching.
 * Timestamps are ISO-8601 (parsed to epoch ms by parseDialLogs).
 */
export const DIAL_LOGS_FIXTURE: DialLogTemplateResponse = {
  took: 18,
  timed_out: false,
  hits: {
    total: { value: 12 },
    hits: [
      // ── web-app-prod ──────────────────────────────────────────────────
      {
        _source: {
          timestamp: '2026-07-13T14:52:10.000Z',
          network_event_type: 'dialed',
          service_id: 'svc-web-app-prod',
          service_name: 'web-app-prod',
          host_name: 'terminator-aws-usw2-1',
          endpoint_name: 'laptop-carrie',
          terminator_remote_addr: '10.10.0.20:8443',
          port: 8443,
          url: 'web-app-prod',
        },
      },
      {
        _source: {
          timestamp: '2026-07-13T14:41:03.000Z',
          network_event_type: 'dialed',
          service_id: 'svc-web-app-prod',
          service_name: 'web-app-prod',
          host_name: 'terminator-aws-usw2-1',
          endpoint_name: 'laptop-devon',
          terminator_remote_addr: '10.10.0.20:8443',
          port: 8443,
          url: 'web-app-prod',
        },
      },
      {
        _source: {
          timestamp: '2026-07-13T14:28:47.000Z',
          network_event_type: 'failed',
          service_id: 'svc-web-app-prod',
          service_name: 'web-app-prod',
          host_name: 'terminator-aws-usw2-1',
          endpoint_name: 'laptop-priya',
          terminator_remote_addr: '10.10.0.20:8443',
          failure_cause: 'ROUTER_ERR_CONN_REFUSED',
          port: 8443,
          url: 'web-app-prod',
        },
      },
      {
        _source: {
          timestamp: '2026-07-13T13:59:22.000Z',
          network_event_type: 'dialed',
          service_id: 'svc-web-app-prod',
          service_name: 'web-app-prod',
          host_name: 'terminator-aws-usw2-1',
          endpoint_name: 'phone-carrie',
          terminator_remote_addr: '10.10.0.20:8443',
          port: 8443,
          url: 'web-app-prod',
        },
      },
      {
        _source: {
          timestamp: '2026-07-13T13:12:05.000Z',
          network_event_type: 'dialed',
          service_id: 'svc-web-app-prod',
          service_name: 'web-app-prod',
          host_name: 'terminator-aws-usw2-1',
          endpoint_name: 'laptop-devon',
          terminator_remote_addr: '10.10.0.20:8443',
          port: 8443,
          url: 'web-app-prod',
        },
      },

      // ── postgres-db ───────────────────────────────────────────────────
      {
        _source: {
          timestamp: '2026-07-13T14:47:31.000Z',
          network_event_type: 'failed',
          service_id: 'svc-postgres-db',
          service_name: 'postgres-db',
          host_name: 'terminator-dc-nyc-2',
          endpoint_name: 'app-server-01',
          terminator_remote_addr: '10.20.5.11:5432',
          failure_cause: 'ROUTER_ERR_DIAL_TIMED_OUT',
          port: 5432,
          url: 'postgres-db',
        },
      },
      {
        _source: {
          timestamp: '2026-07-13T14:33:18.000Z',
          network_event_type: 'dialed',
          service_id: 'svc-postgres-db',
          service_name: 'postgres-db',
          host_name: 'terminator-dc-nyc-2',
          endpoint_name: 'app-server-01',
          terminator_remote_addr: '10.20.5.11:5432',
          port: 5432,
          url: 'postgres-db',
        },
      },
      {
        _source: {
          timestamp: '2026-07-13T14:05:56.000Z',
          network_event_type: 'failed',
          service_id: 'svc-postgres-db',
          service_name: 'postgres-db',
          endpoint_name: 'app-server-02',
          failure_cause: 'NO_TERMINATORS',
          port: 5432,
          url: 'postgres-db',
        },
      },
      {
        _source: {
          timestamp: '2026-07-13T12:44:09.000Z',
          network_event_type: 'dialed',
          service_id: 'svc-postgres-db',
          service_name: 'postgres-db',
          host_name: 'terminator-dc-nyc-2',
          endpoint_name: 'app-server-02',
          terminator_remote_addr: '10.20.5.11:5432',
          port: 5432,
          url: 'postgres-db',
        },
      },

      // ── rdp-gateway (clean) ───────────────────────────────────────────
      {
        _source: {
          timestamp: '2026-07-13T14:15:44.000Z',
          network_event_type: 'dialed',
          service_id: 'svc-rdp-gateway',
          service_name: 'rdp-gateway',
          host_name: 'terminator-branch-den-1',
          endpoint_name: 'laptop-morgan',
          terminator_remote_addr: '10.30.1.5:3389',
          port: 3389,
          url: 'rdp-gateway',
        },
      },
      {
        _source: {
          timestamp: '2026-07-13T13:38:27.000Z',
          network_event_type: 'dialed',
          service_id: 'svc-rdp-gateway',
          service_name: 'rdp-gateway',
          host_name: 'terminator-branch-den-1',
          endpoint_name: 'laptop-sam',
          terminator_remote_addr: '10.30.1.5:3389',
          port: 3389,
          url: 'rdp-gateway',
        },
      },
      {
        _source: {
          timestamp: '2026-07-13T11:02:13.000Z',
          network_event_type: 'dialed',
          service_id: 'svc-rdp-gateway',
          service_name: 'rdp-gateway',
          host_name: 'terminator-branch-den-1',
          endpoint_name: 'laptop-morgan',
          terminator_remote_addr: '10.30.1.5:3389',
          port: 3389,
          url: 'rdp-gateway',
        },
      },
    ],
  },
};
