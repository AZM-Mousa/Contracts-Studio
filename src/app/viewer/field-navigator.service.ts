import { computed, inject, Service, signal } from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import { isFilled, type Field } from '../core/fields/field.model';
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { StudioState } from '../core/studio-state.service';
import { SoundService } from '../core/ui/sound.service';
import { nextFrame } from '../core/utils/schedule.util';
import { Cue } from '../core/enums/cue.enum';

/** Next/previous field, in reading order, for every mode. */
@Service()
export class FieldNavigator {
  readonly #store = inject(FieldStore);
  readonly #engine = inject(PdfEngine);
  readonly #state = inject(StudioState);
  readonly #sound = inject(SoundService);
  readonly currentId = signal<string | null>(null);

  /** In sign mode, the active signer's fields; otherwise every field. */
  readonly sequence = computed<readonly Field[]>(() => {
    const all = this.#store.ordered();
    if (this.#state.mode() === 'sign') {
      return all.filter(f => f.signerId === this.#store.activeSignerId() && !f.readOnly);
    }
    if (this.#state.mode() === 'review') {
      return all.filter(f => f.required && !isFilled(f));
    }
    return all;
  });

  readonly position = computed(() => {
    const index = this.sequence().findIndex(f => f.id === this.currentId());
    return { index: index + 1, total: this.sequence().length };
  });

  next(): void {
    this.#step(1);
  }

  previous(): void {
    this.#step(-1);
  }

  /** Jumps to the first required field that's still empty. */
  firstMissing(): void {
    const target = this.sequence().find(f => f.required && !isFilled(f));
    if (target) {
      this.goTo(target);
    }
  }

  cycleSelection(direction: 1 | -1): void {
    const [current] = this.#store.selection();
    const list = this.#store.ordered();
    if (!list.length) {
      return;
    }
    const index = list.findIndex(f => f.id === current);
    const target = list[(index + direction + list.length) % list.length];
    this.#store.select([target.id]);
    this.goTo(target);
  }

  goTo(field: Field): void {
    this.currentId.set(field.id);
    if (this.#state.editing()) {
      this.#store.select([field.id]);
    }
    this.#engine.revealArea(field.page, field);
    this.#sound.play(Cue.Whoosh);
    this.#focusWhenMounted(field.id);
  }

  #step(direction: 1 | -1): void {
    const list = this.sequence();
    if (!list.length) {
      return;
    }
    let index = list.findIndex(f => f.id === this.currentId());
    if (index === -1) {
      // Start from the first field after the current page.
      const page = this.#engine.currentPage();
      index = direction === 1 ? list.findIndex(f => f.page >= page) - 1 : list.findIndex(f => f.page >= page);
      if (index < -1) {
        index = direction === 1 ? -1 : list.length;
      }
    }
    if (this.#state.mode() === 'sign') {
      // Prefer empty required fields, like a signing guide.
      for (let step = 1; step <= list.length; step++) {
        const candidate = list[(index + direction * step + list.length * 2) % list.length];
        if (candidate.required && !isFilled(candidate)) {
          return this.goTo(candidate);
        }
      }
    }
    this.goTo(list[(index + direction + list.length * 2) % list.length]);
  }

  #focusWhenMounted(id: string, attempts = 40): void {
    const el = document.querySelector<HTMLElement>(`cs-field[data-field-id="${id}"]`);
    if (el) {
      const input = el.querySelector<HTMLElement>('input, select, button');
      (input ?? el).focus({ preventScroll: true });
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    } else if (attempts > 0) {
      nextFrame(() => this.#focusWhenMounted(id, attempts - 1));
    }
  }
}
