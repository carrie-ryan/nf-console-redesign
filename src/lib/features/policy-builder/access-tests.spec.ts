/**
 * Access tests: evaluation (authorization only for mustNot*, the full verdict path for
 * mustConnect), editing through the draft, and the review panel — failing tests block
 * commit; removed requirements are warnings.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/access-tests.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { MockDataService, type AccessTest } from '../../shared/services/mock-data.service';
import { resolve } from '../authorization/trifecta-resolver';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { evaluateTest, evaluateTests, type ReasonLink } from './access-tests';
import { AccessTestsPanelComponent } from './access-tests-panel.component';
import { AssistStore } from './assist/assist.store';
import { DraftReviewComponent } from './draft-review.component';
import { describeOps } from './draft/draft-summary';
import { requirementWarnings } from './draft/loosening';
import { applyDraft, type DraftOp } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { DraftChecks } from './draft/draft-checks';

const seed = buildSeedWorld();
const KIOSKS = 'Let any identity with #kiosks host this service';
const KIOSK_HOST_TEST = 'anyone with #kiosks must not host api-prod';

describe('evaluateTests — seed', () => {
  it('the seed tests all pass on live', () => {
    expect(evaluateTests(seed).map((r) => [r.text, r.pass])).toEqual([
      [KIOSK_HOST_TEST, true],
      ['laptop-alice must connect to git-repo', true],
      ['anyone with #kiosks must not dial api-prod', true],
    ]);
  });

  it('deleting users-gitlab breaks alice\'s mustConnect test, naming the deletion', () => {
    const r = evaluateTests(applyDraft(seed, [{ kind: 'delete', policyId: 'pol-002' }]), seed).find((x) => x.test.id === 'at-002')!;
    expect(r.pass).toBe(false);
    expect(r.offenders).toEqual([
      {
        identityId: 'id-001',
        name: 'laptop-alice',
        reason: 'not authorized to dial — users-gitlab deleted in this draft',
        // Deleted: nothing left to open, so no link.
        parts: [{ text: 'not authorized to dial' }, { text: ' — ' }, { text: 'users-gitlab deleted in this draft' }],
      },
    ]);
  });

  it('mustConnect follows the verdict path: posture, and a matching nobody fails', () => {
    const carol: AccessTest = { id: 't', kind: 'mustConnect', who: { names: ['carol@corp.com'] }, serviceId: 'svc-004', note: '' };
    // Failing in live too: the check is named, no draft cause.
    expect(evaluateTest(carol, seed, seed).offenders.map((o) => o.reason)).toEqual(['blocked by posture — fails require-mfa']);
    const ghost: AccessTest = { ...carol, who: { names: ['nobody'] } };
    expect(evaluateTest(ghost, seed)).toMatchObject({ pass: false, problem: 'Matches no identity' });
  });
});

describe('mustConnect reasons name the draft edit behind them', () => {
  const at002 = (ops: DraftOp[]) => evaluateTests(applyDraft(seed, ops), seed).find((x) => x.test.id === 'at-002')!.offenders[0];

  it('posture: the failing check, and the policy it was added to — both links', () => {
    const o = at002([{ kind: 'update', policyId: 'pol-002', patch: { postureCheckRoles: ['#mfa-required'] } }]);
    expect(o.reason).toBe('blocked by posture — fails require-mfa, added to users-gitlab in this draft');
    expect(o.parts.filter((p) => p.link)).toEqual([
      { text: 'require-mfa', link: { kind: 'check', id: 'pc-001' } },
      { text: 'users-gitlab', link: { kind: 'policy', id: 'pol-002' } },
    ]);
  });

  it('dial: a changed policy is a link', () => {
    const o = at002([{ kind: 'update', policyId: 'pol-002', patch: { identityRoles: ['#nobody'] } }]);
    expect(o.reason).toBe('not authorized to dial — users-gitlab changed in this draft');
    expect(o.parts.find((p) => p.link)).toEqual({ text: 'users-gitlab', link: { kind: 'policy', id: 'pol-002' } });
  });

  it('route: the service edge router policy the draft deleted', () => {
    expect(at002([{ kind: 'delete', target: 'serviceEdgeRouterPolicy', policyId: 'serp-003' }]).reason).toBe(
      'no shared router — git-repo-public-routers deleted in this draft',
    );
  });

  it('host side: the Bind policies the draft deleted', () => {
    const o = at002([
      { kind: 'delete', policyId: 'pol-004' },
      { kind: 'delete', policyId: 'pol-005' },
    ]);
    expect(o.reason).toBe('no host — git-repo-hosts deleted in this draft; git-servers-host deleted in this draft');
  });

  it('without live, reasons carry no cause', () => {
    const r = evaluateTests(applyDraft(seed, [{ kind: 'delete', policyId: 'pol-002' }])).find((x) => x.test.id === 'at-002')!;
    expect(r.offenders[0].reason).toBe('not authorized to dial');
  });

  it('mustNot* offenders link the granting policy', () => {
    const draft = applyDraft(seed, [{ kind: 'update', policyId: 'pol-002', patch: { serviceRoles: ['#git', '#apis'] } }]);
    const test: AccessTest = { id: 't', kind: 'mustNotDial', who: { names: ['laptop-alice'] }, serviceId: 'svc-005', note: '' };
    expect(evaluateTest(test, draft, seed).offenders[0].parts).toEqual([
      { text: 'may dial via ' },
      { text: 'users-gitlab', link: { kind: 'policy', id: 'pol-002' } },
    ]);
  });
});

describe('the #kiosks host proposal on api-prod', () => {
  let store: PolicyDraftStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(PolicyDraftStore);
    const assist = TestBed.inject(AssistStore);
    await assist.send(KIOSKS, 'svc-005');
    expect(assist.proposal()).not.toBeNull();
    assist.accept();
  });

  it('fails mustNotHost — even though no kiosk has a route', () => {
    const world = store.draftWorld();
    const r = evaluateTests(world).find((x) => x.test.id === 'at-001')!;
    expect(r.pass).toBe(false);
    const kiosks = seed.identities.filter((i) => i.attributes.includes('#kiosks')).map((i) => i.name);
    expect(kiosks).toHaveLength(6);
    expect(r.offenders.map((o) => o.name)).toEqual(kiosks);
    expect(r.offenders[0].reason).toBe('may host via new-bind-rule-1');
    // Authorized, but no shared router: authorization alone fails the test.
    expect(resolve('id-005', 'svc-005', world).bindStatus).toBe('AUTHORIZED_NO_ROUTER');
  });

  it('blocks commit in the review panel, naming the failing test', () => {
    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-005');
    TestBed.inject(DraftChecks).flush(); // the review computation, run to completion now
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const commit = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Commit'))!;
    expect(commit.disabled).toBe(true);
    expect(el.querySelector('.dr-blocked')!.textContent).toContain(`Commit is blocked: 1 test fails — ${KIOSK_HOST_TEST}.`);
    expect(el.querySelector('.dr-test-fail')!.textContent).toContain('kiosk-lobby');

    const data = TestBed.inject(MockDataService);
    const before = data.policies();
    fixture.componentInstance.commit();
    expect(data.policies()).toBe(before);
    expect(store.ops()).toHaveLength(1);
  });
});

describe('requirement warnings', () => {
  it('deleting require-mfa warns that it removes a requirement from admins-dev-access', () => {
    const draft = applyDraft(seed, [{ kind: 'delete', target: 'postureCheck', policyId: 'pc-001' }]);
    expect(requirementWarnings(seed, draft)).toEqual(['Deleting require-mfa removes a requirement from 1 policy: admins-dev-access']);
  });

  it('removing check roles from a policy: "Removes a requirement from N policies"', () => {
    const draft = applyDraft(seed, [
      { kind: 'update', policyId: 'pol-001', patch: { postureCheckRoles: [] } },
      { kind: 'update', policyId: 'pol-003', patch: { postureCheckRoles: [] } },
    ]);
    expect(requirementWarnings(seed, draft)).toEqual([
      'Removes a requirement from 2 policies: admins-dev-access (require-mfa), servers-bind-api (corp-os-check)',
    ]);
  });

  it('shown in the review panel, without blocking commit', () => {
    TestBed.configureTestingModule({});
    TestBed.inject(PolicyDraftStore).deletePolicy('pc-001', 'postureCheck');
    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', 'svc-004');
    TestBed.inject(DraftChecks).flush(); // the review computation, run to completion now
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Deleting require-mfa removes a requirement from 1 policy: admins-dev-access');
    expect([...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Commit'))!.disabled).toBe(false);
  });
});

describe('tests are edited through the draft', () => {
  let store: PolicyDraftStore;
  let data: MockDataService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(PolicyDraftStore);
    data = TestBed.inject(MockDataService);
  });

  const added: AccessTest = { id: 'at-draft-1', kind: 'mustNotDial', who: { names: ['kiosk-lobby'] }, serviceId: 'svc-004', note: 'Lobby kiosk stays off git.' };

  it('add: not in MockDataService until commit; its own change line', () => {
    store.addOp({ kind: 'create', target: 'accessTest', policy: added });
    expect(data.accessTests().some((t) => t.id === 'at-draft-1')).toBe(false);
    expect(describeOps(store.live(), store.ops())).toEqual(['Added test: kiosk-lobby must not dial git-repo']);
    store.commit();
    expect(data.accessTests().find((t) => t.id === 'at-draft-1')).toEqual(added);
  });

  it('edit and remove', () => {
    store.upsertUpdate('at-003', { serviceId: 'svc-004' }, 'accessTest');
    store.deletePolicy('at-001', 'accessTest');
    expect(describeOps(store.live(), store.ops())).toEqual([
      'Updated test: anyone with #kiosks must not dial api-prod → anyone with #kiosks must not dial git-repo',
      `Removed test: ${KIOSK_HOST_TEST}`,
    ]);
    expect(data.accessTests()).toHaveLength(3);
    store.commit();
    expect(data.accessTests().map((t) => [t.id, t.serviceId])).toEqual([['at-002', 'svc-004'], ['at-003', 'svc-004']]);
  });

  it('an invalid test is rejected', () => {
    expect(() => store.addOp({ kind: 'create', target: 'accessTest', policy: { ...added, who: {} } })).toThrow(/needs at least one name or attribute/);
  });
});

describe('reason links in the Tests panel', () => {
  it('the check and the policy open their editors', () => {
    TestBed.configureTestingModule({});
    TestBed.inject(PolicyDraftStore).upsertUpdate('pol-002', { postureCheckRoles: ['#mfa-required'] });
    const fixture = TestBed.createComponent(AccessTestsPanelComponent);
    fixture.componentRef.setInput('serviceId', 'svc-004');
    const opened: ReasonLink[] = [];
    fixture.componentInstance.openLink.subscribe((l) => opened.push(l));
    TestBed.inject(DraftChecks).flush(); // the review computation, run to completion now
    fixture.detectChanges();
    const why = (fixture.nativeElement as HTMLElement).querySelector('.at-failing .at-why')!;
    expect(why.textContent!.replace(/\s+/g, ' ')).toContain('laptop-alice — blocked by posture — fails require-mfa, added to users-gitlab in this draft');
    why.querySelectorAll<HTMLButtonElement>('button.tr-link').forEach((b) => b.click());
    expect(opened).toEqual([
      { kind: 'check', id: 'pc-001' },
      { kind: 'policy', id: 'pol-002' },
    ]);
  });
});

describe('Tests panel grouping', () => {
  const render = (serviceId: string) => {
    const fixture = TestBed.createComponent(AccessTestsPanelComponent);
    fixture.componentRef.setInput('serviceId', serviceId);
    TestBed.inject(DraftChecks).flush(); // the review computation, run to completion now
    fixture.detectChanges();
    return fixture;
  };
  const texts = (el: Element | null) => [...(el?.querySelectorAll('.at-text') ?? [])].map((e) => e.textContent!.trim());

  beforeEach(() => TestBed.configureTestingModule({}));

  it('this service first; the others collapse to "N other tests passing"', () => {
    const fixture = render('svc-005');
    const el = fixture.nativeElement as HTMLElement;
    const [here] = el.querySelectorAll('.at-group');
    expect(here.querySelector('.at-group-h')!.textContent).toContain('This service · api-prod');
    expect(texts(here)).toEqual([KIOSK_HOST_TEST, 'anyone with #kiosks must not dial api-prod']);
    const toggle = el.querySelector<HTMLButtonElement>('.at-others')!;
    expect(toggle.textContent!.trim()).toBe('1 other test passing');
    expect(el.textContent).not.toContain('laptop-alice must connect to git-repo');
    toggle.click();
    fixture.detectChanges();
    expect(texts(el.querySelector('#at-others-list'))).toEqual(['laptop-alice must connect to git-repo']);
  });

  it('no tests for the service: says so, with Add test defaulting to it', () => {
    const fixture = render('svc-001');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No tests for gitlab-internal yet');
    el.querySelector<HTMLButtonElement>('.at-add')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.form()!.serviceId).toBe('svc-001');
  });

  it('failing on another service: "Broken by this draft on <service>"', () => {
    TestBed.inject(PolicyDraftStore).deletePolicy('pol-002');
    const el = render('svc-005').nativeElement as HTMLElement;
    const broken = el.querySelectorAll('.at-group')[1];
    expect(broken.querySelector('.at-where')!.textContent).toBe('Broken by this draft on git-repo');
    expect(texts(broken)).toEqual(['laptop-alice must connect to git-repo']);
    expect(el.querySelector('.at-others')).toBeNull();
  });
});
