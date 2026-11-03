import { Service, signal } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { EventBus, PDFFindController, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { FindState } from '../enums/find-state.enum';

type ViewerModule = typeof import('pdfjs-dist/web/pdf_viewer.mjs');

/** Relative to the app's base href, so it also works under a sub-path (GitHub Pages). */
const ASSETS = new URL('pdfjs/', document.baseURI).href;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5;

export interface FindStatus {
  query: string;
  current: number;
  total: number;
  state: FindState;
}

export interface FindOptions {
  caseSensitive: boolean;
  entireWord: boolean;
  /** When false, Arabic harakat and Latin accents are ignored (عَقْد finds عقد). */
  matchDiacritics: boolean;
}

export interface PageMatches {
  page: number;
  count: number;
}

export function isTouchDevice(): boolean {
  return /Android|iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** iPhone / iPad (including iPadOS, which reports itself as a Mac). */
export function isAppleMobile(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Most pixels one page canvas may use. iOS caps canvas memory hard, so it keeps pdf.js's
 * 5 MP (a sharp detail canvas covers the visible area). Android gets 16 MP so a zoomed-in
 * page is drawn at the screen's full pixel density, not stretched; pdf.js also caps
 * this at ~3 screens of pixels. Desktop: 32 MP.
 */
function maxCanvasPixels(): number {
  if (isAppleMobile()) {
    return 5242880;
  }
  return isTouchDevice() ? 2 ** 24 : 2 ** 25;
}

let viewerModule: Promise<ViewerModule> | undefined;

function loadViewerModule(): Promise<ViewerModule> {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;
  // The viewer components read the library from `globalThis.pdfjsLib`.
  (globalThis as { pdfjsLib?: typeof pdfjsLib }).pdfjsLib = pdfjsLib;
  return (viewerModule ??= import('pdfjs-dist/web/pdf_viewer.mjs'));
}

/**
 * Wraps pdf.js's `PDFViewer`: only pages near the screen are drawn, they're
 * drawn at the screen's pixel density (with a sharp detail canvas when zoomed
 * past the canvas limit) and freed once they scroll away.
 */
@Service()
export class PdfEngine {
  readonly ready = signal(false);
  readonly loading = signal(false);
  readonly pagesCount = signal(0);
  readonly currentPage = signal(1);
  readonly scale = signal(1);
  readonly find = signal<FindStatus>({ query: '', current: 0, total: 0, state: FindState.Idle });
  readonly fileName = signal('');
  readonly findOptions = signal<FindOptions>({ caseSensitive: false, entireWord: false, matchDiacritics: false });
  /** Pages with matches for the current search, in page order. */
  readonly pageMatches = signal<readonly PageMatches[]>([]);
  /** Share of pages searched so far (0..1) while a search runs. */
  readonly findProgress = signal(0);

  eventBus!: EventBus;
  viewer!: PDFViewer;
  #findController!: PDFFindController;
  #document: PDFDocumentProxy | null = null;
  #task: PDFDocumentLoadingTask | null = null;
  /** The original file, kept for export (pdf.js takes ownership of what it's given). */
  bytes: Uint8Array | null = null;
  #container!: HTMLDivElement;
  #abort = new AbortController();

  async attach(container: HTMLDivElement, viewerElement: HTMLDivElement): Promise<void> {
    const { EventBus, PDFFindController, PDFLinkService, PDFViewer } = await loadViewerModule();
    this.#container = container;
    this.eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus: this.eventBus });
    this.#findController = new PDFFindController({ eventBus: this.eventBus, linkService });
    this.viewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus: this.eventBus,
      linkService,
      findController: this.#findController,
      // Past this, pdf.js keeps a sharp detail canvas for the visible area.
      maxCanvasPixels: maxCanvasPixels(),
      // When a page is over that limit, pdf.js draws it at half resolution plus a sharp patch
      // for the visible area, so scrolling shows blurry parts. Android draws whole pages sharp.
      enableDetailCanvas: !isTouchDevice() || isAppleMobile(),
      annotationMode: pdfjsLib.AnnotationMode.DISABLE,
      annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
      removePageBorders: false,
    });
    linkService.setViewer(this.viewer);

    this.eventBus.on('pagesinit', () => {
      this.viewer.currentScaleValue = 'page-width';
      this.ready.set(true);
      this.loading.set(false);
    });
    this.eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => this.currentPage.set(pageNumber));
    this.eventBus.on('scalechanging', ({ scale }: { scale: number }) => this.scale.set(scale));
    this.eventBus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
      this.find.update(s => ({ ...s, current: matchesCount.current, total: matchesCount.total }));
      this.#collectPageMatches();
    });
    this.eventBus.on('updatefindcontrolstate', ({ state, matchesCount }: { state: number; matchesCount: { current: number; total: number } }) => {
      const states: FindStatus['state'][] = [FindState.Found, FindState.NotFound, FindState.Wrapped, FindState.Pending];
      this.find.update(s => ({ ...s, state: states[state] ?? 'idle', current: matchesCount.current, total: matchesCount.total }));
    });
    this.#watchPixelRatio();
  }

  async open(data: Uint8Array, name: string): Promise<void> {
    this.loading.set(true);
    this.ready.set(false);
    await this.close();
    this.bytes = data;
    this.#task = pdfjsLib.getDocument({
      data: data.slice(),
      cMapUrl: `${ASSETS}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ASSETS}standard_fonts/`,
      // Draw the 14 standard PDF fonts (Times, Helvetica…) from pdf.js's own font files.
      // Phones don't have Times, so system fonts swapped in other faces with uneven spacing.
      useSystemFonts: false,
      wasmUrl: `${ASSETS}wasm/`,
      iccUrl: `${ASSETS}iccs/`,
    });
    const pdf = await this.#task.promise;
    this.#document = pdf;
    this.fileName.set(name);
    this.pagesCount.set(pdf.numPages);
    this.viewer.setDocument(pdf);
    (this.viewer.linkService as { setDocument(d: PDFDocumentProxy): void }).setDocument(pdf);
  }

  get document(): PDFDocumentProxy | null {
    return this.#document;
  }

  async close(): Promise<void> {
    if (!this.#document) {
      return;
    }
    this.viewer.setDocument(null as unknown as PDFDocumentProxy);
    await this.#task?.destroy();
    this.#task = null;
    this.#document = null;
    this.pagesCount.set(0);
  }

  pageElement(page: number): HTMLElement | null {
    return this.viewer.getPageView(page - 1)?.div ?? null;
  }

  goToPage(page: number): void {
    this.viewer.currentPageNumber = Math.min(Math.max(1, page), this.pagesCount());
  }

  /** Scrolls so that a field's area (page fractions) is in view, centred. */
  /**
   * Scrolls a spot on a page (page fractions) into the middle of the view, keeping the zoom:
   * up/down always, and sideways too when the page is wider than the screen and the
   * spot is off to the side, so next / previous field always lands on the field.
   */
  revealArea(page: number, area: { x: number; y: number; width: number; height: number }): void {
    const pageDiv = this.pageElement(page);
    if (!pageDiv) {
      return;
    }
    const container = this.#container;
    const box = container.getBoundingClientRect();
    const rect = pageDiv.getBoundingClientRect();
    const top = container.scrollTop + rect.top - box.top + (area.y + area.height / 2) * rect.height - container.clientHeight / 2;
    let left = container.scrollLeft;
    const fieldLeft = container.scrollLeft + rect.left - box.left + area.x * rect.width;
    const fieldWidth = area.width * rect.width;
    const margin = 16;
    const offscreen = fieldLeft < container.scrollLeft + margin || fieldLeft + fieldWidth > container.scrollLeft + container.clientWidth - margin;
    if (container.scrollWidth > container.clientWidth && offscreen) {
      // Centre the field; a field wider than the screen shows from its start.
      left = fieldWidth + margin * 2 > container.clientWidth ? fieldLeft - margin : fieldLeft + fieldWidth / 2 - container.clientWidth / 2;
    }
    container.scrollTo({
      top: Math.max(0, top),
      left: Math.max(0, Math.min(left, container.scrollWidth - container.clientWidth)),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  setScale(value: number | 'page-width' | 'page-fit' | 'auto'): void {
    this.viewer.currentScaleValue = typeof value === 'number'
      ? String(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)))
      : value;
  }

  zoomIn(): void {
    this.viewer.increaseScale();
  }

  zoomOut(): void {
    this.viewer.decreaseScale();
  }

  search(query: string, options: { again?: boolean; previous?: boolean } = {}): void {
    const opts = this.findOptions();
    if (!options.again) {
      this.pageMatches.set([]);
      this.findProgress.set(0);
    }
    this.find.update(s => ({ ...s, query }));
    this.eventBus.dispatch('find', {
      source: this,
      type: options.again ? 'again' : '',
      query,
      caseSensitive: opts.caseSensitive,
      entireWord: opts.entireWord,
      highlightAll: true,
      findPrevious: options.previous ?? false,
      matchDiacritics: opts.matchDiacritics,
    });
  }

  /** Reads the per-page results pdf.js has found so far. */
  #collectPageMatches(): void {
    const matches = (this.#findController as unknown as { pageMatches: (number[] | undefined)[] }).pageMatches ?? [];
    const pages: PageMatches[] = [];
    let searched = 0;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i]) {
        searched++;
        if (matches[i]!.length) {
          pages.push({ page: i + 1, count: matches[i]!.length });
        }
      }
    }
    this.pageMatches.set(pages);
    this.findProgress.set(this.pagesCount() ? searched / this.pagesCount() : 0);
  }

  clearSearch(): void {
    this.eventBus.dispatch('findbarclose', { source: this });
    this.find.set({ query: '', current: 0, total: 0, state: FindState.Idle });
    this.pageMatches.set([]);
    this.findProgress.set(0);
  }

  /**
   * Redraws the pages when the device pixel ratio changes (moving the window
   * to another screen, browser zoom), which `PDFViewer` doesn't do on its own
   * in this pdfjs-dist version (mozilla/pdf.js#22320).
   */
  #watchPixelRatio(): void {
    const listen = () => {
      matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
        this.viewer.refresh();
        listen();
      }, { once: true, signal: this.#abort.signal });
    };
    listen();
  }

  destroy(): void {
    this.#abort.abort();
    void this.close();
  }
}
