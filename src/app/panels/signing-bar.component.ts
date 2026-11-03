import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal } from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import { StudioState } from '../core/studio-state.service';
import { I18n } from '../core/ui/i18n';
import { SoundService } from '../core/ui/sound.service';
import { Icon } from '../ui/icon.component';
import { FieldNavigator } from '../viewer/field-navigator.service';
import { Cue } from '../core/enums/cue.enum';

@Component({
  selector: 'cs-signing-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { role: 'toolbar', '[attr.aria-label]': 'i18n.t("progress", progress())', '[class.done]': 'complete()' },
  templateUrl: './signing-bar.component.html',
  styleUrl: './signing-bar.component.scss',
})
export class SigningBar {
  protected readonly i18n = inject(I18n);
  protected readonly nav = inject(FieldNavigator);
  readonly #store = inject(FieldStore);
  readonly #state = inject(StudioState);
  readonly #sound = inject(SoundService);
  protected readonly started = signal(false);
  readonly finished = output<void>();
  protected readonly progress = this.#store.progress;
  protected readonly complete = computed(() => this.progress().total > 0 && this.progress().done === this.progress().total);
  protected readonly dash = computed(() => {
    const { done, total } = this.progress();
    return 97.4 * (1 - (total ? done / total : 0));
  });
  protected readonly signerName = computed(() => this.#store.signer(this.#store.activeSignerId())?.name ?? '');

  constructor() {
    let wasComplete = false;
    effect(() => {
      const complete = this.complete();
      if (complete && !wasComplete) {
        this.#sound.play(Cue.Success);
        this.#state.notify(this.i18n.t('allDone'));
      }
      wasComplete = complete;
    });
  }

  protected start(): void {
    this.started.set(true);
    this.nav.firstMissing();
  }
}
