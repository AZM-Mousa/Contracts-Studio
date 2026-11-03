import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, signal, viewChild } from '@angular/core';
import { Icon } from './icon.component';
import { opensUp } from './popover';
import { nextFrame } from '../core/utils/schedule.util';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  color?: string;
  icon?: string;
}

let nextId = 0;

/**
 * Accessible custom select (WAI-ARIA combobox + listbox): arrow keys, Home/End,
 * type-ahead, Enter/Space to pick, Escape to close. No native <select>.
 */
@Component({
  selector: 'cs-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(focusout)': 'onFocusOut($event)', '[class.open]': 'open()', '[class.up]': 'up()' },
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
})
export class Select<T extends string = string> {
  readonly options = input.required<readonly SelectOption<T>[]>();
  readonly value = model<T | null>(null);
  readonly label = input('');
  readonly placeholder = input('—');

  protected readonly id = `cs-select-${++nextId}`;
  protected readonly open = signal(false);
  protected readonly up = signal(false);
  protected readonly active = signal(0);
  protected readonly selected = computed(() => this.options().find(o => o.value === this.value()) ?? null);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  #typed = '';
  #typedAt = 0;

  protected toggle(): void {
    this.open() ? this.close() : this.show();
  }

  protected show(): void {
    this.active.set(Math.max(0, this.options().findIndex(o => o.value === this.value())));
    this.up.set(opensUp(this.#host, Math.min(270, this.options().length * 40 + 12)));
    this.open.set(true);
    nextFrame(() => this.#host.querySelector('li.active')?.scrollIntoView({ block: 'nearest' }));
  }

  protected close(): void {
    this.open.set(false);
  }

  protected pick(option: SelectOption<T>): void {
    this.value.set(option.value);
    this.close();
    this.trigger().nativeElement.focus();
  }

  protected onFocusOut(event: FocusEvent): void {
    if (!this.#host.contains(event.relatedTarget as Node)) {
      this.close();
    }
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.options().length;
    const move = (to: number) => {
      event.preventDefault();
      if (!this.open()) {
        this.show();
        return;
      }
      this.active.set(Math.min(count - 1, Math.max(0, to)));
      nextFrame(() => this.#host.querySelector('li.active')?.scrollIntoView({ block: 'nearest' }));
    };
    switch (event.key) {
      case 'ArrowDown': return move(this.active() + 1);
      case 'ArrowUp': return move(this.active() - 1);
      case 'Home': return move(0);
      case 'End': return move(count - 1);
      case 'Enter':
      case ' ':
        event.preventDefault();
        return this.open() ? this.pick(this.options()[this.active()]) : this.show();
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        return;
      case 'Tab':
        return this.close();
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      // Type-ahead: jump to the first option starting with what was typed.
      const now = Date.now();
      this.#typed = now - this.#typedAt > 700 ? event.key : this.#typed + event.key;
      this.#typedAt = now;
      const i = this.options().findIndex(o => o.label.toLowerCase().startsWith(this.#typed.toLowerCase()));
      if (i >= 0) {
        this.open() ? move(i) : this.value.set(this.options()[i].value);
      }
    }
  }
}
