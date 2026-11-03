import { Service } from '@angular/core';
import type { StorageKey } from '../enums/storage-key.enum';

/** The only place that touches localStorage; private mode or a full quota never throw. */
@Service()
export class LocalStorageService {
  get(key: StorageKey): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  set(key: StorageKey, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage blocked or full: the value just isn't kept.
    }
  }

  getJson<T>(key: StorageKey, fallback: T): T {
    const raw = this.get(key);
    if (!raw) {
      return fallback;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  setJson(key: StorageKey, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }
}
