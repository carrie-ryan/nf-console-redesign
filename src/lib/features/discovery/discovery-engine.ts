/**
 * PART 1 — the discovery → policy engine. Pure, headless, deterministic.
 *
 * No Angular, no signals, no UI. Every function takes plain data and returns
 * plain data, so it runs in a vitest harness (discovery-engine.spec.ts) and is
 * fully inspectable. The stages, in order:
 *
 *   1. buildServiceVectors  — each identity's dialed-destination set (+ weights)
 *   2. matchDestinations    — each destination vs existing Service.interceptAddress
 *   3. clusterIdentities    — Jaccard + complete-linkage agglomerative clustering
 *   4. assembleProposals    — rank draft policies/services by volume
 *
 * runDiscovery() runs all four and returns the whole picture.
 */

import type { Service } from '../../shared/services/mock-data.service';
import type {
  ClusteringResult,
  DestinationMatch,
  DiscoveredCluster,
  DiscoveredFlow,
  IdentityPairSimilarity,
  IdentityServiceVector,
  Proposal,
  ProposedPolicySpec,
  ProposedServiceSpec,
  ServiceAttributeAssignment,
  UngroupedIdentity,
} from './discovery.models';

// ─── tunable, named constants (visible so they can be reasoned about) ─────────

/**
 * Two identities are "similar" when their Jaccard ≥ this. With complete-linkage
 * clustering (below) this becomes a HARD guarantee: every pair inside a cluster
 * is ≥ this value. 0.6 = "share at least ~60% of their combined destinations".
 */
export const CLUSTER_SIMILARITY_THRESHOLD = 0.6;

/**
 * A cluster is treated as a dialer of a destination only when at least this
 * fraction of its members actually dial it. Stops a single outlier member from
 * granting the whole cluster access to something it doesn't collectively use
 * (the policy should reflect the group's SHARED behaviour, not one machine).
 */
export const CLUSTER_DIAL_MAJORITY = 0.5;

/**
 * A destination whose total circuitCount is below this is flagged as possible
 * noise — surfaced but marked so an operator reviews before creating a service.
 */
export const LOW_VOLUME_THRESHOLD = 25;

// ─── stage 1: per-identity service vectors ────────────────────────────────────

/** Group flows by dialing identity into destination-sets + volume weights. */
export function buildServiceVectors(flows: readonly DiscoveredFlow[]): IdentityServiceVector[] {
  const byIdentity = new Map<string, { name: string; weights: Map<string, number> }>();

  for (const f of flows) {
    // Grouping key only: unenrolled sources have a null identity id, so fall back
    // to ingressIp to keep the same opaque key value as before (behavior unchanged).
    const identityKey = f.dialingIdentityId ?? f.ingressIp;
    let entry = byIdentity.get(identityKey);
    if (!entry) {
      entry = { name: f.dialingIdentityName, weights: new Map() };
      byIdentity.set(identityKey, entry);
    }
    entry.weights.set(f.destinationHostPort, (entry.weights.get(f.destinationHostPort) ?? 0) + f.circuitCount);
  }

  const vectors: IdentityServiceVector[] = [];
  for (const [identityId, entry] of byIdentity) {
    let total = 0;
    for (const w of entry.weights.values()) total += w;
    vectors.push({
      identityId,
      identityName: entry.name,
      destinations: new Set(entry.weights.keys()),
      weights: entry.weights,
      totalCircuits: total,
    });
  }
  // Stable order by id → deterministic clustering / output.
  vectors.sort((a, b) => a.identityId.localeCompare(b.identityId));
  return vectors;
}

// ─── stage 2: destination → existing-service matching ─────────────────────────

/**
 * For each distinct dialed destination, match against existing services by flat
 * `interceptAddress` string equality ("host:port"). Matched → existing serviceId;
 * unmatched → brownfield candidate for a new service.
 */
