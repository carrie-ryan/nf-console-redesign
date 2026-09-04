/**
 * Discovery → Policy feature — shared data models.
 *
 * The engine that consumes these lives in `discovery-engine.ts` (pure, headless).
 * The signal-backed draft store lives in `proposed-policy-store.service.ts`.
 *
 * NOTHING here pre-decides clusters or policies: `DiscoveredFlow` is raw observed
 * traffic; every cluster/match/proposal type below is an ENGINE OUTPUT, produced
 * by Jaccard math over the flows.
 */

import type { Policy } from '../../shared/services/mock-data.service';

// ─── PART 2: the raw flow model (observed traffic) ────────────────────────────

/**
 * One observed traffic flow from a wildcard-intercepted identity.
 *
 * Precedent: the dial-log record (`DialLogRecord` in template-search.service.ts)
 * is the redesign's existing "circuit" shape. This differs in the one field that
 * matters for wildcard discovery:
 *
 *   • dial-logs carry `terminatorRemote` — the EGRESS address the terminator
 *     forwarded to (host side). That is NOT what the identity asked for.
 *   • `destinationHostPort` here is the INGRESS/intercept address the identity
 *     actually DIALED — the wildcard-discovery signal. This is exactly what
 *     dial-logs lack, and what lets us match against Service.interceptAddress.
 *
 * A single camelCase UI model (no snake_case wire twin) is sufficient for mock;
 * a real backend feed would add a `DiscoveredFlowSource` snake_case twin + parser
 * mirroring the DialLogHitSource → DialLogRecord split.
 */
/**
 * App-level (L7) protocol observed on a flow — the SEMANTIC protocol the wire
 * carried, distinct from the transport `protocol` (tcp/udp) a proposed NF service
 * needs. Populated for display + the Traffic-Analysis Sankey's "Protocol" stage;
 * NOTHING in the policy pipeline reads it (that path keeps using transport
 * `protocol`). Widen this union — never the transport one — when a new observed
 * protocol appears.
 */
export type AppProtocol =
  | 'https' | 'http' | 'ssh' | 'rdp' | 'smb' | 'ldap' | 'kerberos' | 'dns'
  | 'ntp' | 'mssql' | 'postgres' | 'modbus' | 's7' | 'enip' | 'opcua';

export interface DiscoveredFlow {
  id: string;
  /**
   * Ref to a REAL identity in MockDataService.identities when the observed source
   * is enrolled; `null` when it is not. A null id means "observed address only" —
   * the source is an IP (see `ingressIp` / `ingressEntityName`), NOT a principal,
   * and must never become a policy grant. Enrollment truth is the identity lookup
   * (enrolledSourceIds), never the string shape.
   */
  dialingIdentityId: string | null;
  dialingIdentityName: string;
  /** The address the identity DIALED, "host:port" — the intercept side. */
  destinationHostPort: string;
  /**
   * Correlated existing service id, or null. RAW mock leaves this null on
   * purpose — matching is an engine stage (see `matchDestinations`), not
   * something the capture pre-computes. The field exists so a backend feed that
   * arrives pre-correlated can populate it.
   */
  matchedServiceId: string | null;
  /** Circuit count over the window — the volume signal used for ranking. */
  circuitCount: number;
  protocol?: 'tcp' | 'udp' | 'http' | 'https';
  /** App-level (L7) protocol — the Sankey's "Protocol" stage. Transport-agnostic;
   *  see AppProtocol. Populated per-destination from DEST_APP_PROTOCOL. */
  appProtocol?: AppProtocol;

  // ─── CloudZiti Traffic Analysis display columns ────────────────────────────
  // Mirror the real console's flow record. NONE of these feed the engine — it
  // clusters/matches purely off `destinationHostPort`; these enrich the evidence
  // table so it reads like the source-of-truth Traffic Analysis view.
  /** Source IP of the ingress (dialing) entity. */
  ingressIp: string;
  /** Host-side IP the terminator forwarded to (egress). */
  egressIp: string;
  /** Host-side port on the egress (may differ from the intercept port). */
  egressPort: number;
  /** The ingress entity's name (the dialing identity) — CloudZiti column. */
  ingressEntityName: string;
  /** The egress host / gateway being reached — DISTINCT from the service name
   *  (one gateway can front several services). */
  egressEntityName: string;
  /** The logical service name observed on the egress side. */
  serviceName: string;

