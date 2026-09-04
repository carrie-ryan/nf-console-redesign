/**
 * PART 5 — the proposed-policy draft store.
 *
 * Mirrors the OnboardingStateService pattern: signal-backed, in-memory (POC),
 * write-through. Holds ProposedPolicy items (a real Policy shape + status +
 * provenance + rationale) staged awaiting approval.
 *
 * Approval MATERIALISES a proposal via the create-policy.save() pattern:
 *   • create the new service (unmatched destinations),
 *   • tag the existing service with its #svc-role (matched destinations),
 *   • tag cluster members with their cluster #role,
 *   • push a real Policy onto data.policies.
 *
 * The mutation itself lives in the pure `materialiseProposal()` function so it can
 * be exercised headlessly (the spec calls it with `new MockDataService()`); the
 * service just injects the singleton and delegates.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { MockDataService, Policy, Service } from '../../shared/services/mock-data.service';
import type {
  DiscoveredCluster,
  DiscoveredRole,
  IdentityAttributeAssignment,
  Proposal,
  ProposalStatus,
  ProposedPolicy,
  RenameRoleResult,
} from './discovery.models';

/** A materialised source (a cluster member and whether it could be tagged). */
export interface MaterialisedMember {
  /** id === name === IP for CIDR-first UNENROLLED sources; disc-id/name when enrolled. */
  id: string;
  name: string;
}

/** The partial-materialize outcome of tagging a role's members: which enrolled
 *  members received the #role, and which "fit the role but aren't enrolled yet"
 *  (no Identity to tag). Returned by both materialize paths so the UI can surface
 *  the deferred-enrollment consequence instead of silently under-tagging. */
export interface MaterializeResult {
  policy: Policy;
  tagged: MaterialisedMember[];
  unenrolled: MaterialisedMember[];
}

/**
 * THE shared identity-tagging choke point — the ONLY place a cluster #role is
 * applied to identities, so the enrolled-check and the partial result are
 * consistent across every materialize path (createRolePolicy today, the Sankey
 * drawer's create later, materialiseProposal/approve).
 *
 * A member is ENROLLED iff its `identityId` resolves to a real Identity; only then
 * is it tagged. An UNENROLLED source (CIDR-first: id === name === a bare IP) has no
 * Identity record to tag — that's a correct no-op, but it's returned in
 * `unenrolled` (a structured result, NOT a dev-log) so the caller can flag it.
 *
 * `attribute` preserves each caller's filter semantics: pass a role name to tag
 * only assignments carrying that attribute (createRolePolicy — a shared
 * destination also carries other roles' tags, not this policy's); omit it to tag
 * every assignment (materialiseProposal). Either way the tag applied is the
 * assignment's own `attribute`, which under the filter equals the passed name.
 */
function tagRoleMembers(
  data: MockDataService,
  assignments: readonly IdentityAttributeAssignment[],
  attribute?: string,
): { tagged: MaterialisedMember[]; unenrolled: MaterialisedMember[] } {
  const tagged: MaterialisedMember[] = [];
  const unenrolled: MaterialisedMember[] = [];
  for (const a of assignments) {
    if (attribute !== undefined && a.attribute !== attribute) continue;
    const enrolled = data.identities().some((i) => i.id === a.identityId);
    if (enrolled) {
      data.identities.update((list) =>
        list.map((i) =>
          i.id === a.identityId ? { ...i, attributes: addAttr(i.attributes, a.attribute) } : i,
        ),
      );
      tagged.push({ id: a.identityId, name: a.identityName });
    } else {
      // No Identity to tag — deferred until the source is enrolled. Surfaced via
      // the returned `unenrolled` array, not a console.warn.
      unenrolled.push({ id: a.identityId, name: a.identityName });
    }
  }
  return { tagged, unenrolled };
}

/** Apply a proposal to the mock data set (create service / tag entities / add
 *  policy). Pure w.r.t. Angular — takes the data service explicitly. Returns the
 *  created Policy PLUS the partial-materialize result (tagged / unenrolled members)
 *  so callers can surface the deferred-enrollment consequence. */
