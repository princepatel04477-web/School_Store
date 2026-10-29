import { describe, expect, it } from 'vitest';
import {
  bestFrames,
  crownFromFace,
  isSaneShoulder,
  measureFrames,
  measureSideFrames,
  shoulderCorners,
  shoulderEdgePx,
  sideDepthPx,
  massMultiplier,
  withMassCurve,
  type MeasureFrame,
} from './measureBody';
import { checkPose, checkSide, measurable, measurableSide } from './measureChecks';

function maskWithHead(width: number, height: number, headY: number, noseX: number): Uint8Array {
  const data = new Uint8Array(width * height);
  data[headY * width + noseX] = 255;
  return data;
}

function frame(shoulderLeftX: number, visibility = 1): MeasureFrame {
  const width = 100;
  const height = 200;
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }));
  landmarks[0] = { x: 0.5, y: 0.2, z: 0, visibility };
  landmarks[11] = { x: shoulderLeftX, y: 0.35, z: 0, visibility };
  landmarks[12] = { x: 0.6, y: 0.35, z: 0, visibility };
  landmarks[29] = { x: 0.45, y: 0.9, z: 0, visibility };
  landmarks[30] = { x: 0.55, y: 0.9, z: 0, visibility };
  landmarks[31] = { x: 0.45, y: 0.88, z: 0, visibility };
  landmarks[32] = { x: 0.55, y: 0.88, z: 0, visibility };
  return {
    landmarks,
    imageWidth: width,
    imageHeight: height,
    mask: { width, height, data: maskWithHead(width, height, 10, 50) },
  };
}

describe('measureFrames', () => {
  it('converts a known pose into shoulder centimetres', () => {
    // Head pixel 10, floor 180, height 170 cm, scale 1. Shoulders 20 px apart.
    const result = measureFrames([frame(0.4)], 170, 1);
    expect(result).toEqual({ shoulder_cm: 20, confidence: 1 });
  });

  it('multiplies by the calibration factor', () => {
    expect(measureFrames([frame(0.4)], 170, 1.1)?.shoulder_cm).toBe(22);
  });

  it('uses the median of several frames', () => {
    const frames = [0.41, 0.4, 0.39, 0.42, 0.38].map((x) => frame(x));
    const result = measureFrames(frames, 170, 1);
    // Distances: 19, 20, 21, 18, 22. Median 20.
    expect(result?.shoulder_cm).toBe(20);
    expect(result?.confidence).toBe(1);
  });

  it('falls back to the face for the top of the head when there is no outline', () => {
    const f = frame(0.4);
    f.mask = undefined;
    // Eyes at y 36 px, mouth at 46 px: crown 1.6 x 10 = 16 px above the eyes, at 20 px.
    f.landmarks[2] = { x: 0.45, y: 0.18, z: 0, visibility: 1 };
    f.landmarks[5] = { x: 0.55, y: 0.18, z: 0, visibility: 1 };
    f.landmarks[9] = { x: 0.47, y: 0.23, z: 0, visibility: 1 };
    f.landmarks[10] = { x: 0.53, y: 0.23, z: 0, visibility: 1 };
    expect(crownFromFace(f)).toBeCloseTo(20);
    // Floor 180, crown 20: 160 px for 160 cm, scale 1, shoulders 20 px.
    expect(measureFrames([f], 160, 1)?.shoulder_cm).toBe(20);
  });
});

describe('shoulder edges from the body outline', () => {
  /** frame(0.4): joints at x 40 and 60 px on row 70, 20 px apart; 1 cm per px. */
  function withBody(from: number, to: number, value = 255): MeasureFrame {
    const f = frame(0.4);
    const { width } = f.mask!;
    for (let y = 60; y <= 80; y += 1) for (let x = from; x <= to; x += 1) f.mask!.data[y * width + x] = value;
    return f;
  }

  it('reads the outline edge to edge across the shoulders', () => {
    expect(shoulderEdgePx(withBody(35, 64))).toBe(30);
  });

  it('moves a heavy body halfway from the joints to the outline edges', () => {
    // Joints 20 cm, outline 30 cm: 25 cm. A joints-only reading said 20 here.
    expect(measureFrames([withBody(35, 64)], 170, 1)).toEqual({ shoulder_cm: 25, confidence: 1, joint_cm: 20, edge_cm: 30 });
  });

  it('applies the calibration factor after the blend', () => {
    expect(measureFrames([withBody(35, 64)], 170, 1.1)?.shoulder_cm).toBe(27.5);
  });

  it('keeps the joints when the outline runs off the side of the picture', () => {
    expect(shoulderEdgePx(withBody(0, 64))).toBeNull();
    expect(measureFrames([withBody(0, 64)], 170, 1)).toEqual({ shoulder_cm: 20, confidence: 1 });
  });

  it('keeps the joints when the outline is too wide to be the body', () => {
    // 50 px against 20 px joints: the outline ran into the background.
    expect(measureFrames([withBody(25, 74)], 170, 1)).toEqual({ shoulder_cm: 20, confidence: 1 });
  });

  it('ignores outline pixels the model is less than half sure of', () => {
    expect(shoulderEdgePx(withBody(35, 64, 100))).toBeNull();
  });
});

