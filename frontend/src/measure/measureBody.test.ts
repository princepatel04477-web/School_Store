import { describe, expect, it } from 'vitest';
import { measureFrames, type MeasureFrame } from './measureBody';

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
    const result = measureFrames([frame(0.4)], 170, 0);
    expect(result).toEqual({ shoulder_cm: 20, confidence: 1 });
  });

  it('adds the calibration offset', () => {
    const result = measureFrames([frame(0.4)], 170, 1.5);
    expect(result?.shoulder_cm).toBe(21.5);
  });

  it('uses the median of several frames', () => {
    const frames = [0.41, 0.4, 0.39, 0.42, 0.38].map((x) => frame(x));
    const result = measureFrames(frames, 170, 0);
    // Distances: 19, 20, 21, 18, 22. Median 20.
    expect(result?.shoulder_cm).toBe(20);
    expect(result?.confidence).toBe(1);
  });
});
