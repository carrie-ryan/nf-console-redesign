import { NgTemplateOutlet } from '@angular/common';
import { SearchPickerComponent, attributeItems, entityItems } from './search-picker.component';
import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { entityMatchesRoles } from '../authorization/authorization-resolver';
import type { EdgeRouterPolicy, Policy, ServiceEdgeRouterPolicy } from '../../shared/services/mock-data.service';
import { PolicyDraftStore, type AnyPatch } from './draft/policy-draft.store';
import type { DraftOp } from './draft/policy-draft';

export type RouterTarget = 'edgeRouterPolicy' | 'serviceEdgeRouterPolicy';
export type RouterPolicy = EdgeRouterPolicy | ServiceEdgeRouterPolicy;

type Side = 'identity' | 'service' | 'router';

interface Entity {
  id: string;
  name: string;
  attributes?: readonly string[];
  /** Identities: the edge router a router identity belongs to. */
  routerId?: string;
}

interface NamedChip {
  role: string;
  name: string;
  found: boolean;
  /** A router identity: shown with the router icon. */
  router: boolean;
}

const ROLE_KEY: Record<Side, 'identityRoles' | 'serviceRoles' | 'edgeRouterRoles'> = {
  identity: 'identityRoles',
  service: 'serviceRoles',
  router: 'edgeRouterRoles',
};

const SIDES: Record<RouterTarget, readonly [Side, Side]> = {
  edgeRouterPolicy: ['identity', 'router'],
  serviceEdgeRouterPolicy: ['service', 'router'],
};

const NOUN: Record<Side, { title: string; one: string; many: string; pick: string; icon: string }> = {
  identity: { title: 'Identities', one: 'identity', many: 'identities', pick: 'an identity', icon: 'fa-user' },
  service: { title: 'Services', one: 'service', many: 'services', pick: 'a service', icon: 'fa-cube' },
  router: { title: 'Routers', one: 'router', many: 'routers', pick: 'a router', icon: 'fa-tower-broadcast' },
};

const KIND: Record<RouterTarget, string> = {
  edgeRouterPolicy: 'edge router policy',
  serviceEdgeRouterPolicy: 'service edge router policy',
};

/** Matched names listed before "+N more", which expands to all. */
const MATCH_SAMPLE = 3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Side panel editing ONE router policy of the draft world — an edge router policy
 * (identities ↔ routers) or a service edge router policy (services ↔ routers).
 * Edits go to PolicyDraftStore.upsertUpdate / deletePolicy with the target, so the
 * canvas, router band and diff follow along.
 *
 * PENDING mode (`pending` set): a gap fix under review, not in the draft yet —
 * either a new suggested policy (`pendingKind` 'create') or an existing one with
 * the fix's entries added (`pendingKind` 'update', those entries in `highlight`).
 * Edits change only the local copy; "Add to draft" adds a create, or folds the
 * changes into the policy's update; "Cancel" leaves the draft untouched. Once
 * added, the editor edits the draft as usual.
 *
 * Named identities are written as @<name>; named services and routers as @<id>,
 * as the seed's own policies do (@svc-004, @er-002).
 *
 * A SYSTEM policy (isSystem: a router identity's grant of its own router, created by
 * Ziti) opens read-only: "Created by Ziti for this router", no pickers, no removing,
 * no delete. The draft would refuse any op on it anyway (applyDraft).
 */
@Component({
  selector: 'app-router-policy-editor',
  standalone: true,
  imports: [NgTemplateOutlet, SearchPickerComponent],
  templateUrl: './router-policy-editor.component.html',
  styleUrls: ['./policy-editor.component.css', './tag-input.css', './router-policy-editor.component.css'],
})
export class RouterPolicyEditorComponent {
  private readonly store = inject(PolicyDraftStore);

  readonly target = input.required<RouterTarget>();
  readonly policyId = input.required<string>();
  /** A fix under review, not yet in the draft. */
  readonly pending = input<RouterPolicy | null>(null);
  readonly pendingKind = input<'create' | 'update'>('create');
  /** Roles the fix adds to an existing policy — marked on their chips while pending. */
  readonly highlight = input<readonly string[]>([]);
  readonly closed = output<void>();

  readonly editError = signal<string | null>(null);

  /** The pending policy until it's added; null once it's in the draft. */
  private readonly local = linkedSignal(() => this.pending());
  readonly isPending = computed(() => this.local() !== null);

  private readonly world = this.store.draftWorld;
  /** The policy as the draft has it (undefined for a new suggestion). */
  private readonly draftPolicy = computed<RouterPolicy | undefined>(() => {
    const list: readonly RouterPolicy[] =
      this.target() === 'edgeRouterPolicy' ? this.world().edgeRouterPolicies : this.world().serviceEdgeRouterPolicies;
    return list.find((p) => p.id === this.policyId());
  });
  readonly policy = computed<RouterPolicy | undefined>(() => this.local() ?? this.draftPolicy());

  readonly kind = computed(() => KIND[this.target()]);
  /** Created by Ziti: shown read-only. */
  readonly system = computed(() => !!(this.policy() as EdgeRouterPolicy | undefined)?.isSystem);
  /** The router a system policy was made for: "edge-public-us-east-1". */
  readonly systemRouter = computed(() => {
    const p = this.policy();
    if (!p || !this.system()) return null;
    const ids = p.edgeRouterRoles.filter((r) => r.startsWith('@')).map((r) => r.slice(1));
    return this.world().edgeRouters.find((r) => ids.includes(r.id) || ids.includes(r.name))?.name ?? null;
  });
  readonly title = computed(() =>
    this.system()
      ? `System ${this.kind()}`
      : this.isPending() && this.pendingKind() === 'create'
        ? `New ${this.kind()}`
        : `Edit ${this.kind()}`,
  );
  readonly mark = computed(() => (this.isPending() ? null : this.store.routerMark(this.target(), this.policyId())));

