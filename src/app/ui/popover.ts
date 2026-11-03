/** Pixels reserved at the bottom of the screen for floating bars. */
const BOTTOM_RESERVE = 110;

/** True when a popover of `height` fits better above `anchor` than below it. */
export function opensUp(anchor: HTMLElement, height: number): boolean {
  const rect = anchor.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - BOTTOM_RESERVE;
  const above = rect.top;
  return below < height && above > below;
}