export function materialiseProposal(p: ProposedPolicy, data: MockDataService): MaterializeResult {
  // 1. Unmatched → create the new (brownfield) service carrying its #svc-role.
  if (p.newService) {
    const svc: Service = {
      id: 'svc-' + Date.now().toString(36) + '-' + p.id,
      name: p.newService.name,
      createdAt: new Date().toISOString(),
      status: 'online',
      protocol: p.newService.protocol,
      interceptAddress: p.newService.interceptAddress,
      hostAddress: p.newService.hostAddress,
      attributes: [...p.newService.attributes],
    };
    data.services.update((list) => [...list, svc]);
  }

  // 2. Matched → tag the existing service so the policy's serviceRoles resolve.
  for (const a of p.serviceAttributeAssignments) {
    data.services.update((list) =>
      list.map((s) =>
        s.id === a.serviceId ? { ...s, attributes: addAttr(s.attributes ?? [], a.attribute) } : s,
      ),
    );
  }

  // 3. Tag cluster members with their cluster #role via the shared choke point.
  //    Enrolled members are tagged; unenrolled sources (bare-IP ids) have no
  //    Identity to tag and come back in `unenrolled` for the caller to surface.
  const { tagged, unenrolled } = tagRoleMembers(data, p.identityAttributeAssignments);

  // 4. Push the real Policy (create-policy.save() shape).
  const policy: Policy = {
    id: 'pol-' + Date.now().toString(36) + '-' + p.id,
    name: p.policy.name,
    createdAt: new Date().toISOString(),
    status: 'active',
    type: p.policy.type,
    semantic: p.policy.semantic,
    identityRoles: [...p.policy.identityRoles],
    serviceRoles: [...p.policy.serviceRoles],
    postureCheckRoles: [...p.policy.postureCheckRoles],
  };
  data.policies.update((list) => [...list, policy]);
  return { policy, tagged, unenrolled };
}

function addAttr(attrs: readonly string[], attr: string): string[] {
  return attrs.includes(attr) ? [...attrs] : [...attrs, attr];
}

/** Compact, filename-safe fragment for a generated service id. */
function slugForId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A materialised role policy — the record kept so a role row can show "done". */
export interface CreatedRolePolicy {
  clusterId: string;
  policyId: string;
  policyName: string;
  /** How many of the role's destination services this policy authorises. */
  serviceCount: number;
}

/** The user-edited definition of a NEW service being created from a proposal —
 *  passed from the create-policy modal so the created Service carries the edited
 *  values, not the engine's derived defaults. Keyed to a proposal by id. */
export interface RolePolicyServiceEdit {
  proposalId: string;
  name: string;
  interceptAddress: string;
  protocol: 'tcp' | 'udp' | 'http' | 'https';
  hostAddress: string;
}

/**
 * One self-contained destination card from the RAW "construct from selection"
 * modal. CREATE-ONLY, PER CARD: it materialises to exactly ONE new intercept
 * service + ONE new dial policy that targets ONLY that service. There is NO
 * tag-existing branch — discovery's premise is that every flow is unmatched, so
 * nothing pre-exists (a card whose intercept happens to collide with a seed
 * service still creates a NEW service, by design).
 */
export interface ManualPolicyCard {
  // ─ new intercept service (access side only) ─
  serviceName: string;
  /** Service attributes as typed; may be empty (a #svc-role is auto-assigned). */
  attributes: readonly string[];
  interceptAddress: string;
  interceptPort: number | null;
  protocol: 'tcp' | 'udp' | '';
  // ─ this card's dial policy ─
  policyName: string;
  // ─ identity authorization: ONE merged grant list, partitioned by the modal ─
  /** The `@`-ref grant tokens — direct identity references used VERBATIM in
   *  identityRoles, with NO tagging (includes unenrolled/CIDR hosts carried
   *  through as-is). */
  refs: readonly string[];
  /** The `#`-role grant tokens the policy targets. Members are resolved by
   *  ATTRIBUTE (existing role holders), NOT from the observed dialers. */
  roleTokens: readonly string[];
}

