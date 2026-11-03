import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FieldStore } from '../core/fields/field-store.service';
import { FIELD_GROUPS, FIELD_META, FieldType } from '../core/fields/field.model';
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { StudioState } from '../core/studio-state.service';
import { I18n } from '../core/ui/i18n';
import { SoundService } from '../core/ui/sound.service';
import { Icon } from '../ui/icon.component';
import { Cue } from '../core/enums/cue.enum';
import { Panel } from '../core/enums/panel.enum';
import { detectFields } from '../core/fields/field-detector';
import { AlertKind, AlertService } from '../ui/alert.service';

@Component({
  selector: 'cs-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './palette.component.html',
  styleUrl: './palette.component.scss',
})
export class Palette {
  protected readonly store = inject(FieldStore);
  protected readonly i18n = inject(I18n);
  readonly #engine = inject(PdfEngine);
  readonly #state = inject(StudioState);
  readonly #sound = inject(SoundService);
  readonly #alert = inject(AlertService);
  /** 0..1 while auto-detect is reading the pages. */
  protected readonly detecting = signal<number | null>(null);
  #detectStop: AbortController | null = null;
  protected readonly meta = FIELD_META;
  protected readonly groups = FIELD_GROUPS.map(id => ({
    id,
    types: (Object.values(FieldType) as FieldType[]).filter(t => FIELD_META[t].group === id),
  }));
  protected readonly signerColor = computed(() => this.store.signer(this.store.activeSignerId())?.color ?? 'var(--accent)');

