/**
 * Assembles a TrifectaWorld from MockDataService's seed arrays.
 *
 * MockDataService is `providedIn: 'root'` with no injected dependencies, so it can
 * be constructed directly — no TestBed / injection context needed. Each seed
 * collection is a WritableSignal; the world is a point-in-time SNAPSHOT of them
 * (later signal writes are not reflected).
 */

import { MockDataService } from '../../shared/services/mock-data.service';
import type { TrifectaWorld } from './trifecta-resolver';

export function buildSeedWorld(data: MockDataService = new MockDataService()): TrifectaWorld {
  return {
    identities: data.identities(),
    services: data.services(),
    edgeRouters: data.edgeRouters(),
    policies: data.policies(),
    edgeRouterPolicies: data.edgeRouterPolicies(),
    serviceEdgeRouterPolicies: data.serviceEdgeRouterPolicies(),
    terminators: data.terminators(),
    postureChecks: data.postureChecks(),
    postureResults: data.postureResults(),
    accessTests: data.accessTests(),
  };
}
