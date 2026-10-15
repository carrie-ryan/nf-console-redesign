import { providerSpec } from './provider-catalog';
import type { AcquisitionMode, ConnectionMode, MatchKey, ProviderConnection } from './provider-connection.models';

/** Acquisition modes, in display order. */
export const ACQUISITION_OPTIONS: { value: AcquisitionMode; label: string }[] = [
  { value: 'poll',  label: 'Poll' },
  { value: 'event', label: 'Event' },
];

/** Polling frequency choices for a connection; `value` is stored on ProviderConnection.pollFrequency. */
export const POLL_OPTIONS: { value: string; label: string }[] = [
  { value: '5m',  label: '5 min' },
  { value: '10m', label: '10 min' },
  { value: '15m', label: '15 min' },
  { value: '30m', label: '30 min' },
  { value: '1h',  label: '1 hour' },
  { value: '6h',  label: '6 hours' },
  { value: '24h', label: '24 hours' },
];

/** Connection rollout modes, in display order; `help` is the one-line explanation under the control. */
export const MODE_OPTIONS: { value: ConnectionMode; label: string; help: string }[] = [
  { value: 'observe', label: 'Observe', help: "Evaluate and record results, but don't block access yet." },
  { value: 'enforce', label: 'Enforce', help: 'Block access when a check fails.' },
];

export function modeLabel(mode: ConnectionMode): string {
  return mode === 'observe' ? 'Observe' : 'Enforce';
}

/** Device-matching strategies. The join's Ziti side comes from joinZitiSide(). */
export const MATCH_OPTIONS: {
  value: MatchKey;
  label: string;
  /** Phrase used in the connection summary line. */
  summary: string;
}[] = [
  { value: 'identityId',   label: 'Identity ID',    summary: 'matches on identity ID' },
  { value: 'identityName', label: 'Identity name',  summary: 'matches on identity name' },
  { value: 'tag',          label: 'Identity tag',   summary: 'matches on identity tag' },
  { value: 'manual',       label: 'Manual mapping', summary: 'matches by manual mapping' },
];

/**
 * The Ziti side of a join ("Joins <this> → <Provider> device record"), or null when
 * there's no join to describe: 'manual' (a mapping table instead) or 'tag' without a tag name.
 */
export function joinZitiSide(matchKey: MatchKey, matchTagKey?: string): string | null {
  const tag = matchTagKey?.trim();
  switch (matchKey) {
    case 'identityId':   return 'Ziti identity ID';
    case 'identityName': return 'Ziti identity name';
    case 'tag':          return tag ? `Ziti identity tag “${tag}”` : null;
    case 'manual':       return null;
  }
}

/** The connection's match phrase, naming the tag for matchKey 'tag'. */
export function matchSummary(conn: Pick<ProviderConnection, 'matchKey' | 'matchTagKey'>): string | undefined {
  if (conn.matchKey === 'tag' && conn.matchTagKey) return `matches on tag “${conn.matchTagKey}”`;
  return MATCH_OPTIONS.find(m => m.value === conn.matchKey)?.summary;
}

export function pollLabel(value: string): string {
  return POLL_OPTIONS.find(p => p.value === value)?.label ?? value;
}

/** The receive URL we expose for a provider to push posture events to (mock — derived from a token). */
export function generatedEventEndpoint(token: string): string {
  return `https://events.netfoundry.example/posture/${token}`;
}

/** How the connection gets posture: "polls every X" or "receives events". Never names a poll interval for an event connection. */
export function acquisitionSummary(conn: Pick<ProviderConnection, 'acquisition' | 'pollFrequency'>): string {
  return conn.acquisition === 'event' ? 'receives events' : `polls every ${pollLabel(conn.pollFrequency ?? '')}`;
}

/** A connection that can't currently evaluate devices. */
export function needsAttention(conn: ProviderConnection): boolean {
  return conn.status !== 'active';
}

/**
 * "<endpoint, or tenant/customer/account id> · polls every X (or receives events) · matches on Y" —
 * everything but the provider. The endpoint segment is dropped when there is no endpoint and no such id.
 * The account id (Cloudflare) comes from the non-secret `settings`.
 */
export function connectionDetails(conn: ProviderConnection): string {
  const accountId = conn.settings?.['account_id'];
  const where = conn.endpoint
    || (conn.customerId ? `${conn.providerType === 'Intune' ? 'tenant' : 'customer'} ${conn.customerId}` : '')
    || (accountId ? `account ${accountId}` : '');
  return [
    where,
    acquisitionSummary(conn),
    matchSummary(conn),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** connectionDetails() led by the provider's display name. */
export function connectionSummary(conn: ProviderConnection): string {
  return `${providerSpec(conn.providerType)?.label ?? conn.providerType} · ${connectionDetails(conn)}`;
}
