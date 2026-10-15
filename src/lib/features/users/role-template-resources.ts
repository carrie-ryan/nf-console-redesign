/**
 * POC MOCK — the manageable resource types a role template can grant actions
 * on, and which actions each supports.
 *
 * Feature-local rather than in MockDataService: nothing outside the role
 * template form needs this, and it's a static catalogue (the set of manageable
 * entity types), not mutable console state.
 */

export type RoleAction = 'create' | 'read' | 'update' | 'delete';

/** Anchor decides what a template's permissions are scoped to. */
export type TemplateAnchor = 'Network' | 'Network Group';

export interface RoleResource {
  /** The API name — shown in monospace beside the display name. */
  id: string;
  name: string;
  /** Actions this resource supports, in CRUD order. Not every resource has
   *  all four: a session can't be created through the API, only read or
   *  deleted, so its template offers exactly those. */
  actions: RoleAction[];
}

/** What the form produces. Not persisted yet — see RoleTemplateFormComponent. */
export interface RoleTemplate {
  name: string;
  description: string;
  anchor: TemplateAnchor;
  /** Resource id → granted actions. Only resources with ≥1 action appear. */
  grants: Record<string, RoleAction[]>;
}

const CRUD: RoleAction[] = ['create', 'read', 'update', 'delete'];

/** Alphabetical, matching the legacy dialog's ordering. */
export const ROLE_RESOURCES: RoleResource[] = [
  { id: 'api-account',                 name: 'API Account',                 actions: CRUD },
  { id: 'auth-policy',                 name: 'Auth Policy',                 actions: CRUD },
  { id: 'certificate-authority',       name: 'Certificate Authority',       actions: CRUD },
  { id: 'config',                      name: 'Config',                      actions: CRUD },
  { id: 'config-type',                 name: 'Config Type',                 actions: CRUD },
  { id: 'edge-router',                 name: 'Edge Router',                 actions: CRUD },
  { id: 'edge-router-policy',          name: 'Edge Router Policy',          actions: CRUD },
  { id: 'external-jwt-signer',         name: 'External JWT Signer',         actions: CRUD },
  { id: 'identity',                    name: 'Identity',                    actions: CRUD },
  { id: 'network',                     name: 'Network',                     actions: CRUD },
  { id: 'network-group',               name: 'Network Group',               actions: CRUD },
  { id: 'posture-check',               name: 'Posture Check',               actions: CRUD },
  { id: 'service',                     name: 'Service',                     actions: CRUD },
  { id: 'service-edge-router-policy',  name: 'Service Edge Router Policy',  actions: CRUD },
  { id: 'service-policy',              name: 'Service Policy',              actions: CRUD },
  // Sessions are created by the network, never by an API caller.
  { id: 'session',                     name: 'Session',                     actions: ['read', 'delete'] },
  // Terminators are registered by hosting SDKs; the API can inspect and retune.
  { id: 'terminator',                  name: 'Terminator',                  actions: ['read', 'update'] },
  { id: 'transit-router',              name: 'Transit Router',              actions: CRUD },
];
