import {
  afterNextRender, ApplicationRef, ChangeDetectionStrategy, Component, type ComponentRef, createComponent, DestroyRef,
  computed, ElementRef, EnvironmentInjector, inject, output, signal, viewChild,
} from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import { MAX_SCALE, MIN_SCALE, PdfEngine } from '../core/pdf/pdf-engine.service';
import { StudioState } from '../core/studio-state.service';
import { I18n } from '../core/ui/i18n';
import { SoundService } from '../core/ui/sound.service';
import { Icon } from '../ui/icon.component';
import { Loader } from '../ui/loader.component';
import { HeroScene } from '../ui/hero-scene.component';
import { FieldNavigator } from './field-navigator.service';
import { PageLayer } from './page-layer.component';
import { Rulers } from './rulers.component';
import { Cue } from '../core/enums/cue.enum';

const NUDGE = 0.002;
const NUDGE_FAST = 0.01;

@Component({
  selector: 'cs-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Loader, HeroScene, Rulers],
  host: {
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'dropping.set(false)',
    '(drop)': 'onDrop($event)',
    '[class.with-rulers]': 'showRulers()',
  },
  templateUrl: './viewer.component.html',
  styleUrl: './viewer.component.scss',
})
export class Viewer {
  readonly fileDropped = output<File>();
  readonly deleteRequested = output<void>();

