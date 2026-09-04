import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MockDataService } from '../../shared/services/mock-data.service';
import { runDiscovery } from './discovery-engine';
import { MaterialisedMember, MaterializeResult, ProposedPolicyStore } from './proposed-policy-store.service';
import { RolePolicyModalComponent } from './role-policy-modal.component';
import { DISCOVERED_FLOWS } from './discovered-flows.mock';
import { enrolledSourceIds } from './source-enrollment';
import type { ProposedPolicy, UngroupedIdentity } from './discovery.models';

/** One observed-flow row in a role's evidence sub-table — mirrors the CloudZiti
 *  Traffic Analysis columns (Ingress IP · Egress IP · Egress Port · Ingress
 *  Entity · Egress Entity · Service · Circuits). */
interface EvidenceRow {
  key: string;
  /** The source id (enrolled disc-id or bare IP) — for the enrollment badge. */
  identityId: string;
  ingressIp: string;
  egressIp: string;
  egressPort: number;
  ingressEntityName: string;
  egressEntityName: string;
  serviceName: string;
  circuits: number;
}

/** A role group as the table renders it: rollups + the flows that justify it. */
interface RoleView {
  clusterId: string;
  roleName: string;
  originalRole: string;
  /** Total cluster members (real identities + unmanaged hosts) — the grouping count.
   *  For the identity-facing badge use `managedCount`, not this. */
  identityCount: number;
  /** Real identities among the members (id resolves in MockDataService.identities) —
   *  the honest "N identities" count; equals what materialize actually tags. */
  managedCount: number;
  serviceCount: number;
  /** Of `serviceCount`, how many are unmatched (a new service on approval). */
  newServiceCount: number;
  totalCircuits: number;
  memberNames: string[];
  sharedDestinations: string[];
  minJaccard: number;
  evidence: EvidenceRow[];
  /** Services dialed by only part of the group (majority rule met, not unanimous). */
  partialServices: { destination: string; dialing: number; total: number }[];
  stragglers: { id: string; name: string }[];
  /** Cluster members that fit the role but aren't enrolled — can't be tagged, so
   *  a created policy won't cover them until they're enrolled. Distinct from
   *  `stragglers` (OUTSIDE-role dialers) and `partialServices` (non-unanimous
   *  destinations). Cluster-derived, so it renders before creation as a hint. */
  unenrolledMembers: { id: string; name: string }[];
  proposals: ProposedPolicy[];
  policyName: string | null;
}

/**
 * PART 3 (rebuilt) — the discovery review, as an ACTIONABLE Traffic Analysis
 * table (the ZLAN/Illumio "observe → recommend policy" pattern).
 *
 * CloudZiti's Traffic Analysis shows observed flows from wildcard intercepts but
 * is read-only. Here the same flows are grouped by DISCOVERED ROLE (identity-
 * cluster) into a handful of scannable rows; expanding a role reveals the real
 * observed flows as evidence, and "Create policy" turns the group into one real
 * dial policy (role → all its services) via the store.
 *
 * The engine + store are consumed as-is; this component only reads their signals
 * and drives the create-policy modal, so every action re-renders reactively.
 */
@Component({
  selector: 'app-discovery-review',
  standalone: true,
  imports: [FormsModule, RolePolicyModalComponent],
  templateUrl: './discovery-review.component.html',
  styleUrl: './discovery-review.component.css',
})
export class DiscoveryReviewComponent {
  private readonly data = inject(MockDataService);
  readonly store = inject(ProposedPolicyStore);

  /** The ungrouped tail — static (engine output), captured at construction. */
  readonly ungroupedIdentities: readonly UngroupedIdentity[];

  constructor() {
    // The engine is pure/deterministic; run it to get the ungrouped tail, and
    // seed the store only when empty so approvals/renames survive navigation.
    const result = runDiscovery(DISCOVERED_FLOWS, this.data.services());
    this.ungroupedIdentities = result.clustering.ungrouped;
    if (this.store.proposals().length === 0) {
      this.store.seed(result.proposals);
      this.store.seedRoles(result.clustering.clusters);
    }
  }

