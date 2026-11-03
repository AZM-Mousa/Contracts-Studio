import { GuideAxis } from '../enums/guide-axis.enum';
import type { Rect } from './field.model';

export interface Guide {
  /** 'v' is a vertical line at `pos` (x), 'h' a horizontal one (y). */
  axis: GuideAxis;
  pos: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: Guide[];
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/**
 * Snaps a moving rect to the page edges and centre and to the edges and centres
 * of the other rects, like design tools do. Thresholds are page fractions.
 */
export function snap(moving: Rect, others: readonly Rect[], thresholdX: number, thresholdY: number): SnapResult {
  const xs = [0, 0.5, 1];
  const ys = [0, 0.5, 1];
  for (const r of others) {
    xs.push(r.x, r.x + r.width / 2, r.x + r.width);
    ys.push(r.y, r.y + r.height / 2, r.y + r.height);
  }
  const bestX = bestOffset([moving.x, moving.x + moving.width / 2, moving.x + moving.width], xs, thresholdX);
  const bestY = bestOffset([moving.y, moving.y + moving.height / 2, moving.y + moving.height], ys, thresholdY);
  const guides: Guide[] = [];
  if (bestX) {
    guides.push({ axis: GuideAxis.V, pos: bestX.target });
  }
  if (bestY) {
    guides.push({ axis: GuideAxis.H, pos: bestY.target });
  }
  return {
    x: moving.x + (bestX?.offset ?? 0),
    y: moving.y + (bestY?.offset ?? 0),
    guides,
  };
}

function bestOffset(edges: number[], targets: number[], threshold: number): { offset: number; target: number } | null {
  let best: { offset: number; target: number } | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const offset = target - edge;
      if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) {
        best = { offset, target };
      }
    }
  }
  return best;
}

/**
 * Finds the closest free spot for `rect` that doesn't overlap `others`,
 * searching outwards in rings. Returns the rect unchanged when it's already free.
 */
export function resolveCollision(rect: Rect, others: readonly Rect[], gap = 0.004): Rect {
  const free = (r: Rect) => others.every(o => !overlaps(r, o, gap));
  if (free(rect)) {
    return rect;
  }
  const step = 0.01;
  for (let ring = 1; ring <= 60; ring++) {
    const d = ring * step;
    const candidates: [number, number][] = [
      [0, d], [0, -d], [d, 0], [-d, 0], [d, d], [-d, d], [d, -d], [-d, -d],
    ];
    for (const [dx, dy] of candidates) {
      const next = {
        ...rect,
        x: clamp(rect.x + dx, 0, 1 - rect.width),
        y: clamp(rect.y + dy, 0, 1 - rect.height),
      };
      if (free(next)) {
        return next;
      }
    }
  }
  return rect;
}

export function boundsOf(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map(r => r.x));
  const y = Math.min(...rects.map(r => r.y));
  const right = Math.max(...rects.map(r => r.x + r.width));
  const bottom = Math.max(...rects.map(r => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export const FIELD_GAP = 0.003;

const spans = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && a1 > b0;

/**
 * Limits a resize so the rect never covers another field: each moving edge
 * stops at the nearest field in its way. `base` is the rect before resizing.
 */
export function limitResize(rect: Rect, base: Rect, others: readonly Rect[], edges: { n: boolean; s: boolean; e: boolean; w: boolean }): Rect {
  let { x, y, width, height } = rect;
  let right = x + width;
  let bottom = y + height;
  for (const o of others) {
    // Left/right edges: only fields beside the original vertical span block them.
    if (spans(base.y, base.y + base.height, o.y, o.y + o.height)) {
      if (edges.e && o.x >= base.x + base.width - 1e-6) {
        right = Math.min(right, o.x - FIELD_GAP);
      }
      if (edges.w && o.x + o.width <= base.x + 1e-6) {
        x = Math.max(x, o.x + o.width + FIELD_GAP);
      }
    }
  }
  for (const o of others) {
    // Top/bottom edges: fields within the new horizontal span block them.
    if (spans(x, right, o.x, o.x + o.width)) {
      if (edges.s && o.y >= base.y + base.height - 1e-6) {
        bottom = Math.min(bottom, o.y - FIELD_GAP);
      }
      if (edges.n && o.y + o.height <= base.y + 1e-6) {
        y = Math.max(y, o.y + o.height + FIELD_GAP);
      }
    }
  }
  width = Math.max(right - x, 0);
  height = Math.max(bottom - y, 0);
  return { x, y, width, height };
}

export function overlapsAny(rect: Rect, others: readonly Rect[]): boolean {
  return others.some(o => overlaps(rect, o));
}

/**
 * The nearest spot where `rect` fits without covering another field: first the
 * rings around it, then a scan of the whole page. Null when the page is full.
 */
export function findFreeSpot(rect: Rect, others: readonly Rect[], gap = 0.004): Rect | null {
  const near = resolveCollision(rect, others, gap);
  const free = (r: Rect) => others.every(o => !overlaps(r, o, gap));
  if (free(near)) {
    return near;
  }
  const step = 0.01;
  let best: Rect | null = null;
  let bestDistance = Infinity;
  for (let y = 0; y <= 1 - rect.height + 1e-9; y += step) {
    for (let x = 0; x <= 1 - rect.width + 1e-9; x += step) {
      const candidate = { ...rect, x, y };
      const distance = Math.hypot(x - rect.x, y - rect.y);
      if (distance < bestDistance && free(candidate)) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}
