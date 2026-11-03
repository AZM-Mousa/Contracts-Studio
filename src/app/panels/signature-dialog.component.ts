import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import { FieldType } from '../core/fields/field.model';
import { SavedKind, SavedSignatures } from '../core/fields/saved-signatures.service';
import { StudioState } from '../core/studio-state.service';
import { I18n } from '../core/ui/i18n';
import { SoundService } from '../core/ui/sound.service';
import { ColorPicker } from '../ui/color-picker.component';
import { Icon } from '../ui/icon.component';
import { nextFrame } from '../core/utils/schedule.util';
import { Cue } from '../core/enums/cue.enum';

type Tab = 'type' | 'draw' | 'upload';
type Point = { x: number; y: number; w: number };
type Stroke = { color: string; points: Point[] };

const INKS = ['#000000', '#0043EC', '#F04438'];
const MAX_UPLOAD = 1024 * 1024;
const LATIN_FONTS = ['Great Vibes', 'Dancing Script', 'Allura'];
const ARABIC_FONTS = ['Katibeh', 'Amiri', 'Aref Ruqaa'];

@Component({
  selector: 'cs-signature-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ColorPicker],
  templateUrl: './signature-dialog.component.html',
  styleUrl: './signature-dialog.component.scss',
})
export class SignatureDialog {
  protected readonly i18n = inject(I18n);
  readonly #state = inject(StudioState);
  readonly #store = inject(FieldStore);
  readonly #saved = inject(SavedSignatures);
  readonly #sound = inject(SoundService);
  private readonly dialogEl = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly padEl = viewChild<ElementRef<HTMLCanvasElement>>('pad');

  protected readonly inks = INKS;
  protected readonly tab = signal<Tab>('type');
  protected readonly ink = signal(INKS[0]);
  protected readonly customInk = signal('#7c3aed');
  protected readonly typed = signal('');
  protected readonly typedFont = signal(LATIN_FONTS[0]);
  protected readonly uploaded = signal<string | null>(null);
  protected readonly uploadError = signal(false);
  protected readonly strokes = signal<Stroke[]>([]);
  protected readonly undone = signal<Stroke[]>([]);
  protected readonly setDefault = signal(true);

  protected readonly field = computed(() => this.#store.fields().find(f => f.id === this.#state.drawingFieldId()) ?? null);
  protected readonly kind = computed<SavedKind | null>(() => {
    const t = this.field()?.type;
    return t === FieldType.Signature ? SavedKind.Signature : t === FieldType.Initials ? SavedKind.Initials : t === FieldType.Stamp ? SavedKind.Stamp : null;
  });
  protected readonly isInitials = computed(() => this.field()?.type === FieldType.Initials);
  protected readonly tabs = computed<Tab[]>(() =>
    this.field()?.type === FieldType.Image || this.field()?.type === FieldType.Stamp ? ['upload'] : ['type', 'draw', 'upload'],
  );
  protected readonly title = computed(() =>
    this.i18n.t(this.isInitials() ? 'fillInitials' : this.field()?.type === FieldType.Stamp ? 'addStamp' : this.field()?.type === FieldType.Image ? 'addImage' : 'fillSignature'),
  );
  protected readonly defaultLabel = computed(() =>
    this.i18n.t(this.isInitials() ? 'defaultInitials' : this.field()?.type === FieldType.Stamp ? 'defaultStamp' : 'defaultSignature'),
  );
  protected readonly saved = computed(() => {
    const f = this.field();
    const kind = this.kind();
    return f && kind ? this.#saved.get(f.signerId, kind) : null;
  });
  /** Arabic scripts when the text is Arabic, Latin scripts otherwise. */
  protected readonly fonts = computed(() => (/[؀-ۿ]/.test(this.typed()) ? ARABIC_FONTS : LATIN_FONTS));
  protected readonly sameCount = computed(() => {
    const f = this.field();
    if (!f) {
      return 0;
    }
    return this.#store.fields().filter(o => o.id === f.id || (f.groupId && o.groupId === f.groupId)
      || (f.forceApply && o.forceApply && o.type === f.type && o.signerId === f.signerId)).length;
  });
  protected readonly canApply = computed(() =>
    this.tab() === 'draw' ? this.strokes().length > 0 : this.tab() === 'type' ? this.typed().trim().length > 0 : !!this.uploaded(),
  );

