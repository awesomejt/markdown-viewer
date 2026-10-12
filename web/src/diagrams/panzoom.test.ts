import { describe, expect, it } from 'vitest';
import { FIT, MAX_SCALE, MIN_SCALE, panBy, pinch, wheelFactor, zoomAt } from './panzoom';

describe('panzoom', () => {
  it('zooms around the center by default', () => {
    expect(zoomAt(FIT, 2)).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it('keeps the point under the cursor in place', () => {
    const at = { x: 100, y: -50 };
    const v = zoomAt({ scale: 1, x: 20, y: 10 }, 2, at);
    // Content offset under `at` before: (at - t) / s = (80, -60); after: the same.
    expect((at.x - v.x) / v.scale).toBeCloseTo(80);
    expect((at.y - v.y) / v.scale).toBeCloseTo(-60);
  });

  it('clamps the scale', () => {
    expect(zoomAt(FIT, 100).scale).toBe(MAX_SCALE);
    expect(zoomAt(FIT, 0.001).scale).toBe(MIN_SCALE);
    // At the limit, zooming further changes nothing.
    expect(zoomAt({ scale: MAX_SCALE, x: 5, y: 5 }, 2, { x: 50, y: 50 })).toEqual({
      scale: MAX_SCALE,
      x: 5,
      y: 5,
    });
  });

  it('pans', () => {
    expect(panBy({ scale: 2, x: 1, y: 2 }, 3, -4)).toEqual({ scale: 2, x: 4, y: -2 });
  });

  it('pinches: spread fingers zoom about their midpoint, moved midpoint pans', () => {
    const spread = pinch(
      FIT,
      [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
    );
    expect(spread).toEqual({ scale: 2, x: 0, y: 0 });
    const moved = pinch(
      FIT,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
      ],
    );
    expect(moved).toEqual({ scale: 1, x: 5, y: 5 });
    // Coincident fingers only pan.
    expect(
      pinch(
        FIT,
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
      ),
    ).toEqual({
      scale: 1,
      x: 1,
      y: 1,
    });
  });

  it('turns wheel deltas into bounded factors', () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
    expect(wheelFactor(0, 0)).toBe(1);
    // Lines and pages are converted to pixels, then capped.
    expect(wheelFactor(3, 1)).toBeCloseTo(Math.exp(-48 * 0.002));
    expect(wheelFactor(1, 2)).toBeCloseTo(wheelFactor(1000, 0));
  });
});
