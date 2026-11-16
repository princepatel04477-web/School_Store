import { describe, expect, it } from 'vitest';
import {
  REFERENCE_CM,
  computeHomography,
  detectReferenceQuad,
  isValidQuad,
  measureGarment,
  measureSegmentCm,
  orderQuadClockwise,
  type Point2D,
  type Quad,
} from './flatGarment';

/** Projects a 2D plane point (X cm, Y cm) through a tilted 3x3 perspective matrix into image pixels. */
function forwardPerspective(p: Point2D): Point2D {
  // Simulates a phone camera held at ~24 degrees pitch over a flat shirt on a bed:
  // top of the shirt is further away (foreshortened), bottom is closer (wider).
  const w = 1 - 0.0045 * p.y + 0.0012 * p.x;
  return {
    x: 500 + (18 * p.x - 1.2 * p.y) / w,
    y: 700 + (0.8 * p.x + 15.5 * p.y) / w,
  };
}

describe('flatGarment homography measurement', () => {
  it('orders scrambled corners clockwise from top-left', () => {
    const ordered = orderQuadClockwise([
      { x: 300, y: 250 },
      { x: 100, y: 100 },
      { x: 100, y: 250 },
      { x: 300, y: 100 },
    ]);
    expect(ordered).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 250 },
      { x: 100, y: 250 },
    ]);
    expect(isValidQuad(ordered)).toBe(true);
  });

  it('measures exact shirt dimensions with a landscape standard card (10 px per cm)', () => {
    const { longCm, shortCm } = REFERENCE_CM.card;
    const quad: Quad = [
      { x: 400, y: 500 },
      { x: 400 + longCm * 10, y: 500 },
      { x: 400 + longCm * 10, y: 500 + shortCm * 10 },
      { x: 400, y: 500 + shortCm * 10 },
    ];
    const result = measureGarment(quad, 'card', {
      shoulder: [{ x: 260, y: 220 }, { x: 604, y: 220 }], // 34.4 cm
      chest: [{ x: 240, y: 380 }, { x: 625, y: 380 }], // 38.5 cm flat -> 77.0 cm around
      length: [{ x: 430, y: 160 }, { x: 430, y: 700 }], // 54.0 cm
    });
    expect(result).toEqual({
      shoulder_cm: 34.4,
      chest_flat_cm: 38.5,
      chest_around_cm: 77,
      length_cm: 54,
      reference: 'card',
    });
  });

  it('auto-handles portrait card orientation and A4 sheets', () => {
    const { longCm, shortCm } = REFERENCE_CM.a4;
    // Portrait A4 sheet: 21.0 cm wide x 29.7 cm tall at 8 px per cm.
    const quad: Quad = [
      { x: 300, y: 300 },
      { x: 300 + shortCm * 8, y: 300 },
      { x: 300 + shortCm * 8, y: 300 + longCm * 8 },
      { x: 300, y: 300 + longCm * 8 },
    ];
    const h = computeHomography(quad, 'a4')!;
    expect(h).not.toBeNull();
    expect(measureSegmentCm(h, { x: 140, y: 200 }, { x: 140 + 42 * 8, y: 200 })).toBe(42);
  });

  it('cancels tilted camera perspective distortion across the entire shirt within 0.1 cm', () => {
    const { longCm, shortCm } = REFERENCE_CM.card;
    // Card placed near the middle of the shirt at plane origin (0..8.56, 0..5.398).
    const cardQuad: Quad = [
      forwardPerspective({ x: 0, y: 0 }),
      forwardPerspective({ x: longCm, y: 0 }),
      forwardPerspective({ x: longCm, y: shortCm }),
      forwardPerspective({ x: 0, y: shortCm }),
    ];
    // Shirt seams far outside the card in 2D plane centimetres:
    // Shoulder: (-18, -22) to (+18, -22) = 36.0 cm
    // Chest flat: (-20, -6) to (+20, -6) = 40.0 cm (80.0 cm around)
    // Length: (4, -26) to (4, +32) = 58.0 cm
    const measured = measureGarment(cardQuad, 'card', {
      shoulder: [forwardPerspective({ x: -18, y: -22 }), forwardPerspective({ x: 18, y: -22 })],
      chest: [forwardPerspective({ x: -20, y: -6 }), forwardPerspective({ x: 20, y: -6 })],
      length: [forwardPerspective({ x: 4, y: -26 }), forwardPerspective({ x: 4, y: 32 })],
    })!;
    expect(measured).not.toBeNull();
    expect(Math.abs(measured.shoulder_cm - 36)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(measured.chest_flat_cm - 40)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(measured.chest_around_cm - 80)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(measured.length_cm - 58)).toBeLessThanOrEqual(0.1);
  });

  it('rejects degenerate or self-intersecting corner quads', () => {
    const bowTie: Quad = [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 200, y: 100 },
      { x: 100, y: 200 },
    ];
    expect(isValidQuad(bowTie)).toBe(false);
  });
});

describe('detectReferenceQuad', () => {
  function syntheticScene(bgLuma: number, cardLuma: number): { rgba: Uint8ClampedArray; w: number; h: number } {
    const w = 320;
    const h = 400;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      rgba[i * 4] = bgLuma;
      rgba[i * 4 + 1] = bgLuma;
      rgba[i * 4 + 2] = bgLuma;
      rgba[i * 4 + 3] = 255;
    }
    // Draw a standard-ratio card (86 x 54 px, ratio 1.59) near the centre.
    for (let y = 173; y < 227; y += 1) {
      for (let x = 117; x < 203; x += 1) {
        const idx = (y * w + x) * 4;
        rgba[idx] = cardLuma;
        rgba[idx + 1] = cardLuma;
        rgba[idx + 2] = cardLuma;
      }
    }
    return { rgba, w, h };
  }

  it('detects a bright PVC card on a dark uniform shirt', () => {
    const { rgba, w, h } = syntheticScene(45, 230);
    const quad = detectReferenceQuad(rgba, w, h, 'card')!;
    expect(quad).not.toBeNull();
    expect(Math.abs(quad[0].x - 117)).toBeLessThanOrEqual(4);
    expect(Math.abs(quad[0].y - 173)).toBeLessThanOrEqual(4);
    expect(Math.abs(quad[2].x - 203)).toBeLessThanOrEqual(4);
    expect(Math.abs(quad[2].y - 227)).toBeLessThanOrEqual(4);
  });

  it('detects a dark card on a white uniform shirt', () => {
    const { rgba, w, h } = syntheticScene(235, 40);
    const quad = detectReferenceQuad(rgba, w, h, 'card')!;
    expect(quad).not.toBeNull();
    expect(Math.abs(quad[1].x - 203)).toBeLessThanOrEqual(4);
    expect(Math.abs(quad[3].y - 227)).toBeLessThanOrEqual(4);
  });
});