  constructor() {
    effect(() => {
      const open = !!this.field();
      untracked(() => {
        const dialog = this.dialogEl().nativeElement;
        if (open && !dialog.open) {
          const f = this.field()!;
          const name = this.#store.signer(f.signerId)?.name ?? '';
          this.tab.set(this.tabs()[0]);
          this.strokes.set([]);
          this.undone.set([]);
          this.uploaded.set(null);
          this.uploadError.set(false);
          this.typed.set(this.isInitials() ? name.split(/\s+/).map(p => p[0] ?? '').join('').slice(0, 3).toUpperCase() : name);
          dialog.showModal();
        } else if (!open && dialog.open) {
          dialog.close();
        }
      });
    });
    // Keep the chosen font valid when switching between Arabic and Latin text.
    effect(() => {
      const fonts = this.fonts();
      if (!fonts.includes(untracked(this.typedFont))) {
        this.typedFont.set(fonts[0]);
      }
    });
    // Size the pad at the screen's pixel density, so strokes stay sharp.
    effect(() => {
      const pad = this.padEl()?.nativeElement;
      if (pad && this.tab() === 'draw') {
        nextFrame(() => this.#sizePad(pad));
      }
    });
  }

  protected tabLabel(t: Tab): string {
    return this.i18n.t(t === 'type' ? 'select' : t === 'draw' ? 'draw' : 'upload');
  }

  protected close(): void {
    this.#state.drawingFieldId.set(null);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected quote(font: string): string {
    return `'${font}', cursive`;
  }

  protected readonly inkSwatches = ['#000000', '#1f2937', '#0043ec', '#1d4ed8', '#0f766e', '#006c35', '#7c3aed', '#f04438', '#b45309', '#9d174d'];

  protected setCustomInk(color: string): void {
    this.customInk.set(color);
    this.ink.set(color);
  }

  protected useSaved(dataUrl: string): void {
    this.#fill(dataUrl);
  }

  protected undo(): void {
    const list = this.strokes();
    if (list.length) {
      this.undone.set([...this.undone(), list[list.length - 1]]);
      this.strokes.set(list.slice(0, -1));
      this.#redraw();
    }
  }

  protected redo(): void {
    const list = this.undone();
    if (list.length) {
      this.strokes.set([...this.strokes(), list[list.length - 1]]);
      this.undone.set(list.slice(0, -1));
      this.#redraw();
    }
  }

  protected clear(): void {
    this.strokes.set([]);
    this.undone.set([]);
    this.#redraw();
  }

  /** Smooth strokes: width from speed and pressure, curves through midpoints. */
  protected down(event: PointerEvent): void {
    const pad = event.currentTarget as HTMLCanvasElement;
    const rect = pad.getBoundingClientRect();
    pad.setPointerCapture(event.pointerId);
    const stroke: Stroke = { color: this.ink(), points: [] };
    let last = { x: event.clientX - rect.left, y: event.clientY - rect.top, t: event.timeStamp };
    let width = 2.4;
    stroke.points.push({ x: last.x, y: last.y, w: width });
    this.strokes.set([...this.strokes(), stroke]);
    this.undone.set([]);
    const move = (e: PointerEvent) => {
      for (const ev of e.getCoalescedEvents?.() ?? [e]) {
        const p = { x: ev.clientX - rect.left, y: ev.clientY - rect.top, t: ev.timeStamp };
        const speed = Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, p.t - last.t);
        width = width * 0.7 + Math.max(1.1, Math.min(3.6, 3.4 - speed * 1.4)) * (0.6 + (ev.pressure || 0.5) * 0.8) * 0.3;
        stroke.points.push({ x: p.x, y: p.y, w: width });
        last = p;
      }
      this.#drawStroke(pad.getContext('2d')!, stroke, Math.max(1, stroke.points.length - 6));
    };
    const up = () => {
      pad.removeEventListener('pointermove', move);
      pad.removeEventListener('pointerup', up);
      pad.removeEventListener('pointercancel', up);
      this.strokes.set([...this.strokes()]);
    };
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
  }

  protected onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.uploadError.set(false);
    if (!file) {
      return;
    }
    if (file.size > MAX_UPLOAD) {
      this.uploadError.set(true);
      this.#sound.play(Cue.Error);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Keep stored images small: max 900 px on the long side.
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        this.uploaded.set(canvas.toDataURL('image/png'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  protected async apply(): Promise<void> {
    let data: string | null = null;
    if (this.tab() === 'draw') {
      data = trim(this.padEl()!.nativeElement);
    } else if (this.tab() === 'type') {
      await document.fonts.load(`64px '${this.typedFont()}'`).catch(() => []);
      data = renderTyped(this.typed(), this.ink(), this.typedFont());
    } else {
      data = this.uploaded();
    }
    if (data) {
      this.#fill(data);
    }
  }

  #fill(data: string): void {
    const f = this.field();
    if (!f) {
      return;
    }
    const kind = this.kind();
    if (kind && this.setDefault()) {
      this.#saved.set(f.signerId, kind, data);
    }
    const count = this.#store.setValue(f.id, data);
    this.#sound.play(Cue.Success);
    if (count > 1) {
      this.#state.notify(this.i18n.t('filledCount', { n: count }));
    }
    this.close();
  }

  #sizePad(pad: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = pad.getBoundingClientRect();
    pad.width = Math.round(rect.width * dpr);
    pad.height = Math.round(rect.height * dpr);
    pad.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#redraw();
  }

  #redraw(): void {
    const pad = this.padEl()?.nativeElement;
    if (!pad) {
      return;
    }
    const ctx = pad.getContext('2d')!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.restore();
    for (const stroke of this.strokes()) {
      this.#drawStroke(ctx, stroke, 1);
    }
  }

  #drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, from: number): void {
    const pts = stroke.points;
    ctx.strokeStyle = ctx.fillStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = Math.max(1, from); i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const prev = pts[i - 2] ?? a;
      ctx.lineWidth = b.w;
      ctx.beginPath();
      ctx.moveTo((prev.x + a.x) / 2, (prev.y + a.y) / 2);
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.stroke();
    }
  }
}

/** Crops a canvas to its ink, with a little padding. */
function trim(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  const pad = 8;
  const out = document.createElement('canvas');
  out.width = maxX - minX + pad * 2;
  out.height = maxY - minY + pad * 2;
  out.getContext('2d')!.drawImage(canvas, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function renderTyped(text: string, ink: string, font: string): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const css = `96px '${font}', cursive`;
  ctx.font = css;
  const rtl = /[؀-ۿ]/.test(text);
  canvas.width = Math.ceil(ctx.measureText(text).width) + 48;
  canvas.height = 160;
  ctx.font = css;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillText(text, rtl ? canvas.width - 24 : 24, 84);
  return canvas.toDataURL('image/png');
}
