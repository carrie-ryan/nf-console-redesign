/**
 * "Everyone except <X>" / "all <A> except <B>": Ziti can't deny, so the assistant
 * replies with no ops and two answer chips — a must-not test for <B> (a draft
 * accessTest op) and the identities in <A> without <B>. An unknown <B> is asked about.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/assist/exclusion.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { PolicyDraftStore } from '../draft/policy-draft.store';
import { AssistStore } from './assist.store';
import { AssistPanelComponent } from './assist-panel.component';
import { noDenyReply, parseExclusion } from './exclusion';

const GIT_REPO = 'svc-004';

const REPLY =
  "Ziti policies only grant access; they can't exclude anyone. Two ways to get the same effect: grant an " +
  "attribute that only the intended identities carry, or add a 'must not' test so #kiosks can never be granted by mistake.";

describe('parseExclusion', () => {
  it.each([
    ['Let everyone except kiosks dial this service', { track: 'dial', from: null, except: '#kiosks' }],
    ['everyone but #kiosks can connect', { track: 'dial', from: null, except: '#kiosks' }],
    ['Let all users except laptops dial this service', { track: 'dial', from: '#users', except: '#laptops' }],
    ['all identities with #servers except for #prod should host it', { track: 'host', from: '#servers', except: '#prod' }],
    ['Anyone except the kiosks may host this', { track: 'host', from: null, except: '#kiosks' }],
  ])('%s', (text, want) => {
    expect(parseExclusion(text)).toEqual(want);
  });

  it('is not every request', () => {
    expect(parseExclusion('Let any identity with #servers host this service')).toBeNull();
    expect(parseExclusion('Let users and laptops dial this service')).toBeNull();
  });
});

describe('Assist — exclusion requests', () => {
  let assist: AssistStore;
  let draft: PolicyDraftStore;
  const last = () => assist.turns().at(-1)!;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    assist = TestBed.inject(AssistStore);
    draft = TestBed.inject(PolicyDraftStore);
  });

  it('replies that Ziti only grants, with no ops and the two chips', async () => {
    await assist.send('Let everyone except kiosks dial this service', GIT_REPO);
    expect(last().status).toBe('reply');
    expect(last().result).toMatchObject({
      ops: [],
      reply: REPLY,
      questions: [],
      answers: ['Add a must-not test for #kiosks', 'Show all identities without #kiosks'],
    });
    expect(noDenyReply('#kiosks')).toBe(REPLY);

    await assist.send('Let all users except laptops dial this service', GIT_REPO);
    expect(last().result!.answers).toEqual(['Add a must-not test for #laptops', 'Show identities in #users without #laptops']);
  });

  it("asks which attribute identifies <B> when it isn't one", async () => {
    await assist.send('Let everyone except contractors dial this service', GIT_REPO);
    expect(last().result).toMatchObject({
      ops: [],
      reply: null,
      questions: ['No identity has the attribute #contractors. Which attribute identifies the identities to leave out?'],
    });
  });

  it('the test chip proposes a mustNotDial test for <B> on this service; Add to draft adds that op', async () => {
    await assist.send('Let everyone except kiosks dial this service', GIT_REPO);
    await assist.send('Add a must-not test for #kiosks', GIT_REPO);
    expect(last().status).toBe('proposed');
    const op = {
      kind: 'create',
      target: 'accessTest',
      policy: {
        id: 'at-draft-1',
        kind: 'mustNotDial',
        who: { attributes: ['#kiosks'] },
        serviceId: GIT_REPO,
        note: "Ziti can't exclude, so this test makes sure anyone with #kiosks is never allowed to dial git-repo.",
      },
    };
    expect(last().result!.ops).toEqual([op]);
    assist.accept();
    expect(draft.ops()).toEqual([op]);
  });

  it('for hosting, the test is mustNotHost', async () => {
    await assist.send('all identities with #servers except #prod should host this', GIT_REPO);
    await assist.send('Add a must-not test for #prod', GIT_REPO);
    expect(last().result!.ops).toMatchObject([{ target: 'accessTest', policy: { kind: 'mustNotHost', who: { attributes: ['#prod'] } } }]);
  });

  it('the list chip names the identities in <A> without <B>, and offers the test', async () => {
    await assist.send('Let all users except laptops dial this service', GIT_REPO);
    await assist.send('Show identities in #users without #laptops', GIT_REPO);
    const r = last().result!;
    expect(last().status).toBe('reply');
    expect(r.ops).toEqual([]);
    const expected = draft
      .live()
      .identities.filter((i) => i.attributes?.includes('#users') && !i.attributes.includes('#laptops'))
      .map((i) => i.name);
    expect(expected).toContain('phone-bob');
    expect(r.items).toEqual(expected.slice(0, 20));
    expect(r.items).not.toContain('laptop-alice');
    expect(r.reply).toBe(
      `${expected.length} identities have #users but not #laptops. Give them an attribute of their own and grant that, instead of #users:`,
    );
    expect(r.answers).toEqual(['Add a must-not test for #laptops']);
  });

  it('the panel shows the reply and its chips; a chip sends its prompt', async () => {
    const fixture = TestBed.createComponent(AssistPanelComponent);
    fixture.componentRef.setInput('serviceId', GIT_REPO);
    assist.open.set(true);
    await assist.send('Let everyone except kiosks dial this service', GIT_REPO);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.ap-answer-text')!.textContent).toBe(REPLY);
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.ap-answer')];
    expect(chips.map((c) => c.textContent!.trim())).toEqual(['Add a must-not test for #kiosks', 'Show all identities without #kiosks']);

    chips[1].click();
    await fixture.whenStable();
    fixture.detectChanges();
    const items = [...el.querySelectorAll('.ap-items li')].map((li) => li.textContent);
    expect(items.length).toBeGreaterThan(0); // a list is shown…
    expect(items).toContain('laptop-alice');
    expect(items).not.toContain('kiosk-lobby'); // …without the kiosk
  });
});
