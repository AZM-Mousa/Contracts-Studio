import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { I18n } from '../core/ui/i18n';
import { SoundService } from '../core/ui/sound.service';
import { AlertService } from './alert.service';
import { nextFrame } from '../core/utils/schedule.util';
import { AlertKind } from '../core/enums/alert-kind.enum';
import { Cue } from '../core/enums/cue.enum';

@Component({
  selector: 'cs-alert-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alert-dialog.component.html',
  styleUrl: './alert-dialog.component.scss',
})
export class AlertDialog {
  protected readonly alerts = inject(AlertService);
  protected readonly i18n = inject(I18n);
  readonly #sound = inject(SoundService);
  private readonly dialogEl = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly confirmEl = viewChild<ElementRef<HTMLButtonElement>>('confirm');
  private readonly textEl = viewChild<ElementRef<HTMLTextAreaElement>>('text');
  protected readonly value = signal('');
  protected readonly touched = signal(false);
  protected readonly valid = computed(() => {
    const a = this.alerts.current();
    return !a?.input || a.input.optional || this.value().trim().length > 0;
  });

  constructor() {
    effect(() => {
      const a = this.alerts.current();
      untracked(() => {
        const dialog = this.dialogEl().nativeElement;
        if (a && !dialog.open) {
          this.value.set('');
          this.touched.set(false);
          dialog.showModal();
          this.#sound.play(a.kind === AlertKind.Success ? Cue.Success : a.kind === AlertKind.Error ? Cue.Error : Cue.Pop);
          nextFrame(() => (this.textEl() ?? this.confirmEl())?.nativeElement.focus());
        } else if (!a && dialog.open) {
          dialog.close();
        }
      });
    });
  }

  protected read(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected cancel(event: Event): void {
    event.preventDefault();
    this.resolve(false);
  }

  protected resolve(confirmed: boolean): void {
    if (confirmed && !this.valid()) {
      this.touched.set(true);
      this.#sound.play(Cue.Error);
      return;
    }
    this.alerts.close({ confirmed, value: this.value().trim() });
  }
}
