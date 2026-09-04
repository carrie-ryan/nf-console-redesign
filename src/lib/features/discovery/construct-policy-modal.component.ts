import { Component, OnDestroy, Renderer2, computed, inject, input, output, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MockDataService } from '../../shared/services/mock-data.service';
import {
  ProposedPolicyStore,
  ManualPolicyCard,
} from './proposed-policy-store.service';
import { GrantEntry, IdentitySearchSelectComponent } from './identity-search-select.component';
import { ObservedSource } from './discovery.models';

/** Post-create summary the modal shows inline (it has no toast). Aggregated across
 *  every included card: how many policies were created, how many grantable callers
 *  were authorized, and which observed sources were EXCLUDED because they're
 *  unenrolled addresses (deduped IPs — displayed but never granted). */
interface CreateSummary {
  policyCount: number;
  grantCount: number;
  excludedAddresses: string[];
}

/**
 * A distinct destination in the raw selection (one group of picked flows sharing
 * a destinationHostPort). Every raw flow is UNMATCHED by definition (wildcard
 * discovery, nothing defined yet), so there is no existing-service correlation
 * here — each destination becomes exactly ONE new intercept service.
 */
export interface SelectedDestination {
  hostPort: string;
  /** Observed protocol across the group's flows IFF unanimous, else null. */
  protocol: 'tcp' | 'udp' | 'http' | 'https' | null;
  /** The distinct sources that dialed this destination (dedup), each classified at
   *  build time as a grantable identity or an observed address (an unenrolled IP,
   *  excluded from grants this increment). */
  identities: ObservedSource[];
}

/** The protocols the intercept card exposes (mirrors onboarding's tcp|udp). */
type CardProtocol = '' | 'tcp' | 'udp';

/**
 * The editable definition of ONE self-contained destination card — its intercept
 * service (access side only), its identity authorization, AND its own dial policy.
 * Per-destination by construction: one service + one dial policy per card, so no
 * shared/combined policy (which would cross-product over-grant).
 */
interface InterceptCard {
  // ─ intercept service (access side only) ─
  serviceName: string;
  attributes: string[];
  interceptAddress: string;
  interceptPort: number | null;
  protocol: CardProtocol;
  // ─ identity authorization — ONE ordered list mixing @-refs and #-roles ─
  /** The merged grant list: each entry is a direct `@`-ref (to a specific,
   *  possibly-unenrolled identity) or a `#`-role the policy targets. Seeded from
   *  the observed dialers as refs; mutated only through onAddRef / onAddRole /
   *  onRemoveGrant (dedup by `token`). */
  grants: GrantEntry[];
  // ─ this card's dial policy ─
  /** null → use the derived default; a string (incl. '') → user override. */
  policyNameOverride: string | null;
  // ─ validation UI state (ported from the onboarding Create Service form) ─
  touched: ReadonlySet<string>;
  submitted: boolean;
}

type CardField = 'name' | 'grants' | 'interceptAddr' | 'interceptPort' | 'policyName';
const REQUIRED_FIELDS: CardField[] = [
  'name', 'grants', 'interceptAddr', 'interceptPort', 'policyName',
];

