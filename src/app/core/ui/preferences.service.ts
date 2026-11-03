import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Service, signal } from '@angular/core';
import { StorageKey } from '../enums/storage-key.enum';
import { LocalStorageService } from '../storage/local-storage.service';
import { runTransition, trackTransitionOrigin } from './view-transition';
import { ThemeMode } from '../enums/theme-mode.enum';
import { Contrast } from '../enums/contrast.enum';
import { Motion } from '../enums/motion.enum';
import { FontScale } from '../enums/font-scale.enum';
import { Lang } from '../enums/lang.enum';
import { TransitionKind } from '../enums/transition-kind.enum';
import { Saturation } from '../enums/saturation.enum';

export { ThemeMode };
export { Contrast };
export { Motion };
export { FontScale };
export { Lang };

export interface A11y {
  contrast: Contrast;
  motion: Motion;
  fontScale: FontScale;
  readable: boolean;
  spacing: boolean;
  bigCursor: boolean;
  strongFocus: boolean;
  underlineLinks: boolean;
  readingGuide: boolean;
  speakFocus: boolean;
  saturation: Saturation;
}

/** Two-colour themes: a main accent and a second one used in gradients and highlights. */
export const ACCENTS = [
  { id: 'indigo', hex: '#4f46e5', hex2: '#ec4899' },
  { id: 'saudi', hex: '#006c35', hex2: '#c8a13a' },
  { id: 'ocean', hex: '#0369a1', hex2: '#f97316' },
  { id: 'teal', hex: '#0d9488', hex2: '#f59e0b' },
  { id: 'violet', hex: '#7c3aed', hex2: '#06b6d4' },
  { id: 'rose', hex: '#e11d48', hex2: '#f59e0b' },
  { id: 'emerald', hex: '#047857', hex2: '#84cc16' },
  { id: 'slate', hex: '#334155', hex2: '#0ea5e9' },
] as const;
export type AccentId = (typeof ACCENTS)[number]['id'] | 'custom';

/** Black or white, whichever has more contrast on the colour (WCAG relative luminance). */
export function onColor(hex: string): string {
  const [r, g, b] = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? '#ffffff' : '#0b0f19';
}

const FONT_SCALES: Record<FontScale, number> = { s: 0.92, m: 1, l: 1.12, xl: 1.25 };

export const DEFAULT_A11Y: A11y = {
  contrast: Contrast.None, motion: Motion.System, fontScale: FontScale.M, readable: false,
  spacing: false, bigCursor: false, strongFocus: false, underlineLinks: false,
  readingGuide: false, speakFocus: false, saturation: Saturation.Normal,
};

interface Stored {
  theme: ThemeMode;
  accent: AccentId;
  custom: [string, string];
  a11y: A11y;
  lang: Lang;
}

@Service()
export class Preferences {
  readonly #doc = inject(DOCUMENT);
  readonly #storage = inject(LocalStorageService);
  readonly #stored = this.#storage.getJson<Partial<Stored>>(StorageKey.Preferences, {});
  readonly #systemDark = signal(matchMedia('(prefers-color-scheme: dark)').matches);

  readonly theme = signal<ThemeMode>(this.#stored.theme ?? ThemeMode.System);
  readonly accent = signal<AccentId>(this.#stored.accent ?? 'indigo');
  readonly custom = signal<[string, string]>(this.#stored.custom ?? ['#4f46e5', '#ec4899']);
  readonly colors = computed<[string, string]>(() => {
    if (this.accent() === 'custom') {
      return this.custom();
    }
    const preset = ACCENTS.find(a => a.id === this.accent()) ?? ACCENTS[0];
    return [preset.hex, preset.hex2];
  });
  readonly a11y = signal<A11y>({ ...DEFAULT_A11Y, ...this.#stored.a11y });
  readonly lang = signal<Lang>(this.#stored.lang ?? (navigator.language.startsWith(Lang.Ar) ? Lang.Ar : Lang.En));

  readonly resolvedTheme = computed(() => (this.theme() === 'system' ? (this.#systemDark() ? 'dark' : 'light') : this.theme()));
  readonly dir = computed(() => (this.lang() === 'ar' ? 'rtl' : 'ltr'));
  readonly hasA11y = computed(() => JSON.stringify(this.a11y()) !== JSON.stringify(DEFAULT_A11Y));

  constructor() {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => this.#systemDark.set(e.matches));
    this.#doc.addEventListener('focusin', this.#speakOnFocus);
    this.#doc.addEventListener('pointermove', this.#moveGuide, { passive: true });
    const root = this.#doc.documentElement;
    trackTransitionOrigin(this.#doc);
    let painted = false;
    effect(() => {
      const theme = this.resolvedTheme();
      const [a, b] = this.colors();
      const apply = () => {
        root.dataset['theme'] = theme;
        root.style.setProperty('--accent', a);
        root.style.setProperty('--accent-2', b);
        root.style.setProperty('--on-accent', onColor(a));
      };
      if (!painted) {
        apply();
        painted = true;
      } else if (root.dataset['theme'] !== theme) {
        // Light <-> dark: a circle of the new theme grows from where you clicked.
        runTransition(this.#doc, apply, TransitionKind.Reveal, theme);
      } else {
        runTransition(this.#doc, apply, TransitionKind.Fade);
      }
    });
    effect(() => {
      const a = this.a11y();
      root.dataset['contrast'] = a.contrast;
      root.dataset['motion'] = a.motion;
      root.style.setProperty('--font-scale', String(FONT_SCALES[a.fontScale]));
      root.classList.toggle('a11y-readable', a.readable);
      root.classList.toggle('a11y-spacing', a.spacing);
      root.classList.toggle('a11y-cursor', a.bigCursor);
      root.classList.toggle('a11y-focus', a.strongFocus);
      root.classList.toggle('a11y-links', a.underlineLinks);
      root.classList.toggle('a11y-guide', a.readingGuide);
      root.dataset['saturation'] = a.saturation;
    });
    effect(() => {
      root.lang = this.lang();
      root.dir = this.dir();
    });
    effect(() => {
      const stored: Stored = { theme: this.theme(), accent: this.accent(), custom: this.custom(), a11y: this.a11y(), lang: this.lang() };
      this.#storage.setJson(StorageKey.Preferences, stored);
    });
  }

  /** Reads out what gets focus (names, labels), in the interface language. */
  #speakOnFocus = (event: FocusEvent) => {
    if (!this.a11y().speakFocus || !('speechSynthesis' in window)) {
      return;
    }
    const el = event.target as HTMLElement;
    const text = el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLInputElement).placeholder
      || el.closest('label')?.textContent || el.textContent;
    if (text?.trim()) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text.trim().slice(0, 160));
      utterance.lang = this.lang() === 'ar' ? 'ar-SA' : 'en-US';
      speechSynthesis.speak(utterance);
    }
  };

  /** Moves the reading guide band with the pointer. */
  #moveGuide = (event: PointerEvent) => {
    if (this.a11y().readingGuide) {
      this.#doc.documentElement.style.setProperty('--guide-y', `${event.clientY}px`);
    }
  };

  setA11y<K extends keyof A11y>(key: K, value: A11y[K]): void {
    this.a11y.update(a => ({ ...a, [key]: value }));
  }

  resetA11y(): void {
    this.a11y.set(DEFAULT_A11Y);
  }

  /** Theme, colours and accessibility back to defaults; the language stays. */
  resetAll(): void {
    this.theme.set(ThemeMode.System);
    this.accent.set('indigo');
    this.custom.set(['#4f46e5', '#ec4899']);
    this.a11y.set(DEFAULT_A11Y);
  }
}