  /** Derived-enrollment set (shared helper) — a source is enrolled iff its id
   *  resolves to a real Identity. Used to badge unenrolled (observed-only) sources
   *  in evidence rows and ungrouped/straggler chips. */
  private readonly enrolledIds = computed(() => enrolledSourceIds(this.data.identities()));
  isEnrolled(sourceId: string): boolean {
    return this.enrolledIds().has(sourceId);
  }

  // ─── which role's create-policy modal is open ───────────────────────
  readonly openClusterId = signal<string | null>(null);

  openModal(clusterId: string): void {
    this.openClusterId.set(clusterId);
  }
  closeModal(): void {
    this.openClusterId.set(null);
  }

  /** Per-cluster partial-materialize result captured when a policy is created —
   *  the members that fit the role but couldn't be tagged (unenrolled). Drives the
   *  post-creation "N tagged, M need enrolling" note. Keyed by clusterId. */
  private readonly createdUnenrolled = signal<Record<string, MaterialisedMember[]>>({});
  unenrolledForCreated(clusterId: string): MaterialisedMember[] {
    return this.createdUnenrolled()[clusterId] ?? [];
  }

  /** Modal emitted its create result — record which members were deferred, then
   *  close. `result` is null only on bad input (no-op). */
  onPolicyCreated(clusterId: string, result: MaterializeResult | null): void {
    if (result) {
      this.createdUnenrolled.update((prev) => ({ ...prev, [clusterId]: result.unenrolled }));
    }
    this.closeModal();
  }

  // ─── inline role rename (in the table row) ──────────────────────────
  readonly editingClusterId = signal<string | null>(null);
  readonly editValue = signal('');
  readonly editError = signal<string | null>(null);

  startEdit(clusterId: string, name: string): void {
    this.editingClusterId.set(clusterId);
    this.editValue.set(name);
    this.editError.set(null);
  }
  cancelEdit(): void {
    this.editingClusterId.set(null);
    this.editError.set(null);
  }
  commitEdit(clusterId: string): void {
    const result = this.store.renameRole(clusterId, this.editValue());
    if (result.ok) {
      this.editingClusterId.set(null);
      this.editError.set(null);
    } else {
      this.editError.set(result.error ?? 'Invalid name.');
    }
  }

