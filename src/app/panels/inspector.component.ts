import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FieldStore, Align } from '../core/fields/field-store.service';
import {
  DEFAULT_FORMATTING, DEPARTMENTS, FieldType, FONT_FAMILIES, parsePageRange, DateFormat, type Field, type Formatting,
  StampShape, TextDir, Validation,
} from '../core/fields/field.model';
import { Preferences } from '../core/ui/preferences.service';
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { StudioState } from '../core/studio-state.service';
import { I18n } from '../core/ui/i18n';
import { SoundService } from '../core/ui/sound.service';
import { ColorPicker } from '../ui/color-picker.component';
import { Icon } from '../ui/icon.component';
import { Select, type SelectOption } from '../ui/select.component';
import { TextAlign } from '../core/enums/text-align.enum';
import { Cue } from '../core/enums/cue.enum';
import { FieldLocation } from '../core/enums/field-location.enum';
import type { BooleanKeys } from '../core/utils/types';
import { Axis } from '../core/enums/axis.enum';
import { Panel } from '../core/enums/panel.enum';

const TEXTUAL = new Set<FieldType>([
  FieldType.Text, FieldType.Email, FieldType.Mobile, FieldType.FullName, FieldType.JobTitle, FieldType.Company,
  FieldType.Dropdown, FieldType.SignDate, FieldType.HijriDate, FieldType.Barcode,
]);
const DATES = new Set<FieldType>([FieldType.SignDate, FieldType.HijriDate]);
const FORCEABLE = new Set<FieldType>([
  FieldType.Initials, FieldType.Signature, FieldType.Stamp, FieldType.FullName, FieldType.JobTitle, FieldType.Company,
  FieldType.Email, FieldType.Mobile, FieldType.Image,
]);

type Section = 'content' | 'format' | 'behaviour' | 'placement';

@Component({
  selector: 'cs-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Select, ColorPicker],
  templateUrl: './inspector.component.html',
  styleUrl: './inspector.component.scss',
})
export class Inspector {
  protected readonly FieldLocation = FieldLocation;
  protected readonly Axis = Axis;
  protected readonly Validation = Validation;
  protected readonly DateFormat = DateFormat;
  protected readonly store = inject(FieldStore);
  protected readonly i18n = inject(I18n);
  readonly #state = inject(StudioState);
  readonly #sound = inject(SoundService);
  readonly #engine = inject(PdfEngine);
  protected readonly pagesCount = this.#engine.pagesCount;
  protected readonly ids = computed(() => this.store.selected().map(f => f.id));
  protected readonly open = signal<ReadonlySet<Section>>(new Set(['content']));

