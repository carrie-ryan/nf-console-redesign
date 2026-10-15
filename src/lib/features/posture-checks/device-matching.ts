import type { MatchKey, ProviderConnection } from './provider-connection.models';

/**
 * One in-scope Ziti identity as the matching engine sees it: what a real Ziti
 * identity carries that a join can use (id, name, tags), plus whether the
 * provider holds a device record for it at all.
 */
export interface MatchSampleIdentity {
  id: string;
  name: string;
  kind: 'device' | 'service';
  /** Arbitrary values stuffed onto the identity — the 'tag' key joins on tags[matchTagKey]. */
  tags?: Record<string, string>;
  /** Whether the provider has a device record for this identity's machine. */
  hasDeviceRecord: boolean;
}

/** Why an identity didn't match a provider device. */
export type MatchReason =
  | 'service-identity'
  | 'no-device-record'
  | 'tag-not-set'
  | 'not-mapped';

/**
 * Reasons that need the provider's device records to know — absent until the
 * connection has authenticated and polled. Every other reason is a Ziti-side fact.
 */
export const PROVIDER_SIDE_REASONS: ReadonlySet<MatchReason> = new Set<MatchReason>(['no-device-record']);

/** Provider-agnostic wording — reasons are shown for every provider. 'tag-not-set' names the tag key. */
export function matchReasonLabel(reason: MatchReason, matchTagKey?: string): string {
  switch (reason) {
    case 'service-identity': return 'Service identity — no device to check';
    case 'no-device-record': return 'No matching device record';
    case 'tag-not-set':      return matchTagKey ? `Tag “${matchTagKey}” not set on identity` : 'Tag not set on identity';
    case 'not-mapped':       return 'Not in the manual mapping';
  }
}

/** The connection-side inputs a match needs beyond the key itself. */
export interface MatchOptions {
  manualMappings?: ProviderConnection['manualMappings'];
  /** Tag name joined on when matchKey is 'tag'. */
  matchTagKey?: string;
}

/** MatchOptions read off a connection. */
export function matchOptionsFor(conn: ProviderConnection | undefined): MatchOptions {
  return { manualMappings: conn?.manualMappings, matchTagKey: conn?.matchTagKey };
}

export interface MatchResult {
  matched: boolean;
  reason?: MatchReason;
}

/**
 * Whether `identity` joins to a provider device under `matchKey`. Service
 * identities never have a device, so they miss with 'service-identity' under
 * every key. Any other identity in `manualMappings` is pinned to a device and
 * matches under every key — for 'manual' that's the only way to match; for the
 * automatic keys it's an override.
 *
 * identityId / identityName are always present on an identity, so they miss only
 * when the provider has no record carrying them. 'tag' also needs
 * tags[matchTagKey] set on the identity.
 */
export function matchIdentity(
  identity: MatchSampleIdentity,
  matchKey: MatchKey,
  { manualMappings = [], matchTagKey }: MatchOptions = {},
): MatchResult {
  if (identity.kind === 'service') return { matched: false, reason: 'service-identity' };
  if (manualMappings.some(m => m.identityId === identity.id)) return { matched: true };

  const withRecord = (): MatchResult =>
    identity.hasDeviceRecord ? { matched: true } : { matched: false, reason: 'no-device-record' };

  switch (matchKey) {
    case 'identityId':
    case 'identityName':
      return withRecord();
    case 'tag':
      return matchTagKey && identity.tags?.[matchTagKey] ? withRecord() : { matched: false, reason: 'tag-not-set' };
    case 'manual':
      return { matched: false, reason: 'not-mapped' };
  }
}

export interface MatchReasonCount {
  reason: MatchReason;
  label: string;
  count: number;
}

export interface MatchSummary {
  total: number;
  matchedCount: number;
  unmatchedCount: number;
  /** 0–100, rounded. */
  matchRate: number;
  /** Unmatched identities grouped by reason, largest group first. */
  reasons: MatchReasonCount[];
}

/** Match every identity in `sample` under `matchKey` and tally the outcome. */
export function summarizeMatches(
  sample: MatchSampleIdentity[],
  matchKey: MatchKey,
  opts: MatchOptions = {},
): MatchSummary {
  const byReason = new Map<MatchReason, number>();
  let matchedCount = 0;
  for (const identity of sample) {
    const r = matchIdentity(identity, matchKey, opts);
    if (r.matched) matchedCount++;
    else if (r.reason) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  }
  const total = sample.length;
  return {
    total,
    matchedCount,
    unmatchedCount: total - matchedCount,
    matchRate: total ? Math.round((matchedCount / total) * 100) : 0,
    reasons: [...byReason]
      .map(([reason, count]) => ({ reason, count, label: matchReasonLabel(reason, opts.matchTagKey) }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * What can be known before the provider is polled: the Ziti-side miss reasons only.
 * No match count or rate — whether the rest match depends on the provider's records.
 */
export interface ZitiCoverage {
  total: number;
  /** Ziti-side reasons, largest group first. */
  reasons: MatchReasonCount[];
}

export function zitiSideCoverage(summary: MatchSummary): ZitiCoverage {
  return { total: summary.total, reasons: summary.reasons.filter(r => !PROVIDER_SIDE_REASONS.has(r.reason)) };
}

/** A summary with every count multiplied by `scale` (display only; the rate is unchanged). */
export function scaleSummary(s: MatchSummary, scale: number): MatchSummary {
  return {
    ...s,
    total: s.total * scale,
    matchedCount: s.matchedCount * scale,
    unmatchedCount: s.unmatchedCount * scale,
    reasons: s.reasons.map(r => ({ ...r, count: r.count * scale })),
  };
}

export interface UnmatchedIdentity {
  identity: MatchSampleIdentity;
  reason: MatchReason;
  label: string;
}

/** The identities in `sample` that miss under `matchKey`, in sample order, each with its reason. */
export function unmatchedIdentities(
  sample: MatchSampleIdentity[],
  matchKey: MatchKey,
  opts: MatchOptions = {},
): UnmatchedIdentity[] {
  return sample.flatMap(identity => {
    const r = matchIdentity(identity, matchKey, opts);
    return r.matched || !r.reason ? [] : [{ identity, reason: r.reason, label: matchReasonLabel(r.reason, opts.matchTagKey) }];
  });
}