function hostOf(hostPort: string): string {
  const i = hostPort.lastIndexOf(':');
  return i > 0 ? hostPort.slice(0, i) : hostPort;
}
function portOf(hostPort: string): number | null {
  const i = hostPort.lastIndexOf(':');
  if (i < 0) return null;
  const n = Number(hostPort.slice(i + 1));
  return Number.isFinite(n) ? n : null;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The RAW "construct from selection" modal — INTERCEPT-ONLY, create-only, and
 * PER-DESTINATION SELF-CONTAINED.
 *
 * Premise: wildcard-intercepted discovery, nothing defined yet — every selected
 * flow is unmatched. The user picked N flows; grouped by destination, each group
 * becomes ONE fully self-contained card: a new intercept service + its identity
 * authorization + its own dial policy. There is deliberately NO shared identity /
 * policy footer — one combined policy would cross-product over-grant (every
 * identity to every service). Each card owns its authorization and its policy.
 *
 * Materialization is CREATE-ONLY: each included card creates exactly ONE new
 * intercept service + ONE new dial policy (never tag-existing — every flow is
 * unmatched by premise). Create is enabled once every included card is valid.
 */
@Component({
  selector: 'app-construct-policy-modal',
  standalone: true,
  imports: [FormsModule, IdentitySearchSelectComponent],
  templateUrl: './construct-policy-modal.component.html',
  styleUrl: './construct-policy-modal.component.css',
})
export class ConstructPolicyModalComponent implements OnDestroy {
  private readonly store = inject(ProposedPolicyStore);
  private readonly data = inject(MockDataService);

  // ─── background scroll lock ─────────────────────────────────────────
  // The backdrop covers the viewport but isn't itself scrollable, so a wheel
  // over the backdrop (or over a dropdown that overflows the modal) chains to the
  // page behind. Lock page scroll for the modal's lifetime — it's created on open
  // and destroyed on close, so the lock maps exactly to "modal is open". Both
  // <html> and <body> are pinned because overflow propagates from the root: body
  // alone doesn't reliably stop the viewport scrollbar.
  private readonly doc = inject(DOCUMENT);
  private readonly renderer = inject(Renderer2);
  private readonly scrollLockTargets = [this.doc.documentElement, this.doc.body];
  private readonly prevOverflow = this.scrollLockTargets.map((el) => el.style.overflow);
  constructor() {
    for (const el of this.scrollLockTargets) this.renderer.setStyle(el, 'overflow', 'hidden');
  }
  ngOnDestroy(): void {
    this.scrollLockTargets.forEach((el, i) => {
      if (this.prevOverflow[i]) this.renderer.setStyle(el, 'overflow', this.prevOverflow[i]);
      else this.renderer.removeStyle(el, 'overflow');
    });
  }

  /** The real identity pool the merged search selects specific `@`-refs from. */
  readonly identityPool = computed(() => this.data.identities());

  /** The distinct `#role` tokens present in the pool's attributes — the roles the
   *  merged search lets the user target. Computed from the pool (this component
   *  passes it down; the search component injects nothing). */
  readonly rolePool = computed(() => {
    const set = new Set<string>();
    for (const i of this.data.identities()) {
      for (const a of i.attributes) if (a.startsWith('#')) set.add(a);
    }
    return [...set].sort();
  });

  readonly destinations = input.required<SelectedDestination[]>();
  readonly flowCount = input<number>(0);

  readonly created = output<void>();
  readonly cancelled = output<void>();

  /** Non-null once Create has run AND some caller couldn't be tagged: the modal
   *  stays open on an honest partial-materialize summary. When every caller was
   *  enrolled (or none were tagged), Create emits `created` and closes as before. */
  readonly summary = signal<CreateSummary | null>(null);

  // ─── per-card editable state (keyed by destinationHostPort) ─────────
  // Overlay pattern: a card reads its seed until first edited, then the edit
  // sticks — same idiom the previous modal used, extended to the full field set.
  private readonly edits = signal<Record<string, InterceptCard>>({});

  /** Seed a card from its destination. PREFILL RULE: a field prefills only when
   *  every row in the group shares the value. Address/Port are consistent by the
   *  group key; protocol prefills only if unanimous (tcp/udp — else blank);
   *  Name/Attributes always start empty (nothing observed names a service). */
  private seed(dest: SelectedDestination): InterceptCard {
    // Seed the grant list from the observed sources, already classified at build
    // time, in OBSERVED ORDER (identities and addresses interleaved as they were
    // dialed — no reshuffle). ENROLLED sources (kind: 'identity') become grantable
    // `@`-refs; UNENROLLED sources (kind: 'address') become non-grantable address
    // entries: visible + removable, but EXCLUDED from the grant partition so no IP
    // token ever reaches identityRoles. No name-match against the pool — enrollment
    // truth already decided grantability upstream.
    const grants: GrantEntry[] = dest.identities.map((s) =>
      s.kind === 'identity'
        ? { kind: 'ref' as const, token: '@' + s.name, identity: { id: s.id, name: s.name } }
        : { kind: 'address' as const, token: s.ip, ip: s.ip },
    );
    return {
      serviceName: '',
      attributes: [],
      grants,
      interceptAddress: hostOf(dest.hostPort),
      interceptPort: portOf(dest.hostPort),
      protocol: dest.protocol === 'tcp' || dest.protocol === 'udp' ? dest.protocol : '',
      policyNameOverride: null,
      touched: new Set<string>(),
      submitted: false,
    };
  }

  /** The grantable (enrolled) sources among the observed dialers — the only ones
   *  the read-only "observed dialers" list shows this increment. Address sources
   *  (unenrolled IPs) are deferred to 2b, so they neither grant nor display here. */
  observedIdentities(dest: SelectedDestination): { id: string; name: string }[] {
    return dest.identities
      .filter((s): s is Extract<ObservedSource, { kind: 'identity' }> => s.kind === 'identity')
      .map((s) => ({ id: s.id, name: s.name }));
  }

  cardFor(dest: SelectedDestination): InterceptCard {
    return this.edits()[dest.hostPort] ?? this.seed(dest);
  }
  private patchCard(dest: SelectedDestination, patch: Partial<InterceptCard>): void {
    const cur = this.cardFor(dest);
    this.edits.update((prev) => ({ ...prev, [dest.hostPort]: { ...cur, ...patch } }));
  }

  // ─── field setters ──────────────────────────────────────────────────
  setName(dest: SelectedDestination, v: string): void { this.patchCard(dest, { serviceName: v }); }
  setInterceptAddress(dest: SelectedDestination, v: string): void { this.patchCard(dest, { interceptAddress: v }); }
  setInterceptPort(dest: SelectedDestination, v: number | null): void { this.patchCard(dest, { interceptPort: v }); }
  setProtocol(dest: SelectedDestination, v: CardProtocol): void { this.patchCard(dest, { protocol: v }); }

  // ─── this card's dial policy (per card) ─────────────────────────────
  /** Derived default: dial-<slug(serviceName)>, falling back to
   *  dial-<slug(intercept-host)> while the service is unnamed. */
  private derivedPolicyName(c: InterceptCard, dest: SelectedDestination): string {
    return 'dial-' + (slug(c.serviceName) || slug(c.interceptAddress) || slug(hostOf(dest.hostPort)) || 'service');
  }
  policyName(dest: SelectedDestination): string {
    const c = this.cardFor(dest);
    return c.policyNameOverride ?? this.derivedPolicyName(c, dest);
  }
  setPolicyName(dest: SelectedDestination, v: string): void { this.patchCard(dest, { policyNameOverride: v }); }

  /** The GRANTABLE tokens this card authorizes — the merged @-refs and #-roles, in
   *  order — surfaced for the dial-policy preview statement. Observed addresses are
   *  EXCLUDED: they are not part of the DIAL grant. */
  grantTokens(dest: SelectedDestination): string[] {
    return this.cardFor(dest).grants
      .filter((g) => g.kind !== 'address')
      .map((g) => g.token);
  }

  /** The observed addresses on a card — the unenrolled IPs surfaced for display but
   *  NOT authorized. Feeds the preview's unauthorized sub-line and the success panel;
   *  never enters identityRoles. */
  addressIps(dest: SelectedDestination): string[] {
    return this.cardFor(dest).grants
      .filter((g): g is Extract<GrantEntry, { kind: 'address' }> => g.kind === 'address')
      .map((g) => g.ip);
  }

  // ─── grant list (merged @-refs + #-roles) — single mutation site ─────
  /** Dispatch a search `add` to the right typed handler by grant kind. Search only
   *  ever emits refs or roles (addresses are seed-only, never search-addable), so an
   *  'address' entry here is a no-op — it can't be added through the search. */
  onAddGrant(dest: SelectedDestination, entry: GrantEntry): void {
    if (entry.kind === 'ref') this.onAddRef(dest, entry.identity);
    else if (entry.kind === 'role') this.onAddRole(dest, entry.token);
  }
  /** Add a specific-identity `@`-ref. Takes the minimal {id,name} the ref carries
   *  (a full Identity from the search narrows to it, as does an unresolved dialer).
   *  No-op if an entry with the same token is already present (dedup by token). */
  onAddRef(dest: SelectedDestination, identity: { id: string; name: string }): void {
    const token = '@' + identity.name;
    const c = this.cardFor(dest);
    if (c.grants.some((g) => g.token === token)) return;
    this.patchCard(dest, {
      grants: [...c.grants, { kind: 'ref', token, identity: { id: identity.id, name: identity.name } }],
    });
  }
  /** Add a `#`-role. No-op if the role token is already present. */
  onAddRole(dest: SelectedDestination, roleToken: string): void {
    const c = this.cardFor(dest);
    if (c.grants.some((g) => g.token === roleToken)) return;
    this.patchCard(dest, { grants: [...c.grants, { kind: 'role', token: roleToken }] });
  }
  /** Remove a grant by its (unique) token, from the one list. */
  onRemoveGrant(dest: SelectedDestination, entry: GrantEntry): void {
    const c = this.cardFor(dest);
    this.patchCard(dest, { grants: c.grants.filter((g) => g.token !== entry.token) });
  }

  // ─── attribute chips (attributes only) ──────────────────────────────
  // Transient uncommitted text, keyed by hostPort (not persisted into the card).
  attrBuf: Record<string, string> = {};

  private addChip(dest: SelectedDestination, key: 'attributes', raw: string): boolean {
    const val = raw.trim().replace(/,+$/, '');
    if (!val) return false;
    const vals = val.split(',').map((v) => v.trim()).filter(Boolean);
    const cur = this.cardFor(dest);
    this.patchCard(dest, { [key]: [...new Set([...cur[key], ...vals])] });
    return true;
  }
  onAttrKeydown(dest: SelectedDestination, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    if (this.addChip(dest, 'attributes', this.attrBuf[dest.hostPort] ?? '')) this.attrBuf[dest.hostPort] = '';
  }
  removeAttr(dest: SelectedDestination, attr: string): void {
    this.patchCard(dest, { attributes: this.cardFor(dest).attributes.filter((a) => a !== attr) });
  }

  // ─── validation (ported pattern, per card) ──────────────────────────
  markTouched(dest: SelectedDestination, field: CardField): void {
    const cur = this.cardFor(dest);
    if (cur.touched.has(field)) return;
    this.patchCard(dest, { touched: new Set([...cur.touched, field]) });
  }
  /** Every required field is required unconditionally now — there's no longer a
   *  mode that toggles which identity field applies. */
  private isRequired(_dest: SelectedDestination, _field: CardField): boolean {
    return true;
  }
  private isFilled(dest: SelectedDestination, field: CardField): boolean {
    const c = this.cardFor(dest);
    switch (field) {
      case 'name': return c.serviceName.trim().length > 0;
      // GRANTABLE-non-empty: a card needs ≥1 ref or role. Observed addresses don't
      // count — a card whose only entries are unenrolled addresses authorizes nobody.
      case 'grants': return c.grants.some((g) => g.kind === 'ref' || g.kind === 'role');
      case 'interceptAddr': return c.interceptAddress.trim().length > 0;
      case 'interceptPort': return c.interceptPort != null;
      case 'policyName': return this.policyName(dest).trim().length > 0;
      default: return true;
    }
  }
  /** Show the red error border? Only required-but-empty, and only after a Save
   *  attempt or once the field's been blurred — so cards don't open red. */
  showError(dest: SelectedDestination, field: CardField): boolean {
    const c = this.cardFor(dest);
    return this.isRequired(dest, field) && !this.isFilled(dest, field)
      && (c.submitted || c.touched.has(field));
  }
  cardCanSave(dest: SelectedDestination): boolean {
    return REQUIRED_FIELDS.every((f) => !this.isRequired(dest, f) || this.isFilled(dest, f));
  }

  // ─── include / exclude + expand per card ────────────────────────────
  private readonly excluded = signal<Set<string>>(new Set());
  isIncluded(hostPort: string): boolean { return !this.excluded().has(hostPort); }
  toggleInclude(hostPort: string): void {
    this.excluded.update((prev) => {
      const next = new Set(prev);
      if (next.has(hostPort)) next.delete(hostPort);
      else next.add(hostPort);
      return next;
    });
  }
  // Default expanded (open) so the form is visible on open; track collapsed ones.
  private readonly collapsed = signal<Set<string>>(new Set());
  isExpanded(hostPort: string): boolean { return !this.collapsed().has(hostPort); }
  toggleExpand(hostPort: string): void {
    this.collapsed.update((prev) => {
      const next = new Set(prev);
      if (next.has(hostPort)) next.delete(hostPort);
      else next.add(hostPort);
      return next;
    });
  }

  readonly includedDestinations = computed(() =>
    this.destinations().filter((d) => this.isIncluded(d.hostPort)),
  );
  /** Save is gated until every INCLUDED card is valid. */
  readonly allIncludedValid = computed(() => {
    const inc = this.includedDestinations();
    return inc.length > 0 && inc.every((d) => this.cardCanSave(d));
  });

  // ─── actions ─────────────────────────────────────────────────────────
  /** Project one included card into the store's create-only per-card shape. */
  private toManualCard(dest: SelectedDestination): ManualPolicyCard {
    const c = this.cardFor(dest);
    // Partition the one grant list into the two things the consumer needs:
    // `@`-refs used verbatim (no tagging) and `#`-role tokens whose members it
    // resolves by attribute.
    return {
      serviceName: c.serviceName,
      attributes: c.attributes,
      interceptAddress: c.interceptAddress,
      interceptPort: c.interceptPort,
      protocol: c.protocol,
      policyName: this.policyName(dest),
      refs: c.grants.filter((g) => g.kind === 'ref').map((g) => g.token),
      roleTokens: c.grants.filter((g) => g.kind === 'role').map((g) => g.token),
    };
  }

  /** Materialise every included card — CREATE-ONLY: one new service + one new dial
   *  policy per card. Grantable callers (refs + role members) are authorized; observed
   *  ADDRESSES are excluded (unenrolled — never enter identityRoles). If any included
   *  card carried an excluded address, hold the modal open on the honest summary so
   *  the exclusion is reported; otherwise emit `created` and let the host close + clear. */
  confirm(): void {
    if (!this.allIncludedValid()) return;
    const included = this.includedDestinations();
    const cards = included.map((d) => this.toManualCard(d));
    const results = this.store.createManualPolicy(cards);

    // Distinct grants that actually landed in the created policies (refs + roles) —
    // the honest "authorized callers" count. Addresses are absent by construction.
    const grants = new Set<string>();
    for (const r of results) for (const g of r.policy.identityRoles) grants.add(g);

    // Observed addresses excluded from every included card — displayed, never granted.
    const excluded = new Set<string>();
    for (const d of included) for (const ip of this.addressIps(d)) excluded.add(ip);

    if (excluded.size > 0) {
      this.summary.set({
        policyCount: results.length,
        grantCount: grants.size,
        excludedAddresses: [...excluded],
      });
      return;
    }
    this.created.emit();
  }
  /** Dismiss the post-create summary — the create already happened, so close +
   *  clear exactly as the all-enrolled path does. */
  done(): void { this.created.emit(); }
  cancel(): void { this.cancelled.emit(); }
}
