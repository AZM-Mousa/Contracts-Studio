import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FieldStore } from './core/fields/field-store.service';
import { ExportService } from './core/pdf/export.service';
import { PdfEngine } from './core/pdf/pdf-engine.service';
import { buildSampleContract, denseFields, sampleFields } from './core/pdf/sample-contract';
import { buildAllFieldsSample } from './core/pdf/sample-all-fields';
import { StudioState, Mode } from './core/studio-state.service';
import { I18n, type Key } from './core/ui/i18n';
import { Preferences } from './core/ui/preferences.service';
import { SoundService } from './core/ui/sound.service';
import { Inspector } from './panels/inspector.component';
import { Palette } from './panels/palette.component';
import { FieldsList } from './panels/fields-list.component';
import { ContextMenu } from './viewer/context-menu.component';
import { SearchBar } from './panels/search-bar.component';
import { SettingsDrawer } from './panels/settings-drawer.component';
import { SignatureDialog } from './panels/signature-dialog.component';
import { SigningBar } from './panels/signing-bar.component';
import { Thumbnails } from './panels/thumbnails.component';
import { AlertDialog } from './ui/alert-dialog.component';
import { AlertService } from './ui/alert.service';
import { Icon } from './ui/icon.component';
import { Loader } from './ui/loader.component';
import { FieldNavigator } from './viewer/field-navigator.service';
import { Viewer } from './viewer/viewer.component';
import { JourneyFlow } from './flows/journey-flow.component';
import { SendFlow } from './flows/send-flow.component';
import { EnvelopeService } from './core/envelope/envelope.service';
import { View } from './core/studio-state.service';
import { Cue } from './core/enums/cue.enum';
import { AlertKind } from './core/enums/alert-kind.enum';
import { ExportKind } from './core/enums/export-kind.enum';
import { Panel } from './core/enums/panel.enum';