/** Return a copy of `p` with every occurrence of the `oldRole` identity #role
 *  (in the policy and the on-approval attribute tags) swapped for `newRole`.
 *  Service roles are #discovered-svc-* and never collide, so they're untouched. */
function renameRoleInProposal(p: ProposedPolicy, oldRole: string, newRole: string): ProposedPolicy {
  const usesRole =
    p.policy.identityRoles.includes(oldRole) ||
    p.identityAttributeAssignments.some((a) => a.attribute === oldRole);
  if (!usesRole) return p;

  return {
    ...p,
    policy: {
      ...p.policy,
      identityRoles: p.policy.identityRoles.map((r) => (r === oldRole ? newRole : r)),
    },
    identityAttributeAssignments: p.identityAttributeAssignments.map((a) =>
      a.attribute === oldRole ? { ...a, attribute: newRole } : a,
    ),
  };
}

@Injectable({ providedIn: 'root' })
export class ProposedPolicyStore {
  private readonly data = inject(MockDataService);

  /** The staged proposals. Write-through, like OnboardingStateService drafts. */
  readonly proposals = signal<ProposedPolicy[]>([]);

  /**
   * The cluster #roles as shared, renameable entities (keyed by clusterId).
   * Proposals reference these through `provenance.clusterIds`; renaming one here
   * propagates to every proposal that cites the cluster. See `DiscoveredRole`.
   */
  readonly roles = signal<DiscoveredRole[]>([]);

  /** Role policies materialised so far (one per role), keyed by clusterId. Drives
   *  the "policy created" state on a role row and the campaign progress. */
  readonly rolePolicies = signal<CreatedRolePolicy[]>([]);

  readonly pending = computed(() => this.proposals().filter((p) => p.status === 'proposed'));
  readonly approved = computed(() => this.proposals().filter((p) => p.status === 'approved'));
  readonly dismissed = computed(() => this.proposals().filter((p) => p.status === 'dismissed'));

  /** Load engine output into the store as 'proposed' items (replaces existing). */
  seed(proposals: readonly Proposal[]): void {
    this.proposals.set(proposals.map((p) => ({ ...p, status: 'proposed' as ProposalStatus })));
  }

  /** Register the discovered clusters as renameable roles (replaces existing). */
  seedRoles(clusters: readonly DiscoveredCluster[]): void {
    this.roles.set(
      clusters.map((c) => ({
        clusterId: c.id,
        originalRole: c.role,
        name: c.role,
        cluster: c,
      })),
    );
  }

  /** The roles that authorise a proposal, resolved from its provenance clusterIds
   *  (order preserved). Empty for ungrouped-only proposals. */
  rolesFor(p: Proposal): DiscoveredRole[] {
    const byId = new Map(this.roles().map((r) => [r.clusterId, r]));
    return p.provenance.clusterIds.map((id) => byId.get(id)).filter((r): r is DiscoveredRole => !!r);
  }

  /** The destination services a role needs — every proposal whose provenance cites
   *  the cluster (i.e. the cluster cleared the majority-dial rule for it). */
  proposalsForRole(clusterId: string): ProposedPolicy[] {
    return this.proposals().filter((p) => p.provenance.clusterIds.includes(clusterId));
  }

  /** The role policy already created for a cluster, if any. */
  policyForRole(clusterId: string): CreatedRolePolicy | undefined {
    return this.rolePolicies().find((r) => r.clusterId === clusterId);
  }

