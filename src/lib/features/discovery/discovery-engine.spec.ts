/**
 * Inspectable, headless harness for the discovery → policy engine.
 *
 * This is where correctness lives (no UI yet). It runs the real engine over the
 * authored mock flows, DUMPS the clusters + Jaccard scores + rationale +
 * proposals to the console (run with `npx ng test` and read the output), and
 * asserts that the intended network EMERGES from the math — clusters are never
 * asserted into existence, they are checked after the fact.
 */

import { MockDataService } from '../../shared/services/mock-data.service';
import { DISCOVERED_FLOWS, DISCOVERY_IDENTITIES } from './discovered-flows.mock';
import { CLUSTER_SIMILARITY_THRESHOLD, runDiscovery } from './discovery-engine';
// Reuse the pure materialiser directly for the headless approval test.
import { materialiseProposal } from './proposed-policy-store.service';
import type { ProposedPolicy } from './discovery.models';

describe('discovery engine — clustering emerges from Jaccard math', () => {
  const data = new MockDataService();
  const services = data.services();
  const result = runDiscovery(DISCOVERED_FLOWS, services);

  it('DUMP — full engine output (inspect this)', () => {
    const dump = {
      threshold: result.clustering.threshold,
      identityCount: result.vectors.length,
      flowCount: DISCOVERED_FLOWS.length,

      serviceVectors: result.vectors.map((v) => ({
        id: v.identityId,
        name: v.identityName,
        dials: [...v.destinations].sort(),
        totalCircuits: v.totalCircuits,
      })),

      destinationMatches: result.matches.map((m) => ({
        dest: m.destinationHostPort,
        matched: m.matched ? m.matchedServiceName : 'UNMATCHED (brownfield)',
        volume: m.totalCircuitCount,
        dialers: m.dialerIdentityIds.length,
      })),

      clusters: result.clustering.clusters.map((c) => ({
        role: c.role,
        members: c.memberNames,
        sharedDestinations: c.sharedDestinations,
        minPairwiseJaccard: c.minPairwiseJaccard,
        avgPairwiseJaccard: c.avgPairwiseJaccard,
        pairwise: c.pairwise.map((p) => `${p.aId}~${p.bId} = ${p.jaccard} {${p.sharedDestinations.join(', ')}}`),
      })),

      ungroupedTail: result.clustering.ungrouped.map((u) => ({
        name: u.identityName,
        dials: u.destinations,
        closestNeighbour: `${u.bestMatchIdentityName} @ ${u.bestJaccard} (< ${result.clustering.threshold})`,
        reason: u.reason,
      })),

      proposalsRankedByVolume: result.proposals.map((p) => ({
        dest: p.destinationHostPort,
        volume: p.totalCircuitCount,
        kind: p.matched ? 'DIAL existing svc' : 'NEW svc + DIAL',
        identityRoles: p.policy.identityRoles,
        serviceRoles: p.policy.serviceRoles,
        flags: [p.lowVolume ? 'LOW-VOLUME/noise' : '', p.ungroupedOnly ? 'UNGROUPED-ONLY' : ''].filter(Boolean),
        rationale: p.rationale,
      })),
    };

    // eslint-disable-next-line no-console
    console.log('\n===== DISCOVERY ENGINE DUMP =====\n' + JSON.stringify(dump, null, 2) + '\n');
    expect(dump.clusters.length).toBeGreaterThan(0);
  });

  it('input identities carry NO cluster attributes (roles come from discovery)', () => {
    expect(DISCOVERY_IDENTITIES.every((i) => i.attributes.length === 0)).toBe(true);
  });

  it('forms exactly the 5 functional groups — from the math, not hardcoded', () => {
    const clusters = result.clustering.clusters;
    // One cluster per CIDR block that shares a dial-set (5 of the 6 blocks; the
    // DMZ block is the scattered tail). Members are a MIX of enrolled ids
    // (disc-0NN) and unenrolled source IPs — clustering keys off the id opaquely.
    expect(clusters.length).toBe(5);

    const clusterOf = (id: string) => clusters.find((c) => c.memberIds.includes(id));

    // Engineering workstations (10.30.11.0/24) — 2 enrolled + 3 unenrolled
    const eng = clusterOf('disc-001');
    expect(eng?.memberIds.slice().sort()).toEqual(
      ['10.30.11.22', '10.30.11.23', '10.30.11.25', 'disc-001', 'disc-002'],
    );
    // Grouped because they share the dev toolchain (one skips api, one adds wiki)
    expect(eng?.sharedDestinations).toEqual(
      ['artifactory.corp:443', 'gitlab.corp:22', 'jenkins.corp:8080'].sort(),
    );

    // Plant-floor gateways (10.70.1.0/24) — 1 enrolled + 3 unenrolled
    const plant = clusterOf('disc-005');
    expect(plant?.memberIds.slice().sort()).toEqual(
      ['10.70.1.52', '10.70.1.53', '10.70.1.54', 'disc-005'],
    );

    // Admin/ops workstations (10.10.20.0/24) — 1 enrolled + 3 unenrolled
    const admin = clusterOf('disc-008');
    expect(admin?.memberIds.slice().sort()).toEqual(
      ['10.10.20.42', '10.10.20.43', '10.10.20.44', 'disc-008'],
    );

    // IT infrastructure / identity (10.10.30.0/24) — 2 enrolled domain-admins + 3 unenrolled
    // (grouped because they share ldap+kerberos+dns+smb; domain-admins add bastion)
    const domain = clusterOf('disc-017');
    expect(domain?.memberIds.slice().sort()).toEqual(
      ['10.10.30.13', '10.10.30.14', '10.10.30.15', 'disc-017', 'disc-018'],
    );

    // Database administration (10.10.31.0/24) — 1 enrolled + 3 unenrolled
    const dba = clusterOf('disc-023');
    expect(dba?.memberIds.slice().sort()).toEqual(
      ['10.10.31.22', '10.10.31.23', '10.10.31.24', 'disc-023'],
    );
  });

  it('COMPLETE-LINKAGE guarantee: every intra-cluster pair >= threshold', () => {
    for (const c of result.clustering.clusters) {
      expect(c.minPairwiseJaccard).toBeGreaterThanOrEqual(CLUSTER_SIMILARITY_THRESHOLD);
      for (const p of c.pairwise) {
        expect(p.jaccard).toBeGreaterThanOrEqual(CLUSTER_SIMILARITY_THRESHOLD);
      }
    }
  });

  it('the messy tail stays ungrouped — not forced into clusters', () => {
    const ungroupedIds = result.clustering.ungrouped.map((u) => u.identityId).sort();
    // The DMZ block (192.168.60.0/24) — scattered, unique reaches: 4 unenrolled IPs
    // + 1 enrolled contractor (disc-014). Each clears the threshold with nobody.
    expect(ungroupedIds).toEqual(
      [
        '192.168.60.10', '192.168.60.12', '192.168.60.8', '192.168.60.9', 'disc-014',
      ].sort(),
    );
    // Every tail member's closest neighbour is BELOW threshold (that's why it's alone).
    for (const u of result.clustering.ungrouped) {
      expect(u.bestJaccard).toBeLessThan(CLUSTER_SIMILARITY_THRESHOLD);
    }
  });

  it('proposals cover matched + unmatched, ranked by volume descending', () => {
    const proposals = result.proposals;

    // Ranked (non-increasing) by volume.
    for (let i = 1; i < proposals.length; i += 1) {
      expect(proposals[i - 1].totalCircuitCount).toBeGreaterThanOrEqual(proposals[i].totalCircuitCount);
    }

    // Roles are derived from the clusters that emerged (group numbers are
    // volume-rank, NOT semantic) — so look them up by a known member.
    const clusters = result.clustering.clusters;
    const engRole = clusters.find((c) => c.memberIds.includes('disc-001'))?.role;
    const adminRole = clusters.find((c) => c.memberIds.includes('disc-008'))?.role;
    expect(engRole).toBeDefined();
    expect(adminRole).toBeDefined();

    // Matched destinations → dial existing service + tag it.
    const gitlab = proposals.find((p) => p.destinationHostPort === 'gitlab.corp:22');
    expect(gitlab?.matched).toBe(true);
    expect(gitlab?.newService).toBeNull();
    expect(gitlab?.serviceAttributeAssignments.length).toBe(1);
    // gitlab is dialed only by the engineering cluster (the DMZ dialers are tail).
    expect(gitlab?.policy.identityRoles).toEqual([engRole]);

    // api is dialed by BOTH eng and admin clusters → two identity roles.
    const api = proposals.find((p) => p.destinationHostPort === 'api.corp:443');
    expect(api?.policy.identityRoles.sort()).toEqual([engRole, adminRole].sort());

    // Unmatched destinations → propose a NEW service.
    const scada = proposals.find((p) => p.destinationHostPort === 'scada.plant:502');
    expect(scada?.matched).toBe(false);
    expect(scada?.newService?.interceptAddress).toBe('scada.plant:502');

    // wiki: 1 eng member + 2 ungrouped, tiny volume → ungrouped-only + noise flag.
    const wiki = proposals.find((p) => p.destinationHostPort === 'wiki.corp:443');
    expect(wiki?.ungroupedOnly).toBe(true);
    expect(wiki?.lowVolume).toBe(true);
    expect(wiki?.policy.identityRoles.length).toBe(0);
  });

  it('materialises a proposal into real Policy + partial-materialize result (Part 5 / step 2)', () => {
    const fresh = new MockDataService();
    const enrolledId = (id: string) => fresh.identities().some((i) => i.id === id);

    // Pick a proposal whose cluster is MIXED (both enrolled disc-ids and unenrolled
    // bare-IP members) so both the `tagged` and `unenrolled` result arrays are
    // exercised — CIDR-first #discovered-group-1 (eng) is 2 enrolled + 3 unenrolled.
    const top = result.proposals.find(
      (p) =>
        p.identityAttributeAssignments.some((a) => enrolledId(a.identityId)) &&
        p.identityAttributeAssignments.some((a) => !enrolledId(a.identityId)),
    );
    expect(top).toBeDefined();
    const staged: ProposedPolicy = { ...top!, status: 'proposed' };

    const beforePolicies = fresh.policies().length;
    const beforeServices = fresh.services().length;

    const created = materialiseProposal(staged, fresh);

    // A real Policy was appended (now nested under .policy).
    expect(fresh.policies().length).toBe(beforePolicies + 1);
    expect(created.policy.type).toBe('dial');
    expect(created.policy.status).toBe('active');

    // Matched → existing service tagged; unmatched → new service created.
    if (top!.matched) {
      expect(fresh.services().length).toBe(beforeServices);
      const svcId = top!.serviceAttributeAssignments[0].serviceId;
      const svc = fresh.services().find((s) => s.id === svcId);
      expect(svc?.attributes).toContain(top!.policy.serviceRoles[0]);
    } else {
      expect(fresh.services().length).toBe(beforeServices + 1);
    }

    // Partial-materialize: only ENROLLED members are tagged; UNENROLLED sources
    // (bare-IP ids) are returned in `unenrolled`, not silently skipped.
    const enrolledAssignments = top!.identityAttributeAssignments.filter((a) => enrolledId(a.identityId));
    const unenrolledAssignments = top!.identityAttributeAssignments.filter((a) => !enrolledId(a.identityId));
    expect(enrolledAssignments.length).toBeGreaterThan(0);
    expect(unenrolledAssignments.length).toBeGreaterThan(0);

    // `tagged` equals the enrolled subset — each actually carries the #role now.
    expect(created.tagged.map((m) => m.id).sort()).toEqual(
      enrolledAssignments.map((a) => a.identityId).sort(),
    );
    for (const a of enrolledAssignments) {
      const ident = fresh.identities().find((i) => i.id === a.identityId);
      expect(ident?.attributes).toContain(a.attribute);
    }

    // `unenrolled` equals the bare-IP assignments; id === name === the IP, and none
    // of them was tagged (there is no Identity to carry the attribute).
    expect(created.unenrolled.length).toBeGreaterThan(0);
    expect(created.unenrolled.map((m) => m.id).sort()).toEqual(
      unenrolledAssignments.map((a) => a.identityId).sort(),
    );
    for (const m of created.unenrolled) {
      expect(m.id).toBe(m.name); // CIDR-first unenrolled source: id === name === IP
      expect(enrolledId(m.id)).toBe(false);
    }

    // eslint-disable-next-line no-console
    console.log('\n===== MATERIALISED RESULT =====\n' + JSON.stringify(created, null, 2) + '\n');
  });
});
