import { Component, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';

type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'space';
interface JsonToken { kind: JsonTokenKind; text: string; }
type CopyTarget = 'cli' | 'url' | 'body';

/** Matches every token JSON.stringify can emit on one line: string (with an optional `:` making it a key), number, literal, punctuation, whitespace. */
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)/g;

function tokenizeLine(line: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  for (const m of line.matchAll(JSON_TOKEN)) {
    if (m[1] !== undefined && m[2] !== undefined) {
      tokens.push({ kind: 'key', text: m[1] }, { kind: 'punct', text: m[2] });
    } else if (m[1] !== undefined) tokens.push({ kind: 'string', text: m[1] });
    else if (m[3] !== undefined) tokens.push({ kind: 'number', text: m[3] });
    else if (m[4] !== undefined) tokens.push({ kind: 'literal', text: m[4] });
    else if (m[5] !== undefined) tokens.push({ kind: 'punct', text: m[5] });
    else tokens.push({ kind: 'space', text: m[6] });
  }
  return tokens;
}

/**
 * Right-hand "API calls" card for create forms: the request method + URL and a
 * syntax-highlighted, line-numbered JSON body, with copy actions. Read-only —
 * the form owns the payload; this only renders and copies it.
 *
 * `json` is the pretty-printed body as a string (not an object) so an unchanged
 * payload is an unchanged input and the highlighted lines aren't rebuilt on
 * every change-detection pass. Projected content renders as a note under the code.
 */
@Component({
  selector: 'app-api-calls-panel',
  standalone: true,
  templateUrl: './api-calls-panel.component.html',
  styleUrl: './api-calls-panel.component.css',
})
export class ApiCallsPanelComponent {
  readonly method = input<string>('POST');
  readonly url = input.required<string>();
  readonly json = input.required<string>();

  readonly lines = computed(() => this.json().split('\n').map(tokenizeLine));

  /** A cURL invocation of the request; the body is compacted and single quotes shell-escaped. */
  readonly curl = computed(() => {
    let body = this.json();
    try { body = JSON.stringify(JSON.parse(body)); } catch { /* send as given */ }
    return `curl -s -X ${this.method()} "${this.url()}" \\\n  -H "Content-Type: application/json" \\\n  -d '${body.replace(/'/g, `'\\''`)}'`;
  });

  readonly menuOpen = signal(false);
  /** Which copy action just succeeded — drives the brief "Copied" confirmation. */
  readonly copied = signal<CopyTarget | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly host = inject(ElementRef<HTMLElement>);

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update(o => !o);
  }

  copy(target: CopyTarget): void {
    this.menuOpen.set(false);
    const text = target === 'cli' ? this.curl() : target === 'url' ? this.url() : this.json();
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(target);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(null), 1500);
    }).catch(() => {});
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menuOpen.set(false);
  }
}
