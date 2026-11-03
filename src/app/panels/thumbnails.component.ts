import { CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, untracked, viewChild } from '@angular/core';
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { I18n } from '../core/ui/i18n';
import { Thumb } from './thumb.component';

const ITEM_HEIGHT = 196;

@Component({
  selector: 'cs-thumbnails',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkVirtualScrollViewport, CdkFixedSizeVirtualScroll, CdkVirtualForOf, Thumb],
  templateUrl: './thumbnails.component.html',
  styleUrl: './thumbnails.component.scss',
})
export class Thumbnails {
  readonly visible = input(true);
  protected readonly i18n = inject(I18n);
  readonly #engine = inject(PdfEngine);
  private readonly viewportEl = viewChild.required(CdkVirtualScrollViewport);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly itemHeight = ITEM_HEIGHT;
  protected readonly pages = computed(() => (this.#engine.ready() ? Array.from({ length: this.#engine.pagesCount() }, (_, i) => i + 1) : []));
  protected readonly track = (_: number, p: number) => p;

  constructor() {
    afterNextRender(() => this.viewportEl().checkViewportSize());
    // Keep the current page in view in the rail.
    effect(() => {
      const page = this.#engine.currentPage();
      if (!this.visible()) {
        return;
      }
      untracked(() => {
        const viewport = this.viewportEl();
        const top = (page - 1) * ITEM_HEIGHT;
        const offset = viewport.measureScrollOffset();
        const height = this.#host.nativeElement.clientHeight;
        if (top < offset || top + ITEM_HEIGHT > offset + height) {
          viewport.scrollToIndex(Math.max(0, page - 2));
        }
      });
    });
  }

  protected go(page: number): void {
    this.#engine.goToPage(page);
  }
}
