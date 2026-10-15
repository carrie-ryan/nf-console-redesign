/**
 * LIVE CHANGES — edits made to live from outside the builder (another admin, a
 * Terraform run). Pure and headless.
 *
 *   liveImpact     — what one change touches on the canvas: the service policies whose
 *                    group cards it changes, the services whose cards it changes, and
 *                    the identities whose group cards it changes (an ERP's members, an
 *                    identity's own edit). Read from the world before AND after, so a
 *                    rule that stops matching still marks what it used to cover.
 *   adminEditOps   — the demo's "another admin edits users-gitlab": one more attribute
 *                    in its identity roles.
 *   terraformOps   — the demo's "Terraform run": the HQ router (@er-004) added to (or,
 *                    run again, taken back out of) one ERP's and one SERP's router roles.
 */

import type { TrifectaWorld } from '../../authorization/trifecta-resolver';
import { entityMatchesRoles } from '../../authorization/authorization-resolver';
import type { Policy } from '../../../shared/services/mock-data.service';
import { entityIn } from './history';
import { opEntities, type DraftOp, type DraftTarget } from './policy-draft';

/** The cards one live change touches. */
export interface LiveImpact {
  policyIds: string[];
  serviceIds: string[];
  identityIds: string[];
}

/** One change made to live outside the builder, as the builder shows it. */
export interface LiveChange {
  /** The history record it made. */
  commitId: string;
  /** ISO time (the demo clock). */
  at: string;
  /** "Dana (admin)", "Terraform". */
  actor: string;
  /** The entities it changed, by target and id, and their names: "users-gitlab". */
  entities: { target: DraftTarget; id: string; name: string }[];
  impact: LiveImpact;
}

type Roles = { semantic: Policy['semantic'] };
type Matchable = { id: string; name: string; attributes?: string[] };

const matching = (items: readonly Matchable[], roles: readonly string[], p: Roles) =>
  items.filter((x) => entityMatchesRoles(roles, p.semantic, x.attributes ?? [], x.name, x.id)).map((x) => x.id);

export function liveImpact(before: TrifectaWorld, after: TrifectaWorld, ops: readonly DraftOp[]): LiveImpact {
  const policyIds = new Set<string>();
  const serviceIds = new Set<string>();
  const identityIds = new Set<string>();
  for (const { target, id } of ops.flatMap(opEntities)) {
    const states = [entityIn(before, target, id), entityIn(after, target, id)].filter((e) => e !== null);
    switch (target) {
      case 'servicePolicy':
        policyIds.add(id);
        break;
      case 'edgeRouterPolicy':
        for (const e of states) {
          const roles = (e['identityRoles'] as string[] | undefined) ?? [];
          for (const i of matching(after.identities, roles, e as unknown as Roles)) identityIds.add(i);
        }
        break;
      case 'serviceEdgeRouterPolicy':
        for (const e of states) {
          const roles = (e['serviceRoles'] as string[] | undefined) ?? [];
          for (const s of matching(after.services, roles, e as unknown as Roles)) serviceIds.add(s);
        }
        break;
      case 'postureCheck':
        // The policies that require it.
        for (const e of states) {
          const check = { id: e.id, name: String(e['name'] ?? ''), attributes: (e['attributes'] as string[] | undefined) ?? [] };
          for (const p of after.policies) if (matching([check], p.postureCheckRoles, p).length) policyIds.add(p.id);
        }
        break;
      case 'service':
        serviceIds.add(id);
        break;
      case 'identity':
        identityIds.add(id);
        break;
      case 'accessTest':
        break; // not on the canvas
    }
  }
  return { policyIds: [...policyIds], serviceIds: [...serviceIds], identityIds: [...identityIds] };
}

/** Attributes the demo admin adds, in turn; then numbered ones. */
const ADMIN_ATTRIBUTES = ['#vendors', '#interns', '#partners'];

/** "Another admin edits users-gitlab": the next unused demo attribute in its identity roles. */
export function adminEditOps(live: TrifectaWorld, policyName = 'users-gitlab'): DraftOp[] {
  const policy = live.policies.find((p) => p.name === policyName) ?? live.policies[0];
  if (!policy) return [];
  let attr = ADMIN_ATTRIBUTES.find((a) => !policy.identityRoles.includes(a));
  for (let n = 2; !attr; n++) if (!policy.identityRoles.includes(`#vendors-${n}`)) attr = `#vendors-${n}`;
  return [{ kind: 'update', policyId: policy.id, patch: { identityRoles: [...policy.identityRoles, attr] } }];
}

/** The router Terraform adds and removes. An @ref is unioned in whatever the semantic. */
export const TERRAFORM_ROUTER = '@er-004';
export const TERRAFORM_ERP = 'rp-003'; // servers-public-routers
export const TERRAFORM_SERP = 'serp-003'; // git-repo-public-routers

const toggled = (roles: readonly string[]) =>
  roles.includes(TERRAFORM_ROUTER) ? roles.filter((r) => r !== TERRAFORM_ROUTER) : [...roles, TERRAFORM_ROUTER];

/** "Terraform run": toggles the HQ router in one ERP's and one SERP's router roles
 *  (whichever of them exist). */
export function terraformOps(live: TrifectaWorld): DraftOp[] {
  const ops: DraftOp[] = [];
  const erp = live.edgeRouterPolicies.find((p) => p.id === TERRAFORM_ERP);
  if (erp) ops.push({ kind: 'update', target: 'edgeRouterPolicy', policyId: erp.id, patch: { edgeRouterRoles: toggled(erp.edgeRouterRoles) } });
  const serp = live.serviceEdgeRouterPolicies.find((p) => p.id === TERRAFORM_SERP);
  if (serp) {
    ops.push({ kind: 'update', target: 'serviceEdgeRouterPolicy', policyId: serp.id, patch: { edgeRouterRoles: toggled(serp.edgeRouterRoles) } });
  }
  return ops;
}
