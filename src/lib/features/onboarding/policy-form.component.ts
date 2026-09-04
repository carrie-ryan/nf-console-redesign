import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, WritableSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PolicyTagPair } from './onboarding-state.service';

/**
 * Spec for the config-driven extra-field slot — the one control that diverges
 * between policy types (today: Service Policy's Dial | Bind type). Rendered as a
 * plain <select> beside Semantic, grounded in the real console's Create Service
 * Policy form: a value-only dropdown (Bind default) that changes no other field.
 */
export interface PolicyFormExtraFieldConfig {
  /** Stable key for the field (maps to the underlying policy attribute, e.g. `type`). */
  key: string;
  label: string;
  /** Control kind. Only 'select' today. */
  type: 'select';
  options: { value: string; label: string }[];
  /** Pre-selected value (e.g. Service Policy Type defaults to Bind). */
  default?: string;
  required?: boolean;
  hint?: string;
}

/**
 * Field-level config for the reusable policy sub-form. Only the FORM fields live
 * here — labels, placeholders, hints, whether the attribute selectors are
 * required, and the optional divergent extra field. All CHROME (header, right
 * rail, Learn more, Back/Continue, saved/next notes) belongs to the STEP that
 * hosts this form, not to the form itself.
 */
export interface PolicyFormConfig {
  /** Placeholder for the Policy Name field. */
  namePlaceholder: string;
  /** First attribute selector (e.g. edge router attributes). */
  attrALabel: string;
  attrAPlaceholder: string;
  attrAHint: string;
  /** Second attribute selector (e.g. identity attributes). */
  attrBLabel: string;
  attrBPlaceholder: string;
  attrBHint: string;
  /**
   * Whether both attribute selectors are required. Onboarding defaults this to
   * true — a policy with neither attribute grants no access — but a per-type
   * config can relax it.
   */
  attributesRequired?: boolean;
  /** Optional divergent field (e.g. Service Policy type = Dial | Bind). */
  extraField?: PolicyFormExtraFieldConfig;
}

/** A policy authored by the sub-form, emitted to the host step on Add. */
export interface AuthoredPolicy {
  name: string;
  semantic: 'AnyOf' | 'AllOf';
  attrA: string[];
  attrB: string[];
  tags: PolicyTagPair[];
  /** Value of the config-driven extra field, when the config declares one. */
  extra?: string;
}

/**
 * Transient in-progress authoring state — the fields the user is filling for the
 * NEXT policy. Reset after each Add (like the advanced service's in-progress
 * config card), so the form clears for the next one; the accumulated list of
 * created policies is owned by the host step, not here.
 */
interface PolicyFormState {
  name: string;
  semantic: 'AnyOf' | 'AllOf';
  attrA: string[];
  attrB: string[];
  tags: PolicyTagPair[];
  extra: string;
  showMore: boolean;
  submitted: boolean;
  touched: ReadonlySet<string>;
}

function blankState(): PolicyFormState {
  return {
    name: '',
    semantic: 'AnyOf',
    attrA: [],
    attrB: [],
    tags: [],
    extra: '',
    showMore: false,
    submitted: false,
    touched: new Set<string>(),
  };
}

/**
 * Reusable policy sub-form — Policy Name + two attribute selectors + Semantic +
 * an optional config-driven extra field, plus Show More (tags). Fields only: NO
 * header, NO right rail, NO Back/Continue, NO saved confirmation — the host step
 * owns all of that.
 *
 * Two modes, driven by the host: CREATE (blank; Add appends via the `create`
 * output) and EDIT (populated from `initial`; Save Changes replaces via the
 * `save` output, Cancel discards via `cancelEdit`). In-progress field state lives
 * in a local transient draft signal — it is NOT persisted across navigation; only
 * the created-policy list the host accumulates is durable.
 */
@Component({
  selector: 'app-policy-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './policy-form.component.html',
  styleUrl: './policy-form.component.css',
})
export class PolicyFormComponent implements OnChanges {
  /** Field-level config for the active policy type. */
  @Input({ required: true }) config!: PolicyFormConfig;

  /** When set, the form opens in EDIT mode populated from these values; when
   *  null (the default) it's a blank CREATE form. */
  @Input() initial: AuthoredPolicy | null = null;

  /** True in edit mode — flips the primary button to "Save Changes" and shows
   *  Cancel. The host tracks which item is being edited; type is preserved. */
  @Input() editing = false;

  /** Emitted on a valid Add (create mode). */
  @Output() create = new EventEmitter<AuthoredPolicy>();
  /** Emitted on a valid Save Changes (edit mode). */
  @Output() save = new EventEmitter<AuthoredPolicy>();
  /** Emitted when the user cancels an edit (discard changes, keep the original). */
  @Output() cancelEdit = new EventEmitter<void>();

  /** In-progress authoring state (transient — reset after each Add / on (re)load). */
  private readonly draft: WritableSignal<PolicyFormState> = signal(blankState());

