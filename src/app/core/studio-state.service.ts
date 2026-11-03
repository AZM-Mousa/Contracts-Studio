import { computed, Service, signal } from '@angular/core';
import { scheduleAfter, type Cancel } from '../core/utils/schedule.util';
import { Mode } from './enums/mode.enum';
import { View } from './enums/view.enum';
import { Panel } from './enums/panel.enum';

export { Mode };

/** Where the right-click menu opened: viewport px, plus the page and the spot on it (page fractions). */
export interface MenuAt {
  x: number;
  y: number;
  page: number;
  px: number;
  py: number;
}
export { View };

@Service()
export class StudioState {
  readonly mode = signal<Mode>(Mode.Edit);
  /** The editor, the send process (company side) or the signer journey (approval side). */
  readonly view = signal<View>(View.Studio);
  readonly grid = signal(false);
  readonly snapping = signal(true);
  readonly thumbnailsOpen = signal(true);
  readonly settingsOpen = signal(false);
  readonly shortcutsOpen = signal(false);
  readonly sheet = signal<Panel>(Panel.None);
  /** Field whose signature/initials/stamp/image dialog is open. */
  readonly drawingFieldId = signal<string | null>(null);
  readonly mountedFields = signal(0);
  /** Format painter: the field whose formatting is copied; null when off. */
  readonly painterSource = signal<string | null>(null);
  /** Signers whose fields are hidden in the editor (a view filter, not a change). */
  readonly hiddenSigners = signal<ReadonlySet<string>>(new Set());
  /** Right-click menu position (viewport px); null when closed. */
  readonly contextMenu = signal<MenuAt | null>(null);
  readonly rulers = signal(true);
  readonly toast = signal<{ text: string; id: number } | null>(null);

  readonly editing = computed(() => this.mode() === 'edit');
  readonly filling = computed(() => this.mode() === 'sign');

  #toastId = 0;
  #toastTimer: Cancel | null = null;

  notify(text: string): void {
    const id = ++this.#toastId;
    this.toast.set({ text, id });
    this.#toastTimer?.();
    this.#toastTimer = scheduleAfter(3200, () => {
      if (this.toast()?.id === id) {
        this.toast.set(null);
      }
    });
  }
}
