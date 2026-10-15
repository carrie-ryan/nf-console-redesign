/**
 * Intercepts: the model (derived from interceptAddress unless set), overlap rules
 * (names, '*.domain' wildcards, CIDR ranges, ports, protocols), and per-identity
 * conflicts between services it may dial.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/intercepts.spec.ts`
 */

import { describe, expect, it } from 'vitest';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import type { Intercept } from '../../shared/services/mock-data.service';
import { applyDraft, type DraftOp } from './draft/policy-draft';
import { interceptConflicts, interceptOf, overlapOf, overlaps } from './intercepts';

const seed = buildSeedWorld();
const svc = (name: string) => seed.services.find((s) => s.name === name)!;

const ic = (addresses: string[], ports: [number, number][] = [[443, 443]], protocols: Intercept['protocols'] = ['tcp']): Intercept => ({
  addresses,
  portRanges: ports.map(([low, high]) => ({ low, high })),
  protocols,
});

describe('interceptOf', () => {
  it('derives from interceptAddress; svc-001/002/003 unchanged, interceptAddress kept', () => {
    expect(interceptOf(svc('gitlab-internal'))).toEqual(ic(['gitlab.corp'], [[22, 22]]));
    expect(interceptOf(svc('app-api-prod'))).toEqual(ic(['api.corp'], [[443, 443]])); // https → tcp
    expect(interceptOf(svc('postgres-db'))).toEqual(ic(['db.corp'], [[5432, 5432]]));
    for (const id of ['svc-001', 'svc-002', 'svc-003']) expect(seed.services.find((s) => s.id === id)!.intercept).toBeUndefined();
  });

  it('reports-svc intercepts *.corp.internal on 443/tcp; its interceptAddress stays', () => {
    expect(interceptOf(svc('reports-svc'))).toEqual(ic(['*.corp.internal']));
    expect(svc('reports-svc').interceptAddress).toBe('reports.corp.internal:443');
  });

  it('port ranges, udp, and no port', () => {
    expect(interceptOf({ interceptAddress: 'dns.corp:5000-5010', protocol: 'udp' })).toEqual(ic(['dns.corp'], [[5000, 5010]], ['udp']));
    expect(interceptOf({ interceptAddress: '10.0.0.0/8', protocol: 'tcp' })).toEqual(ic(['10.0.0.0/8'], [[0, 65535]]));
  });
});

describe('overlaps', () => {
  it('names: exact, any case', () => {
    expect(overlaps(ic(['API.corp']), ic(['api.corp']))).toBe(true);
    expect(overlaps(ic(['api.corp']), ic(['db.corp']))).toBe(false);
  });

  it('wildcards cover names in the domain (any depth), not the domain itself', () => {
    expect(overlapOf(ic(['*.corp.internal']), ic(['api-prod.corp.internal']))!.address).toBe('api-prod.corp.internal');
    expect(overlaps(ic(['*.corp.internal']), ic(['a.b.corp.internal']))).toBe(true);
    expect(overlaps(ic(['*.corp.internal']), ic(['corp.internal']))).toBe(false);
    expect(overlaps(ic(['*.corp.internal']), ic(['evilcorp.internal']))).toBe(false);
    expect(overlapOf(ic(['*.corp.internal']), ic(['*.eu.corp.internal']))!.address).toBe('*.eu.corp.internal');
    expect(overlaps(ic(['*.corp.internal']), ic(['*.corp.external']))).toBe(false);
  });

  it('IPs inside CIDR ranges; ranges that intersect; names never match IPs', () => {
    expect(overlapOf(ic(['10.0.4.0/24']), ic(['10.0.4.20']))!.address).toBe('10.0.4.20');
    expect(overlaps(ic(['10.0.4.0/24']), ic(['10.0.5.20']))).toBe(false);
    expect(overlapOf(ic(['10.0.0.0/8']), ic(['10.1.0.0/16']))!.address).toBe('10.1.0.0/16');
    expect(overlaps(ic(['10.0.0.0/16']), ic(['10.1.0.0/16']))).toBe(false);
    expect(overlaps(ic(['10.0.4.20']), ic(['10.0.4.20']))).toBe(true);
    expect(overlaps(ic(['*.corp']), ic(['10.0.4.20']))).toBe(false);
  });

  it('port ranges must intersect; the shared range is reported', () => {
    expect(overlapOf(ic(['a.corp'], [[8000, 8100]]), ic(['a.corp'], [[8080, 9000]]))!.ports).toEqual({ low: 8080, high: 8100 });
    expect(overlaps(ic(['a.corp'], [[22, 22]]), ic(['a.corp'], [[443, 443]]))).toBe(false);
    expect(overlaps(ic(['a.corp'], [[22, 22], [443, 443]]), ic(['a.corp'], [[443, 443]]))).toBe(true);
  });

  it('protocols must be shared', () => {
    expect(overlaps(ic(['a.corp'], [[53, 53]], ['udp']), ic(['a.corp'], [[53, 53]], ['tcp']))).toBe(false);
    expect(overlapOf(ic(['a.corp'], [[53, 53]], ['udp', 'tcp']), ic(['a.corp'], [[53, 53]], ['udp']))!.protocols).toEqual(['udp']);
  });
});

describe('interceptConflicts', () => {
  const admins = seed.identities.filter((i) => i.attributes?.includes('#admins')).map((i) => i.id);
  const dialReports: DraftOp = {
    kind: 'create',
    policy: {
      id: 'pol-admins-reports', name: 'admins-reports', createdAt: '2026-01-01T00:00:00Z', status: 'active',
      type: 'dial', semantic: 'AnyOf', identityRoles: ['#admins'], serviceRoles: ['@svc-008'], postureCheckRoles: [],
    },
  };

  it('the seed has none', () => {
    expect(interceptConflicts(seed)).toEqual([]);
  });

  it('#admins dialing reports-svc: each admin, and only they, get api-prod × reports-svc on api-prod.corp.internal:443', () => {
    expect(admins.length).toBeGreaterThan(0);
    const draft = applyDraft(seed, [dialReports]);
    const conflicts = interceptConflicts(draft);
    expect(conflicts.map((c) => c.identityId)).toEqual(admins);
    for (const c of conflicts) {
      expect(c.overlaps).toEqual([
        {
          serviceIds: ['svc-005', 'svc-008'],
          serviceNames: ['api-prod', 'reports-svc'],
          address: 'api-prod.corp.internal',
          ports: { low: 443, high: 443 },
          protocols: ['tcp'],
        },
      ]);
    }
  });

  it('removing it clears them', () => {
    const draft = applyDraft(seed, [dialReports]);
    const undone = applyDraft(draft, [{ kind: 'delete', policyId: 'pol-admins-reports' }]);
    expect(interceptConflicts(undone)).toEqual([]);
  });
});
