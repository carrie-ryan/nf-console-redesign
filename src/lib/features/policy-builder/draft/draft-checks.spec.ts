/**
 * Draft checks: the review computation off the edit path. The async path, run to
 * completion (yielding after every step), must give exactly what the synchronous
 * functions give; the service debounces, reports progress, restarts on a new edit,
 * and keeps Commit disabled until it's done.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/draft/draft-checks.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { buildSeedWorld } from '../../authorization/trifecta-world.adapter';
import { evaluateTests } from '../access-tests';
import { DraftReviewComponent } from '../draft-review.component';
import { hostingChanges } from '../hosting';
import { CHECK_DEBOUNCE_MS, DraftChecks, runChecks, runChecksSync } from './draft-checks';
import { diffWorlds, type DraftDiff } from './draft-diff';
import { PolicyDraftStore } from './policy-draft.store';
import { LazyDiffs, calculatingText, reachText } from './lazy-diffs';
import { applyDraft, type DraftOp } from './policy-draft';
import { previewFromDiff, previewText } from '../posture-panel.model';
import { opGenerator, randomDraft } from './random-drafts.testing';
import { affectedPairs } from './affected-services';

describe('async checks == synchronous path', () => {
  const live = buildSeedWorld();

  it('random drafts: diff, hosting changes and tests are identical', async () => {
    const gen = opGenerator(99);
    for (let i = 0; i < 40; i++) {
      const { draft } = randomDraft(gen, live, 1 + (i % 3));
      const progress: number[] = [];
      // sliceMs 0: yield to the event loop after every step.
      const result = await runChecks(live, draft, (p) => progress.push(p.done), () => false, 0);
      expect(result).toEqual({
        diff: diffWorlds({ ...live }, draft, { scope: 'all' }),
        hosting: hostingChanges({ ...live }, draft),
        tests: evaluateTests(draft, { ...live }),
      });
      expect(runChecksSync(live, draft).result).toEqual(result);
      // Progress only goes forward.
      expect(progress).toEqual([...progress].sort((a, b) => a - b));
    }
  });

  it('a cancelled run stops and resolves null', async () => {
    const { draft } = randomDraft(opGenerator(5), live, 3);
    let steps = 0;
    const result = await runChecks(live, draft, () => steps++, () => steps > 1, 0);
    expect(result).toBeNull();
  });
});

describe('DraftChecks service', () => {
  let store: PolicyDraftStore;
  let checks: DraftChecks;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    store = TestBed.inject(PolicyDraftStore);
    checks = TestBed.inject(DraftChecks);
  });
  afterEach(() => vi.useRealTimers());

  const settle = async (ms: number) => {
    TestBed.tick(); // run the scheduling effect
    await vi.advanceTimersByTimeAsync(ms);
  };

  it('checking until 300 ms after the last change, then the synchronous result', async () => {
    store.upsertUpdate('pol-002', { semantic: 'AllOf', identityRoles: ['#users', '#laptops'] });
    expect(checks.state().status).toBe('checking');
    // affectedServices is synchronous: the count is there at once.
    expect(checks.affected()).toEqual(['svc-004', 'svc-006', 'svc-007']);
    expect(checks.state().total).toBe(3);

    await settle(CHECK_DEBOUNCE_MS - 1);
    expect(checks.state().status).toBe('checking');
    await settle(200);
    const s = checks.state();
    expect(s.status).toBe('done');
    expect(s.result!.diff).toEqual(diffWorlds(store.live(), store.draftWorld()));
    expect(s.result!.tests).toEqual(evaluateTests(store.draftWorld(), store.live()));
  });

  it('a new edit restarts the checks: the result is for the latest draft', async () => {
    store.upsertUpdate('pol-002', { name: 'a' });
    await settle(CHECK_DEBOUNCE_MS + 1);
    store.upsertUpdate('pol-005', { identityRoles: ['#nobody'] });
    expect(checks.state().status).toBe('checking');
    await settle(CHECK_DEBOUNCE_MS + 200);
    expect(checks.state().result!.diff).toEqual(diffWorlds(store.live(), store.draftWorld()));
  });

  it('the review: "Checking N of M services…" and Commit disabled, then results', async () => {
    store.upsertUpdate('pol-002', { semantic: 'AllOf', identityRoles: ['#users', '#laptops'] });
    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-004');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const commit = () => [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Commit'))!;

    expect(el.querySelector('.dr-checking')!.textContent).toContain('Checking 0 of 3 services…');
    expect(el.textContent).toContain('This draft also affects 2 other services.');
    expect(commit().disabled).toBe(true);
    fixture.componentInstance.commit();
    expect(store.ops()).toHaveLength(1); // guarded, not just disabled

    await settle(CHECK_DEBOUNCE_MS + 200);
    fixture.detectChanges();
    expect(el.querySelector('.dr-checking')).toBeNull();
    expect(el.querySelectorAll('.dr-row')).toHaveLength(3);
    expect(commit().disabled).toBe(false);
  });
});

describe('no draft: cached live results, never checking', () => {
  it('done at once, with live\'s own test results, evaluated once per live world', () => {
    TestBed.configureTestingModule({});
    const checks = TestBed.inject(DraftChecks);
    const store = TestBed.inject(PolicyDraftStore);
    const s = checks.state();
    expect(s.status).toBe('done');
    expect(s.result!.tests).toEqual(evaluateTests(store.live()));
    expect(s.result!.diff.services).toEqual([]);
    expect(checks.state().result!.tests).toBe(s.result!.tests); // the cached array
  });
});

describe('LazyDiffs', () => {
  it('fills each preview in after the first render — equal to the synchronous mapping', async () => {
    const live = buildSeedWorld();
    const ops: DraftOp[] = [{ kind: 'update', policyId: 'pol-002', patch: { postureCheckRoles: ['#mfa-required'] } }];
    const lazy = new LazyDiffs<string[]>();
    lazy.run([{ key: 'fix', world: live, ops, map: (diff) => previewFromDiff(live, diff).map(previewText) }]);
    expect(lazy.results().get('fix')).toBeUndefined(); // "Calculating…"
    await vi.waitFor(() => expect(lazy.results().get('fix')).toBeDefined());
    expect(lazy.results().get('fix')).toEqual(previewFromDiff(live, diffWorlds(live, applyDraft(live, ops))).map(previewText));
    expect(lazy.results().get('fix')).toEqual(['git-repo: can connect 17 → 1 · blocked by posture 1 → 17']);
  });

  it('a new run abandons the old one', async () => {
    const live = buildSeedWorld();
    const lazy = new LazyDiffs<number>();
    lazy.run([{ key: 'a', world: live, ops: [{ kind: 'delete', policyId: 'pol-002' }], map: (d) => d.services.length }]);
    lazy.run([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(lazy.results().size).toBe(0);
  });

  it('only wanted jobs run, topmost first (screen order)', async () => {
    const live = buildSeedWorld();
    const lazy = new LazyDiffs<number>();
    const job = (key: string, policyId: string) => ({ key, world: live, ops: [{ kind: 'delete', policyId } as DraftOp], map: (d: DraftDiff) => d.services.length });
    lazy.setJobs([job('a', 'pol-001'), job('b', 'pol-002'), job('c', 'pol-003')]);
    lazy.want('c');
    lazy.want('a'); // both on screen before work starts: 'a' (higher) goes first
    await vi.waitFor(() => expect(lazy.results().size).toBe(2));
    expect([...lazy.results().keys()]).toEqual(['a', 'c']);
    await new Promise((r) => setTimeout(r, 20));
    expect(lazy.results().has('b')).toBe(false); // never on screen, never computed
  });

  it('reach: there as soon as a job is wanted, before its diff — services and identities from affectedPairs', () => {
    const live = buildSeedWorld();
    const lazy = new LazyDiffs<number>();
    const named: DraftOp[] = [{ kind: 'update', policyId: 'pol-005', patch: { identityRoles: ['@server-stage-01', '@laptop-alice'] } }];
    const check: DraftOp[] = [{ kind: 'update', target: 'postureCheck', policyId: 'pc-001', patch: { timeoutSeconds: 60 } }];
    lazy.setJobs([
      { key: 'named', world: live, ops: named, map: (d) => d.services.length },
      { key: 'check', world: live, ops: check, map: (d) => d.services.length },
      { key: 'broken', world: live, ops: [{ kind: 'delete', policyId: 'nope' }], map: (d) => d.services.length },
    ]);
    expect(lazy.reach('named')).toBeNull(); // not on screen yet
    lazy.want('named');
    lazy.want('check');
    lazy.want('broken');
    expect(lazy.results().size).toBe(0); // the diffs haven't run…
    // pol-005: its three services; the identities either version selects.
    const pairs = affectedPairs(named, live, applyDraft(live, named));
    const ids = new Set([...pairs.values()].flatMap((v) => [...(v as Set<string>)]));
    expect(lazy.reach('named')).toEqual({ services: 3, identities: ids.size });
    // A posture-check definition: 'all' on its services — every identity.
    expect(lazy.reach('check')!.identities).toBe(live.identities.length);
    expect(lazy.reach('broken')).toBeNull();

    expect(calculatingText(lazy.reach('named'))).toBe(`Reaches 3 services · ${ids.size} identities — calculating…`);
    expect(calculatingText(null)).toBe('Calculating…');
    expect(reachText({ services: 200, identities: 3000 })).toBe('Reaches 200 services · 3,000 identities');
    expect(reachText({ services: 1, identities: 1 })).toBe('Reaches 1 service · 1 identity');
    expect(reachText({ services: 0, identities: 0 })).toBe('Reaches no services');
  });
});
