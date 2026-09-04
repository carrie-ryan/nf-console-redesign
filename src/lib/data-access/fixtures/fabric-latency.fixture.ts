import type { FabricLatencyTemplateResponse } from '../template-search.service';

/**
 * Canned nclinklatency_fabric_latency_v8_tmpl response, matching the REAL
 * template-search shape confirmed in Phase 1.
 *
 * It is a genuine OpenSearch aggregation body: `hits` is empty (aggregation-
 * only, size:0) and the payload lives under aggregations.links, nested
 * links → source_routers → destination_routers → intervals.
 *
 * Two links → the component's two-series (link1/link2) view. Each has a single
 * source→dest path with 25 hourly interval buckets (hours 0–24).
 *
 * IMPORTANT: latency.value is in NANOSECONDS. Values here are 3.1M–15.8M ns,
 * i.e. ~3–16ms after the parser divides by 1e6, so the chart (yMax 18) shows
 * plausible millisecond curves. The two links are given slightly different
 * curves so both render distinctly.
 */
export const FABRIC_LATENCY_FIXTURE: FabricLatencyTemplateResponse = {
  took: 42,
  timed_out: false,
  _shards: { total: 5, successful: 5, skipped: 0, failed: 0 },
  hits: { hits: [], total: { value: 0 } },
  aggregations: {
    links: {
      buckets: [
        {
          key: 'link-aws-usw2-er1__carrie-ryan-ctrl',
          source_routers: {
            buckets: [
              {
                key: 'AWS us-west-2 Edge Router 1',
                destination_routers: {
                  buckets: [
                    {
                      key: 'carrie-ryan controller access',
                      intervals: {
                        buckets: [
        { key_as_string: '2026-07-12T00:00:00Z', key: 1783814400000, latency: { value: 7200000 } },
        { key_as_string: '2026-07-12T01:00:00Z', key: 1783818000000, latency: { value: 7100000 } },
        { key_as_string: '2026-07-12T02:00:00Z', key: 1783821600000, latency: { value: 6900000 } },
        { key_as_string: '2026-07-12T03:00:00Z', key: 1783825200000, latency: { value: 7400000 } },
        { key_as_string: '2026-07-12T04:00:00Z', key: 1783828800000, latency: { value: 5100000 } },
        { key_as_string: '2026-07-12T05:00:00Z', key: 1783832400000, latency: { value: 5300000 } },
        { key_as_string: '2026-07-12T06:00:00Z', key: 1783836000000, latency: { value: 4200000 } },
        { key_as_string: '2026-07-12T07:00:00Z', key: 1783839600000, latency: { value: 15800000 } },
        { key_as_string: '2026-07-12T08:00:00Z', key: 1783843200000, latency: { value: 14100000 } },
        { key_as_string: '2026-07-12T09:00:00Z', key: 1783846800000, latency: { value: 13600000 } },
        { key_as_string: '2026-07-12T10:00:00Z', key: 1783850400000, latency: { value: 6200000 } },
        { key_as_string: '2026-07-12T11:00:00Z', key: 1783854000000, latency: { value: 10900000 } },
        { key_as_string: '2026-07-12T12:00:00Z', key: 1783857600000, latency: { value: 4400000 } },
        { key_as_string: '2026-07-12T13:00:00Z', key: 1783861200000, latency: { value: 5000000 } },
        { key_as_string: '2026-07-12T14:00:00Z', key: 1783864800000, latency: { value: 9800000 } },
        { key_as_string: '2026-07-12T15:00:00Z', key: 1783868400000, latency: { value: 10300000 } },
        { key_as_string: '2026-07-12T16:00:00Z', key: 1783872000000, latency: { value: 6100000 } },
        { key_as_string: '2026-07-12T17:00:00Z', key: 1783875600000, latency: { value: 9700000 } },
        { key_as_string: '2026-07-12T18:00:00Z', key: 1783879200000, latency: { value: 8800000 } },
        { key_as_string: '2026-07-12T19:00:00Z', key: 1783882800000, latency: { value: 12400000 } },
        { key_as_string: '2026-07-12T20:00:00Z', key: 1783886400000, latency: { value: 10100000 } },
        { key_as_string: '2026-07-12T21:00:00Z', key: 1783890000000, latency: { value: 11200000 } },
        { key_as_string: '2026-07-12T22:00:00Z', key: 1783893600000, latency: { value: 9900000 } },
        { key_as_string: '2026-07-12T23:00:00Z', key: 1783897200000, latency: { value: 11000000 } },
        { key_as_string: '2026-07-13T00:00:00Z', key: 1783900800000, latency: { value: 15300000 } },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          key: 'link-aws-usw2-er1__us-east-1-ctrl',
          source_routers: {
            buckets: [
              {
                key: 'AWS us-west-2 Edge Router 1',
                destination_routers: {
                  buckets: [
                    {
                      key: 'us-east-1 controller access',
                      intervals: {
                        buckets: [
        { key_as_string: '2026-07-12T00:00:00Z', key: 1783814400000, latency: { value: 5400000 } },
        { key_as_string: '2026-07-12T01:00:00Z', key: 1783818000000, latency: { value: 5600000 } },
        { key_as_string: '2026-07-12T02:00:00Z', key: 1783821600000, latency: { value: 5200000 } },
        { key_as_string: '2026-07-12T03:00:00Z', key: 1783825200000, latency: { value: 5500000 } },
        { key_as_string: '2026-07-12T04:00:00Z', key: 1783828800000, latency: { value: 4100000 } },
        { key_as_string: '2026-07-12T05:00:00Z', key: 1783832400000, latency: { value: 4300000 } },
        { key_as_string: '2026-07-12T06:00:00Z', key: 1783836000000, latency: { value: 3200000 } },
        { key_as_string: '2026-07-12T07:00:00Z', key: 1783839600000, latency: { value: 12700000 } },
        { key_as_string: '2026-07-12T08:00:00Z', key: 1783843200000, latency: { value: 11400000 } },
        { key_as_string: '2026-07-12T09:00:00Z', key: 1783846800000, latency: { value: 11000000 } },
        { key_as_string: '2026-07-12T10:00:00Z', key: 1783850400000, latency: { value: 4800000 } },
        { key_as_string: '2026-07-12T11:00:00Z', key: 1783854000000, latency: { value: 8900000 } },
        { key_as_string: '2026-07-12T12:00:00Z', key: 1783857600000, latency: { value: 3100000 } },
        { key_as_string: '2026-07-12T13:00:00Z', key: 1783861200000, latency: { value: 3600000 } },
        { key_as_string: '2026-07-12T14:00:00Z', key: 1783864800000, latency: { value: 7900000 } },
        { key_as_string: '2026-07-12T15:00:00Z', key: 1783868400000, latency: { value: 8200000 } },
        { key_as_string: '2026-07-12T16:00:00Z', key: 1783872000000, latency: { value: 4700000 } },
        { key_as_string: '2026-07-12T17:00:00Z', key: 1783875600000, latency: { value: 7800000 } },
        { key_as_string: '2026-07-12T18:00:00Z', key: 1783879200000, latency: { value: 7100000 } },
        { key_as_string: '2026-07-12T19:00:00Z', key: 1783882800000, latency: { value: 9900000 } },
        { key_as_string: '2026-07-12T20:00:00Z', key: 1783886400000, latency: { value: 8000000 } },
        { key_as_string: '2026-07-12T21:00:00Z', key: 1783890000000, latency: { value: 8700000 } },
        { key_as_string: '2026-07-12T22:00:00Z', key: 1783893600000, latency: { value: 7800000 } },
        { key_as_string: '2026-07-12T23:00:00Z', key: 1783897200000, latency: { value: 8900000 } },
        { key_as_string: '2026-07-13T00:00:00Z', key: 1783900800000, latency: { value: 12100000 } },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        // ─── POC DUMMY DATA ─────────────────────────────────────────────
        // The two links above peak at ~15-16ms, all under the dashboard's
        // 100ms latency-concern threshold, so the Insights panel would render
        // empty. The two links below are FABRICATED to peak above 100ms
        // (~142ms and ~115ms) so the "High Latency Links" concern panel
        // demonstrably populates and the threshold filter is visibly excluding
        // the healthy links above. Remove once live data is wired.
        {
          key: 'link-aws-euw1-er1__carrie-ryan-ctrl',
          source_routers: {
            buckets: [
              {
                key: 'AWS eu-west-1 Edge Router 1',
                destination_routers: {
                  buckets: [
                    {
                      key: 'carrie-ryan controller access',
                      intervals: {
                        buckets: [
        { key_as_string: '2026-07-12T00:00:00Z', key: 1783814400000, latency: { value: 42000000 } },
        { key_as_string: '2026-07-12T01:00:00Z', key: 1783818000000, latency: { value: 45000000 } },
        { key_as_string: '2026-07-12T02:00:00Z', key: 1783821600000, latency: { value: 41000000 } },
        { key_as_string: '2026-07-12T03:00:00Z', key: 1783825200000, latency: { value: 48000000 } },
        { key_as_string: '2026-07-12T04:00:00Z', key: 1783828800000, latency: { value: 51000000 } },
        { key_as_string: '2026-07-12T05:00:00Z', key: 1783832400000, latency: { value: 55000000 } },
        { key_as_string: '2026-07-12T06:00:00Z', key: 1783836000000, latency: { value: 62000000 } },
        { key_as_string: '2026-07-12T07:00:00Z', key: 1783839600000, latency: { value: 98000000 } },
        { key_as_string: '2026-07-12T08:00:00Z', key: 1783843200000, latency: { value: 142000000 } },
        { key_as_string: '2026-07-12T09:00:00Z', key: 1783846800000, latency: { value: 121000000 } },
        { key_as_string: '2026-07-12T10:00:00Z', key: 1783850400000, latency: { value: 76000000 } },
        { key_as_string: '2026-07-12T11:00:00Z', key: 1783854000000, latency: { value: 88000000 } },
        { key_as_string: '2026-07-12T12:00:00Z', key: 1783857600000, latency: { value: 54000000 } },
        { key_as_string: '2026-07-12T13:00:00Z', key: 1783861200000, latency: { value: 50000000 } },
        { key_as_string: '2026-07-12T14:00:00Z', key: 1783864800000, latency: { value: 69000000 } },
        { key_as_string: '2026-07-12T15:00:00Z', key: 1783868400000, latency: { value: 73000000 } },
        { key_as_string: '2026-07-12T16:00:00Z', key: 1783872000000, latency: { value: 61000000 } },
        { key_as_string: '2026-07-12T17:00:00Z', key: 1783875600000, latency: { value: 67000000 } },
        { key_as_string: '2026-07-12T18:00:00Z', key: 1783879200000, latency: { value: 58000000 } },
        { key_as_string: '2026-07-12T19:00:00Z', key: 1783882800000, latency: { value: 94000000 } },
        { key_as_string: '2026-07-12T20:00:00Z', key: 1783886400000, latency: { value: 71000000 } },
        { key_as_string: '2026-07-12T21:00:00Z', key: 1783890000000, latency: { value: 82000000 } },
        { key_as_string: '2026-07-12T22:00:00Z', key: 1783893600000, latency: { value: 66000000 } },
        { key_as_string: '2026-07-12T23:00:00Z', key: 1783897200000, latency: { value: 79000000 } },
        { key_as_string: '2026-07-13T00:00:00Z', key: 1783900800000, latency: { value: 90000000 } },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          key: 'link-aws-apse1-er1__us-east-1-ctrl',
          source_routers: {
            buckets: [
              {
                key: 'AWS ap-southeast-1 Edge Router 1',
                destination_routers: {
                  buckets: [
                    {
                      key: 'us-east-1 controller access',
                      intervals: {
                        buckets: [
        { key_as_string: '2026-07-12T00:00:00Z', key: 1783814400000, latency: { value: 38000000 } },
        { key_as_string: '2026-07-12T01:00:00Z', key: 1783818000000, latency: { value: 41000000 } },
        { key_as_string: '2026-07-12T02:00:00Z', key: 1783821600000, latency: { value: 39000000 } },
        { key_as_string: '2026-07-12T03:00:00Z', key: 1783825200000, latency: { value: 44000000 } },
        { key_as_string: '2026-07-12T04:00:00Z', key: 1783828800000, latency: { value: 47000000 } },
        { key_as_string: '2026-07-12T05:00:00Z', key: 1783832400000, latency: { value: 52000000 } },
        { key_as_string: '2026-07-12T06:00:00Z', key: 1783836000000, latency: { value: 58000000 } },
        { key_as_string: '2026-07-12T07:00:00Z', key: 1783839600000, latency: { value: 84000000 } },
        { key_as_string: '2026-07-12T08:00:00Z', key: 1783843200000, latency: { value: 115000000 } },
        { key_as_string: '2026-07-12T09:00:00Z', key: 1783846800000, latency: { value: 103000000 } },
        { key_as_string: '2026-07-12T10:00:00Z', key: 1783850400000, latency: { value: 62000000 } },
        { key_as_string: '2026-07-12T11:00:00Z', key: 1783854000000, latency: { value: 71000000 } },
        { key_as_string: '2026-07-12T12:00:00Z', key: 1783857600000, latency: { value: 48000000 } },
        { key_as_string: '2026-07-12T13:00:00Z', key: 1783861200000, latency: { value: 45000000 } },
        { key_as_string: '2026-07-12T14:00:00Z', key: 1783864800000, latency: { value: 59000000 } },
        { key_as_string: '2026-07-12T15:00:00Z', key: 1783868400000, latency: { value: 64000000 } },
        { key_as_string: '2026-07-12T16:00:00Z', key: 1783872000000, latency: { value: 55000000 } },
        { key_as_string: '2026-07-12T17:00:00Z', key: 1783875600000, latency: { value: 60000000 } },
        { key_as_string: '2026-07-12T18:00:00Z', key: 1783879200000, latency: { value: 53000000 } },
        { key_as_string: '2026-07-12T19:00:00Z', key: 1783882800000, latency: { value: 81000000 } },
        { key_as_string: '2026-07-12T20:00:00Z', key: 1783886400000, latency: { value: 63000000 } },
        { key_as_string: '2026-07-12T21:00:00Z', key: 1783890000000, latency: { value: 72000000 } },
        { key_as_string: '2026-07-12T22:00:00Z', key: 1783893600000, latency: { value: 57000000 } },
        { key_as_string: '2026-07-12T23:00:00Z', key: 1783897200000, latency: { value: 69000000 } },
        { key_as_string: '2026-07-13T00:00:00Z', key: 1783900800000, latency: { value: 77000000 } },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        // ─── END POC DUMMY DATA ─────────────────────────────────────────
      ],
    },
  },
};