  private entities(side: Side): readonly Entity[] {
    const w = this.world();
    return side === 'identity' ? w.identities : side === 'service' ? w.services : w.edgeRouters;
  }

  readonly sides = computed(() => {
    const p = this.policy();
    return p ? SIDES[this.target()].map((side) => this.sideModel(side, p)) : [];
  });

  private sideModel(side: Side, p: RouterPolicy) {
    const roles = this.rolesOf(p, side);
    const all = this.entities(side);
    const named: NamedChip[] = roles
      .filter((r) => r.startsWith('@'))
      .map((role) => {
        const hit = all.find((e) => entityMatchesRoles([role], 'AnyOf', e.attributes ?? [], e.name, e.id));
        return { role, name: hit?.name ?? role.slice(1), found: !!hit, router: !!hit?.routerId };
      });
    const terms = roles.filter((r) => r.startsWith('#'));
    const matched = all.filter((e) => entityMatchesRoles(roles, p.semantic, e.attributes ?? [], e.name, e.id));
    const n = NOUN[side];
    return {
      side,
      noun: n,
      named,
      terms,
      // The pickers: identities by @name, services and routers by @id; what the policy has is marked.
      nameItems: entityItems(all, side === 'identity' ? 'name' : 'id'),
      attrItems: attributeItems(all, n),
      chosen: new Set(roles),
      count: `${plural(matched.length, n.one, n.many)} ${matched.length === 1 ? 'matches' : 'match'}`,
      names: matched.map((e) => e.name),
      more: Math.max(0, matched.length - MATCH_SAMPLE),
    };
  }

  private rolesOf(p: RouterPolicy, side: Side): string[] {
    return [...(((p as unknown as Record<string, string[]>)[ROLE_KEY[side]]) ?? [])];
  }

  /** Sides whose match list was expanded past "+N more"; reset per policy. */
  readonly expandedSides = linkedSignal<string, ReadonlySet<Side>>({
    source: this.policyId,
    computation: () => new Set(),
  });

  shownNames(side: Side, names: readonly string[]): readonly string[] {
    return this.expandedSides().has(side) ? names : names.slice(0, MATCH_SAMPLE);
  }

  toggleMatches(side: Side): void {
    this.expandedSides.update((s) => {
      const next = new Set(s);
      if (!next.delete(side)) next.add(side);
      return next;
    });
  }

  // ─── edits ──────────────────────────────────────────────────────────────────

  private createOp(policy: RouterPolicy): DraftOp {
    return this.target() === 'edgeRouterPolicy'
      ? { kind: 'create', target: 'edgeRouterPolicy', policy: policy as EdgeRouterPolicy }
      : { kind: 'create', target: 'serviceEdgeRouterPolicy', policy: policy as ServiceEdgeRouterPolicy };
  }

  /** While pending, edits stay local; otherwise they're upserted into the draft. */
  private edit(patch: AnyPatch): void {
    const local = this.local();
    if (local) {
      this.local.set({ ...local, ...patch, id: local.id } as RouterPolicy);
      return;
    }
    this.guard(() => this.store.upsertUpdate(this.policyId(), patch, this.target()));
  }

  private guard(action: () => void): boolean {
    try {
      action();
      this.editError.set(null);
      return true;
    } catch (e) {
      this.editError.set(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** A pending policy's sides with nothing on them — "routers" — which it can't be added without. */
  readonly missingSides = computed(() => {
    const p = this.local();
    return p ? SIDES[this.target()].filter((side) => !this.rolesOf(p, side).length).map((side) => NOUN[side].many) : [];
  });

  /** The reviewed fix goes into the draft: a create, or an update of the fields it changed. */
  addToDraft(): void {
    const local = this.local();
    if (!local || this.missingSides().length) return;
    const added = this.guard(() => {
      if (this.pendingKind() === 'create') {
        this.store.addOp(this.createOp(local));
        return;
      }
      const current = this.draftPolicy() as unknown as Record<string, unknown> | undefined;
      const patch = Object.fromEntries(
        Object.entries(local).filter(([k, v]) => k !== 'id' && JSON.stringify(v) !== JSON.stringify(current?.[k])),
      );
      this.store.upsertUpdate(local.id, patch as AnyPatch, this.target());
    });
    if (added) this.local.set(null);
  }

  /** A pending role the fix added, shown highlighted. */
  isAdded(role: string): boolean {
    return this.isPending() && this.highlight().includes(role);
  }

  rename(name: string): void {
    this.edit({ name });
  }

  setSemantic(semantic: Policy['semantic']): void {
    this.edit({ semantic });
  }

  private setRoles(side: Side, roles: string[]): void {
    this.edit({ [ROLE_KEY[side]]: roles });
  }

  private roles(side: Side): string[] {
    const p = this.policy();
    return p ? this.rolesOf(p, side) : [];
  }

  /** A picked role ('@name' / '@id' / '#attribute'); typed attribute text gets its '#'. */
  addRole(side: Side, value: string): void {
    const role = value.startsWith('@') || value.startsWith('#') ? value : `#${value}`;
    const roles = this.roles(side);
    if (!roles.includes(role)) this.setRoles(side, [...roles, role]);
  }

  removeRole(side: Side, role: string): void {
    this.setRoles(side, this.roles(side).filter((r) => r !== role));
  }

  deletePolicy(): void {
    if (this.guard(() => this.store.deletePolicy(this.policyId(), this.target()))) this.closed.emit();
  }
}