  /** (Re)populate the draft whenever the config or item-to-edit changes. Running
   *  in ngOnChanges (not per-setter) means both inputs are set before we read
   *  them, so the extra-field default resolves regardless of input order.
   *  Toggling `editing` alone never rehydrates — that would wipe live edits. */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] || changes['initial']) {
      this.hydrateFromInputs();
    }
  }

  private hydrateFromInputs(): void {
    const init = this.initial;
    if (init) {
      this.draft.set({
        name: init.name,
        semantic: init.semantic,
        attrA: [...init.attrA],
        attrB: [...init.attrB],
        tags: init.tags.map((t) => ({ ...t })),
        extra: init.extra ?? this.config.extraField?.default ?? '',
        showMore: init.tags.length > 0,
        submitted: false,
        touched: new Set<string>(),
      });
    } else {
      this.draft.set({ ...blankState(), extra: this.config.extraField?.default ?? '' });
    }
    this.attrAInput = '';
    this.attrBInput = '';
    this.tagName = '';
    this.tagValue = '';
  }

  // ── Transient input buffers (uncommitted chip/tag text) ───────────────────
  attrAInput = '';
  attrBInput = '';
  tagName = '';
  tagValue = '';

  /** Both selectors required unless the config explicitly opts out. */
  get attributesRequired(): boolean {
    return this.config.attributesRequired !== false;
  }

  // ── Draft-backed field accessors ─────────────────────────────────────────
  get name(): string { return this.draft().name; }
  set name(v: string) { this.draft.update((d) => ({ ...d, name: v })); }

  get semantic(): 'AnyOf' | 'AllOf' { return this.draft().semantic; }
  set semantic(v: 'AnyOf' | 'AllOf') { this.draft.update((d) => ({ ...d, semantic: v })); }

  get extra(): string { return this.draft().extra; }
  set extra(v: string) { this.draft.update((d) => ({ ...d, extra: v })); }

  attrA(): string[] { return this.draft().attrA; }
  attrB(): string[] { return this.draft().attrB; }
  tags(): PolicyTagPair[] { return this.draft().tags; }
  showMore(): boolean { return this.draft().showMore; }
  submitted(): boolean { return this.draft().submitted; }
  touched(): ReadonlySet<string> { return this.draft().touched; }

  // ── Required-field validation ─────────────────────────────────────────────
  markTouched(field: string): void {
    if (this.draft().touched.has(field)) return;
    this.draft.update((d) => ({ ...d, touched: new Set([...d.touched, field]) }));
  }

  private isRequired(field: string): boolean {
    if (field === 'name') return true;
    if (field === 'extra') return !!this.config.extraField?.required;
    return this.attributesRequired; // attrA / attrB
  }

  private isFilled(field: string): boolean {
    switch (field) {
      case 'name':  return this.name.trim().length > 0;
      case 'attrA': return this.attrA().length > 0;
      case 'attrB': return this.attrB().length > 0;
      case 'extra': return this.extra.trim().length > 0;
      default:      return true;
    }
  }

  /** Show the red error border? Only for a required-but-empty field, and only
   *  after an Add attempt or once that field has been blurred. */
  showError(field: string): boolean {
    return this.isRequired(field) && !this.isFilled(field)
      && (this.submitted() || this.touched().has(field));
  }

  get canSubmit(): boolean {
    return (['name', 'attrA', 'attrB', 'extra'] as const)
      .every((f) => !this.isRequired(f) || this.isFilled(f));
  }

  // ── Tag-chip attribute selectors ──────────────────────────────────────────
  private addAttr(raw: string, key: 'attrA' | 'attrB'): boolean {
    const val = raw.trim().replace(/,+$/, '');
    if (!val) return false;
    const vals = val.split(',').map((v) => v.trim()).filter(Boolean);
    this.draft.update((d) => ({ ...d, [key]: [...new Set([...d[key], ...vals])] }));
    return true;
  }

  onAttrAKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    if (this.addAttr(this.attrAInput, 'attrA')) this.attrAInput = '';
  }
  removeAttrA(attr: string): void {
    this.draft.update((d) => ({ ...d, attrA: d.attrA.filter((a) => a !== attr) }));
  }

  onAttrBKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    if (this.addAttr(this.attrBInput, 'attrB')) this.attrBInput = '';
  }
  removeAttrB(attr: string): void {
    this.draft.update((d) => ({ ...d, attrB: d.attrB.filter((a) => a !== attr) }));
  }

  // ── Show More Options (tags) ───────────────────────────────────────────────
  toggleShowMore(): void {
    this.draft.update((d) => ({ ...d, showMore: !d.showMore }));
  }

  addTag(): void {
    const name = this.tagName.trim();
    if (!name) return;
    const value = this.tagValue.trim();
    this.draft.update((d) => ({ ...d, tags: [...d.tags, { name, value }] }));
    this.tagName = '';
    this.tagValue = '';
  }
  removeTag(index: number): void {
    this.draft.update((d) => ({ ...d, tags: d.tags.filter((_, i) => i !== index) }));
  }

  // ── Submit (create or save) ───────────────────────────────────────────────
  /** Validate then emit — create (append) in create mode, save (replace) in edit
   *  mode. On an invalid form, flag the submit attempt (revealing empty-field
   *  errors) and stay put. */
  submit(): void {
    if (!this.canSubmit) {
      this.draft.update((d) => ({ ...d, submitted: true }));
      return;
    }
    const payload = this.buildPayload();
    if (this.editing) {
      this.save.emit(payload);
      // The host collapses the edit slot afterward; no local reset needed.
    } else {
      this.create.emit(payload);
      this.reset();
    }
  }

  /** Discard an in-progress edit — the host restores the chooser and leaves the
   *  original item untouched (edit is non-destructive until saved). */
  cancel(): void {
    this.cancelEdit.emit();
  }

  private buildPayload(): AuthoredPolicy {
    const d = this.draft();
    return {
      name: d.name.trim(),
      semantic: d.semantic,
      attrA: [...d.attrA],
      attrB: [...d.attrB],
      tags: d.tags.map((t) => ({ ...t })),
      extra: this.config.extraField ? d.extra : undefined,
    };
  }

  /** Clear the in-progress authoring state (after a create Add), re-seeding the
   *  extra field's default so the next policy opens on it too. */
  private reset(): void {
    this.draft.set({ ...blankState(), extra: this.config.extraField?.default ?? '' });
    this.attrAInput = '';
    this.attrBInput = '';
    this.tagName = '';
    this.tagValue = '';
  }
}
