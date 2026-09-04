import type { UtilizationTemplateResponse } from '../template-search.service';

/**
 * ⚠️ INFERRED / POC FIXTURE — the ncutilization index/template has NEVER been
 * queried live from this project. This shape is a REASONABLE GUESS at an
 * ncutilization entity-usage response, built so the Insights "High Utilization"
 * panel can be developed end-to-end before live access lands.
 *
 * VERIFY WHEN LIVE ACCESS IS AVAILABLE — the following are assumptions:
 *   • envelope is a plain hits.hits list (mirroring the ncfabriccircuits
 *     dial-logs template), NOT an aggregation body.
 *   • each _source carries entity_name, entity_type ('service'|'identity'
 *     |'router'), and raw usage + capacity numbers; utilization % is DERIVED
 *     (usage / capacity) by the parser, not returned pre-computed.
 * If the real template differs (e.g. returns a terms aggregation, or a
 * pre-computed pct), correct this fixture + parseUtilization together.
 *
 * DATA: a deliberate mix of all three entity types with several entities OVER
 * the 80% concern threshold and several under, so the threshold filter is
 * visibly excluding the healthy ones. `phone-bob` sits at EXACTLY 80% to prove
 * the filter is strictly greater-than.
 *
 * DEPTH: there are 13 entities OVER the 80% threshold — deliberately MORE than
 * the panel's top-N cap (UTILIZATION_TOP_N = 10) — so the panel shows the top 10
 * and the "Show more" drawer surfaces the full 13. (Latency and health have no
 * such depth in their fixtures, so they get no "Show more".)
 */
export const UTILIZATION_FIXTURE: UtilizationTemplateResponse = {
  took: 31,
  timed_out: false,
  hits: {
    total: { value: 17 },
    hits: [
      // ── over threshold (surface as concerns, all three types) — 13 total,
      //    exceeding the top-N cap of 10 so the panel has depth. ──
      { _source: { entity_name: 'auth-service',        entity_type: 'service',  usage: 97,  capacity: 100 } },  // 97%
      { _source: { entity_name: 'app-api-prod',        entity_type: 'service',  usage: 470, capacity: 500 } },  // 94%
      { _source: { entity_name: 'eu-west-edge-01',     entity_type: 'router',   usage: 910, capacity: 1000 } }, // 91%
      { _source: { entity_name: 'vpn-gateway-eu',      entity_type: 'router',   usage: 900, capacity: 1000 } }, // 90%
      { _source: { entity_name: 'postgres-db',         entity_type: 'service',  usage: 88,  capacity: 100 } },  // 88%
      { _source: { entity_name: 'db-replica-2',        entity_type: 'service',  usage: 87,  capacity: 100 } },  // 87%
      { _source: { entity_name: 'laptop-alice',        entity_type: 'identity', usage: 43,  capacity: 50 } },   // 86%
      { _source: { entity_name: 'ci-runner-07',        entity_type: 'identity', usage: 85,  capacity: 100 } },  // 85%
      { _source: { entity_name: 'cache-redis',         entity_type: 'service',  usage: 84,  capacity: 100 } },  // 84%
      { _source: { entity_name: 'us-east-edge-01',     entity_type: 'router',   usage: 415, capacity: 500 } },  // 83%
      // ── the 3 below fall outside the top-10 panel view; visible only in the
      //    "Show more" drawer (worst-first ordering keeps them last). ──
      { _source: { entity_name: 'edge-apac-3',         entity_type: 'router',   usage: 820, capacity: 1000 } }, // 82%
      { _source: { entity_name: 'metrics-collector',   entity_type: 'service',  usage: 81,  capacity: 100 } },  // 81% (svc)
      { _source: { entity_name: 'gitlab-internal',     entity_type: 'service',  usage: 81,  capacity: 100 } },  // 81%
      // ── at threshold exactly (EXCLUDED — filter is strictly > 80) ──
      { _source: { entity_name: 'phone-bob',           entity_type: 'identity', usage: 40,  capacity: 50 } },   // 80%
      // ── under threshold (excluded) ──
      { _source: { entity_name: 'billing-svc',         entity_type: 'service',  usage: 62,  capacity: 100 } },  // 62%
      { _source: { entity_name: 'kiosk-lobby',         entity_type: 'identity', usage: 18,  capacity: 40 } },   // 45%
      { _source: { entity_name: 'ap-southeast-edge-01', entity_type: 'router',  usage: 300, capacity: 1000 } }, // 30%
    ],
  },
};