describe('isSaneShoulder', () => {
  it('accepts a child-shaped reading and rejects a bad one', () => {
    expect(isSaneShoulder(30, 132)).toBe(true);
    expect(isSaneShoulder(15, 132)).toBe(false);
    expect(isSaneShoulder(50, 132)).toBe(false);
    expect(isSaneShoulder(30, 0)).toBe(false);
  });
});

describe('bestFrames', () => {
  it('keeps the clearest frames in their order', () => {
    const frames = [0.2, 0.9, 0.5, 0.8].map((quality, i) => ({ quality, i }));
    expect(bestFrames(frames, 2).map((f) => f.i)).toEqual([1, 3]);
  });
});

/** A child standing well inside the outline, facing the phone. */
function pose(overrides: Record<number, Partial<{ x: number; y: number; z: number; visibility: number }>> = {}) {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  points[0] = { x: 0.5, y: 0.12, z: 0, visibility: 0.9 };
  points[11] = { x: 0.6, y: 0.25, z: 0, visibility: 0.9 };
  points[12] = { x: 0.4, y: 0.25, z: 0, visibility: 0.9 };
  points[23] = { x: 0.56, y: 0.5, z: 0, visibility: 0.9 };
  points[24] = { x: 0.44, y: 0.5, z: 0, visibility: 0.9 };
  points[27] = { x: 0.55, y: 0.85, z: 0, visibility: 0.9 };
  points[28] = { x: 0.45, y: 0.85, z: 0, visibility: 0.9 };
  points[29] = { x: 0.55, y: 0.88, z: 0, visibility: 0.9 };
  points[30] = { x: 0.45, y: 0.88, z: 0, visibility: 0.9 };
  for (const [index, change] of Object.entries(overrides)) points[Number(index)] = { ...points[Number(index)], ...change };
  return points;
}

describe('checkPose', () => {
  const W = 720;
  const H = 1280;

  it('is ready when the child fits and holds still', () => {
    const p = pose();
    const check = checkPose(p, W, H, p);
    expect(check.guidance).toBe('ready');
    expect(check.ready).toBe(true);
  });

  it('asks to move back when the feet are cut off', () => {
    expect(checkPose(pose({ 29: { y: 0.99 } }), W, H, null).guidance).toBe('moveBack');
  });

  it('asks for the full body when the ankles are not seen', () => {
    expect(checkPose(pose({ 27: { visibility: 0.1 } }), W, H, null).guidance).toBe('showFullBody');
  });

  it('asks to move closer when the child is small in the picture', () => {
    const far = pose({ 0: { y: 0.5 }, 27: { y: 0.8 }, 28: { y: 0.8 }, 29: { y: 0.82 }, 30: { y: 0.82 } });
    expect(checkPose(far, W, H, far).guidance).toBe('moveCloser');
  });

  it('asks to stand inside the outline when off to one side', () => {
    const shift = 0.25;
    const p = pose().map((point) => ({ ...point, x: point.x + shift }));
    expect(checkPose(p, W, H, p).guidance).toBe('standInside');
  });

  it('asks to stand straight when the shoulders tilt', () => {
    const p = pose({ 11: { y: 0.29 } });
    expect(checkPose(p, W, H, p).guidance).toBe('standStraight');
  });

  it('asks to hold still while moving', () => {
    const before = pose();
    const after = pose({ 0: { x: 0.53 } });
    expect(checkPose(after, W, H, before).guidance).toBe('holdStill');
  });
});

describe('measurable', () => {
  /** Feet points (heels 29, 30 and toes 31, 32) all set the same way. */
  const feet = (change: Partial<{ y: number; visibility: number }>) => ({ 29: change, 30: change, 31: change, 32: change });

  it('can be read without standing perfectly straight or still', () => {
    const tilted = pose({ 11: { y: 0.22 }, 12: { y: 0.28 } });
    expect(checkPose(tilted, 720, 1280, null).ready).toBe(false);
    expect(measurable(tilted)).toEqual({ ok: true, missing: null });
  });

  it('counts feet that are only partly seen, as shoes often are', () => {
    expect(measurable(pose(feet({ visibility: 0.35 }))).ok).toBe(true);
  });

  it('says the feet are missing when they are out of the picture', () => {
    expect(measurable(pose(feet({ visibility: 0.1 })))).toEqual({ ok: false, missing: 'feet' });
    expect(measurable(pose({ 29: { y: 0.999 } }))).toEqual({ ok: false, missing: 'feet' });
  });

  it('says the head is missing when it is cut off at the top', () => {
    expect(measurable(pose({ 0: { y: 0.01 } }))).toEqual({ ok: false, missing: 'head' });
  });

  it('says the shoulders are missing when one is hidden', () => {
    expect(measurable(pose({ 12: { visibility: 0.2 } }))).toEqual({ ok: false, missing: 'shoulders' });
  });
});

