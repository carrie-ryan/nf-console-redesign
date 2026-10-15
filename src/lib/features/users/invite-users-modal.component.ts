import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MockDataService, OrgRole, RoleGrant } from '../../shared/services/mock-data.service';
import { ModalShellComponent } from '../../shared/components/modal-shell/modal-shell.component';

/** What the modal hands back on submit. The parent does the mutation. */
export interface InviteRequest {
  emails: string[];
  /** Empty when `useDefaultRoles` is set — the parent resolves the defaults. */
  roles: RoleGrant[];
  /** Apply the org's default role set instead of `roles`. */
  useDefaultRoles: boolean;
}

/** Deliberately loose — enough to catch a typo, not a spec-complete RFC 5322
 *  matcher. The real API is the authority on deliverability. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invite one or more people to the org — the redesign of the legacy
 * "INVITE NEW USERS" dialog. Emails are committed as validated chips rather
 * than parsed out of a `;`-separated blob, and roles come from a searchable
 * list; everything else the legacy dialog offered (per-role grant toggle,
 * "use default roles") is carried over.
 *
 * Wraps `app-modal-shell` for the focus trap, Escape, and focus restore. The
 * role dropdown is `position: fixed` and measured off its control — the shell's
 * `.dialog-body` is `overflow-y: auto` and would clip an absolutely-positioned
 * menu. Same approach as discovery's identity-search-select.
 */
@Component({
  selector: 'app-invite-users-modal',
  standalone: true,
  imports: [FormsModule, ModalShellComponent],
  templateUrl: './invite-users-modal.component.html',
  styleUrl: './invite-users-modal.component.css'
})
export class InviteUsersModalComponent implements OnDestroy {
  private readonly data = inject(MockDataService);
  private readonly doc = inject(DOCUMENT);

  readonly invited = output<InviteRequest>();
  readonly cancelled = output<void>();

  // ─── Emails ────────────────────────────────────────────────────────
  readonly emails = signal<string[]>([]);
  readonly emailInput = signal('');
  readonly emailError = signal<string | null>(null);

  // ─── Roles ─────────────────────────────────────────────────────────
  readonly useDefaultRoles = signal(false);
  readonly selectedRoles = signal<RoleGrant[]>([]);
  readonly roleQuery = signal('');
  readonly roleFocused = signal(false);

  readonly defaultRoleNames = computed(() =>
    this.data.orgRoles().filter(r => r.isDefault).map(r => r.name),
  );

  /** Selected ids, so the dropdown can exclude what's already chosen. */
  private readonly selectedIds = computed(() => new Set(this.selectedRoles().map(r => r.roleId)));

  /** Selections resolved back to full roles, in selection order. */
  readonly selectedRoleDetails = computed(() => {
    const byId = new Map(this.data.orgRoles().map(r => [r.id, r]));
    return this.selectedRoles()
      .map(sel => ({ grant: sel, role: byId.get(sel.roleId) }))
      .filter((e): e is { grant: RoleGrant; role: OrgRole } => e.role !== undefined);
  });

  /** Opens only on a non-empty query while focused — an empty input shows no menu. */
  readonly roleMenuOpen = computed(
    () => this.roleFocused() && this.roleQuery().trim().length > 0 && !this.useDefaultRoles(),
  );

  /** Case-insensitive substring over role name and scope, already-chosen excluded. */
  readonly roleMatches = computed<OrgRole[]>(() => {
    const q = this.roleQuery().trim().toLowerCase();
    const chosen = this.selectedIds();
    return this.data.orgRoles()
      .filter(r => !chosen.has(r.id))
      .filter(r => q === '' || r.name.toLowerCase().includes(q) || r.scope.toLowerCase().includes(q));
  });

  // ─── Submission ────────────────────────────────────────────────────
  readonly canSubmit = computed(
    () => this.emails().length > 0 && (this.useDefaultRoles() || this.selectedRoles().length > 0),
  );

  /** Footer summary of what the button will do. */
  readonly consequence = computed(() => {
    const n = this.emails().length;
    if (n === 0) return 'Add at least one email address.';
    const people = `${n} ${n === 1 ? 'person' : 'people'}`;
    if (this.useDefaultRoles()) return `Invites ${people} with the default roles.`;
    const roles = this.selectedRoleDetails();
    if (roles.length === 0) return `Select at least one role for ${people}.`;
    if (roles.length === 1) return `Invites ${people} as ${roles[0].role.name}.`;
    return `Invites ${people} with ${roles.length} roles.`;
  });

  // ─── Email chip entry ──────────────────────────────────────────────

  /** Enter, comma, and semicolon all commit — the legacy field taught `;`. */
  onEmailKeydown(event: KeyboardEvent): void {
    if (event.key === 'Backspace' && this.emailInput() === '' && this.emails().length > 0) {
      event.preventDefault();
      this.emails.update(list => list.slice(0, -1));
      return;
    }
    if (event.key !== 'Enter' && event.key !== ',' && event.key !== ';') return;
    event.preventDefault();
    this.commitEmail();
  }

  /** Commit on blur too, so a typed-but-uncommitted address isn't silently lost
   *  when the user tabs straight to the role search. */
  onEmailBlur(): void {
    if (this.emailInput().trim() !== '') this.commitEmail();
  }

