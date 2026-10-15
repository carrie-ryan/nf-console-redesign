/**
 * Headless harness for the grouped-roster adapter (no UI yet — correctness lives
 * here, exactly as discovery-engine.spec.ts does for the clustering engine).
 *
 * Two kinds of assertion, deliberately kept apart:
 *
 *   • CONSERVATION — structural invariants DERIVED from the inputs. These must
 *     hold for any roster/flow set, so they are computed from the fixtures rather
 *     than written down as literals.
 *   • SEEDED SANITY — the literal counts today's fixtures actually produce.
 *     These pin the current shape so a fixture edit is a visible, deliberate
 *     change. They reflect the demo population seeded into
 *     MockDataService.identities(): the original device/persona block plus the
 *     multi-dimensional estate layered over it, where each record carries an
 *     application, a tier and a site. DISCOVERY_IDENTITIES remain untagged (their
 *     #roles come from discovery) and DISCOVERED_FLOWS is untouched, so the
 *     unmanaged arm is unchanged from cold start.
 */

import { MockDataService } from '../../shared/services/mock-data.service';
import { DISCOVERED_FLOWS } from './discovered-flows.mock';
import { enrolledSourceIds } from './source-enrollment';
import { buildGroupedRoster } from './grouped-roster.adapter';
import type { Identity } from '../../shared/services/mock-data.service';
import type { DiscoveredFlow } from './discovery.models';

