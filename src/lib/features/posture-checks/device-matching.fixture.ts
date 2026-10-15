import type { MatchSampleIdentity } from './device-matching';

/**
 * Display-only multiplier. Matching always runs on the 50-row sample below;
 * headline counts shown in the UI are `sampleCount * DISPLAY_SCALE` so the
 * overview reads like a real 5,000-identity network. Rates are unaffected.
 */
export const DISPLAY_SCALE = 100;

const dev = (id: string, name: string, o: Omit<Partial<MatchSampleIdentity>, 'id' | 'name' | 'kind'> = {}): MatchSampleIdentity =>
  ({ id, name, kind: 'device', hasDeviceRecord: true, ...o });
const svc = (id: string, name: string): MatchSampleIdentity =>
  ({ id, name, kind: 'service', hasDeviceRecord: false });

/**
 * In-scope identities for a connection's device-matching overview. The id-0xx
 * rows reuse real identity ids/names so manual mappings resolve against them.
 * Shape of the sample, on purpose: every identity has an id and name (all a Ziti
 * identity is guaranteed to carry); only a minority are tagged with "serial",
 * some carry other tags ("hostname", "dept") or none — most identities aren't
 * tagged yet. Seven are service identities and five devices have no record at
 * the provider.
 */
export const MATCH_SAMPLE: MatchSampleIdentity[] = [
  dev('id-001', 'laptop-alice',        { tags: { serial: 'C02XK1ALH', hostname: 'LT-ALICE' } }),
  dev('id-003', 'phone-bob'),
  dev('id-004', 'alice@corp.com',      { tags: { hostname: 'LT-ALICE-2' } }),
  dev('id-005', 'kiosk-lobby'),
  dev('id-006', 'laptop-bhatt',        { tags: { hostname: 'LT-BHATT' } }),
  dev('id-007', 'laptop-chen',         { tags: { serial: 'C02YH3CHN', hostname: 'LT-CHEN' } }),
  dev('id-008', 'laptop-dorsey',       { hasDeviceRecord: false }),
  dev('id-009', 'laptop-emeka',        { tags: { hostname: 'LT-EMEKA' } }),
  dev('id-010', 'phone-carla'),
  dev('id-015', 'bob@corp.com'),
  dev('id-016', 'carol@corp.com',      { tags: { hostname: 'LT-CAROL' } }),
  dev('id-017', 'kiosk-reception'),
  dev('id-018', 'kiosk-cafeteria'),
  dev('id-019', 'tablet-warehouse',    { hasDeviceRecord: false }),
  dev('id-020', 'printer-floor2'),
  dev('ms-021', 'laptop-farah',        { tags: { serial: 'C02ZF7FRH', hostname: 'LT-FARAH' } }),
  dev('ms-022', 'laptop-garcia',       { tags: { dept: 'sales' } }),
  dev('ms-023', 'laptop-hughes',       { tags: { hostname: 'LT-HUGHES' } }),
  dev('ms-024', 'laptop-ito'),
  dev('ms-025', 'laptop-jensen',       { tags: { hostname: 'LT-JENSEN' } }),
  dev('ms-026', 'laptop-kowalski',     { hasDeviceRecord: false }),
  dev('ms-027', 'laptop-lin',          { tags: { serial: 'C02QL9LIN', hostname: 'LT-LIN' } }),
  dev('ms-028', 'laptop-moreau'),
  dev('ms-029', 'laptop-new-hire-01',  { hasDeviceRecord: false }),
  dev('ms-030', 'laptop-new-hire-02'),
  dev('ms-031', 'desktop-fin-01',      { tags: { hostname: 'DT-FIN-01', dept: 'finance' } }),
  dev('ms-032', 'desktop-fin-02',      { tags: { hostname: 'DT-FIN-02', dept: 'finance' } }),
  dev('ms-033', 'desktop-fin-03',      { tags: { serial: 'MJ0K4F03', hostname: 'DT-FIN-03' }, hasDeviceRecord: false }),
  dev('ms-034', 'desktop-design-01',   { tags: { hostname: 'DT-DSN-01' } }),
  dev('ms-035', 'desktop-design-02',   { tags: { dept: 'design' } }),
  dev('ms-036', 'phone-dana'),
  dev('ms-037', 'phone-erik'),
  dev('ms-038', 'phone-fiona'),
  dev('ms-039', 'phone-gita',          { tags: { hostname: 'PH-GITA' } }),
  dev('ms-040', 'tablet-field-01'),
  dev('ms-041', 'tablet-field-02'),
  dev('ms-042', 'contractor@vendor.io', { tags: { hostname: 'VND-LT-07' } }),
  dev('ms-043', 'temp@vendor.io'),
  dev('ms-044', 'laptop-nakamura',     { tags: { serial: 'C02RN2NKM', hostname: 'LT-NAKAMURA' } }),
  dev('ms-045', 'laptop-okafor',       { tags: { dept: 'eng' } }),
  dev('ms-046', 'laptop-patel',        { tags: { dept: 'eng' } }),
  dev('ms-047', 'laptop-quinn',        { tags: { hostname: 'LT-QUINN' } }),
  dev('ms-048', 'kiosk-dock'),
  svc('id-002', 'server-prod-01'),
  svc('id-011', 'server-prod-02'),
  svc('id-012', 'server-prod-03'),
  svc('id-013', 'server-stage-01'),
  svc('id-014', 'server-build-01'),
  svc('id-021', 'vm-sandbox-01'),
  svc('ms-049', 'ci-runner-01'),
];
