/**
 * The scale fixture: deterministic, and its access tests all pass on live.
 *
 * Run `npx ng test --watch=false --include src/lib/features/authorization/scale-world.spec.ts`
 */

import { evaluateTests } from '../policy-builder/access-tests';
import { buildScaleWorld } from './scale-world';

describe('buildScaleWorld', () => {
  // A smaller world keeps this in the default suite; the rules are the same at full size.
  const sizes = { identities: 600, services: 60 };

  it('is deterministic', () => {
    expect(JSON.stringify(buildScaleWorld(3, sizes))).toBe(JSON.stringify(buildScaleWorld(3, sizes)));
  });

  it('builds 10 access tests of each kind, all passing on live', () => {
    const w = buildScaleWorld(1, sizes);
    expect(w.accessTests!.map((t) => t.kind)).toEqual([
      'mustNotDial', 'mustNotDial', 'mustNotDial', 'mustNotDial', 'mustNotHost', 'mustNotHost', 'mustNotHost', 'mustConnect', 'mustConnect', 'mustConnect',
    ]);
    const results = evaluateTests(w);
    expect(results.filter((r) => !r.pass).map((r) => `${r.text}: ${r.problem ?? r.offenders[0]?.reason}`)).toEqual([]);
  });
});
