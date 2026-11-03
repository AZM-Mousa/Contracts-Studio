import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import type { Field, Rect } from '../core/fields/field.model';
import { boundsOf, clamp, findFreeSpot, limitResize, overlaps, overlapsAny, snap, type Guide } from '../core/fields/geometry';
import { StudioState } from '../core/studio-state.service';
import { SoundService } from '../core/ui/sound.service';
import { FieldView, type Handle } from './field-view.component';
import { Cue } from '../core/enums/cue.enum';
import { GuideAxis } from '../core/enums/guide-axis.enum';
import { scheduleAfter, type Cancel } from '../core/utils/schedule.util';

const DRAG_THRESHOLD_PX = 3;
/** Touch: hold this long on a field to pick it up; a quicker swipe scrolls the page. */
const HOLD_MS = 260;
const HOLD_SLOP_PX = 8;
const SNAP_PX = 6;
const MIN_PX = 12;

interface Preview {
  ids: ReadonlySet<string>;
  dx: number;
  dy: number;
  /** Set while resizing one field. */
  rect?: Rect;
  /** No free spot under the pointer: the drop will be undone. */
  blocked?: boolean;
}

/**
 * The fields of one page, mounted inside pdf.js's page element while the page
 * is near the screen. Geometry is in page fractions, so zoom is free.
 */
@Component({
  selector: 'cs-page-layer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FieldView],
  host: {
    class: 'cs-page-layer',
    '[class.is-editing]': 'state.editing()',
    '[class.show-grid]': 'state.grid() && state.editing()',
    '[class.is-painting]': '!!state.painterSource()',
    '(pointerdown)': 'onPointerDown($event)',
    '(contextmenu)': 'onContextMenu($event)',
  },
  templateUrl: './page-layer.component.html',
  styleUrl: './page-layer.component.scss',
})
export class PageLayer {
  readonly page = input.required<number>();

  protected readonly state = inject(StudioState);
  readonly #store = inject(FieldStore);
  readonly #sound = inject(SoundService);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly fields = computed(() => this.#store.byPage().get(this.page()) ?? []);
  /** Hidden signers' fields still block placement; they just aren't drawn. */
  protected readonly visible = computed(() => {
    const hidden = this.state.hiddenSigners();
    return hidden.size ? this.fields().filter(f => !hidden.has(f.signerId)) : this.fields();
  });
  protected readonly selection = this.#store.selection;
  protected readonly preview = signal<Preview | null>(null);
  protected readonly guides = signal<Guide[]>([]);
  protected readonly marquee = signal<Rect | null>(null);
  /** True while a field picked up by touch is being dragged (the page must not scroll then). */
  #touchDragging = false;