const SAMPLE_SIZES = [20, 300, 1500, 5000];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SendFlow, JourneyFlow, Icon, Loader, AlertDialog, Viewer, Thumbnails, Palette, Inspector, FieldsList, ContextMenu, SearchBar, SigningBar, SignatureDialog, SettingsDrawer],
  host: {
    '[class.rail-closed]': '!state.thumbnailsOpen()',
    '[class.no-side]': '!state.editing()',
    '[class.in-flow]': 'state.view() !== "studio"',
    '(window:keydown)': 'onGlobalKey($event)',
    '(document:pointerdown)': 'closeMenus($event)',
  },
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly ExportKind = ExportKind;
  protected readonly Panel = Panel;
  protected readonly engine = inject(PdfEngine);
  protected readonly store = inject(FieldStore);
  protected readonly state = inject(StudioState);
  protected readonly i18n = inject(I18n);
  protected readonly prefs = inject(Preferences);
  protected readonly sound = inject(SoundService);
  protected readonly nav = inject(FieldNavigator);
  readonly #export = inject(ExportService);
  readonly #alerts = inject(AlertService);
  protected readonly envelope = inject(EnvelopeService);
  protected readonly views: { id: View; label: Key; icon: string }[] = [
    { id: View.Studio, label: 'viewEditor', icon: 'pen' },
    { id: View.Send, label: 'viewSend', icon: 'upload' },
    { id: View.Journey, label: 'viewJourney', icon: 'signature' },
  ];

  protected setView(view: View): void {
    this.state.view.set(view);
    this.sound.play(Cue.Switch);
  }
  private readonly viewerEl = viewChild.required(Viewer);

  protected readonly sampleSizes = SAMPLE_SIZES;
  protected readonly searchOpen = signal(false);
  protected readonly exportOpen = signal(false);
  protected readonly sampleOpen = signal(false);
  protected readonly generating = signal(0);
  protected readonly exporting = signal(false);
  protected readonly sideTab = signal<Panel>(Panel.Palette);
  protected readonly modes: { id: Mode; label: Key; icon: string }[] = [
    { id: Mode.Edit, label: 'modeEdit', icon: 'pen' },
    { id: Mode.Sign, label: 'modeSign', icon: 'signature' },
    { id: Mode.Review, label: 'modeReview', icon: 'review' },
    { id: Mode.View, label: 'modeView', icon: 'eye' },
  ];
  protected readonly zoomPercent = computed(() => Math.round(this.engine.scale() * 100));

  constructor() {
    // No free space for a field: say what happened.
    effect(() => {
      const info = this.store.noSpace();
      if (!info) {
        return;
      }
      if (info.movedToPage) {
        this.state.notify(this.i18n.t('movedToPage', { n: info.movedToPage }));
        this.engine.goToPage(info.movedToPage);
      } else {
        this.sound.play(Cue.Error);
        void this.#alerts.open({
          kind: AlertKind.Warning,
          title: this.i18n.t('noSpaceTitle'),
          text: this.i18n.t('noSpaceText', { n: info.skipped }),
          cancelText: '',
          confirmText: this.i18n.t('close'),
        });
      }
    });
    // Show the field panel when something gets selected.
    effect(() => {
      // The fields list keeps its tab while you pick fields from it.
      if (this.store.selection().size && untracked(this.sideTab) === Panel.Palette) {
        this.sideTab.set(Panel.Inspector);
      }
    });
  }

  protected setMode(mode: Mode): void {
    this.state.mode.set(mode);
    this.store.select([]);
    this.sound.play(Cue.Switch);
  }

  protected async openFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = '';
    if (file) {
      await this.loadFile(file);
    }
  }

  protected async loadFile(file: File): Promise<void> {
    await this.engine.open(new Uint8Array(await file.arrayBuffer()), file.name);
    this.store.load([]);
    this.sound.play(Cue.Whoosh);
    this.viewerEl().focus();
  }

  protected async generate(pages: number, dense = false): Promise<void> {
    this.sampleOpen.set(false);
    this.generating.set(pages);
    const started = performance.now();
    const bytes = await buildSampleContract(pages);
    const fields = dense ? denseFields(pages) : sampleFields(pages);
    await this.engine.open(bytes, `master-services-agreement-${pages}p.pdf`);
    this.store.load(fields);
    this.generating.set(0);
    this.sound.play(Cue.Success);
    this.state.notify(`${this.i18n.t('loaded', { pages, fields: fields.length })} · ${Math.round(performance.now() - started)} ms`);
    this.viewerEl().focus();
  }

  /** A 2-page contract with every field type, spread over the three signers. */
  protected async generateAllFields(): Promise<void> {
    this.sampleOpen.set(false);
    this.generating.set(2);
    const { bytes, fields } = await buildAllFieldsSample();
    await this.engine.open(bytes, 'employment-offer-all-fields.pdf');
    this.store.load(fields);
    this.generating.set(0);
    this.sound.play(Cue.Success);
    this.state.notify(this.i18n.t('loaded', { pages: 2, fields: fields.length }));
    this.viewerEl().focus();
  }

  /** Finishing a signature: celebrate, then offer the signed PDF. */
  protected async finishSigning(): Promise<void> {
    const { confirmed } = await this.#alerts.open({
      kind: AlertKind.Success,
      title: this.i18n.t('finishTitle'),
      text: this.i18n.t('finishText'),
      confirmText: this.i18n.t('exportPdf'),
      cancelText: this.i18n.t('close'),
    });
    if (confirmed) {
      await this.exportAs(ExportKind.Pdf);
    }
  }

  /** Deleting several fields at once asks first. */
  protected async removeSelected(): Promise<void> {
    const ids = [...this.store.selection()];
    if (ids.length > 1) {
      const { confirmed } = await this.#alerts.open({
        kind: AlertKind.Warning, danger: true,
        title: this.i18n.t('deleteTitle', { n: ids.length }),
        text: this.i18n.t('deleteText'),
        confirmText: this.i18n.t('delete'),
      });
      if (!confirmed) {
        return;
      }
    }
    this.store.remove(ids);
    this.sound.play(Cue.Remove);
  }

  protected async exportAs(kind: ExportKind): Promise<void> {
    this.exportOpen.set(false);
    if (kind === 'json') {
      this.#export.json();
    } else {
      this.exporting.set(true);
      try {
        await this.#export.pdf();
      } finally {
        this.exporting.set(false);
      }
    }
    this.sound.play(Cue.Success);
  }

  protected goToPage(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.engine.goToPage(Number(input.value));
    input.value = String(this.engine.currentPage());
  }

  protected toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  }

  /** Menus close when you press anywhere outside them. */
  protected closeMenus(event: PointerEvent): void {
    if (!(event.target as HTMLElement).closest('.menu-wrap')) {
      this.exportOpen.set(false);
      this.sampleOpen.set(false);
    }
  }

  protected onGlobalKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && this.engine.ready()) {
      event.preventDefault();
      this.searchOpen.set(true);
    }
    if (event.key === 'Escape') {
      this.exportOpen.set(false);
      this.sampleOpen.set(false);
    }
  }
}