describe('side photo', () => {
  /** Side-on: both shoulders at x 50 px on row 70; body 22 px deep there; 1 cm per px. */
  function sideFrame(from = 40, to = 61): MeasureFrame {
    const f = frame(0.5);
    f.landmarks[11] = { x: 0.5, y: 0.35, z: 0, visibility: 0.9 };
    f.landmarks[12] = { x: 0.51, y: 0.35, z: 0, visibility: 0.4 };
    const { width } = f.mask!;
    for (let y = 60; y <= 80; y += 1) for (let x = from; x <= to; x += 1) f.mask!.data[y * width + x] = 255;
    return f;
  }

  it('reads body depth at the shoulders from the outline', () => {
    const f = sideFrame();
    expect(sideDepthPx(f, f.landmarks[11])).toBe(22);
    expect(measureSideFrames([f], 170)).toEqual({ depth_cm: 22, confidence: 0.9 });
  });

  it('gives no reading when the outline runs off the picture', () => {
    expect(measureSideFrames([sideFrame(0, 61)], 170)).toBeNull();
  });

  it('gives no reading for a depth no body has', () => {
    // 6 px deep for 170 cm: under 8% of height.
    expect(measureSideFrames([sideFrame(47, 52)], 170)).toBeNull();
  });

  it('asks to turn sideways while the child still faces the phone', () => {
    const p = pose();
    expect(checkSide(p, 720, 1280, p).guidance).toBe('turnSide');
  });

  it('is ready side-on, with the far shoulder hidden', () => {
    const p = pose({ 11: { x: 0.5 }, 12: { x: 0.52, visibility: 0.3 } });
    expect(checkSide(p, 720, 1280, p).guidance).toBe('ready');
    expect(measurableSide(p)).toEqual({ ok: true, missing: null });
  });
});

describe('mass correction', () => {
  const flat = { bmiBase: 22, gain: 1, alpha: 0.02, beta: 0, min: 0.85, max: 1.35 };

  it('leaves the baseline build alone when gain is 1', () => {
    expect(massMultiplier(22, flat)).toBe(1);
  });

  it('scales thin bodies down and heavy bodies up', () => {
    expect(massMultiplier(18, flat)).toBeCloseTo(0.92);
    expect(massMultiplier(32, flat)).toBeCloseTo(1.2);
  });

  it('bends with beta, the same way on both sides', () => {
    const bent = { ...flat, beta: 0.001 };
    // d = +10: 1 + 0.2 + 0.1; d = -4: 1 - 0.08 - 0.016.
    expect(massMultiplier(32, bent)).toBeCloseTo(1.3);
    expect(massMultiplier(18, bent)).toBeCloseTo(0.904);
  });

  it('stays inside its limits', () => {
    expect(massMultiplier(60, flat)).toBe(1.35);
    expect(massMultiplier(5, flat)).toBe(0.85);
  });

  it('is switched off for now: the live curve leaves readings alone', () => {
    expect(withMassCurve(44.9, 170, 100)).toBe(44.9);
    expect(withMassCurve(40, 166, 55)).toBe(40);
  });

  it('leaves the reading alone without a height or weight', () => {
    expect(withMassCurve(40, 0, 55)).toBe(40);
  });
});

