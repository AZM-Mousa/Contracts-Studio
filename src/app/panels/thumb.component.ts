import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import type { RenderTask } from 'pdfjs-dist';
import { FieldStore } from '../core/fields/field-store.service';
import { isFilled } from '../core/fields/field.model';
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { StudioState } from '../core/studio-state.service';
import { I18n } from '../core/ui/i18n';

const THUMB_WIDTH = 116;

@Component({
  selector: 'cs-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'option',
    '[attr.aria-selected]': 'active()',
    '[class.active]': 'active()',
  },
  templateUrl: './thumb.component.html',
  styleUrl: './thumb.component.scss',
})
export class Thumb {
  readonly page = input.required<number>();
  protected readonly i18n = inject(I18n);
  readonly #engine = inject(PdfEngine);
  readonly #store = inject(FieldStore);
  readonly #state = inject(StudioState);
  private readonly canvasEl = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  protected readonly ready = signal(false);
  protected readonly ratio = signal('210 / 297');
  protected readonly active = computed(() => this.#engine.currentPage() === this.page());
  protected readonly count = computed(() => this.#store.byPage().get(this.page())?.length ?? 0);
  protected readonly missing = computed(() =>
    this.#state.mode() !== 'edit' && (this.#store.byPage().get(this.page()) ?? []).some(f => f.required && !isFilled(f)),
  );
  #task: RenderTask | null = null;

  constructor() {
    // The virtual list reuses components, so redraw when the page changes.
    effect(() => {
      const page = this.page();
      untracked(() => void this.#render(page));
    });
    inject(DestroyRef).onDestroy(() => this.#task?.cancel());
  }

  async #render(pageNumber: number): Promise<void> {
    const pdf = this.#engine.document;
    if (!pdf) {
      return;
    }
    this.#task?.cancel();
    this.ready.set(false);
    try {
      const page = await pdf.getPage(pageNumber);
      if (pageNumber !== this.page()) {
        return;
      }
      const base = page.getViewport({ scale: 1 });
      this.ratio.set(`${base.width} / ${base.height}`);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (THUMB_WIDTH / base.width) * dpr });
      const canvas = this.canvasEl().nativeElement;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      this.#task = page.render({ canvas, viewport });
      await this.#task.promise;
      this.ready.set(true);
      page.cleanup();
    } catch {
      // Cancelled because the item was reused or scrolled away.
    }
  }
}
