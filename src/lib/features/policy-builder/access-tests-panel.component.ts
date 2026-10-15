import { NgTemplateOutlet } from '@angular/common';
import { SearchPickerComponent, attributeItems, nameItems } from './search-picker.component';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { AccessTest } from '../../shared/services/mock-data.service';
import { describeWho, type ReasonLink, type TestResult } from './access-tests';
import { TEST_KINDS } from './draft/policy-draft';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { DraftChecks, liveTestResults } from './draft/draft-checks';
import { TestReasonComponent } from './test-reason.component';

const KIND_LABEL: Record<AccessTest['kind'], string> = {
  mustNotDial: 'must not dial',
  mustNotHost: 'must not host',
  mustConnect: 'must connect to',
};

/** The add / edit form's local state. */
interface TestForm {
  /** null: a new test. */
  id: string | null;
  kind: AccessTest['kind'];
  names: string;
  attributes: string;
  serviceId: string;
  note: string;
}

/** A new test's form, filled in by whoever opened the panel (the editor's "Add test"). */
export interface TestPrefill {
  kind: AccessTest['kind'];
  attributes: readonly string[];
  /** Defaults to the focused service. */
  serviceId?: string;
}

const splitList = (raw: string) => raw.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Side panel listing the access tests of the DRAFT world — each passing or failing
 * there, with who breaks it and why (naming the draft edit behind it) — and adding,
 * editing or removing them. Every change is a draft op (target 'accessTest'),
 * committed like any other change.
 *
 * Grouped around the focused service: its own tests first (passing and failing),
 * then failing tests on other services ("Broken by this draft on <service>" when
 * they pass in live), then the other passing tests, collapsed to a count.
 *
 * Results come from DraftChecks (off the edit path): until they're ready the panel
 * says "Checking N of M services…"; adding, editing and removing tests still work.
 */
@Component({
  selector: 'app-access-tests-panel',
  standalone: true,
  imports: [NgTemplateOutlet, TestReasonComponent, SearchPickerComponent],
  templateUrl: './access-tests-panel.component.html',
  styleUrls: ['./policy-editor.component.css', './tag-input.css', './access-tests-panel.component.css'],
})
export class AccessTestsPanelComponent {
  private readonly store = inject(PolicyDraftStore);
  private readonly checks = inject(DraftChecks);
  /** The focused service — its tests come first; new tests default to it. */
  readonly serviceId = input('');
  /** Open the new-test form filled in with these (each new prefill reopens it). */
  readonly prefill = input<TestPrefill | null>(null);
  readonly closed = output<void>();
  /** A check or policy named in a failure's reason. */
  readonly openLink = output<ReasonLink>();

  readonly kinds = TEST_KINDS;
  readonly kindLabel = KIND_LABEL;
  readonly describeWho = describeWho;
  readonly editError = signal<string | null>(null);

  private readonly world = this.store.draftWorld;
  readonly checking = computed(() => this.checks.state().status === 'checking');
  readonly progress = computed(() => {
    const s = this.checks.state();
    return `Checking ${s.done} of ${s.total} ${s.total === 1 ? 'service' : 'services'}…`;
  });
  readonly results = computed(() => this.checks.state().result?.tests ?? []);
  readonly failing = computed(() => this.results().filter((r) => !r.pass).length);

  readonly serviceName = computed(() => this.world().services.find((s) => s.id === this.serviceId())?.name ?? this.serviceId());
  readonly here = computed(() => this.results().filter((r) => r.test.serviceId === this.serviceId()));
  private readonly elsewhere = computed(() => this.results().filter((r) => r.test.serviceId !== this.serviceId()));
  readonly otherFailing = computed(() => this.elsewhere().filter((r) => !r.pass));
  readonly otherPassing = computed(() => this.elsewhere().filter((r) => r.pass));
  readonly othersOpen = signal(false);

  /** Tests that pass in live — failing in the draft means the draft broke them. */
  private readonly passLive = computed(
    () => new Set(liveTestResults(this.store.live()).filter((r) => r.pass).map((r) => r.test.id)),
  );

