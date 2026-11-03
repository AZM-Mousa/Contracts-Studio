import { TransitionKind } from '../enums/transition-kind.enum';
export { TransitionKind };

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void>; ready?: Promise<void>; skipTransition?: () => void };
};

function reducedMotion(doc: Document): boolean {
  const motion = doc.documentElement.dataset['motion'];
  if (motion === 'reduce') {
    return true;
  }
  if (motion === 'full') {
    return false;
  }
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Runs `apply` inside a view transition. 'reveal' grows the new theme from the
 * last pointer position (--vt-x/--vt-y); 'fade' crossfades. Falls back to a plain
 * update without support or with reduced motion.
 */
export function runTransition(doc: Document, apply: () => void, kind: TransitionKind, to?: string): void {
  const tdoc = doc as TransitionDocument;
  if (typeof tdoc.startViewTransition !== 'function' || reducedMotion(doc)) {
    apply();
    return;
  }
  const root = doc.documentElement;
  root.dataset['vt'] = kind;
  if (to) {
    root.dataset['vtTo'] = to;
  } else {
    delete root.dataset['vtTo'];
  }
  const transition = tdoc.startViewTransition.call(doc, apply);
  const done = () => {
    delete root.dataset['vt'];
    delete root.dataset['vtTo'];
  };
  transition.ready?.catch(() => {});
  transition.finished.then(done, done);
}

/** Remembers where the user last pressed, so the reveal starts from the button they clicked. */
export function trackTransitionOrigin(doc: Document): void {
  const root = doc.documentElement;
  doc.addEventListener('pointerdown', e => {
    root.style.setProperty('--vt-x', `${Math.round(e.clientX)}px`);
    root.style.setProperty('--vt-y', `${Math.round(e.clientY)}px`);
  }, { capture: true, passive: true });
  doc.addEventListener('keydown', () => {
    root.style.removeProperty('--vt-x');
    root.style.removeProperty('--vt-y');
  }, { capture: true, passive: true });
}
