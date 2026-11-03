import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, signal } from '@angular/core';
import { StorageKey } from '../core/enums/storage-key.enum';
import { LocalStorageService } from '../core/storage/local-storage.service';
import { Icon } from './icon.component';
import { opensUp } from './popover';

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const DEFAULT_SWATCHES = ['#111827', '#ffffff', '#4f46e5', '#0369a1', '#0d9488', '#006c35', '#c8a13a', '#e11d48', '#f59e0b', '#7c3aed'];
let nextId = 0;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
}

function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map(n => n / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

/** WCAG contrast ratio between a colour and white. */
function contrastWithWhite(hex: string): number {
  const lum = hexToRgb(hex).map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return 1.05 / (l + 0.05);
}

/**
 * Custom colour picker: saturation/brightness area, hue slider, hex entry,
 * presets, recent colours and the eyedropper. Keyboard: arrows on the area and slider.
 */
@Component({
  selector: 'cs-color-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(focusout)': 'onFocusOut($event)', '[class.open]': 'open()', '[class.up]': 'up()' },
  templateUrl: './color-picker.component.html',
  styleUrl: './color-picker.component.scss',
})
export class ColorPicker {
  readonly value = model('#4f46e5');
  readonly label = input('Colour');
  readonly swatches = input<readonly string[]>(DEFAULT_SWATCHES);

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly id = `cs-color-${++nextId}`;
  protected readonly open = signal(false);
  protected readonly up = signal(false);
  protected readonly hsv = signal<Hsv>({ h: 0, s: 0, v: 0 });
  readonly #storage = inject(LocalStorageService);
  protected readonly recent = signal<string[]>(this.#storage.getJson<string[]>(StorageKey.RecentColors, []));
  protected readonly eyedropper = 'EyeDropper' in window;
  protected readonly hueColor = computed(() => hsvToHex({ h: this.hsv().h, s: 1, v: 1 }));
  protected readonly contrast = computed(() => contrastWithWhite(this.value() || '#000000'));
  protected readonly allSwatches = computed(() => [...new Set(this.swatches())]);

  protected pct(n: number): number {
    return Math.round(n * 100);
  }

  protected round(n: number): number {
    return Math.round(n);
  }

  protected toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    this.hsv.set(hexToHsv(this.value() || '#4f46e5'));
    this.up.set(opensUp(this.#host, 360));
    this.open.set(true);
  }

  protected close(event?: Event): void {
    event?.stopPropagation();
    this.#commit();
    this.open.set(false);
    this.#host.querySelector<HTMLElement>('.trigger')?.focus();
  }

  protected onFocusOut(event: FocusEvent): void {
    if (this.open() && !this.#host.contains(event.relatedTarget as Node)) {
      this.#commit();
      this.open.set(false);
    }
  }

  protected pick(hex: string): void {
    this.hsv.set(hexToHsv(hex));
    this.value.set(hex);
    this.#commit();
  }

  protected typeHex(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim().replace('#', '');
    if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) {
      const hex = '#' + (raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw).toLowerCase();
      this.pick(hex);
    } else {
      (event.target as HTMLInputElement).value = this.value().replace('#', '');
    }
  }

  protected async pickFromScreen(): Promise<void> {
    try {
      const dropper = new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper();
      const { sRGBHex } = await dropper.open();
      this.pick(sRGBHex.length === 7 ? sRGBHex : rgbToHex(...(sRGBHex.match(/\d+/g)!.map(Number) as [number, number, number])));
    } catch {
      // Cancelled.
    }
  }

  protected dragArea(event: PointerEvent, area: HTMLElement): void {
    this.#drag(event, area, (x, y) => this.#set({ ...this.hsv(), s: x, v: 1 - y }));
  }

  protected dragHue(event: PointerEvent, hue: HTMLElement): void {
    this.#drag(event, hue, x => this.#set({ ...this.hsv(), h: x * 360 }));
  }

  protected areaKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 0.1 : 0.02;
    const { s, v } = this.hsv();
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[event.key];
    if (m) {
      event.preventDefault();
      this.#set({ ...this.hsv(), s: clamp01(s + m[0]), v: clamp01(v + m[1]) });
    }
  }

  protected hueKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 15 : 3;
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0;
    if (delta) {
      event.preventDefault();
      this.#set({ ...this.hsv(), h: (this.hsv().h + delta + 360) % 360 });
    }
  }

  #set(hsv: Hsv): void {
    this.hsv.set(hsv);
    this.value.set(hsvToHex(hsv));
  }

  #drag(event: PointerEvent, el: HTMLElement, apply: (x: number, y: number) => void): void {
    event.preventDefault();
    el.focus();
    el.setPointerCapture(event.pointerId);
    const update = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      apply(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
    };
    update(event);
    const up = () => {
      el.removeEventListener('pointermove', update);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      this.#commit();
    };
    el.addEventListener('pointermove', update);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** Remembers the colour in the recent list. */
  #commit(): void {
    const value = this.value();
    if (!value) {
      return;
    }
    const next = [value, ...this.recent().filter(c => c !== value)].slice(0, 8);
    this.recent.set(next);
    this.#storage.setJson(StorageKey.RecentColors, next);
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
