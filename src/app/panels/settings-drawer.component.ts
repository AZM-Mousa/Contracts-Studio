import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, untracked, viewChild } from '@angular/core';
import { StudioState } from '../core/studio-state.service';
import { I18n, type Key } from '../core/ui/i18n';
import { ACCENTS, Preferences, type A11y, Contrast, FontScale, Motion, ThemeMode } from '../core/ui/preferences.service';
import { SoundService } from '../core/ui/sound.service';
import { ColorPicker } from '../ui/color-picker.component';
import { Icon } from '../ui/icon.component';
import { Lang } from '../core/enums/lang.enum';
import { Cue } from '../core/enums/cue.enum';
import { Saturation } from '../core/enums/saturation.enum';
import type { BooleanKeys } from '../core/utils/types';
import { AlertService } from '../ui/alert.service';
import { AlertKind } from '../core/enums/alert-kind.enum';

@Component({
  selector: 'cs-settings-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ColorPicker],
  templateUrl: './settings-drawer.component.html',
  styleUrl: './settings-drawer.component.scss',
})
export class SettingsDrawer {
  protected readonly Cue = Cue;
  protected readonly Lang = Lang;
  protected readonly state = inject(StudioState);
  protected readonly prefs = inject(Preferences);
  protected readonly i18n = inject(I18n);
  protected readonly sound = inject(SoundService);
  readonly #alerts = inject(AlertService);
  private readonly dialogEl = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly accents = ACCENTS;
  protected readonly sizes: FontScale[] = [FontScale.S, FontScale.M, FontScale.L, FontScale.Xl];
  protected readonly sizePx: Record<FontScale, number> = { s: 12, m: 14, l: 16, xl: 18 };
  protected readonly themes: { id: ThemeMode; label: Key; icon: string }[] = [
    { id: ThemeMode.System, label: 'themeSystem', icon: 'settings' },
    { id: ThemeMode.Light, label: 'themeLight', icon: 'sun' },
    { id: ThemeMode.Dark, label: 'themeDark', icon: 'dark' },
  ];
  protected readonly contrasts: { id: Contrast; label: Key }[] = [
    { id: Contrast.None, label: 'contrastNone' }, { id: Contrast.High, label: 'contrastHigh' },
    { id: Contrast.Yellow, label: 'contrastYellow' }, { id: Contrast.Grayscale, label: 'contrastGrayscale' },
  ];
  protected readonly motions: { id: Motion; label: Key }[] = [
    { id: Motion.System, label: 'motionSystem' }, { id: Motion.Reduce, label: 'motionReduce' }, { id: Motion.Full, label: 'motionFull' },
  ];
  protected readonly saturations: { id: Saturation; label: Key }[] = [
    { id: Saturation.Low, label: 'satLow' }, { id: Saturation.Normal, label: 'satNormal' }, { id: Saturation.High, label: 'satHigh' },
  ];
  protected readonly toggles: { key: BooleanKeys<A11y>; label: Key }[] = [
    { key: 'readingGuide', label: 'readingGuide' }, { key: 'speakFocus', label: 'speakFocus' },
    { key: 'readable', label: 'readable' }, { key: 'spacing', label: 'spacing' }, { key: 'bigCursor', label: 'bigCursor' },
    { key: 'strongFocus', label: 'strongFocus' }, { key: 'underlineLinks', label: 'underlineLinks' },
  ];
  protected readonly shortcuts: [string, string][] = [
    ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z', 'Redo'], ['Ctrl+F', 'Search'], ['Ctrl+C', 'Copy'], ['Ctrl+V', 'Paste'],
    ['Ctrl+D', 'Duplicate'], ['Ctrl+A', 'Select page'], ['Del', 'Delete'], ['←↑→↓', 'Nudge (Shift ×5)'],
    ['Tab', 'Next field'], ['Alt', 'Drag without snapping'], ['N', 'Next field (sign)'], ['P', 'Previous field (sign)'],
    ['Ctrl+=', 'Zoom in'], ['Ctrl+-', 'Zoom out'], ['Ctrl+0', 'Fit width'],
  ];

  constructor() {
    effect(() => {
      const open = this.state.settingsOpen();
      untracked(() => {
        const dialog = this.dialogEl().nativeElement;
        if (open && !dialog.open) {
          dialog.showModal();
          this.sound.play(Cue.Whoosh);
        } else if (!open && dialog.open) {
          dialog.close();
        }
      });
    });
  }

  protected setCustom(index: 0 | 1, color: string): void {
    const next = [...this.prefs.custom()] as [string, string];
    next[index] = color;
    this.prefs.custom.set(next);
    this.prefs.accent.set('custom');
  }

  protected resetA11y(): void {
    this.prefs.resetA11y();
    this.sound.play(Cue.Switch);
    this.state.notify(this.i18n.t('a11yWasReset'));
  }

  protected async resetAll(): Promise<void> {
    const { confirmed } = await this.#alerts.open({
      kind: AlertKind.Warning,
      title: this.i18n.t('resetAllTitle'),
      text: this.i18n.t('resetAllText'),
      confirmText: this.i18n.t('resetAll'),
    });
    if (confirmed) {
      this.prefs.resetAll();
      this.state.notify(this.i18n.t('allWasReset'));
    }
  }

  protected setTheme(theme: ThemeMode): void {
    this.prefs.theme.set(theme);
    this.sound.play(Cue.Switch);
  }

  protected set<K extends keyof A11y>(key: K, value: A11y[K]): void {
    this.prefs.setA11y(key, value);
    this.sound.play(Cue.Tick);
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
