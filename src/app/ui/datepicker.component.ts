import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, signal } from '@angular/core';
import { Preferences } from '../core/ui/preferences.service';
import { Icon } from './icon.component';
import { opensUp } from './popover';
import { nextFrame } from '../core/utils/schedule.util';

interface Day {
  iso: string;
  day: number;
  hijri: string;
  inMonth: boolean;
  today: boolean;
  disabled: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
let nextId = 0;

/**
 * Custom date picker (ARIA grid dialog). Every day shows the Gregorian date and
 * its Hijri (Umm al-Qura) day; the header shows both months. No native date input.
 */
@Component({
  selector: 'cs-datepicker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(focusout)': 'onFocusOut($event)', '[class.open]': 'open()', '[class.up]': 'up()' },
  templateUrl: './datepicker.component.html',
  styleUrl: './datepicker.component.scss',
})
export class Datepicker {
  readonly value = model<string>('');
  readonly min = input<string | null>(null);
  readonly label = input('Date');
  readonly placeholder = input('—');
  /** Shows the Hijri date first (for Hijri date fields). */
  readonly hijri = input(false);

  readonly #prefs = inject(Preferences);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly id = `cs-date-${++nextId}`;
  protected readonly todayIso = toIso(new Date());
  protected readonly open = signal(false);
  protected readonly up = signal(false);
  protected readonly cursor = signal(new Date());
  protected readonly focus = signal(this.todayIso);
  protected readonly rtl = computed(() => this.#prefs.lang() === 'ar');
  readonly #locale = computed(() => (this.rtl() ? 'ar-SA' : 'en-GB'));
  readonly #hijriDay = computed(() => new Intl.DateTimeFormat(`${this.rtl() ? 'ar' : 'en'}-SA-u-ca-islamic-umalqura`, { day: 'numeric' }));

  protected readonly display = computed(() =>
    this.value() ? fromIso(this.value()).toLocaleDateString(`${this.#locale()}-u-ca-gregory`, { day: 'numeric', month: 'long', year: 'numeric' }) : '—',
  );
  protected readonly displayHijri = computed(() =>
    this.value() ? new Intl.DateTimeFormat(`${this.rtl() ? 'ar' : 'en'}-SA-u-ca-islamic-umalqura`, { day: 'numeric', month: 'long', year: 'numeric' }).format(fromIso(this.value())) : '',
  );
  protected readonly monthTitle = computed(() =>
    this.cursor().toLocaleDateString(`${this.#locale()}-u-ca-gregory`, { month: 'long', year: 'numeric' }),
  );
  protected readonly hijriTitle = computed(() => {
    const c = this.cursor();
    const fmt = new Intl.DateTimeFormat(`${this.rtl() ? 'ar' : 'en'}-SA-u-ca-islamic-umalqura`, { month: 'long', year: 'numeric' });
    const a = fmt.format(new Date(c.getFullYear(), c.getMonth(), 1));
    const b = fmt.format(new Date(c.getFullYear(), c.getMonth() + 1, 0));
    return a === b ? a : `${a} – ${b}`;
  });
  /** Weeks start on Sunday, as in Saudi Arabia. */
  protected readonly weekdays = computed(() =>
    Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(this.#locale(), { weekday: 'narrow' })),
  );
  protected readonly weeks = computed<Day[][]>(() => {
    const c = this.cursor();
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const min = this.min();
    const weeks: Day[][] = [];
    for (let w = 0; w < 6; w++) {
      const week: Day[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const iso = toIso(date);
        week.push({
          iso, day: date.getDate(), hijri: this.#hijriDay().format(date), inMonth: date.getMonth() === c.getMonth(),
          today: iso === this.todayIso, disabled: !!min && iso < min,
        });
      }
      weeks.push(week);
    }
    return weeks;
  });

  protected toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    const iso = this.value() || this.todayIso;
    this.cursor.set(fromIso(iso));
    this.focus.set(iso);
    this.up.set(opensUp(this.#host, 400));
    this.open.set(true);
    this.#focusDay();
  }

  protected close(event?: Event): void {
    event?.stopPropagation();
    this.open.set(false);
    this.#host.querySelector<HTMLElement>('.trigger')?.focus();
  }

  protected shift(months: number): void {
    const c = this.cursor();
    this.cursor.set(new Date(c.getFullYear(), c.getMonth() + months, 1));
  }

  protected pick(iso: string): void {
    this.value.set(iso);
    this.close();
  }

  protected onFocusOut(event: FocusEvent): void {
    if (!this.#host.contains(event.relatedTarget as Node)) {
      this.open.set(false);
    }
  }

  protected onKey(event: KeyboardEvent): void {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const current = fromIso(this.focus());
    let next: Date | null = null;
    if (steps[event.key] !== undefined) {
      const dir = this.rtl() && Math.abs(steps[event.key]) === 1 ? -steps[event.key] : steps[event.key];
      next = new Date(current);
      next.setDate(current.getDate() + dir);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      next = new Date(current.getFullYear(), current.getMonth() + (event.key === 'PageUp' ? -1 : 1), current.getDate());
    } else if (event.key === 'Home' || event.key === 'End') {
      next = new Date(current);
      next.setDate(current.getDate() + (event.key === 'Home' ? -current.getDay() : 6 - current.getDay()));
    }
    if (next) {
      event.preventDefault();
      this.focus.set(toIso(next));
      if (next.getMonth() !== this.cursor().getMonth() || next.getFullYear() !== this.cursor().getFullYear()) {
        this.cursor.set(new Date(next.getFullYear(), next.getMonth(), 1));
      }
      this.#focusDay();
    }
  }

  #focusDay(): void {
    nextFrame(() => this.#host.querySelector<HTMLElement>(`.day[data-iso="${this.focus()}"]`)?.focus());
  }
}
