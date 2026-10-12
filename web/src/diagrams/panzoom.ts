/**
 * Pan/zoom math for the full-screen diagram viewer (R2.8). The image is centered in the
 * viewport and drawn with `translate(x, y) scale(scale)` around its center, so every point
 * here is relative to the viewport center.
 */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;
/** Factor for one zoom button press or key press. */
export const ZOOM_STEP = 1.25;
export const FIT: View = { scale: 1, x: 0, y: 0 };

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Zooms by `factor` keeping the content under `at` in place. */
export function zoomAt(view: View, factor: number, at: Point = { x: 0, y: 0 }): View {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: at.x - k * (at.x - view.x), y: at.y - k * (at.y - view.y) };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Two-finger gesture: the midpoint pans and the finger distance zooms. */
export function pinch(view: View, from: [Point, Point], to: [Point, Point]): View {
  const m0 = mid(...from);
  const m1 = mid(...to);
  const d0 = Math.hypot(from[0].x - from[1].x, from[0].y - from[1].y);
  const d1 = Math.hypot(to[0].x - to[1].x, to[0].y - to[1].y);
  const panned = panBy(view, m1.x - m0.x, m1.y - m0.y);
  return d0 > 0 && d1 > 0 ? zoomAt(panned, d1 / d0, m1) : panned;
}

/** Wheel zoom factor; trackpad pinches arrive as small `deltaY` with `ctrlKey`. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-100, Math.min(100, px)) * 0.002);
}
