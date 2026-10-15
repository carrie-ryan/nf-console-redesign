/**
 * EXCLUSION REQUESTS — "everyone except <X>" / "all <A> except <B>". Pure, no UI.
 *
 * Ziti policies only grant: there is no deny, so no policy can leave <B> out. The
 * assistant says so and offers the two ways to the same effect, as answer chips:
 *   • "Add a must-not test for <B>"           → a draft access test (mustNotDial /
 *     mustNotHost on this service, who = <B>), so <B> can never be granted by mistake;
 *   • "Show identities in <A> without <B>"     → the identities to give a narrower
 *     attribute (lists them; no ops).
 * An unknown <A> or <B> is asked about instead.
 */

import type { AccessTest, Identity } from '../../../shared/services/mock-data.service';
import type { TrifectaWorld } from '../../authorization/trifecta-resolver';

export type Track = 'dial' | 'host';

export interface ExclusionRequest {
  track: Track;
  /** The attribute everyone is drawn from; null: everyone. */
  from: string | null;
  /** The attribute to leave out. */
  except: string;
}

/** "kiosks" / "#kiosks" → "#kiosks". */
const asAttribute = (term: string) => `#${term.replace(/^#/, '')}`;

/**
 * "Let everyone except kiosks dial this service", "all #users but #kiosks can host it",
 * "anyone except for the #contractors". `all` may name its attribute ("all users",
 * "all identities with #users"). Hosting words (host, serve, bind) make it the host
 * track; anything else is dial. Null: not an exclusion request.
 */
const EXCEPT =
  /\b(?:everyone|everybody|anyone|anybody|all(?:\s+identities)?(?:\s+(?:with\s+)?(?!except\b|but\b)(#?[\w-]+))?)\s+(?:except|but(?:\s+not)?)\s+(?:for\s+)?(?:the\s+)?(#?[\w-]+)/i;
const HOST_WORDS = /\b(?:host|hosts|hosting|serve|serves|bind|binds)\b/i;

export function parseExclusion(text: string): ExclusionRequest | null {
  const m = EXCEPT.exec(text);
  if (!m) return null;
  return {
    track: HOST_WORDS.test(text) ? 'host' : 'dial',
    from: m[1] ? asAttribute(m[1]) : null,
    except: asAttribute(m[2]),
  };
}

/** The answer chips' prompts. */
export const testPrompt = (except: string) => `Add a must-not test for ${except}`;
export const listPrompt = (from: string | null, except: string) =>
  from ? `Show identities in ${from} without ${except}` : `Show all identities without ${except}`;

export const TEST_PROMPT = /^Add a must-not test for (#[\w-]+)$/;
export const LIST_PROMPT = /^Show (?:identities in (#[\w-]+)|all identities) without (#[\w-]+)$/;

export const noDenyReply = (except: string) =>
  `Ziti policies only grant access; they can't exclude anyone. Two ways to get the same effect: ` +
  `grant an attribute that only the intended identities carry, or add a 'must not' test so ${except} ` +
  `can never be granted by mistake.`;

const hasAttribute = (world: TrifectaWorld, attr: string) => world.identities.some((i) => i.attributes?.includes(attr));

/** The questions an exclusion needs answered first: attributes no identity carries. */
export function exclusionQuestions(req: Pick<ExclusionRequest, 'from' | 'except'>, world: TrifectaWorld): string[] {
  const out: string[] = [];
  if (!hasAttribute(world, req.except)) {
    out.push(`No identity has the attribute ${req.except}. Which attribute identifies the identities to leave out?`);
  }
  if (req.from && !hasAttribute(world, req.from)) {
    out.push(`No identity has the attribute ${req.from}. Which attribute identifies the identities to include?`);
  }
  return out;
}

/** Identities in `from` (everyone when null) without `except`. */
export function withoutAttribute(world: TrifectaWorld, from: string | null, except: string): Identity[] {
  return world.identities.filter((i) => (!from || i.attributes?.includes(from)) && !i.attributes?.includes(except));
}

/** The must-not test for `except` on one service; its id is the first free at-draft-N. */
export function mustNotTest(world: TrifectaWorld, serviceId: string, serviceName: string, track: Track, except: string): AccessTest {
  const taken = new Set((world.accessTests ?? []).map((t) => t.id));
  let n = 1;
  while (taken.has(`at-draft-${n}`)) n++;
  return {
    id: `at-draft-${n}`,
    kind: track === 'host' ? 'mustNotHost' : 'mustNotDial',
    who: { attributes: [except] },
    serviceId,
    note: `Ziti can't exclude, so this test makes sure anyone with ${except} is never allowed to ${track} ${serviceName}.`,
  };
}
