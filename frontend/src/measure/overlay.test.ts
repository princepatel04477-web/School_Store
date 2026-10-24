import { describe, expect, it } from 'vitest';
import { outlineDots } from './overlay';

describe('outlineDots', () => {
  /** A 40 x 40 mask with a 20 x 20 body square from (10, 10). */
  function square() {
    const data = new Uint8Array(40 * 40);
    for (let y = 10; y < 30; y += 1) for (let x = 10; x < 30; x += 1) data[y * 40 + x] = 255;
    return { width: 40, height: 40, data };
  }

  it('puts dots only on the edge of the body, not inside or outside it', () => {
    const dots = outlineDots(square(), 2);
    expect(dots.length).toBeGreaterThan(0);
    for (const [x, y] of dots) {
      expect(x >= 10 && x < 30 && y >= 10 && y < 30).toBe(true);
      const nearEdge = x < 12 || x >= 28 || y < 12 || y >= 28;
      expect(nearEdge).toBe(true);
    }
  });

  it('keeps every other point so the line reads as dotted', () => {
    const all = outlineDots(square(), 2).length;
    // The square's edge on a 2 px grid has 36 points; half are kept.
    expect(all).toBe(18);
  });

  it('draws nothing when nobody is in the picture', () => {
    expect(outlineDots({ width: 40, height: 40, data: new Uint8Array(1600) }, 2)).toEqual([]);
  });

  it('ignores outline pixels the model is less than half sure of', () => {
    const faint = square();
    faint.data.forEach((v, i) => { if (v) faint.data[i] = 100; });
    expect(outlineDots(faint, 2)).toEqual([]);
  });
});