  /**
   * Rename a cluster role and propagate the new name into every proposal that
   * cites the cluster — its policy.identityRoles and identityAttributeAssignments
   * — so the eventual materialization emits the renamed role. Validates the
   * attribute convention (#-prefixed, no whitespace, unique).
   */
  renameRole(clusterId: string, rawName: string): RenameRoleResult {
    const roles = this.roles();
    const role = roles.find((r) => r.clusterId === clusterId);
    if (!role) return { ok: false, error: 'Unknown role.' };

    const name = rawName.trim();
    if (!name.startsWith('#')) return { ok: false, error: 'Role must start with #.' };
    if (name.length < 2) return { ok: false, error: 'Role name cannot be empty.' };
    if (/\s/.test(name)) return { ok: false, error: 'Role cannot contain spaces.' };
    if (roles.some((r) => r.clusterId !== clusterId && r.name === name)) {
      return { ok: false, error: 'Another role already uses that name.' };
    }

    const oldName = role.name;
    if (oldName === name) return { ok: true };

    this.roles.update((list) => list.map((r) => (r.clusterId === clusterId ? { ...r, name } : r)));
    this.proposals.update((list) => list.map((p) => renameRoleInProposal(p, oldName, name)));
    return { ok: true };
  }

  /**
   * Materialise ONE dial policy authorising a role to a SELECTED set of its
   * destination services (Illumio-style: a single policy, many serviceRoles).
   *
   * For every selected proposal it applies the same side-effects `materialise-
   * Proposal` would (create the brownfield service / tag the existing one, tag
   * the role's members) — but instead of one policy per destination it pushes a
   * SINGLE policy whose serviceRoles union every selected service's #svc-role.
   * Service creation is idempotent (guarded by interceptAddress) so a destination
   * shared by two roles — e.g. api.corp — is created once and authorised by both
   * roles' policies. New services carry the caller's EDITED definition (name /
   * intercept / protocol / host) when an `edits` entry is supplied, otherwise the
   * engine's derived spec. Selected proposals flip to 'approved' and the role is
   * recorded as materialised. Returns the created Policy plus the partial-
   * materialize result (tagged / unenrolled members), or null on bad input.
   */
  createRolePolicy(
    clusterId: string,
    proposalIds: readonly string[],
    rawPolicyName: string,
    edits: readonly RolePolicyServiceEdit[] = [],
  ): MaterializeResult | null {
    const role = this.roles().find((r) => r.clusterId === clusterId);
    if (!role) return null;

    const wanted = new Set(proposalIds);
    const selected = this.proposals().filter(
      (p) => wanted.has(p.id) && p.provenance.clusterIds.includes(clusterId),
    );
    if (selected.length === 0) return null;

    const editById = new Map(edits.map((e) => [e.proposalId, e]));
    const name = rawPolicyName.trim() || `dial-${role.name.replace(/^#/, '')}`;
    const serviceRoles: string[] = [];
    // Accumulate tagged / unenrolled members across the selected proposals,
    // deduped per identity (a member recurs once per destination it dials).
    const taggedMap = new Map<string, string>();
    const unenrolledMap = new Map<string, string>();

    for (const p of selected) {
      // Service side — create the brownfield service (once) or tag the existing.
      // A NEW service takes the modal's edited fields when present.
      if (p.newService) {
        const spec = p.newService;
        const edit = editById.get(p.id);
        const svcName = edit?.name.trim() || spec.name;
        const interceptAddress = edit?.interceptAddress.trim() || spec.interceptAddress;
        const protocol = edit?.protocol ?? spec.protocol;
        const hostAddress = edit?.hostAddress.trim() || spec.hostAddress;

        const exists = this.data.services().some((s) => s.interceptAddress === interceptAddress);
        if (!exists) {
          const svc: Service = {
            id: 'svc-' + Date.now().toString(36) + '-' + p.id,
            name: svcName,
            createdAt: new Date().toISOString(),
            status: 'online',
            protocol,
            interceptAddress,
            hostAddress,
            attributes: [...spec.attributes],
          };
          this.data.services.update((list) => [...list, svc]);
        } else {
          // Already created (e.g. under another role) — ensure the #svc-role sticks.
          this.data.services.update((list) =>
            list.map((s) =>
              s.interceptAddress === interceptAddress
                ? { ...s, attributes: addAttr(s.attributes ?? [], spec.attributes[0]) }
                : s,
            ),
          );
        }
      }
      for (const a of p.serviceAttributeAssignments) {
        this.data.services.update((list) =>
          list.map((s) =>
            s.id === a.serviceId ? { ...s, attributes: addAttr(s.attributes ?? [], a.attribute) } : s,
          ),
        );
      }

      // Identity side — tag THIS role's members only (a shared destination's
      // assignments also carry the other role's tag; that's not this policy's).
      // Routed through the shared choke point so the enrolled-check + partial
      // result are identical to every other materialize path.
      const res = tagRoleMembers(this.data, p.identityAttributeAssignments, role.name);
      for (const t of res.tagged) taggedMap.set(t.id, t.name);
      for (const u of res.unenrolled) unenrolledMap.set(u.id, u.name);

      for (const sr of p.policy.serviceRoles) if (!serviceRoles.includes(sr)) serviceRoles.push(sr);
    }

    const policy: Policy = {
      id: 'pol-' + Date.now().toString(36) + '-' + clusterId,
      name,
      createdAt: new Date().toISOString(),
      status: 'active',
      type: 'dial',
      semantic: 'AnyOf',
      identityRoles: [role.name],
      serviceRoles,
      postureCheckRoles: [],
    };
    this.data.policies.update((list) => [...list, policy]);

    const selIds = new Set(selected.map((p) => p.id));
    this.proposals.update((list) =>
      list.map((p) => (selIds.has(p.id) ? { ...p, status: 'approved' as ProposalStatus } : p)),
    );
    this.rolePolicies.update((list) => [
      ...list.filter((r) => r.clusterId !== clusterId),
      { clusterId, policyId: policy.id, policyName: name, serviceCount: selected.length },
    ]);
    return {
      policy,
      tagged: [...taggedMap].map(([id, name]) => ({ id, name })),
      unenrolled: [...unenrolledMap].map(([id, name]) => ({ id, name })),
    };
  }

