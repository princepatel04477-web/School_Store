import { SHOULDER_OFFSET_CM } from './config';

/** BlazePose indexes used for a full-body front view. */
export const NOSE = 0;
export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;
export const LEFT_HEEL = 29;
export const RIGHT_HEEL = 30;
export const LEFT_FOOT = 31;
export const RIGHT_FOOT = 32;

export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface Mask {
  width: number;
  height: number;
  /** Row-major. A value above 0 is body. */
  data: Uint8Array;
}

export interface MeasureFrame {
  landmarks: Landmark[];
  mask: Mask;
  imageWidth: number;
  imageHeight: number;
}

export interface MeasureResult {
  shoulder_cm: number;
  confidence: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Smallest mask row above the nose that contains a body pixel near the nose column. */
export function headPixelY(mask: Mask, nose: Landmark): number | null {
  const noseX = Math.round(nose.x * mask.width);
  const noseY = Math.round(nose.y * mask.height);
  const band = Math.max(2, Math.round(mask.width * 0.12));
  const limitY = Math.min(mask.height, Math.max(0, noseY));
  for (let y = 0; y < limitY; y += 1) {
    const row = y * mask.width;
    const x0 = Math.max(0, noseX - band);
    const x1 = Math.min(mask.width - 1, noseX + band);
    for (let x = x0; x <= x1; x += 1) {
      if (mask.data[row + x] > 0) return y;
    }
  }
  return null;
}

function floorPixelY(frame: MeasureFrame): number | null {
  const points = [LEFT_HEEL, RIGHT_HEEL, LEFT_FOOT, RIGHT_FOOT]
    .map((index) => frame.landmarks[index])
    .filter((point): point is Landmark => Boolean(point));
  if (points.length === 0) return null;
  const lowest = Math.max(...points.map((point) => point.y));
  return lowest * frame.imageHeight;
}

function frameMeasure(frame: MeasureFrame, heightCm: number, offsetCm: number): MeasureResult | null {
  const nose = frame.landmarks[NOSE];
  const left = frame.landmarks[LEFT_SHOULDER];
  const right = frame.landmarks[RIGHT_SHOULDER];
  if (!nose || !left || !right || heightCm <= 0) return null;

  const headYMask = headPixelY(frame.mask, nose);
  const floorY = floorPixelY(frame);
  if (headYMask == null || floorY == null || frame.mask.height <= 1) return null;

  const headY = headYMask * (frame.imageHeight / frame.mask.height);
  const pixelHeight = floorY - headY;
  if (pixelHeight < 20) return null;

  const scale = heightCm / pixelHeight;
  const dx = (left.x - right.x) * frame.imageWidth;
  const dy = (left.y - right.y) * frame.imageHeight;
  const shoulderPx = Math.hypot(dx, dy);
  const visibility = Math.min(
    nose.visibility ?? 0,
    left.visibility ?? 0,
    right.visibility ?? 0,
    frame.landmarks[LEFT_HEEL]?.visibility ?? 0,
    frame.landmarks[RIGHT_HEEL]?.visibility ?? 0,
  );

  return {
    shoulder_cm: Math.round((shoulderPx * scale + offsetCm) * 10) / 10,
    confidence: Math.round(Math.max(0, Math.min(1, visibility)) * 1000) / 1000,
  };
}

/** Median shoulder and confidence across the still frames. */
export function measureFrames(
  frames: MeasureFrame[],
  heightCm: number,
  offsetCm: number = SHOULDER_OFFSET_CM,
): MeasureResult | null {
  const measured = frames
    .map((frame) => frameMeasure(frame, heightCm, offsetCm))
    .filter((row): row is MeasureResult => row != null);
  if (measured.length === 0) return null;
  return {
    shoulder_cm: Math.round(median(measured.map((row) => row.shoulder_cm)) * 10) / 10,
    confidence: Math.round(median(measured.map((row) => row.confidence)) * 1000) / 1000,
  };
}