  protected readonly signerOptions = computed<SelectOption[]>(() =>
    this.store.signers().map(s => ({ value: s.id, label: s.name, color: s.color })),
  );
  protected readonly validations = computed<SelectOption<Validation>[]>(() => (
    ['none', 'email', 'mobileSa', 'number', 'nationalId', 'iban'] as Validation[]
  ).map(v => ({ value: v, label: this.i18n.t(`val_${v}` as never) })));
  protected readonly fonts: SelectOption<Formatting['fontFamily']>[] = FONT_FAMILIES.map(f => ({ value: f, label: f, hint: f === 'Almarai' ? 'العربية · English' : undefined }));
  protected readonly departments = computed<SelectOption[]>(() =>
    DEPARTMENTS.map(d => ({ value: d.id, label: this.#prefs.lang() === 'ar' ? d.nameAr : d.name, icon: 'stamp' })),
  );
  readonly #prefs = inject(Preferences);
  protected readonly location = signal<FieldLocation>(FieldLocation.Range);
  protected readonly rangeText = signal('');
  protected readonly rangeValid = computed(() => this.location() !== FieldLocation.Range || !this.rangeText().trim() || parsePageRange(this.rangeText(), this.pagesCount()) !== null);
  protected readonly confirmForce = signal<boolean | null>(null);
  protected readonly dateFormats: SelectOption<DateFormat>[] = [
    { value: DateFormat.DayMonthNameYear, label: '28 October 2026' }, { value: DateFormat.DayMonthYear, label: '28/10/2026' }, { value: DateFormat.Iso, label: '2026-10-28' },
  ];
  protected readonly shapes: StampShape[] = [StampShape.Circle, StampShape.Square, StampShape.Rectangle];
  protected readonly dirs: TextDir[] = [TextDir.Auto, TextDir.Rtl, TextDir.Ltr];
  protected readonly textAligns: { id: Formatting['align']; icon: string }[] = [
    { id: TextAlign.Start, icon: 'alignLeft' }, { id: TextAlign.Center, icon: 'alignCenter' }, { id: TextAlign.End, icon: 'alignRight' },
  ];
  protected readonly aligns: { mode: Align; icon: string }[] = [
    { mode: Align.Left, icon: 'alignLeft' }, { mode: Align.Center, icon: 'alignCenter' }, { mode: Align.Right, icon: 'alignRight' },
    { mode: Align.Top, icon: 'alignTop' }, { mode: Align.Middle, icon: 'alignMiddle' }, { mode: Align.Bottom, icon: 'alignBottom' },
  ];

  protected toggleSection(section: Section): void {
    const next = new Set(this.open());
    next.has(section) ? next.delete(section) : next.add(section);
    this.open.set(next);
    this.#sound.play(Cue.Tick);
  }

  protected color(f: Field): string {
    return this.store.signer(f.signerId)?.color ?? 'var(--accent)';
  }

  protected fmt(f: Field): Formatting {
    return f.formatting ?? DEFAULT_FORMATTING;
  }

  protected hasOptions(f: Field): boolean {
    return f.type === FieldType.RadioGroup || f.type === FieldType.Dropdown || f.type === FieldType.MultiSelect;
  }

  protected isTextual(f: Field): boolean {
    return TEXTUAL.has(f.type);
  }

  protected isDate(f: Field): boolean {
    return DATES.has(f.type);
  }

  protected forceable(f: Field): boolean {
    return FORCEABLE.has(f.type);
  }

  protected all(fields: readonly Field[], key: BooleanKeys<Field>): boolean {
    return fields.every(f => !!f[key]);
  }

  protected set(change: Partial<Field>): void {
    this.store.update(this.ids(), () => change);
    this.#sound.play(Cue.Tick);
  }

  protected setFmt(change: Partial<Formatting>): void {
    this.store.update(this.ids(), f => ({ formatting: { ...(f.formatting ?? DEFAULT_FORMATTING), ...change } }));
    this.#sound.play(Cue.Tick);
  }

  /** The default value is also the starting value, as in the original editor. */
  protected setDefault(value: string): void {
    this.store.update(this.ids(), f => ({ defaultValue: value || undefined, value: f.value ?? (value || null) }));
  }

  protected placeOnPages(): void {
    const pages = this.#locationPages();
    // First / last page moves the field itself there, so no copy is left behind on the current page.
    const single = this.location() === FieldLocation.First || this.location() === FieldLocation.Last;
    if (single) {
      this.store.update(this.ids(), () => ({ page: pages[0] }), true);
      this.#engine.goToPage(pages[0]);
      this.#state.notify(this.i18n.t('movedTo', { n: pages[0] }));
      this.#sound.play(Cue.Drop);
      return;
    }
    const count = this.store.placeOnPages(this.ids(), pages);
    this.#state.notify(this.i18n.t('copiedToPages', { n: count }));
    this.#sound.play(Cue.Success);
  }

  #locationPages(): number[] {
    const count = this.pagesCount();
    switch (this.location()) {
      case FieldLocation.All:
        return Array.from({ length: count }, (_, i) => i + 1);
      case FieldLocation.First:
        return [1];
      case FieldLocation.Last:
        return [count];
      case FieldLocation.Range:
        return parsePageRange(this.rangeText(), count) ?? [];
    }
  }

  protected askForce(event: Event): void {
    const on = this.checked(event);
    (event.target as HTMLInputElement).checked = !on;
    this.confirmForce.set(on);
  }

  protected applyForce(): void {
    this.set({ forceApply: !!this.confirmForce() });
    this.confirmForce.set(null);
  }

  protected setChecked(on: boolean): void {
    this.store.update(this.ids(), () => ({ checkedByDefault: on, value: on }));
  }

  protected optionList(f: Field): SelectOption[] {
    return (f.options ?? []).map(o => ({ value: o, label: o }));
  }

  protected dirLabel(d: TextDir): string {
    return this.i18n.t(d === 'auto' ? 'dir_auto' : d === 'rtl' ? 'dir_rtl' : 'dir_ltr');
  }

  protected align(mode: Align): void {
    this.store.align(mode);
    this.#sound.play(Cue.Snap);
  }

  /** Keyboard-friendly way to move fields to another page. */
  protected moveToPage(event: Event): void {
    const page = Math.round(this.num(event));
    if (page >= 1 && page <= this.pagesCount()) {
      this.store.update(this.ids(), () => ({ page }), true);
      this.#engine.goToPage(page);
      this.#sound.play(Cue.Drop);
    }
  }

  protected readonly painting = computed(() => !!this.#state.painterSource());

  /** Format painter: click other fields to give them this field's look; Esc ends it. */
  protected paint(f: Field): void {
    const on = this.#state.painterSource() === f.id;
    this.#state.painterSource.set(on ? null : f.id);
    if (!on) {
      this.#state.notify(this.i18n.t('painterOn'));
    }
    this.#sound.play(Cue.Tick);
  }

  protected duplicate(): void {
    this.store.duplicate(this.ids());
    this.#sound.play(Cue.Pop);
  }

  protected remove(): void {
    this.store.remove(this.ids());
    this.#sound.play(Cue.Remove);
    this.#state.sheet.set(Panel.None);
  }

  /** Live font size while dragging the slider, without adding undo steps. */
  protected preview(event: Event): void {
    const value = this.num(event);
    for (const id of this.ids()) {
      document.querySelector<HTMLElement>(`cs-field[data-field-id="${id}"]`)?.style.setProperty('--fs', String(value));
    }
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected num(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected lines(event: Event): string[] {
    return this.text(event).split('\n').map(l => l.trim()).filter(Boolean);
  }
}
