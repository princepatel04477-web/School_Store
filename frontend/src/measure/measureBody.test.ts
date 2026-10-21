import { describe, expect, it } from 'vitest';
import {
  bestFrames,
  crownFromFace,
  isSaneShoulder,
  measureFrames,
  measureSideFrames,
  shoulderEdgePx,
  sideDepthPx,
  withBackCurve,
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

describe('withBackCurve', () => {
  it('leaves a slim reading alone', () => {
    // 166 cm, 55 kg: BMI 20.0. Camera 39.5, tape 40.
    expect(withBackCurve(39.5, 166, 55)).toBe(39.5);
  });

  it('raises a heavy reading towards the tape across the back', () => {
    // 170 cm, 100 kg: BMI 34.6, +21.9%. Camera 44.9, tape 55.
    expect(withBackCurve(44.9, 170, 100)).toBe(54.7);
  });

  it('raises an average build a little', () => {
    // 170 cm, 70 kg: BMI 24.2, +6.3%.
    expect(withBackCurve(40, 170, 70)).toBe(42.5);
  });

  it('stops at 30% however heavy', () => {
    expect(withBackCurve(40, 150, 120)).toBe(52);
  });
});
