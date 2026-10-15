import { Component, computed, inject, signal } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConsoleUser, ConsoleUserStatus, MockDataService, OrgRole, RoleGrant } from '../../shared/services/mock-data.service';
import { UserPrefsService } from '../../shared/services/user-prefs.service';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { PillComponent, PillVariant } from '../../shared/components/pill/pill.component';
import { InviteRequest, InviteUsersModalComponent } from './invite-users-modal.component';
import { EditRoleOptionsModalComponent, RoleOptionUpdate } from './edit-role-options-modal.component';

type UserTab = 'users' | 'roles' | 'invitations' | 'role-templates';

/**
 * Org administration — the humans who sign into the console, as opposed to the
 * Ziti edge identities under /identities. Four in-page subtabs (mirrors
 * SessionsComponent); only Users is built out, the rest are empty states until
 * their columns are specified.
 */
@Component({
  selector: 'app-users',
  standalone: true,
  imports: [SlicePipe, RouterLink, EmptyStateComponent, PillComponent, InviteUsersModalComponent, EditRoleOptionsModalComponent],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css'
})
export class UsersComponent {
  readonly data = inject(MockDataService);
  readonly prefs = inject(UserPrefsService);

  readonly tabs: { id: UserTab; label: string }[] = [
    { id: 'users',          label: 'Users' },
    { id: 'roles',          label: 'User Roles' },
    { id: 'invitations',    label: 'Invitations' },
    { id: 'role-templates', label: 'Role Templates' },
  ];

  /** The tabs are in-page state rather than routes, so a page that navigates
   *  away and back (the role-template form) says which one to restore via a
   *  `?tab=` query param. Read once — the tabs don't deep-link beyond that. */
  readonly activeTab = signal<UserTab>(this.initialTab());
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly inviteOpen = signal(false);

  // ─── User Roles tab ──────────────────────────────────────────────────
  /** The role whose options are being edited — null when the modal is closed. */
  readonly editingRole = signal<OrgRole | null>(null);
  readonly roleFilter = signal('');
  /** Role ids whose member list is expanded (the "Show N User(s)" disclosure). */
  readonly expandedRoles = signal<Set<string>>(new Set());

