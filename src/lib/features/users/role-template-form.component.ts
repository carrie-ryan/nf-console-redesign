import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  ROLE_RESOURCES,
  RoleAction,
  RoleResource,
  RoleTemplate,
  TemplateAnchor,
} from './role-template-resources';

/** Where Cancel / Save / the back arrow return to. The Users subtabs are in-page
 *  state, so the query param is what puts you back on the right one. */
const RETURN_TO = '/users';
const RETURN_QUERY = { tab: 'role-templates' };

/**
 * Add a role template — the full-page redesign of the legacy "ADD A ROLE
 * TEMPLATE" dialog.
 *
 * The permission matrix is a two-pane picker rather than the legacy accordion:
 * resources on the left (each showing how many actions it has selected), the
 * highlighted resource's action chips on the right. Every resource stays one
 * click away, and the right pane never gets longer than one resource's actions
 * — which is what made the modal unworkable at this density.
 */
@Component({
  selector: 'app-role-template-form',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './role-template-form.component.html',
  styleUrl: './role-template-form.component.css'
})
export class RoleTemplateFormComponent {
  private readonly router = inject(Router);

  readonly resources = ROLE_RESOURCES;
  readonly returnLink = RETURN_TO;
  readonly returnQuery = RETURN_QUERY;

  // ─── Details ─────────────────────────────────────────────────────────
  readonly name = signal('');
  readonly description = signal('');
  readonly anchor = signal<TemplateAnchor>('Network');
  readonly anchors: { id: TemplateAnchor; hint: string }[] = [
    { id: 'Network',       hint: 'Permissions apply within a single network.' },
    { id: 'Network Group', hint: 'Permissions apply across every network in the group.' },
  ];

  // ─── Actions ─────────────────────────────────────────────────────────
  /** Resource id → selected actions. A missing key means nothing selected. */
  readonly selected = signal<Record<string, RoleAction[]>>({});
  readonly activeId = signal<string>(ROLE_RESOURCES[0].id);
  readonly filter = signal('');

  readonly activeResource = computed<RoleResource>(
    () => this.resources.find(r => r.id === this.activeId()) ?? this.resources[0],
  );

  /** Filtering narrows the list but never changes which resource is active —
   *  clearing the filter shouldn't move the right pane out from under you. */
  readonly filteredResources = computed(() => {
    const q = this.filter().toLowerCase().trim();
    if (!q) return this.resources;
    return this.resources.filter(r =>
      r.name.toLowerCase().includes(q) || r.id.includes(q),
    );
  });

  readonly totalActions = computed(() =>
    Object.values(this.selected()).reduce((n, list) => n + list.length, 0),
  );

  readonly resourceCount = computed(() =>
    Object.values(this.selected()).filter(list => list.length > 0).length,
  );

  /** Header count pill, echoing the reference's "2 of 22 fields included". */
  readonly summary = computed(() => {
    const r = this.resourceCount();
    const a = this.totalActions();
    if (r === 0) return `0 of ${this.resources.length} resources`;
    const actions = `${a} ${a === 1 ? 'action' : 'actions'}`;
    return `${r} of ${this.resources.length} resources · ${actions}`;
  });

  readonly canSave = computed(() => this.name().trim() !== '' && this.totalActions() > 0);

  countFor(resourceId: string): number {
    return this.selected()[resourceId]?.length ?? 0;
  }

  isActionOn(resourceId: string, action: RoleAction): boolean {
    return this.selected()[resourceId]?.includes(action) ?? false;
  }

  toggleAction(resourceId: string, action: RoleAction): void {
    this.selected.update(cur => {
      const list = cur[resourceId] ?? [];
      const next = list.includes(action)
        ? list.filter(a => a !== action)
        : [...list, action];
      return { ...cur, [resourceId]: next };
    });
  }

  /** All of the ACTIVE resource's actions are selected. */
  readonly allActiveSelected = computed(() => {
    const r = this.activeResource();
    return this.countFor(r.id) === r.actions.length;
  });

  /** At least one — drives the All-actions checkbox's indeterminate state. */
  readonly someActiveSelected = computed(() => this.countFor(this.activeResource().id) > 0);

  toggleAllForActive(): void {
    const r = this.activeResource();
    const all = this.allActiveSelected();
    this.selected.update(cur => ({ ...cur, [r.id]: all ? [] : [...r.actions] }));
  }

  // ─── Actions on the form itself ──────────────────────────────────────

  cancel(): void {
    this.router.navigate([RETURN_TO], { queryParams: RETURN_QUERY });
  }

  save(): void {
    if (!this.canSave()) return;

    const template: RoleTemplate = {
      name: this.name().trim(),
      description: this.description().trim(),
      anchor: this.anchor(),
      // Drop resources the user toggled on and back off — an empty list is not
      // a grant, and it would otherwise inflate the saved template.
      grants: Object.fromEntries(
        Object.entries(this.selected()).filter(([, list]) => list.length > 0),
      ),
    };

    // TODO(persistence): append `template` to a templates signal and render it
    // on the Role Templates tab. Deliberately out of scope for this pass — the
    // shape above is what that store would take.
    void template;

    this.router.navigate([RETURN_TO], { queryParams: RETURN_QUERY });
  }
}
