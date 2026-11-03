import { afterNextRender, ChangeDetectionStrategy, Component, computed, debounced, DestroyRef, effect, ElementRef, inject, output, signal, untracked, viewChild } from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import { displayValue, type Field } from '../core/fields/field.model';
import { StorageKey } from '../core/enums/storage-key.enum';
import { LocalStorageService } from '../core/storage/local-storage.service';
import type { FindOptions } from '../core/pdf/pdf-engine.service';
import { FieldNavigator } from '../viewer/field-navigator.service';
import { Preferences } from '../core/ui/preferences.service';
import { SoundService } from '../core/ui/sound.service';

interface Recognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => Recognition;
const SpeechRecognition = (globalThis as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
  ?? (globalThis as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { I18n } from '../core/ui/i18n';
import { Icon } from '../ui/icon.component';
import { Cue } from '../core/enums/cue.enum';

@Component({
  selector: 'cs-search-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { role: 'search' },
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.scss',
})
export class SearchBar {
  readonly closed = output<void>();
  protected readonly engine = inject(PdfEngine);
  protected readonly i18n = inject(I18n);
  readonly #prefs = inject(Preferences);
  readonly #sound = inject(SoundService);
  protected readonly voiceSupported = !!SpeechRecognition;
  protected readonly listening = signal(false);
  #recognition: Recognition | null = null;
  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');
  readonly #query = signal('');
  readonly #debouncedQuery = debounced(() => this.#query(), 220);
  readonly #fields = inject(FieldStore);
  readonly #nav = inject(FieldNavigator);
  readonly #storage = inject(LocalStorageService);
  protected readonly showRecent = signal(false);
  protected readonly showAll = signal(false);
  protected readonly recent = signal<string[]>(this.#storage.getJson<string[]>(StorageKey.RecentSearches, []));
  protected readonly shownPages = computed(() => (this.showAll() ? this.engine.pageMatches() : this.engine.pageMatches().slice(0, 24)));
  /** Fields whose label, hint or value contains the query. */
  protected readonly fieldHits = computed(() => {
    const q = this.#debouncedQuery.value().trim().toLowerCase();
    if (q.length < 2) {
      return [];
    }
    const lang = document.documentElement.lang;
    const hits: Field[] = [];
    for (const f of this.#fields.fields()) {
      const text = `${f.label} ${f.hint ?? ''} ${this.i18n.field(f.type)} ${displayValue(f, lang)}`.toLowerCase();
      if (text.includes(q)) {
        hits.push(f);
        if (hits.length >= 50) {
          break;
        }
      }
    }
    return hits;
  });

  constructor() {
    afterNextRender(() => this.inputEl().nativeElement.focus());
    inject(DestroyRef).onDestroy(() => this.#recognition?.stop());
    // Search once typing pauses.
    effect(() => {
      const query = this.#debouncedQuery.value().trim();
      untracked(() => {
        if (query) {
          this.engine.search(query);
          this.showRecent.set(false);
        } else {
          this.engine.clearSearch();
        }
      });
    });
    // Remember a query once it has results.
    effect(() => {
      const { query, total } = this.engine.find();
      if (query && total) {
        untracked(() => this.#remember(query));
      }
    });
  }

  /** Speech to text with the browser's recognizer; searches as words come in. */
  protected toggleVoice(): void {
    if (this.listening()) {
      this.#recognition?.stop();
      return;
    }
    const recognition = new SpeechRecognition!();
    recognition.lang = this.#prefs.lang() === 'ar' ? 'ar-SA' : 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = e => {
      const result = e.results[e.results.length - 1];
      const text = result[0].transcript.trim().replace(/[.!?،]+$/, '');
      this.inputEl().nativeElement.value = text;
      if (result.isFinal && text) {
        this.#query.set(text);
        this.#sound.play(Cue.Success);
      }
    };
    recognition.onerror = () => this.#sound.play(Cue.Error);
    recognition.onend = () => this.listening.set(false);
    this.#recognition = recognition;
    recognition.start();
    this.listening.set(true);
    this.#sound.play(Cue.Pop);
  }

  protected onInput(event: Event): void {
    this.#query.set((event.target as HTMLInputElement).value);
    this.showAll.set(false);
  }

  protected toggle(option: keyof FindOptions): void {
    this.engine.findOptions.update(o => ({ ...o, [option]: !o[option] }));
    const query = this.inputEl().nativeElement.value;
    if (query) {
      this.engine.search(query);
    }
  }

  protected useRecent(query: string): void {
    this.inputEl().nativeElement.value = query;
    this.#query.set(query);
    this.showRecent.set(false);
  }

  protected goToField(field: Field): void {
    this.#nav.goTo(field);
  }

  protected signerColor(field: Field): string {
    return this.#fields.signer(field.signerId)?.color ?? 'var(--accent)';
  }

  #remember(query: string): void {
    const next = [query, ...this.recent().filter(r => r !== query)].slice(0, 6);
    this.recent.set(next);
    this.#storage.setJson(StorageKey.RecentSearches, next);
  }

  protected step(event: Event, previous: boolean): void {
    event.preventDefault();
    const query = this.inputEl().nativeElement.value;
    if (query) {
      this.engine.search(query, { again: true, previous });
    }
  }

  protected close(): void {
    this.engine.clearSearch();
    this.closed.emit();
  }
}