  readonly filteredRoles = computed(() => {
    const q = this.roleFilter().toLowerCase().trim();
    if (!q) return this.data.orgRoles();
    return this.data.orgRoles().filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.scope.toLowerCase().includes(q) ||
      r.strategy.toLowerCase().includes(q) ||
      r.resourceType.toLowerCase().includes(q),
    );
  });

  /** Members holding a role, with the per-user grant flag that role carries for
   *  them — the sub-rows the disclosure reveals. */
  membersOf(roleId: string): { user: ConsoleUser; canGrant: boolean }[] {
    return this.data.consoleUsers()
      .map(user => ({ user, grant: user.roleGrants?.find(g => g.roleId === roleId) }))
      .filter((e): e is { user: ConsoleUser; grant: RoleGrant } => e.grant !== undefined)
      .map(e => ({ user: e.user, canGrant: e.grant.canGrant }));
  }

  isRoleExpanded(roleId: string): boolean { return this.expandedRoles().has(roleId); }

  toggleRoleExpanded(roleId: string): void {
    this.expandedRoles.update(s => {
      const next = new Set(s);
      if (next.has(roleId)) next.delete(roleId); else next.add(roleId);
      return next;
    });
  }

  readonly allSelected = computed(() => {
    const items = this.data.consoleUsers();
    return items.length > 0 && items.every(u => this.selectedIds().has(u.id));
  });
  readonly someSelected = computed(() => this.data.consoleUsers().some(u => this.selectedIds().has(u.id)));

  private initialTab(): UserTab {
    const requested = inject(ActivatedRoute).snapshot.queryParamMap.get('tab');
    return this.tabs.some(t => t.id === requested) ? (requested as UserTab) : 'users';
  }

  /** Switching tabs drops the selection — it belongs to the Users table only. */
  setTab(tab: UserTab): void {
    this.activeTab.set(tab);
    this.clearSelection();
  }

  toggleSelect(id: string): void {
    this.selectedIds.update(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  selectAllPage(items: { id: string }[]): void {
    const ids = items.map(i => i.id);
    const allSel = ids.every(id => this.selectedIds().has(id));
    this.selectedIds.update(s => {
      const next = new Set(s);
      if (allSel) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  clearSelection(): void { this.selectedIds.set(new Set()); }

  /**
   * Land the invite as pending users so the new rows show up immediately.
   * Mutating the shared signal from the page is the established convention
   * here — alerts does the same with `data.alerts.update(...)`.
   *
   * `lastLoginAt` is deliberately left unset: an invitee has never signed in,
   * and the table already renders that as "Never".
   */
  onInvited(req: InviteRequest): void {
    // "Use default roles" is resolved here, not in the modal: the invitee gets
    // real role rows like anyone else, so the table has something to render.
    // Defaults arrive ungrantable — handing one out is an explicit choice.
    const roleGrants: RoleGrant[] = req.useDefaultRoles
      ? this.data.orgRoles().filter(r => r.isDefault).map(r => ({ roleId: r.id, canGrant: false }))
      : req.roles;

    const now = new Date().toISOString();
    this.data.consoleUsers.update(users => [
      ...users,
      ...req.emails.map(email => ({
        id: crypto.randomUUID(),
        // No display name until the invitee accepts and fills one in; the
        // local-part is the best stand-in the invite gives us.
        name: email.split('@')[0],
        email,
        roleGrants,
        status: 'invited' as const,
        mfaEnabled: false,
        createdAt: now,
      })),
    ]);
    this.inviteOpen.set(false);
  }

  /** Commit one role's org-level options. Same convention as onInvited — the
   *  page writes the shared signal; the modal only reports intent. */
  onRoleOptionsSaved(update: RoleOptionUpdate): void {
    this.data.orgRoles.update(roles =>
      roles.map(r => r.id === update.roleId
        ? { ...r, isDefault: update.isDefault, grantableByDefault: update.grantableByDefault }
        : r),
    );
    this.editingRole.set(null);
  }

  // ─── Role cell ───────────────────────────────────────────────────────

  /** Role ids → names, in assignment order. Ids with no matching OrgRole are
   *  dropped rather than shown raw. */
  private roleNames(user: ConsoleUser, grantableOnly = false): string[] {
    const byId = new Map(this.data.orgRoles().map(r => [r.id, r]));
    return (user.roleGrants ?? [])
      .filter(g => !grantableOnly || g.canGrant)
      .map(g => byId.get(g.roleId)?.name)
      .filter((name): name is string => name !== undefined);
  }

  /** Role cell text: the name when there's one role, "N roles" beyond that. */
  roleLabel(user: ConsoleUser): string {
    const names = this.roleNames(user);
    if (names.length === 0) return '—';
    if (names.length === 1) return names[0];
    return `${names.length} roles`;
  }

  /** Just the roles this user may hand out — empty means no badge. Named in the
   *  badge's tooltip, since a user can hold several roles and grant only some. */
  grantableRoles(user: ConsoleUser): string[] {
    return this.roleNames(user, true);
  }

  /** ConsoleUserStatus → PillVariant. Status is optional on ConsoleUser, so an
   *  unset status reads as 'active' (the state every pre-existing fixture is in). */
  statusVariant(status: ConsoleUserStatus | undefined): PillVariant {
    switch (status) {
      case 'invited':  return 'pending';
      case 'disabled': return 'inactive';
      default:         return 'active';
    }
  }

  statusLabel(status: ConsoleUserStatus | undefined): string {
    switch (status) {
      case 'invited':  return 'Invited';
      case 'disabled': return 'Disabled';
      default:         return 'Active';
    }
  }
}