describe('shoulder points on the outline', () => {
  /**
   * A front-on outline on the 100 x 200 test frame (1 cm per px): neck 10 px wide
   * down to row 60, shoulders sloping out 3 px a row each side to row 65 (40 px),
   * then turning down into the arms (0.5 px a row, then straight) to row 110.
   * Joints at x 32 and 68 on row 70 (36 px apart). The corner is on row 65.
   */
  function shouldersFrame(): MeasureFrame {
    const f = frame(0.32);
    f.landmarks[12] = { x: 0.68, y: 0.35, z: 0, visibility: 1 };
    const { width } = f.mask!;
    const halfWidth = (y: number) => (y < 60 ? 5 : y <= 65 ? 5 + 3 * (y - 60) : y <= 70 ? 20 + 0.5 * (y - 65) : 22.5);
    for (let y = 30; y <= 110; y += 1) {
      const h = Math.floor(halfWidth(y));
      for (let x = 50 - h; x < 50 + h; x += 1) f.mask!.data[y * width + x] = 255;
    }
    return f;
  }

  it('finds where the shoulder slope turns down into the arm', () => {
    const corners = shoulderCorners(shouldersFrame())!;
    expect(corners).not.toBeNull();
    expect(corners.left.y * 200).toBeGreaterThanOrEqual(64);
    expect(corners.left.y * 200).toBeLessThanOrEqual(67);
    // About 20 px out from the middle on each side.
    expect((corners.right.x - corners.left.x) * 100).toBeGreaterThanOrEqual(39);
    expect((corners.right.x - corners.left.x) * 100).toBeLessThanOrEqual(42);
  });

  it('measures shoulder point to shoulder point when it finds them', () => {
    const result = measureFrames([shouldersFrame()], 170, 1)!;
    expect(result.corner_cm).toBeGreaterThanOrEqual(39);
    expect(result.corner_cm).toBeLessThanOrEqual(42);
    expect(result.shoulder_cm).toBe(result.corner_cm);
  });

  /** shouldersFrame with its neck rows (above row 60) redrawn by `neck(y)`. */
  function withNeck(neck: (y: number) => number): MeasureFrame {
    const f = shouldersFrame();
    const { width } = f.mask!;
    for (let y = 30; y < 60; y += 1) {
      f.mask!.data.fill(0, y * width, (y + 1) * width);
      const h = neck(y);
      f.mask!.data.fill(255, y * width + 50 - h, y * width + 50 + h);
    }
    return f;
  }

  it('does not take a jagged neck edge for the shoulder', () => {
    const corners = shoulderCorners(withNeck((y) => (y % 4 < 2 ? 5 : 7)))!;
    expect(corners).not.toBeNull();
    expect(corners.left.y * 200).toBeGreaterThanOrEqual(63);
    expect((corners.right.x - corners.left.x) * 100).toBeGreaterThanOrEqual(39);
  });

  it('does not take a shirt collar for the shoulder', () => {
    // The outline widens from 5 to 9 px at the collar, then runs straight down to the shoulders.
    const corners = shoulderCorners(withNeck((y) => (y < 52 ? 5 : y < 54 ? 5 + 2 * (y - 51) : 9)))!;
    expect(corners).not.toBeNull();
    expect((corners.right.x - corners.left.x) * 100).toBeGreaterThanOrEqual(39);
  });

  it('reads a noisy full-size outline to within a centimetre', () => {
    // 400 x 800 picture, 0.25 cm per px: crown row 40, floor row 720 (170 cm).
    const width = 400;
    const height = 800;
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    landmarks[0] = { x: 0.5, y: 100 / height, z: 0, visibility: 1 };
    landmarks[11] = { x: 128 / width, y: 190 / height, z: 0, visibility: 1 };
    landmarks[12] = { x: 272 / width, y: 190 / height, z: 0, visibility: 1 };
    for (const i of [29, 30, 31, 32]) landmarks[i] = { x: 0.5, y: 720 / height, z: 0, visibility: 1 };
    const data = new Uint8Array(width * height);
    // Head, neck, shoulder slope out to 84 px (42 cm across) at row 175, then down the arm.
    const half = (y: number) =>
      y < 120 ? 30 : y < 160 ? 24 : y <= 175 ? 24 + 4 * (y - 160) : y <= 200 ? 84 + 0.3 * (y - 175) : 91;
    let seed = 7;
    const jitter = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed % 3) - 1;
    };
    for (let y = 40; y <= 720; y += 1) {
      const h = Math.round(half(y));
      data.fill(255, y * width + 200 - h + jitter(), y * width + 200 + h + jitter());
    }
    const f: MeasureFrame = { landmarks, imageWidth: width, imageHeight: height, mask: { width, height, data } };
    const result = measureFrames([f], 170, 1)!;
    expect(result.corner_cm).toBeDefined();
    expect(Math.abs(result.shoulder_cm - 42)).toBeLessThanOrEqual(1);
  });

  it('falls back when the outline has no shoulder slope (a straight block)', () => {
    const f = frame(0.32);
    f.landmarks[12] = { x: 0.68, y: 0.35, z: 0, visibility: 1 };
    const { width } = f.mask!;
    for (let y = 30; y <= 110; y += 1) for (let x = 28; x < 72; x += 1) f.mask!.data[y * width + x] = 255;
    expect(shoulderCorners(f)).toBeNull();
    expect(measureFrames([f], 170, 1)?.corner_cm).toBeUndefined();
  });
});
