import { describe, expect, it } from 'vitest';
import { bestFrames, crownFromFace, isSaneShoulder, measureFrames, type MeasureFrame } from './measureBody';
import { checkPose } from './measureChecks';

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
    const far = pose({ 0: { y: 0.4 }, 27: { y: 0.8 }, 28: { y: 0.8 }, 29: { y: 0.82 }, 30: { y: 0.82 } });
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
