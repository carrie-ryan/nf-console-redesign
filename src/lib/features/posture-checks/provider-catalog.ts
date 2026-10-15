import type { ProviderSpec, ProviderType } from './provider-connection.models';

const FRESHNESS_WINDOWS = ['1 hour', '3 hours', '6 hours', '12 hours', '24 hours', '7 days', '30 days'];

/**
 * Static description of each supported posture provider: the credentials its
 * connection form asks for and the device attributes a ServiceProvider check
 * can write conditions against.
 *
 * A provider's `api_url` credential, when it has one, becomes
 * ProviderConnection.endpoint. All other entered values stay out of the
 * connection record (see credentialRef).
 */
export const PROVIDER_CATALOG: ProviderSpec[] = [
  {
    // Sits above the EDRs: aggregates their posture into a normalized score + platform, and pushes it to us.
    providerType: 'Cloudflare',
    label: 'Cloudflare',
    multi: true,
    eventOnly: true,
    help: 'Cloudflare normalizes posture from your underlying EDRs into a single score. '
      + 'Connect here if Cloudflare Access is your posture layer; connect to an EDR directly for its full signal set.',
    attributes: [
      { id: 'score',    label: 'Posture score', kind: 'range', sub: '0–100, set by the underlying provider', min: 0, max: 100 },
      { id: 'platform', label: 'Platform',      kind: 'enum', values: ['windows', 'mac', 'linux', 'android', 'ios', 'chromeos'] },
    ],
    credentialFields: [
      { key: 'account_id', label: 'Account ID' },
      { key: 'api_token',  label: 'API Token', secret: true },
    ],
  },
  {
    providerType: 'CrowdStrike',
    label: 'CrowdStrike',
    multi: true,
    attributes: [
      { id: 'overall',       label: 'Overall',       kind: 'range', sub: '1–100', min: 1, max: 100 },
      { id: 'os',            label: 'OS',            kind: 'range', sub: '1–100', min: 1, max: 100 },
      { id: 'sensor_config', label: 'Sensor config', kind: 'range', sub: '1–100', min: 1, max: 100 },
      { id: 'version',       label: 'Version',       kind: 'text' },
      { id: 'state',         label: 'State',         kind: 'enum', values: ['Online', 'Offline', 'Unknown'] },
      { id: 'last_seen',     label: 'Last seen',     kind: 'freshness', values: FRESHNESS_WINDOWS },
    ],
    credentialFields: [
      { key: 'client_id',     label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', secret: true },
      { key: 'api_url',       label: 'REST API URL (Base URL)' },
      { key: 'customer_id',   label: 'Customer ID' },
    ],
  },
  {
    providerType: 'Custom',
    // Offered as "Add new provider" in the provider picker, not as a list row.
    label: 'Custom provider',
    multi: false,
    attributes: [
      { id: 'score', label: 'Score', kind: 'range', sub: '0–100', min: 0, max: 100 },
    ],
    credentialFields: [
      { key: 'access_client_id',     label: 'Access Client ID' },
      { key: 'access_client_secret', label: 'Access Client Secret', secret: true },
      { key: 'api_url',              label: 'REST API URL' },
    ],
  },
  {
    providerType: 'Kolide',
    label: 'Kolide',
    multi: false,
    attributes: [
      { id: 'auth_state', label: 'Auth state', kind: 'enum', values: ['Good', 'Notified', 'Will Block', 'Blocked'] },
    ],
    credentialFields: [
      { key: 'client_secret', label: 'Client Secret', secret: true },
    ],
  },
  {
    providerType: 'Intune',
    label: 'Microsoft Intune',
    multi: false,
    attributes: [
      { id: 'compliance_state', label: 'Compliance state', kind: 'enum',
        values: ['Compliant', 'Noncompliant', 'In grace period', 'Conflict', 'Error', 'Not evaluated'] },
    ],
    credentialFields: [
      { key: 'client_id',     label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', secret: true },
      { key: 'customer_id',   label: 'Customer ID (Directory / tenant ID)' },
    ],
  },
  {
    providerType: 'SentinelOne',
    label: 'SentinelOne',
    multi: true,
    attributes: [
      { id: 'infected',          label: 'Infected',          kind: 'bool' },
      { id: 'active_threats',    label: 'Active Threats',    kind: 'count' },
      { id: 'is_active',         label: 'Is Active',         kind: 'bool' },
      { id: 'network_status',    label: 'Network status',    kind: 'enum', values: ['Connected', 'Disconnected'] },
      { id: 'operational_state', label: 'Operational State', kind: 'enum', values: ['Fully operational', 'Partially operational', 'Disabled'] },
    ],
    credentialFields: [
      { key: 'api_token', label: 'API Token', secret: true },
      { key: 'api_url',   label: 'REST API URL' },
    ],
  },
  {
    providerType: 'Tanium',
    label: 'Tanium',
    multi: true,
    attributes: [
      { id: 'total_score',   label: 'Total score',   kind: 'range', sub: '1–1000', min: 1, max: 1000 },
      { id: 'risk_level',    label: 'Risk level',    kind: 'enum', values: ['Low', 'Medium', 'High', 'Critical'] },
      { id: 'eid_last_seen', label: 'EID last seen', kind: 'freshness', values: FRESHNESS_WINDOWS },
    ],
    credentialFields: [
      { key: 'client_secret', label: 'Client Secret', secret: true },
      { key: 'api_url',       label: 'REST API URL' },
    ],
  },
  {
    providerType: 'Uptycs',
    label: 'Uptycs',
    multi: false,
    attributes: [
      { id: 'score', label: 'Score', kind: 'range', sub: '0–100', min: 0, max: 100 },
    ],
    credentialFields: [
      { key: 'client_key',    label: 'Client key' },
      { key: 'client_secret', label: 'Client Secret', secret: true },
      { key: 'customer_id',   label: 'Customer ID' },
    ],
  },
  {
    providerType: 'WorkspaceOne',
    label: 'Workspace ONE',
    multi: false,
    attributes: [
      { id: 'compliant', label: 'Device is compliant', kind: 'fixed' },
    ],
    credentialFields: [
      { key: 'client_id',     label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', secret: true },
      { key: 'api_url',       label: 'REST API URL' },
      { key: 'token_url',     label: 'Region-specific token URL' },
    ],
  },
];

/** Catalog lookup by provider type. */
export function providerSpec(type: ProviderType): ProviderSpec | undefined {
  return PROVIDER_CATALOG.find(p => p.providerType === type);
}