describe('grouped-roster adapter — tag nodes + two-armed catch-all', () => {
  const data = new MockDataService();
  const identities = data.identities();
  const flows = DISCOVERED_FLOWS;
  const roster = buildGroupedRoster(identities, flows);

  it('DUMP — full projection (inspect this)', () => {
    const dump = {
      totals: roster.totals,
      tagNodes: roster.tagNodes.map((n) => ({
        attribute: n.attribute,
        count: n.memberCount,
        members: n.members.map((m) => m.name),
      })),
      noTag: roster.catchAll.noTag.members.map((m) => `${m.id} · ${m.name}`),
      unmanaged: roster.catchAll.unmanaged.members.map((h) => h.display),
    };

    // eslint-disable-next-line no-console
    console.log('\n===== GROUPED ROSTER DUMP =====\n' + JSON.stringify(dump, null, 2) + '\n');
    expect(dump.totals.identityCount).toBeGreaterThan(0);
  });

  // ─── conservation (derived from the inputs, not hardcoded) ──────────────────

  it('Σ tag-node member counts === Σ of every identity\'s attributes.length', () => {
    const expected = identities.reduce((sum, i) => sum + i.attributes.length, 0);
    const actual = roster.tagNodes.reduce((sum, n) => sum + n.memberCount, 0);

    expect(actual).toBe(expected);
    expect(roster.totals.tagPlacements).toBe(expected);
  });

  it('no-tag arm count === identities with attributes.length === 0', () => {
    const expected = identities.filter((i) => i.attributes.length === 0);
    expect(roster.catchAll.noTag.memberCount).toBe(expected.length);
    expect(roster.catchAll.noTag.members.map((m) => m.id).sort()).toEqual(
      expected.map((i) => i.id).sort(),
    );
  });

  it('unmanaged arm count === distinct unmanaged ingress hosts in the flows', () => {
    const enrolled = enrolledSourceIds(identities);
    const expected = new Set(
      flows
        .filter((f) => f.dialingIdentityId === null || !enrolled.has(f.dialingIdentityId))
        .map((f) => f.ingressIp),
    );

    expect(roster.catchAll.unmanaged.memberCount).toBe(expected.size);
    expect(roster.catchAll.unmanaged.members.map((h) => h.ingressIp).sort()).toEqual(
      [...expected].sort(),
    );
  });

  it('no identity appears in both a tag node and the no-tag arm', () => {
    const tagged = new Set(roster.tagNodes.flatMap((n) => n.members.map((m) => m.id)));
    const untagged = roster.catchAll.noTag.members.map((m) => m.id);

    expect(untagged.filter((id) => tagged.has(id))).toEqual([]);
    // …and together the two cover the roster exactly once each.
    expect(tagged.size + untagged.length).toBe(identities.length);
    expect(roster.totals.taggedIdentityCount).toBe(tagged.size);
  });

  it('one tag node per DISTINCT attribute across the roster', () => {
    const distinct = new Set(identities.flatMap((i) => i.attributes));
    expect(roster.tagNodes.map((n) => n.attribute).sort()).toEqual([...distinct].sort());
  });

  it('an identity with N tags appears in exactly N tag nodes', () => {
    for (const identity of identities) {
      const appearsIn = roster.tagNodes.filter((n) =>
        n.members.some((m) => m.id === identity.id),
      );
      expect(appearsIn.length).toBe(identity.attributes.length);
      // each appearance is under a tag the identity actually carries
      for (const node of appearsIn) {
        expect(identity.attributes).toContain(node.attribute);
      }
    }
  });

  it('every member row carries its identity\'s FULL tag set, not just the node\'s tag', () => {
    const byId = new Map(identities.map((i) => [i.id, i]));

    for (const node of roster.tagNodes) {
      for (const member of node.members) {
        // the row's tag set matches the roster record exactly…
        expect([...member.attributes].sort()).toEqual([...byId.get(member.id)!.attributes].sort());
        // …and always includes the tag whose node this row sits in
        expect(member.attributes).toContain(node.attribute);
      }
    }

    // a no-tag member carries an empty set, never a missing field
    for (const member of roster.catchAll.noTag.members) {
      expect(member.attributes).toEqual([]);
    }
  });

  it('a double-tagged identity shows BOTH tags from either node it sits under', () => {
    const usersNode = roster.tagNodes.find((n) => n.attribute === '#users');
    const laptopsNode = roster.tagNodes.find((n) => n.attribute === '#laptops');

    const fromUsers = usersNode?.members.find((m) => m.name === 'laptop-bhatt');
    const fromLaptops = laptopsNode?.members.find((m) => m.name === 'laptop-bhatt');

    expect([...(fromUsers?.attributes ?? [])].sort()).toEqual(['#laptops', '#users']);
    expect([...(fromLaptops?.attributes ?? [])].sort()).toEqual(['#laptops', '#users']);
  });

  it('every tag node member carries that tag, and node membership is a set', () => {
    const byId = new Map(identities.map((i) => [i.id, i]));
    for (const node of roster.tagNodes) {
      const ids = node.members.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(node.memberCount).toBe(node.members.length);
      for (const id of ids) {
        expect(byId.get(id)?.attributes).toContain(node.attribute);
      }
    }
  });

  // ─── the two catch-all arms stay distinct shapes ────────────────────────────

  it('the unmanaged arm carries host refs, never an identity or a principal name', () => {
    const identityIds = new Set(identities.map((i) => i.id));
    const identityNames = new Set(identities.map((i) => i.name));

    for (const host of roster.catchAll.unmanaged.members) {
      // a host ref has no id/name fields at all…
      expect(Object.keys(host).sort()).toEqual(['display', 'ingressIp']);
      // …its address resolves to no Identity…
      expect(identityIds.has(host.ingressIp)).toBe(false);
      // …and it is never displayed under a managed identity's name.
      expect(identityNames.has(host.display)).toBe(false);
    }
  });

  it('no managed source leaks into the unmanaged arm', () => {
    const enrolled = enrolledSourceIds(identities);
    const managedIps = new Set(
      flows
        .filter((f) => f.dialingIdentityId !== null && enrolled.has(f.dialingIdentityId))
        .map((f) => f.ingressIp),
    );
    for (const host of roster.catchAll.unmanaged.members) {
      expect(managedIps.has(host.ingressIp)).toBe(false);
    }
  });

  // ─── seeded sanity (the literal shape today's fixtures produce) ─────────────
  // NOTE: these counts reflect the DELIBERATE seed in MockDataService.identities()
  // — the original tagged-demo block PLUS the multi-dimensional estate
  // (application / role / location) layered over it, PLUS two router identities
  // (no attributes) — not a cold-start roster.

  it('seeded roster: 18 tag nodes, 13 no-tag identities, 19 unmanaged hosts', () => {
    expect(roster.totals.identityCount).toBe(86);
    expect(roster.totals.tagNodeCount).toBe(18);
    expect(roster.totals.tagPlacements).toBe(231);
    expect(roster.totals.taggedIdentityCount).toBe(73);
    expect(roster.totals.noTagCount).toBe(13);
    // flows are untouched by the seed extension — this arm must not move
    expect(roster.totals.unmanagedCount).toBe(19);
  });

  it('seeded roster: every tag node is genuinely multi-member', () => {
    const sizeOf = (attribute: string) =>
      roster.tagNodes.find((n) => n.attribute === attribute)?.memberCount;

    // device / persona vocabulary (the original block, grown by the estate)
    expect(sizeOf('#users')).toBe(16);
    expect(sizeOf('#laptops')).toBe(11);
    expect(sizeOf('#servers')).toBe(31);
    expect(sizeOf('#prod')).toBe(11);
    expect(sizeOf('#admins')).toBe(3);
    expect(sizeOf('#kiosks')).toBe(6);
    expect(sizeOf('#mobile')).toBe(5);
    // application dimension
    expect(sizeOf('#app-payments')).toBe(14);
    expect(sizeOf('#app-crm')).toBe(13);
    expect(sizeOf('#app-logistics')).toBe(14);
    expect(sizeOf('#app-analytics')).toBe(10);
    // role (tier) dimension
    expect(sizeOf('#role-web')).toBe(10);
    expect(sizeOf('#role-api')).toBe(12);
    expect(sizeOf('#role-db')).toBe(8);
    expect(sizeOf('#role-worker')).toBe(12);
    // location dimension
    expect(sizeOf('#loc-us-east')).toBe(21);
    expect(sizeOf('#loc-eu')).toBe(19);
    expect(sizeOf('#loc-plant')).toBe(15);

    // no tag-node is a singleton — every node reads as a group, and every circle
    // on the map stays above the radius where it can still show its own count
    expect(roster.tagNodes.filter((n) => n.memberCount === 1)).toEqual([]);
  });

  it('seeded roster: multi-membership is the norm, up to five tags deep', () => {
    const byId = new Map(identities.map((i) => [i.id, i]));
    const appearances = new Map<string, number>();
    for (const node of roster.tagNodes) {
      for (const member of node.members) {
        appearances.set(member.id, (appearances.get(member.id) ?? 0) + 1);
      }
    }
    const counts = [...appearances.values()];

    // An identity is filed under exactly as many nodes as it has tags — the
    // invariant that actually matters, asserted derived rather than pinned.
    for (const [id, count] of appearances) {
      expect(count).toBe(byId.get(id)!.attributes.length);
    }

    // The estate is deliberately DEEP, not a two-tag pairing: a host carries an
    // application, a tier and a site, and often a device tag on top. This is what
    // gives the overlap lines something to reveal, so it is pinned.
    expect(Math.max(...counts)).toBe(5);
    expect(counts.filter((c) => c === 1).length).toBe(8);
    expect(counts.filter((c) => c === 2).length).toBe(12);
    expect(counts.filter((c) => c >= 3).length).toBe(53);
    // every tagged identity is accounted for by those three buckets
    expect(counts.length).toBe(roster.totals.taggedIdentityCount);
  });

  it('seeded roster: the no-tag arm holds MANAGED identities beyond the disc-* eight', () => {
    const ids = roster.catchAll.noTag.members.map((m) => m.id);
    const disc = ids.filter((id) => id.startsWith('disc-'));
    const seeded = ids.filter((id) => id.startsWith('id-'));

    expect(disc.length).toBe(8);
    // id-077 / id-078: the router identities, which carry no attributes.
    expect(seeded.sort()).toEqual(['id-019', 'id-020', 'id-021', 'id-077', 'id-078']);
  });

  it('cold-start fixtures: unmanaged hosts display as their own address', () => {
    for (const host of roster.catchAll.unmanaged.members) {
      expect(host.display).toBe(host.ingressIp);
    }
  });

  // ─── invariants hold away from the fixtures too ─────────────────────────────

  it('holds on an empty roster and empty flows', () => {
    const empty = buildGroupedRoster([], []);
    expect(empty.tagNodes).toEqual([]);
    expect(empty.catchAll.noTag.memberCount).toBe(0);
    expect(empty.catchAll.unmanaged.memberCount).toBe(0);
    expect(empty.totals.tagPlacements).toBe(0);
  });

  it('a stale non-null dialingIdentityId that resolves to nobody is unmanaged, shown by IP', () => {
    const stale: DiscoveredFlow = {
      ...flows[0],
      id: 'flow-stale',
      dialingIdentityId: 'disc-does-not-exist',
      dialingIdentityName: 'ghost-ws',
      ingressIp: '10.99.99.99',
      ingressEntityName: 'ghost-ws',
    };
    const built = buildGroupedRoster(identities, [stale]);

    expect(built.catchAll.unmanaged.members).toEqual([
      { ingressIp: '10.99.99.99', display: '10.99.99.99' },
    ]);
  });

  it('throws on a blank attribute token rather than inventing a bucket', () => {
    const bad: Identity = { ...identities[0], id: 'id-blank', attributes: ['  '] };
    expect(() => buildGroupedRoster([bad], [])).toThrow(/blank attribute/);
  });

  it('throws on a flow missing ingressIp', () => {
    const bad: DiscoveredFlow = { ...flows[0], id: 'flow-bad', dialingIdentityId: null, ingressIp: '' };
    expect(() => buildGroupedRoster(identities, [bad])).toThrow(/missing ingressIp/);
  });
});
