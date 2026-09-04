import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MaterializeResult, ProposedPolicyStore, RolePolicyServiceEdit } from './proposed-policy-store.service';
import type { ProposedPolicy, ServiceDraft } from './discovery.models';
import { ServiceCardComponent } from './service-card.component';
import { MockDataService } from '../../shared/services/mock-data.service';
import { enrolledSourceIds } from './source-enrollment';

/**
 * The "Create dial policy" dialog for one discovered role.
 *
 * Shows the REAL, editable objects being created — not summaries:
 *   • the role (editable chip, rename propagates) + the identities it covers,
 *   • one collapsible sub-card per service: NEW services expose their full
 *     editable definition (name / intercept / protocol / host); EXISTING services
 *     get a read-only "tag existing" treatment. Each has an include/exclude toggle,
 *   • the policy's real shape: name (editable) + the concrete grant
 *     "#role may DIAL → [services]" with type/semantic shown.
 *
 * Confirm builds the real objects from the (possibly-edited) values via
 * `store.createRolePolicy`, passing the per-service edits through.
 */
@Component({
  selector: 'app-role-policy-modal',
  standalone: true,
  imports: [FormsModule, ServiceCardComponent],
  templateUrl: './role-policy-modal.component.html',
  styleUrl: './role-policy-modal.component.css',
})
export class RolePolicyModalComponent {
  private readonly store = inject(ProposedPolicyStore);
  private readonly data = inject(MockDataService);

  readonly clusterId = input.required<string>();
  /** Emits the partial-materialize result so the parent can surface how many
   *  members were tagged vs. deferred (unenrolled). */
  readonly created = output<MaterializeResult | null>();
  readonly cancelled = output<void>();

  /** The role, resolved live so a rename inside the modal reflects immediately. */
  readonly role = computed(() => {
    this.store.roles();
    return this.store.roles().find((r) => r.clusterId === this.clusterId());
  });

  /** Derived-enrollment set (shared helper) — a member is a real identity iff its id
   *  resolves to an Identity; otherwise it's an UNMANAGED observed host (a bare IP). */
  private readonly enrolledIds = computed(() => enrolledSourceIds(this.data.identities()));
  isEnrolled(id: string): boolean {
    return this.enrolledIds().has(id);
  }

  /** Cluster members split by enrollment — the SAME `isEnrolled` determination the
   *  materialize path uses to decide what actually gets tagged. `managed` are real
   *  identities (tagged on create); the rest are unmanaged hosts (never tagged). */
  readonly members = computed(() => {
    const r = this.role();
    if (!r) return [] as { id: string; name: string; managed: boolean }[];
    const enrolled = this.enrolledIds();
    return r.cluster.memberIds.map((id, i) => ({
      id,
      name: r.cluster.memberNames[i] ?? id,
      managed: enrolled.has(id),
    }));
  });
  /** Count of real identities — what "covers"/"tags" must report (NOT memberIds.length,
   *  which also counts unmanaged hosts that are never tagged). */
  readonly managedCount = computed(() => this.members().filter((m) => m.managed).length);
  /** Unmanaged members (observed hosts) — surfaced as a separate, muted clause. */
  readonly unmanagedMembers = computed(() => this.members().filter((m) => !m.managed));

  /** The role's candidate services (its dialed destinations). */
  readonly proposals = computed<ProposedPolicy[]>(() => {
    this.store.proposals();
    return this.store
      .proposalsForRole(this.clusterId())
      .slice()
      .sort((a, b) => b.totalCircuitCount - a.totalCircuitCount);
  });

  // ─── selection (track DE-selected → default all on) ─────────────────
  private readonly deselected = signal<Set<string>>(new Set());
  isSelected(id: string): boolean {
    return !this.deselected().has(id);
  }
  toggleService(id: string): void {
    this.deselected.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  readonly selectedIds = computed(() =>
    this.proposals().filter((p) => this.isSelected(p.id)).map((p) => p.id),
  );
  readonly selectedProposals = computed(() =>
    this.proposals().filter((p) => this.isSelected(p.id)),
  );

  // ─── per-service editable drafts (NEW services only) ────────────────
  private readonly edits = signal<Record<string, ServiceDraft>>({});

  /** The current draft for a proposal — the user's edit (from the card), or the
   *  derived default. For a MATCHED service the name is the existing service's. */
  draftFor(p: ProposedPolicy): ServiceDraft {
    const e = this.edits()[p.id];
    if (e) return e;
    const existingName = p.serviceAttributeAssignments[0]?.serviceName;
    return {
      name: p.matched
        ? existingName ?? p.destinationHostPort
        : p.newService?.name ?? p.destinationHostPort,
      interceptAddress: p.newService?.interceptAddress ?? p.destinationHostPort,
      protocol: p.newService?.protocol ?? 'tcp',
      hostAddress: p.newService?.hostAddress ?? p.destinationHostPort,
    };
  }
  /** The shared card emitted an edited draft — store it as this proposal's edit. */
  onDraftChange(id: string, draft: ServiceDraft): void {
    this.edits.update((prev) => ({ ...prev, [id]: draft }));
  }

  /** The #svc-role a proposal's policy targets (auto-managed; shown, not edited). */
  svcRole(p: ProposedPolicy): string {
    return p.policy.serviceRoles[0] ?? '';
  }

  /** Display name for a service in collapsed/grant contexts (edited name for new,
   *  existing service name for matched). */
  serviceLabel(p: ProposedPolicy): string {
    if (p.matched) return p.serviceAttributeAssignments[0]?.serviceName ?? p.destinationHostPort;
    return this.draftFor(p).name || p.destinationHostPort;
  }

  // ─── policy name (default from role, editable) ──────────────────────
  private readonly nameOverride = signal<string | null>(null);
  readonly policyName = computed(
    () => this.nameOverride() ?? `dial-${this.role()?.name.replace(/^#/, '') ?? 'role'}`,
  );
  setName(v: string): void {
    this.nameOverride.set(v);
  }

  // ─── inline role rename (propagates via the store) ──────────────────
  readonly editingName = signal(false);
  readonly editValue = signal('');
  readonly editError = signal<string | null>(null);
  startEdit(): void {
    this.editValue.set(this.role()?.name ?? '');
    this.editError.set(null);
    this.editingName.set(true);
  }
  cancelEdit(): void {
    this.editingName.set(false);
    this.editError.set(null);
  }
  commitEdit(): void {
    const result = this.store.renameRole(this.clusterId(), this.editValue());
    if (result.ok) {
      this.editingName.set(false);
      this.editError.set(null);
    } else {
      this.editError.set(result.error ?? 'Invalid name.');
    }
  }

  // ─── consequence counts (one quiet line, not a bulleted block) ──────
  readonly newCount = computed(() => this.selectedProposals().filter((p) => !p.matched).length);
  readonly tagCount = computed(() => this.selectedProposals().filter((p) => p.matched).length);

  confirm(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    const edits: RolePolicyServiceEdit[] = this.selectedProposals()
      .filter((p) => !p.matched)
      .map((p) => ({ proposalId: p.id, ...this.draftFor(p) }));
    const result = this.store.createRolePolicy(this.clusterId(), ids, this.policyName(), edits);
    this.created.emit(result);
  }
  cancel(): void {
    this.cancelled.emit();
  }
}
