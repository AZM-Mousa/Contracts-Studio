import { inject, Service, signal } from '@angular/core';
import { StorageKey } from '../enums/storage-key.enum';
import { LocalStorageService } from '../storage/local-storage.service';
import { SavedKind } from '../enums/saved-kind.enum';

export { SavedKind };

/** Default signature / initials / stamp per signer, kept on this device (the original "set as default"). */
@Service()
export class SavedSignatures {
  readonly #storage = inject(LocalStorageService);
  readonly #items = signal<Record<string, string>>(this.#storage.getJson(StorageKey.SavedSignatures, {}));

  get(signerId: string, kind: SavedKind): string | null {
    return this.#items()[`${signerId}:${kind}`] ?? null;
  }

  set(signerId: string, kind: SavedKind, dataUrl: string): void {
    this.#items.update(items => ({ ...items, [`${signerId}:${kind}`]: dataUrl }));
    this.#write();
  }

  clear(signerId: string, kind: SavedKind): void {
    this.#items.update(items => {
      const { [`${signerId}:${kind}`]: _, ...rest } = items;
      return rest;
    });
    this.#write();
  }

  #write(): void {
    this.#storage.setJson(StorageKey.SavedSignatures, this.#items());
  }
}
