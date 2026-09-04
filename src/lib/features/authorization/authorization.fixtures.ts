/**
 * Fixtures for the DIAL authorization resolver — authored in the EXACT shape the
 * discovery engine produces AFTER approval (see discovery-engine.ts:254-362 and
 * proposed-policy-store materialisation):
 *   • identities tagged  #discovered-group-{eng,plant,admin}
 *   • services   tagged  #discovered-svc-*
 *   • real dial Policies (identityRoles / serviceRoles / semantic / type)
 *
 * These are SEPARATE from MockDataService seed data (whose services carry no
 * attributes) and clearly labeled so they can later be swapped for real
 * post-discovery output without touching the resolver.
 *
 * The set is authored to exercise every resolver path:
 *   • AnyOf full fan-out            — eng→devtools, plant→ot
 *   • AllOf stricter than AnyOf     — admin→secrets requires #mfa-verified too;
 *                                     ops3 lacks it, so the segment is PARTIAL
 *   • '#all' wildcard fan-out       — @break-glass reaches every service
 *   • '@'-ref direct identity match — same break-glass policy targets @breakglass-root
 *   • deliberate isolation ('none') — nothing dials the secrets/ot segments from
 *                                     eng/plant; plant→secrets is 'none'
 *   • bind policy MUST be ignored   — a BIND policy connects plant→secrets; if the
 *                                     resolver wrongly counted it, plant→secrets
 *                                     would flip to 'full'. It must stay 'none'.
 *
 * SECOND INCREMENT — catch-all + zero-edge reasons:
 *   • ungrouped bucket              — break-glass (identity, no #discovered-group-*)
 *                                     and app-api-prod (service, now UNTAGGED) fall
 *                                     into the '#ungrouped' row/column. break-glass→
 *                                     api is a real edge there via '#all'. (Both
 *                                     silently vanished before the catch-all.)
 *   • zeroEdgeReason 'isolated'     — #discovered-group-guest is referenced by a
 *                                     dial policy (so its members ARE matchable),
 *                                     but that policy targets a service role no
 *                                     service carries → zero edges, isolated.
 *   • zeroEdgeReason 'unresolvable' — #discovered-group-legacy is referenced by NO
 *                                     policy at all → nothing could match → gap.
 *   • orphan-unmanaged (attrs: [])  — an untagged identity, lands in '#ungrouped'
 *                                     alongside break-glass; masked at segment
 *                                     level because the bucket has break-glass's
 *                                     real edges (see the task-2 note: reason keys
 *                                     on RESOLVED EDGES, not on carrying attrs).
 */

import type { Identity, Policy, Service } from '../../shared/services/mock-data.service';

/** The segmenting prefixes callers pass to rollUpSegments for this fixture set. */
export const FIXTURE_IDENTITY_SEGMENT_ATTR = '#discovered-group-';
export const FIXTURE_SERVICE_SEGMENT_ATTR = '#discovered-svc-';

const T = '2026-08-01T00:00:00Z';

// ─── identities (post-discovery: tagged with cluster #roles) ──────────────────

