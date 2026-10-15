import type { EntityStatus } from '../../shared/services/mock-data.service';

/**
 * External device-posture providers a ServiceProvider posture check can pull
 * from. 'Custom' covers a generic HTTP endpoint the customer runs themselves.
 */
export type ProviderType =
  | 'Cloudflare'
  | 'CrowdStrike'
  | 'Custom'
  | 'Kolide'
  | 'Intune'
  | 'SentinelOne'
  | 'Tanium'
  | 'Uptycs'
  | 'WorkspaceOne';

/**
 * Which Ziti-identity value a provider's device record is joined on:
 *   identityId   — the identity's id
 *   identityName — the identity's name
 *   tag          — a value stuffed into identity.tags[matchTagKey] (e.g. a serial number)
 *   manual       — an explicit identity → device pin, from `manualMappings`
 */
export type MatchKey = 'identityId' | 'identityName' | 'tag' | 'manual';

/** Shape of a provider attribute's condition — drives which operator/value editor renders. */
export type ConditionKind = 'range' | 'count' | 'enum' | 'bool' | 'freshness' | 'text' | 'fixed';

/**
 * Rollout mode for a connection — applies to every check that reads from it:
 *   observe — evaluate and record results, enforce nothing (a dry run)
 *   enforce — a failing check blocks access
 * New connections start in observe and are flipped to enforce by hand.
 */
export type ConnectionMode = 'observe' | 'enforce';

/**
 * How device posture reaches us from the provider:
 *   poll  — we fetch it on `pollFrequency`
 *   event — the provider pushes it to `eventEndpoint`
 * Staleness (onStale / maxAgeSeconds) applies to both: an event connection is stale when no
 * event has arrived within maxAgeSeconds.
 */
export type AcquisitionMode = 'poll' | 'event';

/** One manual identity → provider-device pairing (matchKey 'manual'). */
export interface IdentityMapping {
  identityId: string;
  externalDeviceId: string;
}

/**
 * A configured link to an external posture provider. Holds only non-secret
 * config: credentials live elsewhere and are referenced by `credentialRef`.
 */
export interface ProviderConnection {
  id: string;
  name: string;
  providerType: ProviderType;
  endpoint: string;
  acquisition: AcquisitionMode;
  /** Poll interval, e.g. '15m'. Only when acquisition is 'poll'. */
  pollFrequency?: string;
  /** The receive endpoint on our side that the provider pushes posture events to. Only when acquisition is 'event'. */
  eventEndpoint?: string;
  matchKey: MatchKey;
  /** Tag name joined on when matchKey is 'tag', e.g. 'serial'. Ignored for other keys. */
  matchTagKey?: string;
  manualMappings?: IdentityMapping[];
  mode: ConnectionMode;
  status: EntityStatus;
  lastVerifiedAt: string | null;
  createdAt: string;
  /** Non-secret customer / tenant id, kept for providers whose credentials include `customer_id`. */
  customerId?: string;
  /**
   * The non-secret credential values the connection form collected (client_id, token_url, …),
   * keyed by CredentialField.key, so the form can be re-opened pre-filled. Never holds a secret field.
   */
  settings?: Record<string, string>;
  /** Opaque handle to the stored credential — never the secret itself. */
  credentialRef?: string;
}

/** One device attribute a provider exposes for posture conditions. */
export interface ProviderAttribute {
  id: string;
  label: string;
  kind: ConditionKind;
  /** Short secondary label, e.g. a scale ("1–100"). */
  sub?: string;
  min?: number;
  max?: number;
  /** Allowed values — the options for kind 'enum', the time windows for kind 'freshness'. */
  values?: string[];
}

/** One credential input a provider's connection form asks for. */
export interface CredentialField {
  key: string;
  label: string;
  /** Masked, write-only input. */
  secret?: boolean;
}

/** Static description of a provider: its attributes and the credentials it needs. */
export interface ProviderSpec {
  providerType: ProviderType;
  label: string;
  /** Whether one check may assert several of this provider's attributes. */
  multi: boolean;
  /** One-line framing shown under the provider once it's picked. */
  help?: string;
  /** The provider pushes posture and can't be polled: its connections are always acquisition 'event'. */
  eventOnly?: boolean;
  attributes: ProviderAttribute[];
  credentialFields: CredentialField[];
}