  /** ISO-8601 window bounds. */
  firstSeen: string;
  lastSeen: string;
}

/**
 * An observed dialing source, classified at build time from enrollment truth:
 * an ENROLLED source resolves to a real Identity (grantable); an UNENROLLED source
 * is an observed ADDRESS (an IP) that is NOT a principal and must never enter the
 * grant path. This discriminated shape keeps the two apart by construction so a
 * bare IP can never be coerced into a `#`/`@` identity grant.
 */
export type ObservedSource =
  | { kind: 'identity'; id: string; name: string }
  | { kind: 'address'; ip: string };

// ─── PART 1, stage 1: per-identity service vectors ────────────────────────────

/** An identity's dialed-destination set + per-destination volume weight. */
export interface IdentityServiceVector {
  identityId: string;
  identityName: string;
  /** Set of distinct destinationHostPorts this identity dialed. */
  destinations: ReadonlySet<string>;
  /** destinationHostPort → summed circuitCount (volume weight). */
  weights: ReadonlyMap<string, number>;
  totalCircuits: number;
}

// ─── PART 1, stage 2: destination → existing-service matching ─────────────────

/** One distinct dialed destination and whether it hit an existing service. */
export interface DestinationMatch {
  destinationHostPort: string;
  matched: boolean;
  matchedServiceId: string | null;
  matchedServiceName: string | null;
  protocol?: 'tcp' | 'udp' | 'http' | 'https';
  /** Summed circuitCount across every flow to this destination. */
  totalCircuitCount: number;
  /** Distinct identities that dialed it. */
  dialerIdentityIds: string[];
  flowIds: string[];
}

// ─── PART 1, stage 3: Jaccard clustering ──────────────────────────────────────

/** One pairwise Jaccard similarity (for inspection / rationale). */
export interface IdentityPairSimilarity {
  aId: string;
  bId: string;
  jaccard: number;
  sharedDestinations: string[];
}

/**
 * A cluster of identities. COMPLETE-LINKAGE guarantee: every intra-cluster pair
 * has Jaccard ≥ threshold (so `minPairwiseJaccard` ≥ threshold), which makes the
 * intersection-based rationale honest — the shared set is common to ALL members.
 */
export interface DiscoveredCluster {
  id: string;
  /** Suggested #role for the cluster (structural — the UI can rename it). */
  role: string;
  memberIds: string[];
  memberNames: string[];
  /** Intersection of all members' destination sets — the "grouped because" set. */
  sharedDestinations: string[];
  /** Complete-linkage floor: the weakest pair in the cluster. */
  minPairwiseJaccard: number;
  avgPairwiseJaccard: number;
  /** Every intra-cluster pair's score — inspectable, not a black box. */
  pairwise: IdentityPairSimilarity[];
}

/** An identity that cleared the threshold with nobody — the honest tail. */
export interface UngroupedIdentity {
  identityId: string;
  identityName: string;
  destinations: string[];
  /** Its highest similarity to ANY other identity (all < threshold). */
  bestJaccard: number;
  bestMatchIdentityId: string | null;
  bestMatchIdentityName: string | null;
  reason: string;
}

export interface ClusteringResult {
  clusters: DiscoveredCluster[];
  ungrouped: UngroupedIdentity[];
  threshold: number;
}

// ─── PART 1, stage 4: proposals ───────────────────────────────────────────────

/**
 * The editable definition of a service in the create-policy modals — the fields
 * that DEFINE a Service. Context-agnostic (no cluster/proposal coupling); the
 * shared `ServiceCardComponent` binds to this, and both the roles modal and the
 * raw "construct from selection" modal build/edit it.
 */