export const FIXTURE_IDENTITIES: Identity[] = [
  // Engineering cluster — #discovered-group-eng
  { id: 'auth-eng-1', name: 'eng-ws-anderson', createdAt: T, status: 'online', type: 'device', attributes: ['#discovered-group-eng'] },
  { id: 'auth-eng-2', name: 'eng-ws-bhatt',    createdAt: T, status: 'online', type: 'device', attributes: ['#discovered-group-eng'] },
  { id: 'auth-eng-3', name: 'eng-ws-chen',     createdAt: T, status: 'online', type: 'device', attributes: ['#discovered-group-eng'] },

  // Plant-floor cluster — #discovered-group-plant
  { id: 'auth-plant-1', name: 'plc-gw-line1', createdAt: T, status: 'online', type: 'device', attributes: ['#discovered-group-plant'] },
  { id: 'auth-plant-2', name: 'plc-gw-line2', createdAt: T, status: 'online', type: 'device', attributes: ['#discovered-group-plant'] },
  { id: 'auth-plant-3', name: 'plc-gw-line3', createdAt: T, status: 'online', type: 'device', attributes: ['#discovered-group-plant'] },

  // Admin/ops cluster — #discovered-group-admin. ops1/ops2 also carry #mfa-verified;
  // ops3 does NOT — so an AllOf policy needing both attributes excludes ops3.
  { id: 'auth-admin-1', name: 'admin-ws-ops1', createdAt: T, status: 'online', type: 'user', attributes: ['#discovered-group-admin', '#mfa-verified'] },
  { id: 'auth-admin-2', name: 'admin-ws-ops2', createdAt: T, status: 'online', type: 'user', attributes: ['#discovered-group-admin', '#mfa-verified'] },
  { id: 'auth-admin-3', name: 'admin-ws-ops3', createdAt: T, status: 'online', type: 'user', attributes: ['#discovered-group-admin'] },

  // Break-glass root — UNSEGMENTED (no #discovered-group-*) → lands in '#ungrouped'.
  // It reaches every service via the '@'-ref + '#all' policy below, so the ungrouped
  // IDENTITY segment is NOT zero-edge (its zeroEdgeReason must be null).
  { id: 'auth-breakglass', name: 'breakglass-root', createdAt: T, status: 'online', type: 'user', attributes: [] },

  // ── SECOND INCREMENT fixtures ──

  // 'isolated' segment — #discovered-group-guest. A dial policy references this role
  // (so members ARE matchable), but it targets a service role nothing carries → the
  // whole segment resolves to zero edges. Intentional-looking posture.
  { id: 'auth-guest-1', name: 'guest-kiosk-1', createdAt: T, status: 'online', type: 'device', attributes: ['#discovered-group-guest'] },
  { id: 'auth-guest-2', name: 'guest-kiosk-2', createdAt: T, status: 'online', type: 'device', attributes: ['#discovered-group-guest'] },

  // 'unresolvable' segment — #discovered-group-legacy. NO policy references this role
  // and members are not '@'-referenced → nothing could ever match them (config gap).
  { id: 'auth-legacy-1', name: 'legacy-host-1', createdAt: T, status: 'offline', type: 'device', attributes: ['#discovered-group-legacy'] },
  { id: 'auth-legacy-2', name: 'legacy-host-2', createdAt: T, status: 'offline', type: 'device', attributes: ['#discovered-group-legacy'] },

  // Untagged orphan (attributes: []) — the literal "small untagged identity". Lands
  // in '#ungrouped' with break-glass; unmatchable itself, but the ungrouped bucket
  // stays non-zero because break-glass carries real edges.
  { id: 'auth-orphan', name: 'orphan-unmanaged', createdAt: T, status: 'online', type: 'device', attributes: [] },
];

// ─── services (post-discovery: tagged with #discovered-svc-* roles) ───────────

export const FIXTURE_SERVICES: Service[] = [
  // devtools segment (3)
  { id: 'auth-svc-gitlab',      name: 'gitlab-internal', createdAt: T, status: 'online', protocol: 'tcp',   interceptAddress: 'gitlab.corp:22',      hostAddress: '10.0.1.50:22',   attributes: ['#discovered-svc-devtools'] },
  { id: 'auth-svc-jenkins',     name: 'jenkins',         createdAt: T, status: 'online', protocol: 'http',  interceptAddress: 'jenkins.corp:8080',   hostAddress: '10.0.1.61:8080', attributes: ['#discovered-svc-devtools'] },
  { id: 'auth-svc-artifactory', name: 'artifactory',     createdAt: T, status: 'online', protocol: 'https', interceptAddress: 'artifactory.corp:443', hostAddress: '10.0.1.62:443', attributes: ['#discovered-svc-devtools'] },

  // ot segment (2)
  { id: 'auth-svc-scada',     name: 'scada',     createdAt: T, status: 'online', protocol: 'tcp', interceptAddress: 'scada.plant:502',      hostAddress: '10.70.2.11:502',  attributes: ['#discovered-svc-ot'] },
  { id: 'auth-svc-historian', name: 'historian', createdAt: T, status: 'online', protocol: 'tcp', interceptAddress: 'historian.plant:1433', hostAddress: '10.70.2.14:1433', attributes: ['#discovered-svc-ot'] },

  // secrets segment (1) — the AllOf-gated target
  { id: 'auth-svc-vault', name: 'vault', createdAt: T, status: 'online', protocol: 'https', interceptAddress: 'vault.corp:8200', hostAddress: '10.10.1.20:8200', attributes: ['#discovered-svc-secrets'] },

  // UNTAGGED service (no #discovered-svc-*) → lands in the '#ungrouped' service
  // column. Only the break-glass '#all' reaches it, so break-glass→api is the
  // (#ungrouped identity, #ungrouped service) cell — the pair that vanished before.
  { id: 'auth-svc-api', name: 'app-api-prod', createdAt: T, status: 'online', protocol: 'https', interceptAddress: 'api.corp:443', hostAddress: '10.0.2.10:8443', attributes: [] },
];

