import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import type { RouterGapKind } from '../service-view.layout';
import { AssistStore, type Turn } from './assist.store';
import type { RoutingNote } from './interpret';
import { SUGGESTIONS } from './recorded-model';

/**
 * ASSIST PANEL — a floating chat. A round launcher sits in the window's bottom-right
 * corner; it opens a compact panel above it, which can be expanded and closed back
 * to the launcher. Open / expanded live in AssistStore (the page minimises it when a
 * side panel opens).
 *
 * Inside: the conversation for this service — each reply's summary lines, routing
 * notes, questions and their answer chips — then one text input, with the example
 * prompts below it (shown while the conversation is empty, then behind an "Example
 * prompts" toggle). A reply with ops is a proposal the canvas previews; "Add to
 * draft" / "Discard" settle it.
 */
@Component({
  selector: 'app-assist-panel',
  standalone: true,
  templateUrl: './assist-panel.component.html',
  styleUrl: './assist-panel.component.css',
})
export class AssistPanelComponent {
  readonly assist = inject(AssistStore);

  readonly serviceId = input.required<string>();
  /** The draft is submitted for review: the assistant can't propose changes. */
  readonly locked = input(false);
  /** "Set up routing" on a note, once its proposal is in the draft. */
  readonly routerGap = output<{ groupId: string; kind: RouterGapKind }>();

  readonly suggestions = Object.values(SUGGESTIONS);
  readonly text = signal('');
  readonly turns = computed(() => this.assist.turnsFor(this.serviceId()));

  /** "Example prompts" toggle — chips are always shown while the conversation is empty. */
  readonly examplesOpen = signal(false);
  readonly showChips = computed(() => this.turns().length === 0 || this.examplesOpen());

  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('promptInput');
  private readonly fab = viewChild.required<ElementRef<HTMLButtonElement>>('fab');

  constructor() {
    // Keep the latest reply in view (also when the panel reopens).
    effect(() => {
      this.turns();
      this.assist.open();
      const el = this.log()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
    // Opening the panel puts the cursor in the input.
    effect(() => {
      const el = this.input()?.nativeElement;
      if (el) queueMicrotask(() => el.focus());
    });
  }

  toggle(): void {
    this.assist.open.update((o) => !o);
  }

  /** Close (button or Escape) and hand focus back to the launcher. */
  close(): void {
    this.assist.open.set(false);
    this.fab().nativeElement.focus();
  }

  send(prompt = this.text()): void {
    if (!prompt.trim()) return;
    void this.assist.send(prompt, this.serviceId());
    this.text.set('');
    this.examplesOpen.set(false);
  }

  /** Answer chips only act on the latest turn; older ones stay as a record. */
  isLatest(t: Turn): boolean {
    return this.turns().at(-1)?.id === t.id;
  }

  status(t: Turn) {
    return this.assist.statusOf(t);
  }

  /** "Set up routing" is offered once the proposal is in the draft, for this service's groups. */
  canSetUp(t: Turn, note: RoutingNote): boolean {
    return this.status(t) === 'added' && note.serviceId === this.serviceId();
  }

  setUpRouting(note: RoutingNote): void {
    this.routerGap.emit({ groupId: note.groupId, kind: note.kind });
  }
}
