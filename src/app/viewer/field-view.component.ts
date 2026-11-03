import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input } from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import { DEFAULT_FORMATTING, displayValue, FIELD_META, FieldType, isFilled, multiValues, validate, type Field } from '../core/fields/field.model';
import { Datepicker } from '../ui/datepicker.component';
import { StudioState } from '../core/studio-state.service';
import { nextFrame } from '../core/utils/schedule.util';
import { I18n } from '../core/ui/i18n';
import { SoundService } from '../core/ui/sound.service';
import { Preferences } from '../core/ui/preferences.service';
import { Icon } from '../ui/icon.component';
import { Select } from '../ui/select.component';
import { Cue } from '../core/enums/cue.enum';

const DRAWN = new Set<FieldType>([FieldType.Signature, FieldType.Initials, FieldType.Stamp, FieldType.Image]);
const TEXT_INPUT: Partial<Record<FieldType, string>> = {
  [FieldType.Text]: 'text', [FieldType.FullName]: 'text', [FieldType.JobTitle]: 'text', [FieldType.Company]: 'text',
  [FieldType.Email]: 'email', [FieldType.Mobile]: 'tel',
};
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

export function autoValue(type: FieldType, _lang: string): string | null {
  const now = new Date();
  if (type === FieldType.SignDate || type === FieldType.HijriDate) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  if (type === FieldType.Barcode) {
    return `DC-${now.getFullYear()}-${Math.floor(now.getTime() / 1000).toString(36).toUpperCase()}`;
  }
  return null;
}

@Component({
  selector: 'cs-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Select, Datepicker],
  host: {
    class: 'cs-field',
    role: 'group',
    '[attr.data-field-id]': 'field().id',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.tabindex]': 'focusable() ? 0 : -1',
    '[class.is-selected]': 'selected()',
    '[class.is-mine]': 'mine()',
    '[class.is-filled]': 'filled()',
    '[class.is-missing]': 'missing()',
    '[class.is-locked]': 'locked()',
    '[class.is-invalid]': 'invalid()',
    '[class.is-pinned]': 'field().locked',
    '[class.b]': 'fmt().bold',
    '[class.i]': 'fmt().italic',
    '[class.u]': 'fmt().underline',
    '[class]': '"align-" + fmt().align',
    '[style.font-family]': 'fontStack()',
    '[style.background-color]': 'fmt().background || null',
    '[style.--fink]': 'fmt().color',
    '[style.--border]': 'fmt().borderColor || null',
    '[attr.dir]': 'field().dir === "auto" ? null : field().dir',
    '[attr.title]': 'field().hint || null',
    '[class.mode-edit]': 'state.editing()',
    '[class.cs-type-checkbox]': 'field().type === "Checkbox"',
    '[style.--signer]': 'signerColor()',
    '[style.--fs]': 'field().fontSize',
    '(click)': 'activate($event)',
    '(keydown.enter)': 'activate($event)',
    '(keydown.space)': 'activate($event)',
  },
  templateUrl: './field-view.component.html',
  styleUrl: './field-view.component.scss',
})
export class FieldView {
  readonly field = input.required<Field>();
  readonly selected = input(false);
  readonly single = input(true);

  protected readonly state = inject(StudioState);
  protected readonly i18n = inject(I18n);
  readonly #store = inject(FieldStore);
  readonly #sound = inject(SoundService);
  readonly #prefs = inject(Preferences);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly handles = HANDLES;