  /** A paste of "a@b.com; c@d.com" should land as two chips, not one bad one. */
  onEmailPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!/[,;\s]/.test(text)) return;
    event.preventDefault();
    for (const part of text.split(/[,;\s]+/)) {
      this.emailInput.set(part);
      this.commitEmail();
      if (this.emailError()) break;
    }
  }

  private readonly emailField = viewChild<ElementRef<HTMLInputElement>>('emailField');

  /**
   * Clear BOTH the signal and the native input. `[ngModel]` writes back to the
   * DOM asynchronously, so between a commit and the next change-detection pass
   * the input still holds the committed text — any keystroke arriving in that
   * window (a paste, an autofill burst, fast typing) appends to the stale value
   * and the addresses run together. Setting `.value` directly closes the gap.
   */
  private clearEmailInput(): void {
    this.emailInput.set('');
    const el = this.emailField()?.nativeElement;
    if (el) el.value = '';
  }

  private commitEmail(): void {
    const raw = this.emailInput().trim().replace(/[,;]+$/, '');
    if (!raw) { this.clearEmailInput(); return; }
    if (!EMAIL_RE.test(raw)) {
      this.emailError.set(`"${raw}" is not a valid email address.`);
      return;
    }
    if (this.emails().some(e => e.toLowerCase() === raw.toLowerCase())) {
      this.emailError.set(`${raw} has already been added.`);
      return;
    }
    this.emails.update(list => [...list, raw]);
    this.clearEmailInput();
    this.emailError.set(null);
  }

  setEmailInput(value: string): void {
    this.emailInput.set(value);
    // Typing is the user fixing the problem — clear the complaint as they go.
    if (this.emailError()) this.emailError.set(null);
  }

  removeEmail(email: string): void {
    this.emails.update(list => list.filter(e => e !== email));
  }

  // ─── Role selection ────────────────────────────────────────────────

  private readonly roleField = viewChild<ElementRef<HTMLInputElement>>('roleField');

  pickRole(role: OrgRole): void {
    // Seeded from the role's org-level option (Edit Role Options), not hardcoded
    // off — but still only a starting point: the admin can flip it per person.
    this.selectedRoles.update(list => [
      ...list,
      { roleId: role.id, canGrant: role.grantableByDefault ?? false },
    ]);
    // Same async write-back caveat as the email field — see clearEmailInput.
    this.roleQuery.set('');
    const el = this.roleField()?.nativeElement;
    if (el) el.value = '';
  }

  removeRole(roleId: string): void {
    this.selectedRoles.update(list => list.filter(r => r.roleId !== roleId));
  }

  toggleCanGrant(roleId: string): void {
    this.selectedRoles.update(list =>
      list.map(r => (r.roleId === roleId ? { ...r, canGrant: !r.canGrant } : r)),
    );
  }

  /** Enter picks the first match. */
  onRoleEnter(event: Event): void {
    const matches = this.roleMatches();
    if (matches.length === 0) return;
    event.preventDefault();
    this.pickRole(matches[0]);
  }

  onRoleFocus(): void {
    this.roleFocused.set(true);
    this.updateMenuPosition();
  }

  // ─── Fixed-overlay positioning for the role dropdown ───────────────
  private readonly roleControl = viewChild<ElementRef<HTMLElement>>('roleControl');
  readonly menuTop = signal(0);
  readonly menuLeft = signal(0);
  readonly menuWidth = signal(0);
  readonly menuMaxHeight = signal(240);

  constructor() {
    // Re-place the menu when the selection changes — adding a role row grows the
    // control and moves its bottom edge.
    effect(() => {
      this.selectedRoles();
      if (this.roleMenuOpen()) this.updateMenuPosition();
    });
    // Capture phase so scrolling the modal BODY (an inner element, not window)
    // repositions the menu instead of letting it detach from the control.
    this.doc.addEventListener('scroll', this.reposition, true);
  }

  ngOnDestroy(): void {
    this.doc.removeEventListener('scroll', this.reposition, true);
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.roleMenuOpen()) this.updateMenuPosition();
  }

  private readonly reposition = (): void => {
    if (this.roleMenuOpen()) this.updateMenuPosition();
  };

  private updateMenuPosition(): void {
    const el = this.roleControl()?.nativeElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = r.bottom + 4;
    this.menuTop.set(top);
    this.menuLeft.set(r.left);
    this.menuWidth.set(r.width);
    const available = this.doc.defaultView!.innerHeight - top - 12;
    this.menuMaxHeight.set(Math.max(140, Math.min(320, available)));
  }

  // ─── Actions ───────────────────────────────────────────────────────

  setUseDefaultRoles(value: boolean): void {
    this.useDefaultRoles.set(value);
    if (value) this.roleQuery.set('');
  }

  cancel(): void { this.cancelled.emit(); }

  submit(): void {
    // Catch an address still sitting in the input when Send is clicked.
    if (this.emailInput().trim() !== '') this.commitEmail();
    if (!this.canSubmit()) return;
    this.invited.emit({
      emails: this.emails(),
      roles: this.useDefaultRoles() ? [] : this.selectedRoles(),
      useDefaultRoles: this.useDefaultRoles(),
    });
  }
}