export function matchDestinations(
  flows: readonly DiscoveredFlow[],
  services: readonly Pick<Service, 'id' | 'name' | 'interceptAddress'>[],
): DestinationMatch[] {
  const svcByIntercept = new Map<string, { id: string; name: string }>();
  for (const s of services) svcByIntercept.set(s.interceptAddress, { id: s.id, name: s.name });

  const byDest = new Map<
    string,
    { total: number; protocol?: DiscoveredFlow['protocol']; dialers: Set<string>; flowIds: string[] }
  >();

  for (const f of flows) {
    let entry = byDest.get(f.destinationHostPort);
    if (!entry) {
      entry = { total: 0, protocol: f.protocol, dialers: new Set(), flowIds: [] };
      byDest.set(f.destinationHostPort, entry);
    }
    entry.total += f.circuitCount;
    // Dialer key only: null identity id (unenrolled) falls back to ingressIp so the
    // dialer set keeps its prior value.
    entry.dialers.add(f.dialingIdentityId ?? f.ingressIp);
    entry.flowIds.push(f.id);
  }

  const matches: DestinationMatch[] = [];
  for (const [destinationHostPort, entry] of byDest) {
    const svc = svcByIntercept.get(destinationHostPort);
    matches.push({
      destinationHostPort,
      matched: svc !== undefined,
      matchedServiceId: svc?.id ?? null,
      matchedServiceName: svc?.name ?? null,
      protocol: entry.protocol,
      totalCircuitCount: entry.total,
      dialerIdentityIds: [...entry.dialers].sort(),
      flowIds: entry.flowIds,
    });
  }
  matches.sort((a, b) => b.totalCircuitCount - a.totalCircuitCount);
  return matches;
}

// ─── stage 3: Jaccard + complete-linkage clustering ───────────────────────────

/** Jaccard similarity of two sets: |A ∩ B| / |A ∪ B|. Empty/empty → 0. */
export function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Sorted intersection of two sets — the "shared destinations" for a pair. */
function sharedOf(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  const shared: string[] = [];
  for (const x of a) if (b.has(x)) shared.push(x);
  return shared.sort();
}

/** Intersection across MANY sets — the "grouped because they all share" set. */
function intersectAll(sets: ReadonlySet<string>[]): string[] {
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  const shared: string[] = [];
  for (const x of first) {
    if (rest.every((s) => s.has(x))) shared.push(x);
  }
  return shared.sort();
}

interface WorkingCluster {
  members: IdentityServiceVector[];
}

/**
 * Complete-linkage agglomerative clustering.
 *
 * Linkage(A, B) = the MINIMUM pairwise Jaccard across all cross-cluster pairs.
 * Repeatedly merge the two clusters with the highest linkage while that linkage
 * ≥ threshold. Because we only merge when the WEAKEST cross pair clears the bar,
 * every pair inside a finished cluster is guaranteed ≥ threshold — which is what
 * makes "grouped because they share X, Y, Z" an honest statement (the shared set
 * is common to ALL members, not just chained neighbours).
 *
 * Singletons that never merge fall out as the ungrouped tail — NOT forced in.
 */
export function clusterIdentities(
  vectors: readonly IdentityServiceVector[],
  threshold: number = CLUSTER_SIMILARITY_THRESHOLD,
): ClusteringResult {
  const byId = new Map<string, IdentityServiceVector>();
  for (const v of vectors) byId.set(v.identityId, v);

  // Memoised pairwise Jaccard between individual identities.
  const pairCache = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const jac = (a: IdentityServiceVector, b: IdentityServiceVector): number => {
    const key = pairKey(a.identityId, b.identityId);
    let v = pairCache.get(key);
    if (v === undefined) {
      v = jaccardSimilarity(a.destinations, b.destinations);
      pairCache.set(key, v);
    }
    return v;
  };
  const completeLinkage = (A: WorkingCluster, B: WorkingCluster): number => {
    let min = Infinity;
    for (const a of A.members) for (const b of B.members) min = Math.min(min, jac(a, b));
    return min;
  };

  let clusters: WorkingCluster[] = vectors.map((v) => ({ members: [v] }));

  for (;;) {
    let bestI = -1;
    let bestJ = -1;
    let best = -Infinity;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const linkage = completeLinkage(clusters[i], clusters[j]);
        if (linkage > best) {
          best = linkage;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI < 0 || best < threshold) break;
    clusters[bestI].members.push(...clusters[bestJ].members);
    clusters = clusters.filter((_, idx) => idx !== bestJ);
  }

  // Split: size ≥ 2 → cluster; size 1 → ungrouped tail.
  const realClusters: WorkingCluster[] = [];
  const singletons: WorkingCluster[] = [];
  for (const c of clusters) (c.members.length >= 2 ? realClusters : singletons).push(c);

  // Deterministic cluster order: highest-volume cluster first.
  realClusters.sort((a, b) => volumeOf(b) - volumeOf(a));

  const outClusters: DiscoveredCluster[] = realClusters.map((c, idx) => {
    const members = [...c.members].sort((a, b) => a.identityId.localeCompare(b.identityId));
    const pairwise: IdentityPairSimilarity[] = [];
    let min = Infinity;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const score = jac(members[i], members[j]);
        pairwise.push({
          aId: members[i].identityId,
          bId: members[j].identityId,
          jaccard: round(score),
          sharedDestinations: sharedOf(members[i].destinations, members[j].destinations),
        });
        min = Math.min(min, score);
        sum += score;
        count += 1;
      }
    }
    return {
      id: `cluster-${idx + 1}`,
      role: `#discovered-group-${idx + 1}`,
      memberIds: members.map((m) => m.identityId),
      memberNames: members.map((m) => m.identityName),
      sharedDestinations: intersectAll(members.map((m) => m.destinations)),
      minPairwiseJaccard: round(min),
      avgPairwiseJaccard: round(count === 0 ? 0 : sum / count),
      pairwise,
    };
  });

  // For each ungrouped identity, record its best (sub-threshold) neighbour so the
  // tail is explainable ("closest was X at 0.50, below 0.60").
  const ungrouped: UngroupedIdentity[] = singletons
    .map((c) => c.members[0])
    .sort((a, b) => a.identityId.localeCompare(b.identityId))
    .map((v) => {
      let bestJaccard = 0;
      let bestId: string | null = null;
      for (const other of vectors) {
        if (other.identityId === v.identityId) continue;
        const score = jac(v, other);
        if (score > bestJaccard) {
          bestJaccard = score;
          bestId = other.identityId;
        }
      }
      return {
        identityId: v.identityId,
        identityName: v.identityName,
        destinations: [...v.destinations].sort(),
        bestJaccard: round(bestJaccard),
        bestMatchIdentityId: bestId,
        bestMatchIdentityName: bestId ? (byId.get(bestId)?.identityName ?? null) : null,
        reason: 'needs individual policy',
      };
    });

  return { clusters: outClusters, ungrouped, threshold };
}