  /**
   * Reads the text of every page, finds labels such as "Signature:" or "التاريخ"
   * and offers to add matching fields for the active signer. A second click stops it.
   */
  protected async detect(): Promise<void> {
    const pdf = this.#engine.document;
    if (this.#detectStop) {
      this.#detectStop.abort();
      return;
    }
    if (!pdf) {
      return;
    }
    const pages = Array.from({ length: this.#engine.pagesCount() }, (_, i) => i + 1);
    this.#detectStop = new AbortController();
    this.detecting.set(0);
    try {
      const found = await detectFields(pdf, pages, done => this.detecting.set(done / pages.length), this.#detectStop.signal);
      if (!found.length) {
        await this.#alert.open({ kind: AlertKind.Info, title: this.i18n.t('detectNone'), text: this.i18n.t('detectNoneText') });
        return;
      }
      const fresh = this.store.freshDetections(found);
      if (!fresh.length) {
        await this.#alert.open({ kind: AlertKind.Success, title: this.i18n.t('detectCovered', { n: found.length }), text: this.i18n.t('detectCoveredText') });
        return;
      }
      const onPages = new Set(fresh.map(f => f.page)).size;
      const signer = this.store.signer(this.store.activeSignerId())?.name ?? '';
      const covered = found.length - fresh.length;
      const { confirmed } = await this.#alert.open({
        kind: AlertKind.Question,
        title: this.i18n.t('detectFound', { n: fresh.length }),
        text: this.i18n.t('detectFoundText', { pages: onPages, name: signer }) + (covered ? ' ' + this.i18n.t('detectSkipped', { n: covered }) : ''),
        confirmText: this.i18n.t('detectAdd'),
        cancelText: this.i18n.t('cancel'),
      });
      if (confirmed) {
        const added = this.store.addDetected(fresh);
        this.#state.notify(this.i18n.t('detectAdded', { n: added }));
        this.#sound.play(Cue.Success);
        if (added) {
          this.#engine.goToPage(fresh[0].page);
        }
      }
    } finally {
      this.#detectStop = null;
      this.detecting.set(null);
    }
  }

  protected initials(name: string): string {
    return name.split(' ').map(p => p[0]).join('').slice(0, 2);
  }

  protected pickSigner(id: string): void {
    this.store.activeSignerId.set(id);
    this.store.update(this.store.selection(), () => ({ signerId: id }));
    this.#sound.play(Cue.Tick);
  }

  /**
   * Drag a recipient onto a field to assign it to them (all selected fields when the
   * dropped-on field is part of the selection). A tap just makes them the active signer.
   */
  protected startSignerDrag(event: PointerEvent, signerId: string): void {
    if (event.button !== 0) {
      return;
    }
    const signer = this.store.signer(signerId);
    const origin = { x: event.clientX, y: event.clientY };
    let ghost: HTMLElement | null = null;
    let target: HTMLElement | null = null;
    const mark = (el: HTMLElement | null) => {
      if (target !== el) {
        target?.classList.remove('is-assign-target');
        el?.classList.add('is-assign-target');
        target = el;
      }
    };
    const move = (e: PointerEvent) => {
      if (!ghost && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 6) {
        ghost = document.createElement('div');
        ghost.className = 'signer-ghost';
        ghost.textContent = signer?.name ?? '';
        ghost.style.setProperty('--signer', signer?.color ?? 'var(--accent)');
        document.body.append(ghost);
        this.#state.sheet.set(Panel.None);
      }
      if (ghost) {
        e.preventDefault();
        ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -130%)`;
        mark(document.elementsFromPoint(e.clientX, e.clientY).map(el => el.closest<HTMLElement>('cs-field')).find(Boolean) ?? null);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      ghost?.remove();
      const field = target;
      mark(null);
      if (!ghost) {
        this.pickSigner(signerId);
        return;
      }
      const id = field?.dataset['fieldId'];
      if (id) {
        const ids = this.store.selection().has(id) ? [...this.store.selection()] : [id];
        this.store.update(ids, () => ({ signerId }));
        this.#sound.play(Cue.Drop);
        this.#state.notify(this.i18n.t('assignedTo', { n: ids.length, name: signer?.name ?? '' }));
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Adds to the middle of what's visible of the current page. */
  protected add(type: FieldType): void {
    if (!this.#engine.ready()) {
      return;
    }
    const page = this.#engine.currentPage();
    const div = this.#engine.pageElement(page);
    let y = 0.5;
    if (div) {
      const rect = div.getBoundingClientRect();
      const container = div.closest('.viewer-container')!.getBoundingClientRect();
      const visibleMid = (Math.max(rect.top, container.top) + Math.min(rect.bottom, container.bottom)) / 2;
      y = Math.min(0.95, Math.max(0.05, (visibleMid - rect.top) / rect.height));
    }
    if (this.store.create(type, page, 0.5, y, this.#engine.pagesCount())) {
      this.#sound.play(Cue.Pop);
    }
    this.#state.sheet.set(Panel.None);
  }

  protected startDrag(event: PointerEvent, type: FieldType): void {
    if (event.button !== 0) {
      return;
    }
    const button = event.currentTarget as HTMLElement;
    const origin = { x: event.clientX, y: event.clientY };
    let ghost: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      if (!ghost && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 6) {
        ghost = button.cloneNode(true) as HTMLElement;
        ghost.classList.add('drag-ghost');
        ghost.style.setProperty('--signer', this.signerColor());
        document.body.append(ghost);
        this.#state.sheet.set(Panel.None);
      }
      if (ghost) {
        e.preventDefault();
        ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%) rotate(-2deg)`;
        const page = this.#pageAt(e.clientX, e.clientY);
        document.querySelectorAll('.page.is-drop-target').forEach(p => p !== page && p.classList.remove('is-drop-target'));
        page?.classList.add('is-drop-target');
      }
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.querySelectorAll('.page.is-drop-target').forEach(p => p.classList.remove('is-drop-target'));
      if (!ghost) {
        this.add(type);
        return;
      }
      ghost.remove();
      const page = this.#pageAt(e.clientX, e.clientY);
      if (!page) {
        return;
      }
      const rect = page.getBoundingClientRect();
      if (this.store.create(type, Number(page.dataset['pageNumber']), (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, this.#engine.pagesCount())) {
        this.#sound.play(Cue.Drop);
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  #pageAt(x: number, y: number): HTMLElement | null {
    return (document.elementFromPoint(x, y)?.closest('.page') as HTMLElement | null) ?? null;
  }
}