  /**
   * Materialise the RAW "construct from selection" cards — CREATE-ONLY and PER
   * CARD. Each included card produces exactly ONE new intercept service and ONE
   * new dial policy that targets ONLY that service (never a union across cards,
   * never a tag-existing branch — every destination is unmatched by premise, so
   * a collision with a seed service still creates a NEW service). Returns the
   * created policies, one per card in order — each with its partial-materialize
   * result (tagged / unenrolled members) so the modal can surface the deferred-
   * enrollment consequence, identical to the other two creation paths.
   */
  createManualPolicy(cards: readonly ManualPolicyCard[]): MaterializeResult[] {
    return cards.map((card, i) => this.materialiseManualCard(card, i));
  }

  /**
   * ASSEMBLY (union-capable) for a dial policy's identity side — deliberately
   * mode-AGNOSTIC. Combines direct `@`-refs AND one-or-more `#`-role specs into a
   * single identityRoles list, tagging each role's members through the shared
   * `tagRoleMembers` choke point and accumulating (not overwriting) tagged /
   * unenrolled across every role spec.
   *
   * Ordering is refs-first, then role tokens in spec order — which reproduces
   * today's single-source output exactly, because callers currently pass one side
   * empty (role mode: refs=[], one roleSpec; specific mode: refs=[...], no specs).
   * The union capability exists for 1b; SELECTION stays mode-gated at the call
   * site this increment, so output is byte-identical for every existing card.
   */
  private buildIdentityGrant(
    refs: readonly string[],
    roleSpecs: readonly { role: string; identities: readonly { id: string; name: string }[] }[],
  ): { identityRoles: string[]; tagged: MaterialisedMember[]; unenrolled: MaterialisedMember[] } {
    const identityRoles: string[] = [...refs];
    const tagged: MaterialisedMember[] = [];
    const unenrolled: MaterialisedMember[] = [];
    for (const spec of roleSpecs) {
      identityRoles.push(spec.role);
      const assignments: IdentityAttributeAssignment[] = spec.identities.map((idn) => ({
        identityId: idn.id,
        identityName: idn.name,
        attribute: spec.role,
      }));
      const res = tagRoleMembers(this.data, assignments, spec.role);
      tagged.push(...res.tagged);
      unenrolled.push(...res.unenrolled);
    }
    return { identityRoles, tagged, unenrolled };
  }

