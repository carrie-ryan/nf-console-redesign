/**
 * Text contrast over the design tokens in styles.css (read as text, so the real values
 * are checked): every text colour must reach WCAG AA (4.5:1) on white, the page
 * background and every card/panel tint it's used on. Secondary text (--color-text-3)
 * must also stay visibly lighter than --color-text-2. --color-text-disabled is exempt
 * (disabled controls and placeholders only).
 *
 * Run `npx ng test --watch=false --include src/lib/shared/design/text-contrast.spec.ts`
 */

import css from '../../../styles.css' with { loader: 'text' };

/** The :root tokens, by name. */
function tokens(text: string): Map<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(text)![1];
  return new Map([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const channel = (i: number) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const T = tokens(css);
const v = (name: string) => {
  const value = T.get(name);
  if (!value) throw new Error(`Missing token ${name}`);
  return value;
};

/** Every background secondary and status text sits on. */
const SURFACES = [
  '--color-surface',
  '--color-bg',
  '--color-surface-2',
  '--brand-primary-light',
  '--color-info-bg',
  '--color-success-bg',
  '--color-warning-bg',
  '--color-danger-bg',
];

/** Text colours that carry information. */
const TEXT = ['--color-text', '--color-text-2', '--color-text-3', '--color-success-text', '--color-warning-text', '--color-danger-text'];

describe('text contrast (design tokens)', () => {
  for (const text of TEXT) {
    for (const surface of SURFACES) {
      it(`${text} on ${surface}: at least 4.5:1`, () => {
        expect(contrast(v(text), v(surface))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('--color-text-3 stays visibly lighter than --color-text-2', () => {
    expect(luminance(v('--color-text-3'))).toBeGreaterThan(luminance(v('--color-text-2')));
    expect(contrast(v('--color-text-3'), v('--color-text-2'))).toBeGreaterThanOrEqual(1.4);
  });

  it('the disabled / placeholder grey is its own token, lighter than --color-text-3', () => {
    expect(luminance(v('--color-text-disabled'))).toBeGreaterThan(luminance(v('--color-text-3')));
  });

  it('the checker itself: black on white is 21:1, a colour on itself 1:1', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#627084', '#627084')).toBe(1);
  });
});
