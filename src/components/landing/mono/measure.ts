// src/components/landing/mono/measure.ts
export interface Point {
  x: number;
  y: number;
}

/** Subset of DOMRect we actually read (so tests can pass plain objects). */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Top-middle of `rect`, expressed relative to `stage`'s top-left corner. */
export function topCenter(rect: Rect, stage: Rect): Point {
  return {
    x: rect.left - stage.left + rect.width / 2,
    y: rect.top - stage.top,
  };
}

/** Middle of `rect`, expressed relative to `stage`'s top-left corner. */
export function center(rect: Rect, stage: Rect): Point {
  return {
    x: rect.left - stage.left + rect.width / 2,
    y: rect.top - stage.top + rect.height / 2,
  };
}

/**
 * A gentle cubic-bezier drape from `from` down to `to`. Control points sit at
 * the vertical midpoint, pulled slightly toward each end so the rope curves
 * rather than running dead straight.
 */
export function ropePath(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const midY = from.y + (to.y - from.y) * 0.5;
  const c1x = from.x + dx * 0.1;
  const c2x = to.x - dx * 0.1;
  return `M ${from.x},${from.y} C ${c1x},${midY} ${c2x},${midY} ${to.x},${to.y}`;
}
