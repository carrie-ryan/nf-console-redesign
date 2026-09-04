import { AttachedConfigData } from './onboarding-state.service';

/**
 * Service templates (Part 1 — DATA + TYPES ONLY).
 *
 * A service template describes a pre-fillable ADVANCED service: the config
 * values to seed, plus per-field guidance on whether each value is fixed by the
 * pattern, merely a starting point, or something the user must supply. Later
 * parts add the overlay UI (that reads fieldStates), the pre-fill wiring (that
 * feeds `data` into the advanced form's applyConfigData), and user-saved
 * templates (source: 'user'). This file introduces NO UI and NO wiring.
 *
 * Field keys in `data` / `fieldStates` reuse the AttachedConfigData interface
 * verbatim (imported, never redefined) so a template pre-fills the advanced
 * form's ic_ and h_ fields 1:1 - a mismatched key would silently fail to fill.
 */

/**
 * The seven Ziti config types. Mirrors CONFIG_TYPES in
 * onboarding-service-advanced.component.ts (kept as a standalone type here so
 * this data module doesn't depend on the component). The curated library below
 * only uses 'intercept.v1' and 'host.v1'.
 */
export type ConfigType =
  | 'host.v1'
  | 'host.v2'
  | 'intercept.v1'
  | 'interfaces.v1'
  | 'proxy.v1'
  | 'ziti-tunneler-client.v1'
  | 'ziti-tunneler-server.v1';

/**
 * Per-field disposition within a template:
 *   • 'locked'  — value fixed by the pattern; shown disabled in the overlay.
 *   • 'default' — pre-filled but editable (a sensible starting point).
 *   • 'blank'   — the user must supply it; `data` carries an empty/neutral value.
 * Fields ABSENT from a config's fieldStates map are treated as 'default'.
 */
export type FieldState = 'locked' | 'default' | 'blank';

/** One config a template seeds — a type, the seed values, and per-field states. */
export interface TemplateConfig {
  type: ConfigType;
  /** Seed value for every AttachedConfigData field (full interface). */
  data: AttachedConfigData;
  /**
   * Per-field state. Fields not listed default to 'default' (pre-filled,
   * editable). 'blank' fields carry an empty/neutral value in `data`.
   */
  fieldStates: Partial<Record<keyof AttachedConfigData, FieldState>>;
}

/** Structural guidance for the policies an advanced service typically needs.
 *  DISPLAY-ONLY (Part 5) — attributes are intentionally NOT modeled here; they
 *  are always blank per network. Used by CURATED templates. */
export interface TemplatePolicyShape {
  type: 'service' | 'router' | 'service-edge-router';
  semantic?: string;
  dialBind?: 'Dial' | 'Bind';
}

/**
 * A real policy captured from a completed flow into a USER template (Part 4a) —
 * DISTINCT from TemplatePolicyShape: it carries the actual name + attributes so a
 * user template reproduces the same-network policies on apply (Part 4b), not just
 * structural guidance. `dialBind` mirrors a Service Policy's Dial|Bind extra field.
 */
export interface CapturedPolicy {
  type: 'service' | 'router' | 'service-edge-router';
  name: string;
  semantic: string;
  attrA: string[];
  attrB: string[];
  dialBind?: 'Dial' | 'Bind';
}

/** A curated (Part 1) or user-saved (Part 4) service template. */
export interface ServiceTemplate {
  id: string;
  /** Display name, e.g. "HTTPS Web App". */
  name: string;
  /** One-line description of what the template is for. */
  description: string;
  /** Font Awesome class for the template's icon. */
  icon: string;
  /** Provenance. 'user' templates are captured from a completed flow (Part 4a). */
  source: 'curated' | 'user';
  /** The configs to seed — usually an intercept + a host. For user templates,
   *  the captured AttachedConfigData snapshots. */
  configs: TemplateConfig[];
  /** Service-level pre-fills. Kept minimal; attributes usually blank. */
  serviceDefaults?: { attributes?: string[] };
  /** Structural policy guidance (Part 5 displays these) — CURATED templates. */
  policyShapes?: TemplatePolicyShape[];

  // ── User-template payload (Part 4a). Curated templates leave these undefined. ──
  /** The full-flow policies captured with their real attributes (user templates). */
  capturedPolicies?: CapturedPolicy[];
  /** The captured service's own attributes, if any (user templates). */
  serviceAttributes?: string[];
  /** Epoch millis the user saved the template — for sorting/display. */
  createdAt?: number;
}

/**
 * Neutral seed for every AttachedConfigData field — mirrors the advanced form's
 * blankConfigData(). Each template overrides only the fields the pattern sets;
 * everything else stays at these empty/neutral values (so 'blank' and untouched
 * fields are already correct without per-template repetition).
 */