  constructor() {
    // Not passive, so a held field can stop the page from scrolling under the finger.
    const stopScroll = (e: TouchEvent) => this.#touchDragging && e.cancelable && e.preventDefault();
    this.#host.addEventListener('touchmove', stopScroll, { passive: false });
    inject(DestroyRef).onDestroy(() => this.#host.removeEventListener('touchmove', stopScroll));
  }

  protected geometry(field: Field): Rect {
    const p = this.preview();
    if (!p?.ids.has(field.id)) {
      return field;
    }
    return p.rect ?? { ...field, x: field.x + p.dx, y: field.y + p.dy };
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.state.editing()) {
      return;
    }
    const target = event.target as HTMLElement;
    const fieldEl = target.closest<HTMLElement>('cs-field');
    const painter = this.state.painterSource();
    if (painter) {
      // Format painter: each click pastes the format; a click on an empty spot ends it.
      event.preventDefault();
      if (fieldEl) {
        this.#store.copyFormat(painter, [fieldEl.dataset['fieldId']!]);
        this.#sound.play(Cue.Snap);
      } else {
        this.state.painterSource.set(null);
      }
      return;
    }
    if (fieldEl) {
      const id = fieldEl.dataset['fieldId']!;
      const handle = target.dataset['handle'] as Handle | undefined;
      if (event.pointerType === 'touch' && !handle) {
        this.#holdToDrag(event, id, fieldEl);
        return;
      }
      event.preventDefault();
      if (handle) {
        this.#resize(event, id, handle);
      } else {
        this.#move(event, id);
      }
      fieldEl.focus({ preventScroll: true });
    } else if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      // On touch, an empty area scrolls the document instead.
      this.#select(event);
    }
  }

  /** Right-click: a field joins (or becomes) the selection; an empty spot clears it. */
  protected onContextMenu(event: MouseEvent): void {
    if (!this.state.editing()) {
      return;
    }
    event.preventDefault();
    const id = (event.target as HTMLElement).closest<HTMLElement>('cs-field')?.dataset['fieldId'];
    if (!id) {
      this.#store.select([]);
    } else if (!this.#store.selection().has(id)) {
      this.#store.select([id]);
    }
    const r = this.#pageSize();
    this.state.contextMenu.set({
      x: event.clientX, y: event.clientY, page: this.page(),
      px: (event.clientX - r.left) / r.width, py: (event.clientY - r.top) / r.height,
    });
  }

  #pageSize() {
    const r = this.#host.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  /**
   * Touch on a field: a quick swipe scrolls the page like paper, a tap selects the
   * field, and press-and-hold picks it up to drag.
   */
  #holdToDrag(down: PointerEvent, id: string, fieldEl: HTMLElement): void {
    const origin = { x: down.clientX, y: down.clientY };
    let timer: Cancel | null = null;
    const stop = () => {
      timer?.();
      timer = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === down.pointerId && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > HOLD_SLOP_PX) {
        stop();
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) {
        return;
      }
      const tapped = !!timer && e.type === 'pointerup';
      stop();
      if (tapped) {
        this.#store.select([id]);
        fieldEl.focus({ preventScroll: true });
      }
    };
    timer = scheduleAfter(HOLD_MS, () => {
      stop();
      this.#touchDragging = true;
      navigator.vibrate?.(8);
      fieldEl.focus({ preventScroll: true });
      const release = () => {
        this.#touchDragging = false;
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      this.#move(down, id);
    });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  #move(event: PointerEvent, id: string): void {
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (additive) {
      this.#store.toggleSelect(id);
      return;
    }
    if (!this.#store.selection().has(id)) {
      this.#store.select([id]);
    }
    const moving = this.fields().filter(f => this.#store.selection().has(f.id) && !f.readOnly && !f.locked);
    if (!moving.length) {
      return;
    }
    const ids = new Set(moving.map(f => f.id));
    const others = this.fields().filter(f => !ids.has(f.id));
    const start = boundsOf(moving);
    const page = this.#pageSize();
    const origin = { x: event.clientX, y: event.clientY };
    // Where the pointer grabbed the group, so a drop on another page keeps that offset.
    const grab = { x: (origin.x - page.left) / page.width - start.x, y: (origin.y - page.top) / page.height - start.y };
    let started = false;
    let lastGuides = 0;
    let target: HTMLElement | null = null;

    this.#track(event, move => {
      const px = move.clientX - origin.x;
      const py = move.clientY - origin.y;
      if (!started && Math.hypot(px, py) < DRAG_THRESHOLD_PX) {
        return;
      }
      started = true;
      target = this.#otherPageAt(move.clientX, move.clientY);
      this.#markTarget(target);
      if (target) {
        // Over another page: follow the pointer freely, no snapping or clamping.
        this.guides.set([]);
        this.preview.set({ ids, dx: px / page.width, dy: py / page.height });
        return;
      }
      let x = clamp(start.x + px / page.width, 0, 1 - start.width);
      let y = clamp(start.y + py / page.height, 0, 1 - start.height);
      let guides: Guide[] = [];
      if (this.state.snapping() && !move.altKey) {
        const snapped = snap({ ...start, x, y }, others, SNAP_PX / page.width, SNAP_PX / page.height);
        x = clamp(snapped.x, 0, 1 - start.width);
        y = clamp(snapped.y, 0, 1 - start.height);
        guides = snapped.guides;
      }
      if (guides.length > lastGuides) {
        this.#sound.play(Cue.Snap);
      }
      lastGuides = guides.length;
      this.guides.set(guides);
      // Show where it will really land: the nearest spot that doesn't cover another field.
      const spot = findFreeSpot({ ...start, x, y }, others);
      if (spot) {
        x = spot.x;
        y = spot.y;
      }
      this.preview.set({ ids, dx: x - start.x, dy: y - start.y, blocked: !spot });
    }, last => {
      const p = this.preview();
      this.preview.set(null);
      this.guides.set([]);
      this.#markTarget(null);
      if (started && target && last) {
        const rect = target.getBoundingClientRect();
        const toPage = Number(target.dataset['pageNumber']);
        const x = clamp((last.clientX - rect.left) / rect.width - grab.x, 0, 1 - start.width);
        const y = clamp((last.clientY - rect.top) / rect.height - grab.y, 0, 1 - start.height);
        this.#store.update(ids, f => ({ page: toPage, x: x + (f.x - start.x), y: y + (f.y - start.y) }), true);
        this.#sound.play(Cue.Drop);
        return;
      }
      if (started && p && p.blocked) {
        this.#sound.play(Cue.Error);
      } else if (started && p && (p.dx || p.dy)) {
        this.#store.update(ids, f => ({ x: f.x + p.dx, y: f.y + p.dy }), true);
        this.#sound.play(Cue.Drop);
      }
    });
  }

  #resize(event: PointerEvent, id: string, handle: Handle): void {
    const field = this.fields().find(f => f.id === id);
    if (!field || field.readOnly || field.fixedSize) {
      return;
    }
    const page = this.#pageSize();
    const origin = { x: event.clientX, y: event.clientY };
    const minW = MIN_PX / page.width;
    const minH = MIN_PX / page.height;
    const others = this.fields().filter(f => f.id !== id);
    const edges = { n: handle.includes('n'), s: handle.includes('s'), e: handle.includes('e'), w: handle.includes('w') };
    let valid: Rect = field;

    this.#track(event, move => {
      const dx = (move.clientX - origin.x) / page.width;
      const dy = (move.clientY - origin.y) / page.height;
      let { x, y, width, height } = field;
      if (handle.includes('e')) {
        width = clamp(field.width + dx, minW, 1 - field.x);
      }
      if (handle.includes('s')) {
        height = clamp(field.height + dy, minH, 1 - field.y);
      }
      if (handle.includes('w')) {
        x = clamp(field.x + dx, 0, field.x + field.width - minW);
        width = field.x + field.width - x;
      }
      if (handle.includes('n')) {
        y = clamp(field.y + dy, 0, field.y + field.height - minH);
        height = field.y + field.height - y;
      }
      // Never grow over another field: edges stop at the neighbour; anything still overlapping keeps the last good size.
      let rect = limitResize({ x, y, width, height }, field, others, edges);
      if (rect.width < minW || rect.height < minH || overlapsAny(rect, others)) {
        rect = valid;
      } else {
        valid = rect;
      }
      this.guides.set(this.state.snapping() ? edgeGuides(rect, others, SNAP_PX / page.width, SNAP_PX / page.height) : []);
      this.preview.set({ ids: new Set([id]), dx: 0, dy: 0, rect });
    }, () => {
      const rect = this.preview()?.rect;
      this.preview.set(null);
      this.guides.set([]);
      if (rect) {
        this.#store.update([id], () => rect);
        this.#sound.play(Cue.Drop);
      }
    });
  }

  #select(event: PointerEvent): void {
    const page = this.#pageSize();
    const ax = (event.clientX - page.left) / page.width;
    const ay = (event.clientY - page.top) / page.height;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const initial = additive ? new Set(this.#store.selection()) : new Set<string>();
    let started = false;

    this.#track(event, move => {
      const bx = clamp((move.clientX - page.left) / page.width, 0, 1);
      const by = clamp((move.clientY - page.top) / page.height, 0, 1);
      if (!started && Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) < DRAG_THRESHOLD_PX) {
        return;
      }
      started = true;
      const rect = { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
      this.marquee.set(rect);
      const hit = this.fields().filter(f => overlaps(f, rect)).map(f => f.id);
      this.#store.select([...initial, ...hit]);
    }, () => {
      this.marquee.set(null);
      if (!started && !additive) {
        this.#store.select([]);
      }
    });
  }

  /** The page element under the pointer, if it isn't this layer's page. */
  #otherPageAt(x: number, y: number): HTMLElement | null {
    const own = this.#host.parentElement;
    const hits = document.elementsFromPoint(x, y);
    const page = hits.map(el => el.closest<HTMLElement>('.page')).find(Boolean) ?? null;
    return page && page !== own ? page : null;
  }

  #markTarget(page: HTMLElement | null): void {
    document.querySelectorAll('.page.is-drop-target').forEach(p => p !== page && p.classList.remove('is-drop-target'));
    page?.classList.add('is-drop-target');
  }

  /** Pointer capture on the layer, so moves keep coming outside the page. */
  #track(event: PointerEvent, onMove: (e: PointerEvent) => void, onEnd: (last: PointerEvent | null) => void): void {
    const el = this.#host;
    el.setPointerCapture(event.pointerId);
    let frame = 0;
    let last: PointerEvent | null = null;
    const move = (e: PointerEvent) => {
      last = e;
      // One update per frame, however fast the pointer moves.
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (last) {
          onMove(last);
        }
      });
    };
    const end = () => {
      cancelAnimationFrame(frame);
      if (last) {
        onMove(last);
      }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      onEnd(last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}

/** Guides for edges of a resized rect that line up with other fields. */
function edgeGuides(rect: Rect, others: readonly Rect[], tx: number, ty: number): Guide[] {
  const guides: Guide[] = [];
  const near = (a: number, b: number, t: number) => Math.abs(a - b) <= t;
  for (const o of others) {
    for (const v of [o.x, o.x + o.width]) {
      if (near(rect.x, v, tx) || near(rect.x + rect.width, v, tx)) {
        guides.push({ axis: GuideAxis.V, pos: v });
      }
    }
    for (const h of [o.y, o.y + o.height]) {
      if (near(rect.y, h, ty) || near(rect.y + rect.height, h, ty)) {
        guides.push({ axis: GuideAxis.H, pos: h });
      }
    }
  }
  return guides.slice(0, 4);
}
