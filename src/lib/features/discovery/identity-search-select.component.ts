import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Identity } from '../../shared/services/mock-data.service';

/**
 * ONE grant entry in the merged identity-authorization field: either a direct
 * `@`-reference to a specific identity, or a `#`-role the policy targets. The
 * `token` is the canonical, display-and-dedup key ('@name' or '#role'); a ref
 * also carries the minimal identity it points at.
 *
 * A ref's `identity` is intentionally the MINIMAL {id, name} — NOT a full
 * Identity. Seeded refs can come from observed dialers that don't resolve to a
 * real Identity (CIDR-first / unenrolled hosts); those carry {id, name} only, so
 * widening the field to the shared subset lets resolved and unresolved refs share
 * one shape without fabricating createdAt/status/type or casting.
 */
export type GrantEntry =
  | { kind: 'ref'; token: string; identity: { id: string; name: string } }
  | { kind: 'role'; token: string }
  // An observed, UNENROLLED source (an IP). DISPLAYED (so the exclusion is visible)
  // and removable, but NOT a grantable @/# reference — it never enters identityRoles
  // and is not search-addable (it only arrives via seed). token === ip.
  | { kind: 'address'; token: string; ip: string };

/**
 * Search-and-multi-select for the merged identity-authorization field — a
 * CONTROLLED component that owns NO selection state. The parent supplies the
 * identity pool (`candidateIdentities`), the distinct role tokens
 * (`candidateRoles`), and the already-`selected` grant entries; this component
 * only emits `add` / `remove` intents. Its sole internal state is transient UI
 * (the query text + whether the dropdown is open).
 *
 * One search yields BOTH result types: identities (matched by name / #attribute)
 * and roles (matched by token substring), visually distinguished in the dropdown
 * and in the selected chips so `@`refs and `#`roles are separable at a glance.
 *
 * Colocated with the modal (not shared) — it's specific to that flow's shape.
 */