function seedData(overrides: Partial<AttachedConfigData>): AttachedConfigData {
  return {
    ic_portRanges: '',
    ic_addresses: '',
    ic_allowedSource: '',
    ic_protoTcp: false,
    ic_protoUdp: false,
    ic_sourceIp: '',
    h_protocol: 'tcp',
    h_address: '',
    h_port: null,
    h_forwardProtocol: false,
    h_forwardAddress: false,
    h_forwardPort: false,
    h_allowedSource: '',
    h_forwardTranslations: '',
    h_http_url: '',
    h_http_method: 'GET',
    h_http_status: null,
    h_http_interval: '',
    h_listen_bindEdge: false,
    h_listen_identity: '',
    h_listen_connectTimeout: '',
    h_listen_maxConn: null,
    h_portcheck_address: '',
    h_portcheck_interval: '',
    h_portcheck_timeout: '',
    h_proxy_type: '',
    h_proxy_address: '',
    ...overrides,
  };
}

/** Every curated service usually needs a bind service policy + a router policy;
 *  modeled identically across the curated set (structural guidance only). */
const BIND_AND_ROUTER: TemplatePolicyShape[] = [
  { type: 'service', dialBind: 'Bind' },
  { type: 'router' },
];

/**
 * The curated template library — static, no persistence (mirrors the
 * EXISTING_CONFIGS pattern in the advanced component). Four patterns, each an
 * intercept.v1 + host.v1 pair. The locked/blank split reflects what actually
 * defines each pattern: the well-known port/protocol are locked; the service's
 * intercept address and the backend host address are always the user's to fill.
 */
export const CURATED_TEMPLATES: readonly ServiceTemplate[] = [
  // 1. HTTPS Web App — port 443/TCP is what makes it "HTTPS".
  {
    id: 'tmpl-https-web-app',
    name: 'HTTPS Web App',
    description: 'A web application served over HTTPS on port 443.',
    icon: 'fa-solid fa-globe',
    source: 'curated',
    configs: [
      {
        type: 'intercept.v1',
        data: seedData({ ic_portRanges: '443', ic_protoTcp: true, ic_protoUdp: false }),
        fieldStates: {
          ic_portRanges: 'locked',
          ic_protoTcp: 'locked',
          ic_protoUdp: 'locked',
          ic_addresses: 'blank',
        },
      },
      {
        type: 'host.v1',
        data: seedData({ h_protocol: 'tcp', h_port: 443 }),
        fieldStates: {
          h_protocol: 'locked',
          h_port: 'locked',
          h_address: 'blank',
        },
      },
    ],
    policyShapes: BIND_AND_ROUTER,
  },

  // 2. Generic TCP Service — TCP is fixed, but the port range is the user's
  //    (no standard port). This is the port-BLANK/default counterpart to HTTPS.
  {
    id: 'tmpl-generic-tcp',
    name: 'Generic TCP Service',
    description: 'A plain TCP service on a port range you choose.',
    icon: 'fa-solid fa-plug',
    source: 'curated',
    configs: [
      {
        type: 'intercept.v1',
        // ic_portRanges left '' (DEFAULT — user sets it); ic_addresses BLANK.
        data: seedData({ ic_protoTcp: true }),
        fieldStates: {
          ic_protoTcp: 'locked',
          ic_addresses: 'blank',
        },
      },
      {
        type: 'host.v1',
        // h_port null (BLANK — no standard port); h_address BLANK.
        data: seedData({ h_protocol: 'tcp' }),
        fieldStates: {
          h_protocol: 'locked',
          h_port: 'blank',
          h_address: 'blank',
        },
      },
    ],
    policyShapes: BIND_AND_ROUTER,
  },

  // 3. SSH — port 22/TCP is what makes it SSH.
  {
    id: 'tmpl-ssh',
    name: 'SSH',
    description: 'Secure shell access to a host on port 22.',
    icon: 'fa-solid fa-terminal',
    source: 'curated',
    configs: [
      {
        type: 'intercept.v1',
        data: seedData({ ic_portRanges: '22', ic_protoTcp: true }),
        fieldStates: {
          ic_portRanges: 'locked',
          ic_protoTcp: 'locked',
          ic_addresses: 'blank',
        },
      },
      {
        type: 'host.v1',
        data: seedData({ h_protocol: 'tcp', h_port: 22 }),
        fieldStates: {
          h_protocol: 'locked',
          h_port: 'locked',
          h_address: 'blank',
        },
      },
    ],
    policyShapes: BIND_AND_ROUTER,
  },

  // 4. Database — TCP is fixed, but the port is a DEFAULT (Postgres 5432 seed;
  //    the user may run MySQL 3306, etc.), so it stays editable, not locked.
  {
    id: 'tmpl-database',
    name: 'Database',
    description: 'A TCP database service (defaults to PostgreSQL 5432).',
    icon: 'fa-solid fa-database',
    source: 'curated',
    configs: [
      {
        type: 'intercept.v1',
        // ic_portRanges '5432' is a DEFAULT (not locked) — user may change it.
        data: seedData({ ic_portRanges: '5432', ic_protoTcp: true }),
        fieldStates: {
          ic_protoTcp: 'locked',
          ic_addresses: 'blank',
        },
      },
      {
        type: 'host.v1',
        // h_port 5432 is a DEFAULT (not locked).
        data: seedData({ h_protocol: 'tcp', h_port: 5432 }),
        fieldStates: {
          h_protocol: 'locked',
          h_address: 'blank',
        },
      },
    ],
    policyShapes: BIND_AND_ROUTER,
  },
];
