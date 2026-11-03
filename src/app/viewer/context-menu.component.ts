import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { Align, FieldStore } from '../core/fields/field-store.service';
import { FIELD_META, FieldType } from '../core/fields/field.model';
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { StudioState } from '../core/studio-state.service';
import { I18n } from '../core/ui/i18n';
import { SoundService } from '../core/ui/sound.service';
import { Icon } from '../ui/icon.component';
import { Cue } from '../core/enums/cue.enum';

const MARGIN = 8;
const QUICK_ADD: FieldType[] = [FieldType.Signature, FieldType.Initials, FieldType.SignDate, FieldType.Text, FieldType.Checkbox, FieldType.Stamp];

/**
 * Right-click (or ContextMenu / Shift+F10) menu for the editor. On a field it acts on the
 * selection; on an empty spot it offers quick add and paste at that spot.
 * Arrow keys move between items, Escape or a click outside closes it.
 */
@Component({
  selector: 'cs-context-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    '(document:pointerdown)': 'onOutside($event)',
    '(window:blur)': 'close()',
    '(window:resize)': 'close()',
  },
  templateUrl: './context-menu.component.html',
  styleUrl: './context-menu.component.scss',
})
export class ContextMenu {
  readonly deleteRequested = output<void>();

  protected readonly state = inject(StudioState);
  protected readonly store = inject(FieldStore);
  protected readonly i18n = inject(I18n);
  readonly #engine = inject(PdfEngine);
  readonly #sound = inject(SoundService);
  protected readonly meta = FIELD_META;
  protected readonly quickAdd = QUICK_ADD;
  protected readonly aligns: { mode: Align; icon: string }[] = [
    { mode: Align.Left, icon: 'alignLeft' }, { mode: Align.Center, icon: 'alignCenter' }, { mode: Align.Right, icon: 'alignRight' },
    { mode: Align.Top, icon: 'alignTop' }, { mode: Align.Middle, icon: 'alignMiddle' }, { mode: Align.Bottom, icon: 'alignBottom' },
  ];
  protected readonly at = this.state.contextMenu;
  protected readonly selected = this.store.selected;
  protected readonly locked = computed(() => this.selected().length > 0 && this.selected().every(f => f.locked));
  /** Position after keeping the menu inside the window. */
  protected readonly pos = signal({ left: 0, top: 0 });
  private readonly menuEl = viewChild<ElementRef<HTMLElement>>('menu');
  readonly #mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  protected readonly keys = { copy: `${this.#mod}C`, paste: `${this.#mod}V`, duplicate: `${this.#mod}D`, all: `${this.#mod}A` };

  constructor() {
    afterRenderEffect(() => {
      const at = this.at();
      const menu = this.menuEl()?.nativeElement;
      if (!at || !menu) {
        return;
      }
      const { width, height } = menu.getBoundingClientRect();
      this.pos.set({
        left: Math.max(MARGIN, Math.min(at.x, innerWidth - width - MARGIN)),
        top: Math.max(MARGIN, at.y + height > innerHeight - MARGIN ? at.y - height : at.y),
      });
      menu.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    });
  }

  close(): void {
    this.state.contextMenu.set(null);
  }

  protected onOutside(event: PointerEvent): void {
    if (this.at() && !this.menuEl()?.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  protected onKey(event: KeyboardEvent): void {
    const items = [...(this.menuEl()?.nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      event.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        return go(index + 1);
      case 'ArrowUp':
      case 'ArrowLeft':
        return go(index - 1);
      case 'Home':
        return go(0);
      case 'End':
        return go(items.length - 1);
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
    }
  }

  #ids(): string[] {
    return this.selected().map(f => f.id);
  }

  #done(cue: Cue = Cue.Tick): void {
    this.#sound.play(cue);
    this.close();
  }

  protected add(type: FieldType): void {
    const at = this.at()!;
    if (this.store.create(type, at.page, at.px, at.py, this.#engine.pagesCount())) {
      this.#done(Cue.Pop);
    } else {
      this.close();
    }
  }

  protected copy(): void {
    this.store.copy();
    this.state.notify(this.i18n.t('copied', { n: this.selected().length }));
    this.#done();
  }

  protected paste(): void {
    const at = this.at()!;
    this.store.paste(at.page, this.selected().length ? undefined : { x: at.px, y: at.py });
    this.#done(Cue.Pop);
  }

  protected duplicate(): void {
    this.store.duplicate(this.#ids());
    this.#done(Cue.Pop);
  }

  /** Starts the format painter with this field's formatting. */
  protected paint(): void {
    this.state.painterSource.set(this.selected()[0].id);
    this.state.notify(this.i18n.t('painterOn'));
    this.#done();
  }

  protected toggleLock(): void {
    const lock = !this.locked();
    this.store.update(this.#ids(), () => ({ locked: lock }));
    this.#done();
  }

  protected assign(signerId: string): void {
    this.store.update(this.#ids(), () => ({ signerId }));
    this.#done(Cue.Snap);
  }

  protected align(mode: Align): void {
    this.store.align(mode);
    this.#done(Cue.Snap);
  }

  protected selectPage(): void {
    this.store.select((this.store.byPage().get(this.at()!.page) ?? []).map(f => f.id));
    this.#done();
  }

  protected remove(): void {
    this.close();
    this.deleteRequested.emit();
  }
}