  /** Create one card's new service + its dedicated dial policy. */
  private materialiseManualCard(card: ManualPolicyCard, i: number): MaterializeResult {
    const name = card.serviceName.trim();
    // The #svc-role the policy targets: the user's typed attributes, or a single
    // auto-assigned #svc-<slug(name)> so the policy always has a concrete target.
    const serviceRoles = card.attributes.length
      ? [...card.attributes]
      : ['#svc-' + (slugForId(name) || 'service')];

    // 1. Always create a NEW service. The intercept is the destination host:port.
    const interceptFull = card.interceptPort != null
      ? `${card.interceptAddress.trim()}:${card.interceptPort}`
      : card.interceptAddress.trim();
    const stamp = Date.now().toString(36) + '-' + i;
    const svc: Service = {
      // interceptFull is always populated now, so the slugForId fallback below is
      // unreachable-empty — kept only as a defensive default.
      id: 'svc-' + stamp + '-' + (slugForId(name) || slugForId(interceptFull) || 'svc'),
      name: name || interceptFull || 'service',
      createdAt: new Date().toISOString(),
      status: 'online',
      protocol: card.protocol || 'tcp',
      interceptAddress: interceptFull,
      // Intercept-only discovery: the host side is unknown — mirror the intercept.
      hostAddress: interceptFull,
      attributes: serviceRoles,
    };
    this.data.services.update((list) => [...list, svc]);

    // 2. Identity side — independent of the service create. The merged grant list
    //    feeds BOTH sides of the union-capable buildIdentityGrant at once now:
    //    `@`-refs go in verbatim (NO tagging — includes unenrolled/CIDR hosts),
    //    and each `#`-role becomes a role spec whose members are resolved by
    //    ATTRIBUTE (the existing holders of that role), NOT the observed dialers —
    //    '#all' resolves to every identity (matching resolvedIdentities semantics).
    //    Members come from real identities, so tagging is idempotent and the
    //    `unenrolled` set stays empty in practice; it's still surfaced through the
    //    same partial-materialize path createRolePolicy / materialiseProposal use.
    const roleSpecs = card.roleTokens.map((roleToken) => ({
      role: roleToken,
      identities: this.data
        .identities()
        .filter((i) => roleToken === '#all' || i.attributes.some((a) => a === roleToken))
        .map((i) => ({ id: i.id, name: i.name })),
    }));
    const { identityRoles, tagged, unenrolled } = this.buildIdentityGrant([...card.refs], roleSpecs);

    // 3. One dial policy targeting ONLY this card's service.
    const policy: Policy = {
      id: 'pol-' + stamp + '-' + (slugForId(name) || 'manual'),
      name: card.policyName.trim() || 'dial-' + (slugForId(name) || 'service'),
      createdAt: new Date().toISOString(),
      status: 'active',
      type: 'dial',
      semantic: 'AnyOf',
      identityRoles,
      serviceRoles,
      postureCheckRoles: [],
    };
    this.data.policies.update((list) => [...list, policy]);
    return { policy, tagged, unenrolled };
  }

  /** Approve → materialise into real data, then flip status. No-op if not found
   *  or already approved. Returns the created Policy (or null). */
  approve(id: string): Policy | null {
    const target = this.proposals().find((p) => p.id === id);
    if (!target || target.status === 'approved') return null;
    const { policy } = materialiseProposal(target, this.data);
    this.setStatus(id, 'approved');
    return policy;
  }

  dismiss(id: string): void {
    this.setStatus(id, 'dismissed');
  }

  reset(): void {
    this.proposals.set([]);
    this.roles.set([]);
    this.rolePolicies.set([]);
  }

  private setStatus(id: string, status: ProposalStatus): void {
    this.proposals.update((list) => list.map((p) => (p.id === id ? { ...p, status } : p)));
  }
}
