import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, viewChild } from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import { boundsOf } from '../core/fields/geometry';
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { nextFrame, type Cancel } from '../core/utils/schedule.util';

/** Ruler thickness in px (kept in sync with $ruler in the stylesheet). */
const SIZE = 20;
/** pdf.js draws 1pt as 96/72 CSS px at 100%, so 1cm is 96/2.54 px times the zoom. */
const PX_PER_CM = 96 / 2.54;

interface Palette {
  bg: string;
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  line: string;
}

/**
 * Horizontal and vertical rulers in centimetres, measured from the current page's
 * top-left corner. They shade the page, the selection, and follow the pointer.
 */
@Component({
  selector: 'cs-rulers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rulers.component.html',
  styleUrl: './rulers.component.scss',
})
export class Rulers {
  /** The scrolling viewer container the rulers measure. */
  readonly container = input.required<HTMLElement>();

  readonly #engine = inject(PdfEngine);
  readonly #store = inject(FieldStore);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly topEl = viewChild.required<ElementRef<HTMLCanvasElement>>('top');
  private readonly sideEl = viewChild.required<ElementRef<HTMLCanvasElement>>('side');
  #pointer: { x: number; y: number } | null = null;
  #pending: Cancel | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Zoom, page change and selection all move what the rulers show.
    effect(() => {
      this.#engine.scale();
      this.#engine.currentPage();
      this.#store.selection();
      this.#request();
    });
    afterNextRender(() => {
      const container = this.container();
      const onScroll = () => this.#request();
      const onMove = (e: PointerEvent) => {
        this.#pointer = { x: e.clientX, y: e.clientY };
        this.#request();
      };
      const onLeave = () => {
        this.#pointer = null;
        this.#request();
      };
      container.addEventListener('scroll', onScroll, { passive: true });
      container.addEventListener('pointermove', onMove, { passive: true });
      container.addEventListener('pointerleave', onLeave);
      const resize = new ResizeObserver(onScroll);
      resize.observe(container);
      destroyRef.onDestroy(() => {
        container.removeEventListener('scroll', onScroll);
        container.removeEventListener('pointermove', onMove);
        container.removeEventListener('pointerleave', onLeave);
        resize.disconnect();
        this.#pending?.();
      });
    });
  }

  #request(): void {
    this.#pending ??= nextFrame(() => {
      this.#pending = null;
      this.#draw();
    });
  }

  #colors(): Palette {
    const css = getComputedStyle(this.#host);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return { bg: v('--panel'), paper: v('--surface'), ink: v('--ink'), muted: v('--muted'), accent: v('--accent'), line: v('--line') };
  }

  #draw(): void {
    const page = this.#engine.currentPage();
    const pageEl = this.#engine.pageElement(page);
    const top = this.topEl().nativeElement;
    const side = this.sideEl().nativeElement;
    if (!pageEl) {
      return;
    }
    const colors = this.#colors();
    const pr = pageEl.getBoundingClientRect();
    const tr = top.getBoundingClientRect();
    const sr = side.getBoundingClientRect();
    const cm = this.#engine.scale() * PX_PER_CM;
    const selected = this.#store.selected().filter(f => f.page === page);
    const box = selected.length ? boundsOf(selected) : null;

    this.#ruler(top, tr.width, colors, {
      origin: pr.left - tr.left, length: pr.width, cm,
      band: box ? [box.x * pr.width, (box.x + box.width) * pr.width] : null,
      pointer: this.#pointer ? this.#pointer.x - tr.left : null,
      vertical: false,
    });
    this.#ruler(side, sr.height, colors, {
      origin: pr.top - sr.top, length: pr.height, cm,
      band: box ? [box.y * pr.height, (box.y + box.height) * pr.height] : null,
      pointer: this.#pointer ? this.#pointer.y - sr.top : null,
      vertical: true,
    });
  }

  /**
   * Draws one ruler. Everything is computed along the ruler's length (`along`) and
   * across its thickness, then mapped to x/y for the horizontal or vertical one.
   */
  #ruler(
    canvas: HTMLCanvasElement, span: number, colors: Palette,
    o: { origin: number; length: number; cm: number; band: [number, number] | null; pointer: number | null; vertical: boolean },
  ): void {
    const dpr = devicePixelRatio || 1;
    const w = o.vertical ? SIZE : span;
    const h = o.vertical ? span : SIZE;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const rect = (along: number, size: number, from: number, depth: number) =>
      o.vertical ? g.fillRect(from, along, depth, size) : g.fillRect(along, from, size, depth);

    g.fillStyle = colors.bg;
    g.fillRect(0, 0, w, h);
    // The page.
    g.fillStyle = colors.paper;
    rect(o.origin, o.length, 0, SIZE);
    // The selection.
    if (o.band) {
      g.fillStyle = colors.accent;
      g.globalAlpha = 0.22;
      rect(o.origin + o.band[0], o.band[1] - o.band[0], 0, SIZE);
      g.globalAlpha = 1;
    }

    // Ticks: millimetres when there's room, otherwise half or whole centimetres.
    const mm = o.cm / 10;
    const step = mm >= 4 ? 1 : mm >= 2 ? 5 : 10;
    const labelEvery = o.cm >= 28 ? 1 : o.cm >= 14 ? 2 : 5;
    const first = Math.ceil(-o.origin / mm / step) * step;
    const last = Math.floor((span - o.origin) / mm);
    g.fillStyle = colors.muted;
    g.font = '600 9px system-ui, sans-serif';
    g.textBaseline = 'top';
    for (let i = first; i <= last; i += step) {
      const at = Math.round(o.origin + i * mm) + 0.5;
      const major = i % 10 === 0;
      const depth = major ? SIZE * 0.5 : i % 5 === 0 ? SIZE * 0.32 : SIZE * 0.18;
      rect(at, 1, SIZE - depth, depth);
      const n = i / 10;
      if (major && n % labelEvery === 0) {
        const text = String(n);
        if (o.vertical) {
          g.save();
          g.translate(2, at + 2);
          g.rotate(Math.PI / 2);
          g.translate(0, -9);
          g.fillText(text, 0, 0);
          g.restore();
        } else {
          g.fillText(text, at + 3, 2);
        }
      }
    }

    // Edge line between ruler and page area.
    g.fillStyle = colors.line;
    if (o.vertical) {
      g.fillRect(SIZE - 1, 0, 1, h);
    } else {
      g.fillRect(0, SIZE - 1, w, 1);
    }
    // Pointer marker.
    if (o.pointer !== null && o.pointer >= 0 && o.pointer <= span) {
      g.fillStyle = colors.accent;
      rect(Math.round(o.pointer), 1.5, 0, SIZE);
    }
  }
}