  protected readonly engine = inject(PdfEngine);
  protected readonly i18n = inject(I18n);
  protected readonly dropping = signal(false);
  protected readonly showRulers = computed(() => this.engine.ready() && this.#state.editing() && this.#state.rulers());
  readonly #store = inject(FieldStore);
  readonly #state = inject(StudioState);
  readonly #sound = inject(SoundService);
  readonly #nav = inject(FieldNavigator);
  readonly #appRef = inject(ApplicationRef);
  readonly #injector = inject(EnvironmentInjector);
  private readonly containerEl = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly viewerEl = viewChild.required<ElementRef<HTMLDivElement>>('viewer');
  readonly #layers = new Map<number, ComponentRef<PageLayer>>();
  #observer?: IntersectionObserver;

  constructor() {
    afterNextRender(async () => {
      const container = this.containerEl().nativeElement;
      await this.engine.attach(container, this.viewerEl().nativeElement);
      this.#observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset['pageNumber']);
          if (entry.isIntersecting) {
            this.#mount(page, entry.target as HTMLElement);
          } else {
            this.#unmount(page);
          }
        }
        this.#countMounted();
      }, { root: container, rootMargin: '150% 0px' });

      this.engine.eventBus.on('pagesinit', () => {
        this.#unmountAll();
        for (let i = 1; i <= this.engine.pagesCount(); i++) {
          const div = this.engine.pageElement(i);
          if (div) {
            this.#observer!.observe(div);
          }
        }
      });
      // pdf.js clears a page element's children when it resets the page; put the layer back.
      const reattach = ({ pageNumber }: { pageNumber: number }) => {
        const ref = this.#layers.get(pageNumber);
        const div = this.engine.pageElement(pageNumber);
        if (ref && div && ref.location.nativeElement.parentElement !== div) {
          div.append(ref.location.nativeElement);
        }
      };
      this.engine.eventBus.on('pagerender', reattach);
      this.engine.eventBus.on('pagerendered', reattach);
      this.#pinchZoom(container);
    });
    inject(DestroyRef).onDestroy(() => {
      this.#observer?.disconnect();
      this.#unmountAll();
      this.engine.destroy();
    });
  }

  focus(): void {
    this.containerEl().nativeElement.focus({ preventScroll: true });
  }

  #mount(page: number, div: HTMLElement): void {
    if (this.#layers.has(page)) {
      return;
    }
    const host = document.createElement('cs-page-layer');
    div.append(host);
    const ref = createComponent(PageLayer, { environmentInjector: this.#injector, hostElement: host });
    ref.setInput('page', page);
    this.#appRef.attachView(ref.hostView);
    this.#layers.set(page, ref);
  }

  #unmount(page: number): void {
    const ref = this.#layers.get(page);
    if (ref) {
      this.#appRef.detachView(ref.hostView);
      ref.destroy();
      ref.location.nativeElement.remove();
      this.#layers.delete(page);
    }
  }

  #unmountAll(): void {
    for (const page of [...this.#layers.keys()]) {
      this.#unmount(page);
    }
  }

  #countMounted(): void {
    let count = 0;
    for (const page of this.#layers.keys()) {
      count += this.#store.byPage().get(page)?.length ?? 0;
    }
    this.#state.mountedFields.set(count);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    const editing = this.#state.editing();
    const inField = (event.target as HTMLElement).matches('input, select, textarea');
    if (inField && !mod) {
      return;
    }
    const key = event.key.toLowerCase();
    const run = (fn: () => void) => {
      event.preventDefault();
      fn();
    };
    if (mod && key === 'z') {
      return run(() => (event.shiftKey ? this.#store.redo() : this.#store.undo()));
    }
    if (mod && key === 'y') {
      return run(() => this.#store.redo());
    }
    if (mod && (key === '=' || key === '+')) {
      return run(() => this.engine.zoomIn());
    }
    if (mod && key === '-') {
      return run(() => this.engine.zoomOut());
    }
    if (mod && key === '0') {
      return run(() => this.engine.setScale('page-width'));
    }
    if (!editing) {
      if (key === 'n' || (event.altKey && key === 'arrowdown')) {
        return run(() => this.#nav.next());
      }
      if (key === 'p' || (event.altKey && key === 'arrowup')) {
        return run(() => this.#nav.previous());
      }
      return;
    }
    const selected = this.#store.selected();
    if (key === 'contextmenu' || (event.shiftKey && key === 'f10')) {
      return run(() => this.#openMenu());
    }
    if (mod && key === 'a') {
      return run(() => this.#store.select((this.#store.byPage().get(this.engine.currentPage()) ?? []).map(f => f.id)));
    }
    if (mod && key === 'c') {
      return run(() => this.#store.copy());
    }
    if (mod && key === 'v') {
      return run(() => {
        this.#store.paste(this.engine.currentPage());
        this.#sound.play(Cue.Pop);
      });
    }
    if (mod && key === 'd' && selected.length) {
      return run(() => {
        this.#store.duplicate(selected.map(f => f.id));
        this.#sound.play(Cue.Pop);
      });
    }
    if (key === 'escape') {
      return run(() => (this.#state.painterSource() ? this.#state.painterSource.set(null) : this.#store.select([])));
    }
    if ((key === 'delete' || key === 'backspace') && selected.length) {
      return run(() => this.deleteRequested.emit());
    }
    const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (arrows[key] && selected.length) {
      const step = event.shiftKey ? NUDGE_FAST : NUDGE;
      const [dx, dy] = arrows[key];
      return run(() => {
        if (!this.#store.nudge(selected.map(f => f.id), dx * step, dy * step)) {
          this.#sound.play(Cue.Error);
        }
      });
    }
    if (key === 'tab' && selected.length <= 1) {
      return run(() => this.#nav.cycleSelection(event.shiftKey ? -1 : 1));
    }
  }

  /** Keyboard way to the right-click menu: at the selected field, or the middle of the current page. */
  #openMenu(): void {
    const [field] = this.#store.selected();
    const page = field?.page ?? this.engine.currentPage();
    const el = this.engine.pageElement(page);
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    const px = field ? field.x + field.width / 2 : 0.5;
    const py = field ? field.y + field.height : 0.5;
    this.#state.contextMenu.set({ x: r.left + px * r.width, y: r.top + py * r.height, page, px, py });
  }

  protected onWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    event.preventDefault();
    this.#zoomAt(this.engine.scale() * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
  }

  /** Zooms keeping the document point under (clientX, clientY) where it is, like a paper under your fingers. */
  #zoomAt(scale: number, clientX: number, clientY: number): void {
    const container = this.containerEl().nativeElement;
    const rect = container.getBoundingClientRect();
    const ox = clientX - rect.left;
    const oy = clientY - rect.top;
    const before = this.engine.scale();
    const x = container.scrollLeft + ox;
    const y = container.scrollTop + oy;
    this.engine.setScale(scale);
    const ratio = this.engine.scale() / before;
    container.scrollLeft = x * ratio - ox;
    container.scrollTop = y * ratio - oy;
  }

  protected onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      this.dropping.set(true);
    }
  }

  protected onDrop(event: DragEvent): void {
    this.dropping.set(false);
    const file = event.dataTransfer?.files[0];
    if (file && file.type === 'application/pdf') {
      event.preventDefault();
      this.fileDropped.emit(file);
    }
  }

  /**
   * Two-finger pinch: scales with a CSS transform while pinching and redraws sharp once at the end,
   * keeping the pinch point in place. Double tap zooms in at the tapped point, or back to fit width.
   */
  #pinchZoom(container: HTMLDivElement): void {
    let startDistance = 0;
    let startScale = 1;
    let factor = 1;
    let mid = { x: 0, y: 0 };
    let lastTap = { t: 0, x: 0, y: 0 };
    const viewer = this.viewerEl().nativeElement;
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    // Touch events (not pointer events): the browser would otherwise take two fingers over
    // as its own page zoom, which only stretches the picture and looks pixelated.
    container.addEventListener('touchstart', e => {
      if (e.touches.length !== 2) {
        return;
      }
      startDistance = distance(e.touches);
      startScale = this.engine.scale();
      factor = 1;
      mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      const rect = container.getBoundingClientRect();
      viewer.style.transformOrigin = `${container.scrollLeft + mid.x - rect.left}px ${container.scrollTop + mid.y - rect.top}px`;
      lastTap = { t: 0, x: 0, y: 0 };
    }, { passive: true });
    container.addEventListener('touchmove', e => {
      if (e.touches.length !== 2 || !startDistance) {
        return;
      }
      e.preventDefault();
      factor = Math.min(MAX_SCALE / startScale, Math.max(MIN_SCALE / startScale, distance(e.touches) / startDistance));
      viewer.style.transform = `scale(${factor})`;
    }, { passive: false });
    const finish = (e: TouchEvent) => {
      if (!startDistance || e.touches.length >= 2) {
        return;
      }
      viewer.style.transform = '';
      startDistance = 0;
      if (Math.abs(factor - 1) > 0.02) {
        // Redraws the pages at the new size, at the screen's full pixel density.
        this.#zoomAt(startScale * factor, mid.x, mid.y);
      }
    };
    container.addEventListener('touchend', finish);
    container.addEventListener('touchcancel', finish);

    // Double tap: zoom in at the tapped point, or back to fit width.
    container.addEventListener('pointerup', e => {
      if (e.pointerType !== 'touch' || !e.isPrimary || startDistance || (this.#state.editing() && (e.target as HTMLElement).closest('cs-field'))) {
        return;
      }
      const now = e.timeStamp;
      if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap = { t: 0, x: 0, y: 0 };
        const fit = container.clientWidth / (this.engine.pageElement(this.engine.currentPage())?.offsetWidth ?? container.clientWidth) * this.engine.scale();
        if (this.engine.scale() > fit * 1.3) {
          this.engine.setScale('page-width');
        } else {
          this.#zoomAt(this.engine.scale() * 2.2, e.clientX, e.clientY);
        }
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    });
  }
}