// ─── dial policies (+ one bind policy that MUST be ignored) ───────────────────

export const FIXTURE_POLICIES: Policy[] = [
  // 1) AnyOf → eng cluster fully authorized to the devtools segment (3×3 = full).
  {
    id: 'auth-pol-eng-devtools', name: 'dial-eng-devtools', createdAt: T, status: 'active',
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-eng'], serviceRoles: ['#discovered-svc-devtools'], postureCheckRoles: [],
  },

  // 2) AnyOf → plant cluster fully authorized to the ot segment (3×2 = full).
  {
    id: 'auth-pol-plant-ot', name: 'dial-plant-ot', createdAt: T, status: 'active',
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-plant'], serviceRoles: ['#discovered-svc-ot'], postureCheckRoles: [],
  },

  // 3) AllOf → admins WITH MFA reach secrets. Requires BOTH #discovered-group-admin
  //    AND #mfa-verified. ops3 lacks MFA → excluded → admin→secrets is PARTIAL (2/3).
  //    Under AnyOf this same policy would authorize all 3 (each has the group attr).
  {
    id: 'auth-pol-admin-secrets', name: 'dial-admin-mfa-secrets', createdAt: T, status: 'active',
    type: 'dial', semantic: 'AllOf',
    identityRoles: ['#discovered-group-admin', '#mfa-verified'], serviceRoles: ['#discovered-svc-secrets'], postureCheckRoles: [],
  },

  // 4) '@'-ref direct identity match + '#all' service wildcard → break-glass root
  //    dials EVERY service. Exercises both the @-passthrough and #all fan-out.
  {
    id: 'auth-pol-breakglass-all', name: 'dial-breakglass-all', createdAt: T, status: 'active',
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['@breakglass-root'], serviceRoles: ['#all'], postureCheckRoles: [],
  },

  // 5) BIND policy — MUST be ignored by the dial resolver. It connects plant→secrets;
  //    if binds leaked in, plant→secrets would show 'full'. It must stay 'none'.
  {
    id: 'auth-pol-plant-bind-secrets', name: 'bind-plant-secrets', createdAt: T, status: 'active',
    type: 'bind', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-plant'], serviceRoles: ['#discovered-svc-secrets'], postureCheckRoles: [],
  },

  // 6) 'isolated' driver — references the guest role (so guests ARE matchable on the
  //    identity side) but targets '#discovered-svc-nonexistent', a role NO service
  //    carries. Result: guest segment is matchable yet has zero edges → 'isolated'.
  {
    id: 'auth-pol-guest-nowhere', name: 'dial-guest-nowhere', createdAt: T, status: 'active',
    type: 'dial', semantic: 'AnyOf',
    identityRoles: ['#discovered-group-guest'], serviceRoles: ['#discovered-svc-nonexistent'], postureCheckRoles: [],
  },

  // NOTE: there is deliberately NO policy referencing '#discovered-group-legacy' —
  // that absence is what makes the legacy segment 'unresolvable' (nothing matches).
];
