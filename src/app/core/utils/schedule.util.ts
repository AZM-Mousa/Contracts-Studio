import type { DestroyRef } from '@angular/core';

export type Cancel = () => void;

/**
 * The only place that touches timers. Each helper returns a cancel function and,
 * given a DestroyRef, cancels itself when the owner is destroyed.
 */
export function scheduleAfter(ms: number, run: () => void, destroyRef?: DestroyRef): Cancel {
  const id = setTimeout(run, ms);
  const cancel = () => clearTimeout(id);
  destroyRef?.onDestroy(cancel);
  return cancel;
}

export function scheduleEvery(ms: number, run: () => void, destroyRef?: DestroyRef): Cancel {
  const id = setInterval(run, ms);
  const cancel = () => clearInterval(id);
  destroyRef?.onDestroy(cancel);
  return cancel;
}

/** Runs on the next animation frame (after layout), e.g. to focus or measure. */
export function nextFrame(run: () => void): Cancel {
  const id = requestAnimationFrame(run);
  return () => cancelAnimationFrame(id);
}

/** Waits for a promise-friendly delay. */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => scheduleAfter(ms, resolve));
}