  /** "Broken by this draft on api-prod" — or "Failing on api-prod" when live fails it too. */
  otherLabel(r: TestResult): string {
    const service = this.world().services.find((s) => s.id === r.test.serviceId)?.name ?? r.test.serviceId;
    return this.passLive().has(r.test.id) ? `Broken by this draft on ${service}` : `Failing on ${service}`;
  }
  readonly services = computed(() => this.world().services.map((s) => ({ id: s.id, name: s.name })));
  /** The pickers: identities by plain name, and the identity attributes in use. */
  readonly identityItems = computed(() => nameItems(this.world().identities));
  readonly attributeItems = computed(() => attributeItems(this.world().identities, { one: 'identity', many: 'identities' }));

  /** A comma-separated form field as a list (its chips), and as a set (marked in the picker). */
  listOf(raw: string): string[] {
    return splitList(raw);
  }
  setOf(raw: string): ReadonlySet<string> {
    return new Set(splitList(raw));
  }

  /** Adds a picked name / attribute to its comma-separated field (attributes get their '#'). */
  addTo(field: 'names' | 'attributes', value: string): void {
    const f = this.form();
    if (!f) return;
    const v = field === 'attributes' && !value.startsWith('#') ? `#${value}` : value;
    const list = splitList(f[field]);
    if (!list.includes(v)) this.patchForm({ [field]: [...list, v].join(', ') });
  }

  removeFrom(field: 'names' | 'attributes', value: string): void {
    const f = this.form();
    if (f) this.patchForm({ [field]: splitList(f[field]).filter((x) => x !== value).join(', ') });
  }

  /** Removed in the draft, but still in live — listed so they can be restored by discarding. */
  readonly removed = computed(() => {
    const now = new Set((this.world().accessTests ?? []).map((t) => t.id));
    return (this.store.live().accessTests ?? []).filter((t) => !now.has(t.id));
  });

  mark(id: string) {
    return this.store.routerMark('accessTest', id);
  }

  readonly form = signal<TestForm | null>(null);
  readonly formValid = computed(() => {
    const f = this.form();
    return !!f && !!f.serviceId && (splitList(f.names).length > 0 || splitList(f.attributes).length > 0);
  });

  constructor() {
    effect(() => {
      const p = this.prefill();
      if (p) untracked(() => this.startAdd(p));
    });
  }

  startAdd(prefill?: TestPrefill): void {
    this.editError.set(null);
    const wanted = prefill?.serviceId ?? this.serviceId();
    const serviceId = this.services().some((s) => s.id === wanted) ? wanted : (this.services()[0]?.id ?? '');
    this.form.set({
      id: null,
      kind: prefill?.kind ?? 'mustNotDial',
      names: '',
      attributes: (prefill?.attributes ?? []).join(', '),
      serviceId,
      note: '',
    });
  }

  startEdit(t: AccessTest): void {
    this.editError.set(null);
    this.form.set({
      id: t.id,
      kind: t.kind,
      names: (t.who.names ?? []).join(', '),
      attributes: (t.who.attributes ?? []).join(', '),
      serviceId: t.serviceId,
      note: t.note,
    });
  }

  patchForm(patch: Partial<TestForm>): void {
    this.form.update((f) => (f ? { ...f, ...patch } : f));
  }

  save(): void {
    const f = this.form();
    if (!f || !this.formValid()) return;
    const names = splitList(f.names);
    const attributes = splitList(f.attributes).map((a) => (a.startsWith('#') ? a : `#${a}`));
    const who: AccessTest['who'] = { ...(names.length ? { names } : {}), ...(attributes.length ? { attributes } : {}) };
    const fields = { kind: f.kind, who, serviceId: f.serviceId, note: f.note.trim() };
    try {
      if (f.id) {
        this.store.upsertUpdate(f.id, fields, 'accessTest');
      } else {
        this.store.addOp({ kind: 'create', target: 'accessTest', policy: { id: this.freshId(), ...fields } });
      }
      this.form.set(null);
      this.editError.set(null);
    } catch (e) {
      this.editError.set(e instanceof Error ? e.message : String(e));
    }
  }

  remove(t: AccessTest): void {
    try {
      this.store.deletePolicy(t.id, 'accessTest');
      if (this.form()?.id === t.id) this.form.set(null);
    } catch (e) {
      this.editError.set(e instanceof Error ? e.message : String(e));
    }
  }

  private freshId(): string {
    const taken = new Set([...(this.store.live().accessTests ?? []), ...(this.world().accessTests ?? [])].map((t) => t.id));
    let n = 1;
    while (taken.has(`at-draft-${n}`)) n++;
    return `at-draft-${n}`;
  }
}
