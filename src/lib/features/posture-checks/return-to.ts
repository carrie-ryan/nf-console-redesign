/**
 * The Policy Builder links here with `?returnTo=<its url>` (service, ?with=): the
 * Posture Checks pages carry it along and offer the way back. Only a builder url is
 * honoured — never an arbitrary destination.
 */
export function builderReturn(url: string | null | undefined): string | null {
  return url && /^\/policy-builder(?:[/?#]|$)/.test(url) ? url : null;
}
