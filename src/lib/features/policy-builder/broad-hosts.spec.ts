/**
 * Broad host rules: a draft that makes a service's authorized host count grow past 3
 * (or by more than 3) is warned about — in the review's Warnings, naming and linking
 * the Bind policy responsible, and in the policy editor while editing that Bind rule.
 * A warning, never a block.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/broad-hosts.spec.ts`
 */

import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import type { Policy } from '../../shared/services/mock-data.service';
import { DraftReviewComponent } from './draft-review.component';
import { DraftChecks } from './draft/draft-checks';
import { applyDraft, type DraftOp } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { BROAD_HOSTS, broadHostWarnings, hostingFor } from './hosting';
import { PolicyEditorComponent } from './policy-editor.component';
import type { ReasonLink } from './access-tests';

const seed = buildSeedWorld();
const GITLAB = 'svc-001'; // gitlab-internal

const bindRule = (id: string, identityRoles: string[]): Policy => ({
  id, name: id, createdAt: '2026-01-01T00:00:00Z', status: 'active',
  type: 'bind', semantic: 'AnyOf', identityRoles, serviceRoles: [`@${GITLAB}`], postureCheckRoles: [],
});
const create = (p: Policy): DraftOp => ({ kind: 'create', policy: p });

const SENTENCE = 'This makes 31 identities hosts of gitlab-internal; traffic is shared across every host that serves it.';

describe('broadHostWarnings', () => {
  const before = hostingFor(GITLAB, seed).authorizedHostIds.length;

  it('the #servers host rule on gitlab-internal: 31 hosts, naming the rule', () => {
    expect(before).toBeLessThanOrEqual(BROAD_HOSTS);
    const draft = applyDraft(seed, [create(bindRule('servers-gitlab-host', ['#servers']))]);
    const [w, ...rest] = broadHostWarnings(seed, draft);
    expect(rest).toEqual([]);
    expect(w).toMatchObject({ serviceId: GITLAB, before, after: 31, policies: [{ id: 'servers-gitlab-host', name: 'servers-gitlab-host' }] });
    expect(w.parts.map((p) => p.text).join('')).toBe(`${SENTENCE} Granted by servers-gitlab-host.`);
    expect(w.parts.find((p) => p.link)!.link).toEqual({ kind: 'policy', id: 'servers-gitlab-host' });
  });

  it('a single named host does not', () => {
    const host = seed.identities.find((i) => !hostingFor(GITLAB, seed).authorizedHostIds.includes(i.id))!;
    const draft = applyDraft(seed, [create(bindRule('one-host', [`@${host.name}`]))]);
    expect(hostingFor(GITLAB, draft).authorizedHostIds.length).toBe(before + 1);
    expect(broadHostWarnings(seed, draft)).toEqual([]);
  });

  it('no draft, or fewer hosts: nothing', () => {
    expect(broadHostWarnings(seed, seed)).toEqual([]);
    const wide = applyDraft(seed, [create(bindRule('servers-gitlab-host', ['#servers']))]);
    expect(broadHostWarnings(wide, seed)).toEqual([]); // shrinking back is never broad
  });
});

describe('the review and the editor show it', () => {
  let store: PolicyDraftStore;
  let id: string;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DraftReviewComponent, PolicyEditorComponent], providers: [provideRouter([])] });
    store = TestBed.inject(PolicyDraftStore);
    id = store.createForService('bind', GITLAB);
    store.upsertUpdate(id, { identityRoles: ['#servers'] });
  });

  it('review: in Warnings, the policy name links to it, and commit is not blocked', () => {
    const fixture = TestBed.createComponent(DraftReviewComponent);
    fixture.componentRef.setInput('serviceId', GITLAB);
    TestBed.inject(DraftChecks).flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const warn = el.querySelector('.dr-broad')!;
    expect(warn.closest('section')!.querySelector('h3')!.textContent).toBe('Warnings');
    expect(warn.textContent).toBe(`${SENTENCE} Granted by ${store.draftWorld().policies.find((p) => p.id === id)!.name}.`);
    const links: ReasonLink[] = [];
    fixture.componentInstance.openLink.subscribe((l) => links.push(l));
    warn.querySelector<HTMLButtonElement>('.tr-link')!.click();
    expect(links).toEqual([{ kind: 'policy', id }]);
    const commit = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Commit'))!;
    expect(commit.disabled).toBe(false);
  });

  it('editor: while editing the Bind rule; gone once it names a single host', () => {
    const fixture = TestBed.createComponent(PolicyEditorComponent);
    fixture.componentRef.setInput('policyId', id);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.pe-warn li')!.textContent).toBe(SENTENCE);
    const host = seed.identities.find((i) => !hostingFor(GITLAB, seed).authorizedHostIds.includes(i.id))!;
    store.upsertUpdate(id, { identityRoles: [`@${host.name}`] });
    fixture.detectChanges();
    expect(el.querySelector('.pe-warn')).toBeNull();
  });
});