export interface ServiceDraft {
  name: string;
  interceptAddress: string;
  protocol: 'tcp' | 'udp' | 'http' | 'https';
  hostAddress: string;
}

/** A brand-new service to create for an unmatched (brownfield) destination. */
export interface ProposedServiceSpec {
  name: string;
  protocol: 'tcp' | 'udp' | 'http' | 'https';
  /** = the destinationHostPort (the intercept side). */
  interceptAddress: string;
  /** Brownfield: host side == intercept side until an operator refines it. */
  hostAddress: string;
  /** The #svc-role the proposed policy references. */
  attributes: string[];
}

/** Give an EXISTING service a #role so a policy's serviceRoles can resolve to it
 *  (seed services carry no attributes today). */
export interface ServiceAttributeAssignment {
  serviceId: string;
  serviceName: string;
  attribute: string;
}

/** Tag a cluster member with its cluster #role on approval. */
export interface IdentityAttributeAssignment {
  identityId: string;
  identityName: string;
  attribute: string;
}

/** The concrete NF service-policy fields a proposal becomes — a real `Policy`
 *  minus the fields the store stamps at materialize time (id/createdAt/status). */
export type ProposedPolicySpec = Pick<
  Policy,
  'type' | 'name' | 'semantic' | 'identityRoles' | 'serviceRoles' | 'postureCheckRoles'
>;

export interface ProposalProvenance {
  destinationHostPort: string;
  matchedServiceId: string | null;
  /** Clusters whose role authorizes this destination. */
  clusterIds: string[];
  /** Every identity that dialed the destination (cluster + ungrouped). */
  identityIds: string[];
  flowIds: string[];
}

/**
 * A single proposal, keyed by destination. Carries the policy spec PLUS the
 * side-effects approval must also apply (new service / service-attr / identity-
 * attr assignments), its provenance, human rationale, volume, and honesty flags.
 */
export interface Proposal {
  id: string;
  destinationHostPort: string;
  matched: boolean;
  policy: ProposedPolicySpec;
  /** Non-null only for unmatched destinations. */
  newService: ProposedServiceSpec | null;
  /** Non-empty only for matched destinations (existing svc needs a #role). */
  serviceAttributeAssignments: ServiceAttributeAssignment[];
  /** Cluster #role tags to apply to members on approval. */
  identityAttributeAssignments: IdentityAttributeAssignment[];
  provenance: ProposalProvenance;
  rationale: string;
  /** Summed circuitCount to this destination — the ranking key. */
  totalCircuitCount: number;
  /** Volume below the noise threshold — review before acting. */
  lowVolume: boolean;
  /** No cluster cleared the majority rule; only individual identities dial it. */
  ungroupedOnly: boolean;
  ungroupedDialers: { identityId: string; identityName: string }[];
}

// ─── PART 5: proposed-policy draft store item ─────────────────────────────────

export type ProposalStatus = 'proposed' | 'approved' | 'dismissed';

/** A `Proposal` staged in the draft store, with lifecycle status. */
export interface ProposedPolicy extends Proposal {
  status: ProposalStatus;
}

/**
 * A cluster #role as a SHARED, RENAMEABLE entity in the store.
 *
 * The engine copies its `role` string into every proposal that cites the cluster
 * (`policy.identityRoles`, `identityAttributeAssignments`, the rationale). To let
 * the reviewer rename a role once and have it propagate everywhere, the store
 * keys roles by their stable `clusterId` and proposals reference the role through
 * `provenance.clusterIds` — they never own the display name. `name` is the
 * editable value (starts === `originalRole`); the embedded `cluster` carries the
 * members / shared-destinations / scores the expanded card renders.
 */
export interface DiscoveredRole {
  clusterId: string;
  /** The engine's structural suggestion (#discovered-group-N) — never mutated. */
  originalRole: string;
  /** The current, possibly-renamed display name. #-prefixed, no spaces. */
  name: string;
  cluster: DiscoveredCluster;
}

/** Outcome of a rename attempt — `error` is a human-facing validation message. */
export interface RenameRoleResult {
  ok: boolean;
  error?: string;
}
