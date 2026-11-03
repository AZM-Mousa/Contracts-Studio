import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import { displayValue, FIELD_META, FieldType, isFilled, type Field } from '../core/fields/field.model';
import { StudioState } from '../core/studio-state.service';
import { I18n } from '../core/ui/i18n';
import { Preferences } from '../core/ui/preferences.service';
import { SoundService } from '../core/ui/sound.service';
import { FieldNavigator } from '../viewer/field-navigator.service';
import { Icon } from '../ui/icon.component';
import { Select, type SelectOption } from '../ui/select.component';
import { Cue } from '../core/enums/cue.enum';
import { nextFrame } from '../core/utils/schedule.util';
import { Panel } from '../core/enums/panel.enum';

/** Row height in px; the list only renders the rows in view, so 200,000 fields stay fast. */
const ROW = 48;
const OVERSCAN = 8;
const ANY = '*';

/**
 * Every field in the document in reading order, with filters (text, signer, type,
 * unfilled), jump-to on click, "select shown", and per-signer visibility on the pages.
 */
@Component({
  selector: 'cs-fields-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Select],
  templateUrl: './fields-list.component.html',
  styleUrl: './fields-list.component.scss',
})
export class FieldsList {
  protected readonly ROW = ROW;
  protected readonly meta = FIELD_META;
  protected readonly store = inject(FieldStore);
  protected readonly state = inject(StudioState);
  protected readonly i18n = inject(I18n);
  readonly #prefs = inject(Preferences);
  readonly #nav = inject(FieldNavigator);
  readonly #sound = inject(SoundService);

  protected readonly query = signal('');
  protected readonly signer = signal<string | null>(ANY);
  protected readonly type = signal<string | null>(ANY);
  protected readonly unfilled = signal(false);
  protected readonly scrollTop = signal(0);
  protected readonly viewport = signal(520);
  private readonly listEl = viewChild.required<ElementRef<HTMLElement>>('list');

  protected readonly signerOptions = computed<SelectOption[]>(() => [
    { value: ANY, label: this.i18n.t('allSigners') },
    ...this.store.signers().map(s => ({ value: s.id, label: s.name, color: s.color })),
  ]);
  protected readonly typeOptions = computed<SelectOption[]>(() => [
    { value: ANY, label: this.i18n.t('allTypes') },
    ...(Object.values(FieldType) as FieldType[]).map(t => ({ value: t, label: this.i18n.field(t), icon: FIELD_META[t].icon })),
  ]);

  protected readonly filtered = computed<readonly Field[]>(() => {
    const q = this.query().trim().toLowerCase();
    const signer = this.signer() ?? ANY;
    const type = this.type() ?? ANY;
    const unfilled = this.unfilled();
    const lang = this.#prefs.lang();
    return this.store.ordered().filter(f =>
      (signer === ANY || f.signerId === signer)
      && (type === ANY || f.type === type)
      && (!unfilled || !isFilled(f))
      && (!q || `${f.label} ${this.i18n.field(f.type)} ${displayValue(f, lang)}`.toLowerCase().includes(q)),
    );
  });

  protected readonly window = computed(() => {
    const list = this.filtered();
    const start = Math.max(0, Math.floor(this.scrollTop() / ROW) - OVERSCAN);
    const end = Math.min(list.length, start + Math.ceil(this.viewport() / ROW) + OVERSCAN * 2);
    return { start, rows: list.slice(start, end) };
  });

  constructor() {
    const observer = new ResizeObserver(([entry]) => this.viewport.set(entry.contentRect.height || 520));
    afterNextRender(() => observer.observe(this.listEl().nativeElement));
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  protected onScroll(event: Event): void {
    this.scrollTop.set((event.target as HTMLElement).scrollTop);
  }

  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.#toTop();
  }

  protected setSigner(value: string | null): void {
    this.signer.set(value);
    this.#toTop();
  }

  protected setType(value: string | null): void {
    this.type.set(value);
    this.#toTop();
  }

  protected toggleUnfilled(): void {
    this.unfilled.update(on => !on);
    this.#toTop();
  }

  protected title(f: Field): string {
    return f.label || this.i18n.field(f.type);
  }

  protected value(f: Field): string {
    return displayValue(f, this.#prefs.lang());
  }

  protected filled(f: Field): boolean {
    return isFilled(f);
  }

  protected color(f: Field): string {
    return this.store.signer(f.signerId)?.color ?? 'var(--accent)';
  }

  /** Click jumps to the field; Ctrl/Cmd/Shift-click adds it to (or removes it from) the selection. */
  protected open(event: MouseEvent, f: Field): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      const next = new Set(this.store.selection());
      next.has(f.id) ? next.delete(f.id) : next.add(f.id);
      this.store.select(next);
      this.#sound.play(Cue.Tick);
      return;
    }
    // On phones the list is a bottom sheet: close it so the field is visible.
    this.state.sheet.set(Panel.None);
    this.#nav.goTo(f);
  }

  /** Arrow keys move between rows, like a list box. */
  protected onKey(event: KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) {
      return;
    }
    event.preventDefault();
    const target = Math.min(this.filtered().length - 1, Math.max(0, index + step));
    const list = this.listEl().nativeElement;
    const top = target * ROW;
    if (top < list.scrollTop || top + ROW > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
    nextFrame(() => list.querySelector<HTMLElement>(`[data-index="${target}"]`)?.focus());
  }

  protected selectShown(): void {
    this.store.select(this.filtered().map(f => f.id));
    this.#sound.play(Cue.Snap);
  }

  protected toggleSigner(id: string): void {
    const hidden = new Set(this.state.hiddenSigners());
    hidden.has(id) ? hidden.delete(id) : hidden.add(id);
    this.state.hiddenSigners.set(hidden);
    this.#sound.play(Cue.Tick);
  }

  #toTop(): void {
    this.listEl().nativeElement.scrollTop = 0;
    this.scrollTop.set(0);
  }
}
