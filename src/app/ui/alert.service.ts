import { AlertKind } from '../core/enums/alert-kind.enum';
import { Service, signal } from '@angular/core';

export { AlertKind };

export interface AlertOptions {
  kind: AlertKind;
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  /** Asks for text, e.g. a rejection reason; required unless `inputOptional`. */
  input?: { label: string; placeholder?: string; optional?: boolean };
  danger?: boolean;
}

export interface AlertResult {
  confirmed: boolean;
  value: string;
}

interface Open extends AlertOptions {
  resolve: (result: AlertResult) => void;
}

/** Illustrated dialogs (SweetAlert-style, built in): one at a time, promise based. */
@Service()
export class AlertService {
  readonly current = signal<Open | null>(null);

  open(options: AlertOptions): Promise<AlertResult> {
    this.current()?.resolve({ confirmed: false, value: '' });
    return new Promise(resolve => this.current.set({ ...options, resolve }));
  }

  close(result: AlertResult): void {
    const open = this.current();
    this.current.set(null);
    open?.resolve(result);
  }
}
