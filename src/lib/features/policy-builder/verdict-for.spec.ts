/**
 * verdictFor (index counts, no layout) equals the layout's verdict for every service,
 * in the seed and in a 500 × 50 scale world.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/verdict-for.spec.ts`
 */

import { buildScaleWorld } from '../authorization/scale-world';
import type { TrifectaWorld } from '../authorization/trifecta-resolver';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { layoutServiceView, verdictFor } from './service-view.layout';

const everyService = (world: TrifectaWorld) => {
  for (const s of world.services) {
    // A fresh world object each side: no shared caches between the two paths.
    expect(verdictFor(s.id, { ...world }), s.id).toEqual(layoutServiceView(s.id, { ...world }).serviceVerdict);
  }
};

describe('verdictFor == layoutServiceView(…).serviceVerdict', () => {
  it('every service in the seed', () => everyService(buildSeedWorld()));
  it('every service in a 500 × 50 scale world', () => everyService(buildScaleWorld(1, { identities: 500, services: 50 })));
});