  protected readonly meta = computed(() => FIELD_META[this.field().type]);
  protected readonly signerColor = computed(() => this.#store.signer(this.field().signerId)?.color ?? 'var(--accent)');
  protected readonly mine = computed(() => this.field().signerId === this.#store.activeSignerId());
  protected readonly filled = computed(() => isFilled(this.field()));
  protected readonly isDrawn = computed(() => DRAWN.has(this.field().type));
  protected readonly locked = computed(() => this.field().readOnly || (this.state.filling() && !this.mine()));
  protected readonly editableInput = computed(() => this.state.filling() && this.mine() && !this.field().readOnly);
  protected readonly missing = computed(() => this.state.mode() === 'review' && this.field().required && !this.filled());
  protected readonly fmt = computed(() => this.field().formatting ?? DEFAULT_FORMATTING);
  protected readonly invalid = computed(() => !validate(this.field()));
  protected readonly isDate = computed(() => this.field().type === FieldType.SignDate || this.field().type === FieldType.HijriDate);
  protected readonly shown = computed(() => displayValue(this.field(), this.#prefs.lang()));
  /** Almarai covers Arabic and Latin; the others fall back to it for Arabic text. */
  protected readonly fontStack = computed(() => `'${this.fmt().fontFamily}', 'Almarai', 'Segoe UI', Tahoma, sans-serif`);
  protected readonly focusable = computed(() => this.state.editing() || this.editableInput());
  protected readonly inputType = computed(() => TEXT_INPUT[this.field().type] ?? null);
  protected readonly dropdownOptions = computed(() => (this.field().options ?? []).map(o => ({ value: o, label: o })));
  protected readonly text = computed(() => (typeof this.field().value === 'string' ? (this.field().value as string) : ''));
  protected readonly ariaLabel = computed(() => {
    const f = this.field();
    const signer = this.#store.signer(f.signerId)?.name ?? '';
    return `${f.label || this.i18n.field(f.type)}, ${signer}${f.required ? ', ' + this.i18n.t('required') : ''}`;
  });
  protected readonly cta = computed(() => {
    switch (this.field().type) {
      case FieldType.Signature: return this.i18n.t('signHere');
      case FieldType.Initials: return this.i18n.t('initialHere');
      case FieldType.Stamp: return this.i18n.t('stampHere');
      default: return this.i18n.t('tapToFill');
    }
  });

  protected activate(event: Event): void {
    const f = this.field();
    // Sign mode, another signer's field: switch to that signer (this demo plays every
    // signer), then the same click fills it, so every field is clickable.
    if (this.state.filling() && !this.mine() && !f.readOnly) {
      this.#store.activeSignerId.set(f.signerId);
      this.state.notify(this.i18n.t('signingAs', { name: this.#store.signer(f.signerId)?.name ?? '' }));
      const fillsOnClick = f.type === FieldType.Checkbox || this.isDrawn() || (FIELD_META[f.type].auto && !this.isDate());
      if (!fillsOnClick) {
        // Inputs, dates and lists appear once the field is editable: focus (and open) them.
        nextFrame(() => {
          const control = this.#host.querySelector<HTMLElement>('input, .radio, cs-select button, cs-datepicker button');
          control?.focus();
          if (control?.closest('cs-select, cs-datepicker')) {
            control.click();
          }
        });
        return;
      }
    }
    if (!this.editableInput()) {
      return;
    }
    if (f.type === FieldType.Checkbox) {
      event.preventDefault();
      this.#store.setValue(f.id, f.value !== true);
      this.#sound.play(Cue.Switch);
    } else if (this.isDrawn()) {
      event.preventDefault();
      this.state.drawingFieldId.set(f.id);
      this.#sound.play(Cue.Pop);
    } else if (FIELD_META[f.type].auto && !this.filled() && !this.isDate()) {
      this.#store.setValue(f.id, autoValue(f.type, document.documentElement.lang));
      this.#sound.play(Cue.Success);
    }
  }

  protected setText(event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.#store.setValue(this.field().id, value || null);
  }

  protected setDate(iso: string): void {
    this.#store.setValue(this.field().id, iso || null);
    this.#sound.play(Cue.Success);
  }

  protected setOption(value: string | null): void {
    this.#store.setValue(this.field().id, value);
    this.#sound.play(Cue.Tick);
  }

  /** Chosen options of a multi-select field, in the order of its option list. */
  protected readonly picked = computed(() => multiValues(this.field().value));

  protected toggleOption(option: string, event: Event): void {
    if (!this.editableInput()) {
      return;
    }
    event.stopPropagation();
    const chosen = new Set(this.picked());
    chosen.has(option) ? chosen.delete(option) : chosen.add(option);
    const ordered = (this.field().options ?? []).filter(o => chosen.has(o));
    this.#store.setValue(this.field().id, ordered.length ? ordered.join('\n') : null);
    this.#sound.play(Cue.Tick);
  }

  protected choose(option: string, event: Event): void {
    if (!this.editableInput()) {
      return;
    }
    event.stopPropagation();
    this.#store.setValue(this.field().id, option);
    this.#sound.play(Cue.Tick);
  }
}
