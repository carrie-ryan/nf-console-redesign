import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment.local';

/**
 * Single source of truth for the target network coordinates.
 *
 * Reads `networkGroupId` + `networkId` from the gitignored
 * environment.local.ts (captured by the Phase 0.5 probe). Every Tier 1
 * (reporting) call pulls these from here rather than hard-coding them, so
 * pointing the console at a different network is a one-file change.
 *
 * Exposed as plain readonly getters: the values are static per session
 * (they come from build-time env config, not a live API), so a signal would
 * add reactivity that never fires.
 */
@Injectable({ providedIn: 'root' })
export class NetworkContextService {
  get networkGroupId(): string {
    return environment.networkGroupId;
  }

  get networkId(): string {
    return environment.networkId;
  }
}