  // ─── expand / collapse role rows ────────────────────────────────────
  private readonly expanded = signal<Set<string>>(new Set());
  isExpanded(clusterId: string): boolean {
    return this.expanded().has(clusterId);
  }
  toggle(clusterId: string): void {
    this.expanded.update((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }

  // ─── the role table view-model ──────────────────────────────────────
  readonly roleViews = computed<RoleView[]>(() => {
    const roles = this.store.roles();
    // Touch proposals so approvals/renames recompute the views.
    this.store.proposals();

    return roles.map((role) => {
      const proposals = this.store
        .proposalsForRole(role.clusterId)
        .slice()
        .sort((a, b) => b.totalCircuitCount - a.totalCircuitCount);

      const destSet = new Set(proposals.map((p) => p.destinationHostPort));
      const memberSet = new Set(role.cluster.memberIds);

      // Evidence = observed flows by this role's members to its destinations,
      // aggregated per (identity, destination). Every column is the CloudZiti
      // Traffic-Analysis set, read straight off the flow record.
      const agg = new Map<string, EvidenceRow>();
      for (const f of DISCOVERED_FLOWS) {
        // Opaque member/grouping key: unenrolled sources have a null identity id,
        // so fall back to ingressIp to match the engine's cluster memberIds.
        const identityKey = f.dialingIdentityId ?? f.ingressIp;
        if (!memberSet.has(identityKey)) continue;
        if (!destSet.has(f.destinationHostPort)) continue;
        const key = identityKey + '|' + f.destinationHostPort;
        const cur = agg.get(key);
        if (cur) {
          cur.circuits += f.circuitCount;
        } else {
          agg.set(key, {
            key,
            identityId: identityKey,
            ingressIp: f.ingressIp,
            egressIp: f.egressIp,
            egressPort: f.egressPort,
            ingressEntityName: f.ingressEntityName,
            egressEntityName: f.egressEntityName,
            // Naming honesty: unmatched destinations have NO service — show the
            // observed destination host, never a fabricated product name.
            serviceName: f.serviceName || hostOf(f.destinationHostPort),
            circuits: f.circuitCount,
          });
        }
      }
      const evidence = [...agg.values()].sort(
        (a, b) => b.circuits - a.circuits || a.ingressEntityName.localeCompare(b.ingressEntityName),
      );
      const totalCircuits = evidence.reduce((n, e) => n + e.circuits, 0);

      // Majority-dial honesty: services not every member dials.
      const partialServices = proposals
        .map((p) => {
          const dialers = new Set(p.provenance.identityIds);
          const dialing = role.cluster.memberIds.filter((id) => dialers.has(id)).length;
          return { destination: p.destinationHostPort, dialing, total: role.cluster.memberIds.length };
        })
        .filter((s) => s.dialing < s.total);

      // Stragglers = identities outside this role that also dial its destinations.
      const stragglers = new Map<string, string>();
      for (const p of proposals) for (const u of p.ungroupedDialers) stragglers.set(u.identityId, u.identityName);

      // Unenrolled MEMBERS of this role — cluster members whose id doesn't resolve
      // to an Identity (CIDR-first: a bare IP). They can't be tagged, so a created
      // policy won't cover them until enrolled. Derived from cluster membership so
      // it's available as a pre-creation hint AND matches the store's tag result.
      const memberNameById = new Map(
        role.cluster.memberIds.map((id, i) => [id, role.cluster.memberNames[i] ?? id]),
      );
      const unenrolledMembers = role.cluster.memberIds
        .filter((id) => !this.isEnrolled(id))
        .map((id) => ({ id, name: memberNameById.get(id) ?? id }));

      return {
        clusterId: role.clusterId,
        roleName: role.name,
        originalRole: role.originalRole,
        identityCount: role.cluster.memberIds.length,
        managedCount: role.cluster.memberIds.filter((id) => this.isEnrolled(id)).length,
        serviceCount: proposals.length,
        newServiceCount: proposals.filter((p) => !p.matched).length,
        totalCircuits,
        memberNames: role.cluster.memberNames,
        sharedDestinations: role.cluster.sharedDestinations,
        minJaccard: role.cluster.minPairwiseJaccard,
        evidence,
        partialServices,
        stragglers: [...stragglers].map(([id, name]) => ({ id, name })),
        unenrolledMembers,
        proposals,
        policyName: this.store.policyForRole(role.clusterId)?.policyName ?? null,
      };
    });
  });

  /** Peak volume across roles — normalises the volume bars. */
  readonly peakVolume = computed(() =>
    Math.max(1, ...this.roleViews().map((r) => r.totalCircuits)),
  );

  /** Low-confidence proposals: dialed by no cluster (individual / below noise). */
  readonly lowConfidence = computed(() =>
    this.store
      .proposals()
      .filter((p) => p.provenance.clusterIds.length === 0)
      .slice()
      .sort((a, b) => b.totalCircuitCount - a.totalCircuitCount),
  );

  // ─── progress ledger ────────────────────────────────────────────────
  readonly totalRoles = computed(() => this.store.roles().length);
  readonly policiesCreated = computed(() => this.store.rolePolicies().length);
  readonly rolesRemaining = computed(() => this.totalRoles() - this.policiesCreated());
  readonly reviewedPct = computed(() => {
    const t = this.totalRoles();
    return t === 0 ? 0 : Math.round((this.policiesCreated() / t) * 100);
  });
}

/** Host part of a "host:port" — the honest default label for an unmatched
 *  destination (which has no service name of its own). */
function hostOf(hostPort: string): string {
  const i = hostPort.lastIndexOf(':');
  return i > 0 ? hostPort.slice(0, i) : hostPort;
}