function volumeOf(c: WorkingCluster): number {
  let total = 0;
  for (const m of c.members) total += m.totalCircuits;
  return total;
}

// ─── stage 4: proposal assembly ───────────────────────────────────────────────

/** lowercase, non-alphanumerics → single dash, trimmed. */
function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Turn clusters + matches into ranked draft proposals — one per destination.
 *
 * For each destination:
 *   • a cluster "dials" it when ≥ CLUSTER_DIAL_MAJORITY of its members do;
 *   • identityRoles = the roles of the clusters that dial it;
 *   • matched destination   → dial policy + a #svc-role for the EXISTING service
 *                             (seed services have no attributes, so the policy's
 *                             serviceRoles wouldn't resolve without this);
 *   • unmatched destination → a NEW service (brownfield) + dial policy;
 *   • dialers not covered by any cluster are surfaced as ungrouped (individual).
 *
 * Proposals are ranked by total circuitCount; low-volume ones are flagged.
 */
export function assembleProposals(
  clustering: ClusteringResult,
  matches: readonly DestinationMatch[],
  vectors: readonly IdentityServiceVector[],
  lowVolumeThreshold: number = LOW_VOLUME_THRESHOLD,
  dialMajority: number = CLUSTER_DIAL_MAJORITY,
): Proposal[] {
  const vectorById = new Map<string, IdentityServiceVector>();
  for (const v of vectors) vectorById.set(v.identityId, v);

  const proposals: Proposal[] = [];

  for (const m of matches) {
    const dialerSet = new Set(m.dialerIdentityIds);

    // Which clusters collectively dial this destination (majority rule)?
    const clusterDialers = clustering.clusters
      .map((c) => {
        const dialingMembers = c.memberIds.filter((id) => dialerSet.has(id));
        return { cluster: c, dialingMembers, fraction: dialingMembers.length / c.memberIds.length };
      })
      .filter((x) => x.fraction >= dialMajority);

    const coveredMemberIds = new Set<string>();
    for (const cd of clusterDialers) for (const id of cd.cluster.memberIds) coveredMemberIds.add(id);

    // Dialers not represented by an authorising cluster role → individual review.
    const ungroupedDialers = m.dialerIdentityIds
      .filter((id) => !coveredMemberIds.has(id))
      .map((id) => ({ identityId: id, identityName: vectorById.get(id)?.identityName ?? id }));

    const identityRoles = clusterDialers.map((cd) => cd.cluster.role);
    const ungroupedOnly = identityRoles.length === 0;

    // Service role (attribute) the policy targets.
    const svcRole = m.matched
      ? `#discovered-svc-${slug(m.matchedServiceName ?? m.destinationHostPort)}`
      : `#discovered-svc-${slug(hostOf(m.destinationHostPort))}`;

    // Identity #role assignments to apply on approval (cluster members only).
    const identityAttributeAssignments = clusterDialers.flatMap((cd) =>
      cd.cluster.memberIds.map((id) => ({
        identityId: id,
        identityName: vectorById.get(id)?.identityName ?? id,
        attribute: cd.cluster.role,
      })),
    );

    // Service side.
    let newService: ProposedServiceSpec | null = null;
    let serviceAttributeAssignments: ServiceAttributeAssignment[] = [];
    if (m.matched && m.matchedServiceId) {
      serviceAttributeAssignments = [
        { serviceId: m.matchedServiceId, serviceName: m.matchedServiceName ?? '', attribute: svcRole },
      ];
    } else {
      newService = {
        name: hostOf(m.destinationHostPort),
        protocol: m.protocol ?? 'tcp',
        interceptAddress: m.destinationHostPort,
        hostAddress: m.destinationHostPort, // brownfield: same until refined
        attributes: [svcRole],
      };
    }

    const policy: ProposedPolicySpec = {
      type: 'dial',
      name: `dial-${slug(hostOf(m.destinationHostPort))}`,
      semantic: 'AnyOf',
      identityRoles,
      serviceRoles: [svcRole],
      postureCheckRoles: [],
    };

    proposals.push({
      id: `prop-${slug(m.destinationHostPort)}`,
      destinationHostPort: m.destinationHostPort,
      matched: m.matched,
      policy,
      newService,
      serviceAttributeAssignments,
      identityAttributeAssignments,
      provenance: {
        destinationHostPort: m.destinationHostPort,
        matchedServiceId: m.matchedServiceId,
        clusterIds: clusterDialers.map((cd) => cd.cluster.id),
        identityIds: m.dialerIdentityIds,
        flowIds: m.flowIds,
      },
      rationale: buildRationale(m, clusterDialers, ungroupedDialers, svcRole),
      totalCircuitCount: m.totalCircuitCount,
      lowVolume: m.totalCircuitCount < lowVolumeThreshold,
      ungroupedOnly,
      ungroupedDialers,
    });
  }

  proposals.sort((a, b) => b.totalCircuitCount - a.totalCircuitCount);
  return proposals;
}

function hostOf(hostPort: string): string {
  const i = hostPort.lastIndexOf(':');
  return i > 0 ? hostPort.slice(0, i) : hostPort;
}

interface ClusterDialer {
  cluster: DiscoveredCluster;
  dialingMembers: string[];
  fraction: number;
}

function buildRationale(
  m: DestinationMatch,
  clusterDialers: ClusterDialer[],
  ungroupedDialers: { identityId: string; identityName: string }[],
  svcRole: string,
): string {
  const parts: string[] = [];

  const svcClause = m.matched
    ? `matches existing service "${m.matchedServiceName}" — tag it ${svcRole} so the policy resolves`
    : `no existing service intercepts this — propose a new service (${svcRole})`;
  parts.push(`${m.destinationHostPort}: ${svcClause}.`);

  for (const cd of clusterDialers) {
    parts.push(
      `${cd.cluster.role} (${cd.cluster.memberIds.length} identities: ${cd.cluster.memberNames.join(', ')}) ` +
        `dials this — ${cd.dialingMembers.length}/${cd.cluster.memberIds.length} members observed; ` +
        `grouped because they share {${cd.cluster.sharedDestinations.join(', ')}}.`,
    );
  }

  if (clusterDialers.length === 0) {
    parts.push('No cluster reaches the majority dial rule — only individual identities use it.');
  }
  if (ungroupedDialers.length > 0) {
    parts.push(
      `Also dialed by ${ungroupedDialers.length} ungrouped identity(ies) ` +
        `(${ungroupedDialers.map((u) => u.identityName).join(', ')}) — each needs an individual policy.`,
    );
  }
  parts.push(`Total volume ${m.totalCircuitCount} circuits.`);
  return parts.join(' ');
}

// ─── round helper (2dp) — keep scores readable/stable ─────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── convenience: run every stage ─────────────────────────────────────────────

export interface DiscoveryResult {
  vectors: IdentityServiceVector[];
  matches: DestinationMatch[];
  clustering: ClusteringResult;
  proposals: Proposal[];
}

export function runDiscovery(
  flows: readonly DiscoveredFlow[],
  services: readonly Pick<Service, 'id' | 'name' | 'interceptAddress'>[],
  options?: { threshold?: number; lowVolumeThreshold?: number; dialMajority?: number },
): DiscoveryResult {
  const vectors = buildServiceVectors(flows);
  const matches = matchDestinations(flows, services);
  const clustering = clusterIdentities(vectors, options?.threshold ?? CLUSTER_SIMILARITY_THRESHOLD);
  const proposals = assembleProposals(
    clustering,
    matches,
    vectors,
    options?.lowVolumeThreshold ?? LOW_VOLUME_THRESHOLD,
    options?.dialMajority ?? CLUSTER_DIAL_MAJORITY,
  );
  return { vectors, matches, clustering, proposals };
}