@Component({
  selector: 'app-identity-search-select',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="iss">
      <div #control class="iss-control" [class.is-open]="isOpen()">
        @for (e of selected(); track e.token) {
          @if (e.kind === 'address') {
            <!-- Observed address: NOT grantable. Reuses the raw table's unenrolled
                 vocabulary (de-emphasized value + "unenrolled" src-badge). -->
            <span class="tag-chip address">
              <span class="src-unenrolled">{{ e.token }}</span>
              <span class="src-badge">unmanaged</span>
              <button class="tag-chip-x" type="button" (click)="remove.emit(e)"
                [attr.aria-label]="'Remove ' + e.token"><i class="fa-solid fa-xmark"></i></button>
            </span>
          } @else {
            <span class="tag-chip" [class.ref]="e.kind === 'ref'" [class.role]="e.kind === 'role'">
              <i class="fa-solid" [class.fa-user]="e.kind === 'ref'" [class.fa-tag]="e.kind === 'role'"
                aria-hidden="true"></i>
              {{ e.token }}
              <button class="tag-chip-x" type="button" (click)="remove.emit(e)"
                [attr.aria-label]="'Remove ' + e.token"><i class="fa-solid fa-xmark"></i></button>
            </span>
          }
        }
        <input class="iss-input" type="text"
          [ngModel]="query()" (ngModelChange)="query.set($event)"
          (focus)="onFocus()" (blur)="focused.set(false)"
          (keydown.enter)="onEnter($event)"
          [placeholder]="selected().length === 0 ? 'Search identities or #roles' : ''"
          autocomplete="off" role="combobox" [attr.aria-expanded]="isOpen()" />
      </div>

      @if (isOpen() && (matchIdentities().length > 0 || matchRoles().length > 0)) {
        <!-- mousedown preventDefault so picking doesn't blur-close before click -->
        <ul class="iss-menu" role="listbox" (mousedown)="$event.preventDefault()"
          [style.top.px]="menuTop()" [style.left.px]="menuLeft()"
          [style.width.px]="menuWidth()" [style.maxHeight.px]="menuMaxHeight()">
          @if (matchRoles().length > 0) {
            <li class="iss-group" role="presentation">Roles</li>
            @for (r of matchRoles(); track r) {
              <li class="iss-opt is-role" role="option" (click)="pickRole(r)">
                <span class="iss-opt-name mono">{{ r }}</span>
                <span class="iss-opt-kind"><i class="fa-solid fa-tag"></i> role</span>
              </li>
            }
          }
          @if (matchIdentities().length > 0) {
            <li class="iss-group" role="presentation">Identities</li>
            @for (m of matchIdentities(); track m.id) {
              <li class="iss-opt is-ref" role="option" (click)="pickIdentity(m)">
                <span class="iss-opt-name">{{ m.name }}</span>
                <span class="iss-opt-attrs">
                  @for (a of m.attributes; track a) {
                    <span class="iss-opt-attr">{{ a }}</span>
                  }
                </span>
              </li>
            }
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .iss { position: relative; }
    .iss-control {
      display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
      padding: 6px 8px; min-height: 38px;
      border: 1px solid var(--border, #d0d5dd); border-radius: 8px;
      background: var(--surface, #fff);
    }
    .iss-control.is-open { border-color: var(--accent, #3b82f6); }
    /* Chips are rendered inside this component, so the modal's .tag-chip styles
       don't reach them — size them here. Without this the X inherits the modal's
       font-size/line-height and renders oversized. */
    .tag-chip {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; line-height: 1.4;
      padding: 2px 4px 2px 8px; border-radius: 6px;
      border: 1px solid transparent;
      background: var(--chip, #f2f4f7); color: inherit;
    }
    /* Refs vs roles must read distinct at a glance: different tint + border, and
       a leading icon (fa-user for @refs, fa-tag for #roles). */
    .tag-chip.ref {
      background: var(--ref-chip, #eef4ff); border-color: var(--ref-border, #c7d7fe);
    }
    .tag-chip.role {
      background: var(--role-chip, #f3eefe); border-color: var(--role-border, #d9c7fe);
    }
    .tag-chip > .fa-user, .tag-chip > .fa-tag {
      font-size: 10px; color: var(--muted, #667085);
    }
    /* Observed address (unenrolled) chip — muted, plainly not a grant. Value +
       badge styles copied verbatim from the raw table (.src-unenrolled/.src-badge)
       so the "unenrolled" vocabulary reads identically to where it originated. */
    .tag-chip.address {
      background: var(--color-surface-2, #f2f4f7);
      border-color: var(--color-border, #d0d5dd);
    }
    .src-unenrolled { color: var(--color-text-2, #667085); font-weight: 500; }
    .src-badge {
      display: inline-flex;
      align-items: center;
      margin-left: 0.4rem;
      padding: 0.05rem 0.4rem;
      border: 1px solid var(--color-border, #d0d5dd);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-surface-2, #eef0f3);
      color: var(--color-text-3, #98a2b3);
      font-size: 0.8125rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      line-height: 1.4;
      white-space: nowrap;
      vertical-align: middle;
    }
    .tag-chip-x {
      display: inline-flex; align-items: center; justify-content: center;
      /* sized to the chip text, not the modal */
      font-size: 11px; line-height: 1; vertical-align: middle;
      width: 16px; height: 16px; padding: 0;
      border: none; border-radius: 4px; cursor: pointer;
      background: transparent; color: var(--muted, #667085);
    }
    .tag-chip-x:hover { background: var(--hover, #e4e7ec); color: inherit; }
    .tag-chip-x:focus-visible { outline: 2px solid var(--accent, #3b82f6); outline-offset: 1px; }
    .tag-chip-x .fa-xmark { font-size: 11px; line-height: 1; }
    .iss-input {
      flex: 1 1 140px; min-width: 140px; border: none; outline: none;
      background: transparent; font: inherit; color: inherit; padding: 2px;
    }
    .iss-menu {
      /* FIXED, not absolute: the menu is anchored to the viewport so the modal's
         scrollable body (overflow:auto) can't clip it — it renders IN FRONT of the
         modal. top/left/width and a fitted max-height come from TS measurement of
         the control (see updateMenuPosition). z-index sits above the dialog. */
      position: fixed; z-index: 1000;
      box-sizing: border-box; margin: 0; padding: 4px; list-style: none;
      overflow-y: auto;
      /* Keep wheel/scroll at the list's boundary from chaining to the modal/page
         behind — the list scrolls within itself. */
      overscroll-behavior: contain;
      border: 1px solid var(--border, #d0d5dd); border-radius: 8px;
      background: var(--surface, #fff);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    }
    .iss-group {
      padding: 6px 10px 2px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--muted, #667085);
    }
    .iss-opt {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 8px 10px; border-radius: 6px; cursor: pointer;
    }
    .iss-opt:hover { background: var(--hover, #f2f4f7); }
    .iss-opt.is-role:hover { background: var(--role-chip, #f3eefe); }
    .iss-opt-name { font-weight: 500; }
    .mono { font-family: var(--mono, monospace); }
    .iss-opt-kind {
      font-size: 11px; color: var(--muted, #667085);
      display: inline-flex; align-items: center; gap: 4px;
    }
    .iss-opt-attrs { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
    .iss-opt-attr {
      font-size: 11px; font-family: var(--mono, monospace);
      color: var(--muted, #667085); background: var(--chip, #f2f4f7);
      padding: 1px 6px; border-radius: 10px;
    }
  `,
})
export class IdentitySearchSelectComponent implements OnDestroy {
  /** Full identity pool to search over — supplied by the parent. */
  readonly candidateIdentities = input.required<Identity[]>();
  /** Distinct `#role` tokens the parent lets the user pick — supplied by the
   *  parent (computed from the pool's attributes; this component injects nothing). */
  readonly candidateRoles = input.required<string[]>();
  /** Already-chosen grant entries — supplied by the parent (controlled). */
  readonly selected = input.required<GrantEntry[]>();

  readonly add = output<GrantEntry>();
  readonly remove = output<GrantEntry>();

  // ─── fixed-overlay positioning ──────────────────────────────────────
  // The menu is position:fixed so the modal's scrollable body can't clip it.
  // These four values (measured from the control) place and size it under the
  // input each time it opens, the chips wrap, or the page/modal scrolls/resizes.
  private readonly control = viewChild<ElementRef<HTMLElement>>('control');
  private readonly doc = inject(DOCUMENT);
  readonly menuTop = signal(0);
  readonly menuLeft = signal(0);
  readonly menuWidth = signal(0);
  readonly menuMaxHeight = signal(240);

  constructor() {
    // Re-place the menu whenever it's open — and re-run when the chips change
    // (adding/removing a selection wraps the control, moving its bottom edge).
    effect(() => {
      this.selected();
      if (this.isOpen()) this.updateMenuPosition();
    });
    // Capture-phase so scrolls of the modal body (an inner element, not window)
    // are caught too — the menu stays glued to the control instead of detaching.
    this.doc.addEventListener('scroll', this.reposition, true);
  }

  ngOnDestroy(): void {
    this.doc.removeEventListener('scroll', this.reposition, true);
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.isOpen()) this.updateMenuPosition();
  }

  /** Focus the input and pre-measure so the menu opens already positioned (no
   *  first-frame flash at the default top-left). */
  onFocus(): void {
    this.focused.set(true);
    this.updateMenuPosition();
  }

  private readonly reposition = (): void => {
    if (this.isOpen()) this.updateMenuPosition();
  };

  /** Measure the control and size/place the fixed menu under it, capping its
   *  height to the space remaining to the viewport bottom so it never overflows
   *  off-screen and always scrolls within itself. */
  private updateMenuPosition(): void {
    const el = this.control()?.nativeElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const top = r.bottom + gap;
    this.menuTop.set(top);
    this.menuLeft.set(r.left);
    this.menuWidth.set(r.width);
    // Leave a small margin at the viewport bottom; clamp to a sane range.
    const available = this.doc.defaultView!.innerHeight - top - 12;
    this.menuMaxHeight.set(Math.max(140, Math.min(320, available)));
  }

  /** Transient UI state only (no selection state). */
  readonly query = signal('');
  /** Whether the input is focused. Necessary but not sufficient to open the menu. */
  readonly focused = signal(false);

  /** The query has content after trimming + stripping a single leading @ / #. */
  private readonly queryActive = computed(
    () => this.query().trim().replace(/^[@#]/, '').length > 0,
  );

  /** The dropdown opens ONLY on a non-empty query while focused — an empty or
   *  whitespace-only query keeps it closed even when the input has focus. */
  readonly isOpen = computed(() => this.focused() && this.queryActive());

  /** The tokens already present, so both result lists can exclude them. */
  private readonly selectedTokens = computed(() => new Set(this.selected().map((e) => e.token)));

  private readonly normalizedQuery = computed(() =>
    this.query().trim().replace(/^[@#]/, '').toLowerCase(),
  );

  /** Identity matches — case-insensitive substring (a single leading @ / #
   *  stripped) against name AND each attribute. Already-present refs excluded. */
  readonly matchIdentities = computed<Identity[]>(() => {
    const q = this.normalizedQuery();
    const chosen = this.selectedTokens();
    return this.candidateIdentities()
      .filter((i) => !chosen.has('@' + i.name))
      .filter(
        (i) =>
          q === '' ||
          i.name.toLowerCase().includes(q) ||
          i.attributes.some((a) => a.toLowerCase().includes(q)),
      );
  });

  /** Role matches — case-insensitive substring against the role token itself
   *  ('#' included in the token). Already-present roles excluded. */
  readonly matchRoles = computed<string[]>(() => {
    const q = this.normalizedQuery();
    const chosen = this.selectedTokens();
    return this.candidateRoles()
      .filter((r) => !chosen.has(r))
      .filter((r) => q === '' || r.toLowerCase().includes(q));
  });

  pickIdentity(identity: Identity): void {
    this.add.emit({ kind: 'ref', token: '@' + identity.name, identity: { id: identity.id, name: identity.name } });
    this.query.set('');
  }

  pickRole(role: string): void {
    this.add.emit({ kind: 'role', token: role });
    this.query.set('');
  }

  /** Enter picks the first available match — roles first, then identities. */
  onEnter(event: Event): void {
    const roles = this.matchRoles();
    if (roles.length > 0) {
      event.preventDefault();
      this.pickRole(roles[0]);
      return;
    }
    const ids = this.matchIdentities();
    if (ids.length === 0) return;
    event.preventDefault();
    this.pickIdentity(ids[0]);
  }
}
