import {
  DEFAULT_SHOULDER_FACTOR,
  MASS_CURVE,
  MASK_BODY_MIN,
  SHOULDER_EDGE_BLEND,
  SHOULDER_EDGE_MAX_RATIO,
  SHOULDER_TO_HEIGHT,
  DEPTH_TO_HEIGHT,
  CORNER_SLOPE,
  CORNER_TO_JOINTS,
} from './config';

/** BlazePose indexes used for a full-body front view. */
export const NOSE = 0;
export const LEFT_EYE = 2;
export const RIGHT_EYE = 5;
export const MOUTH_LEFT = 9;
export const MOUTH_RIGHT = 10;
export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;
export const LEFT_HIP = 23;
export const RIGHT_HIP = 24;
export const LEFT_ANKLE = 27;
export const RIGHT_ANKLE = 28;
export const LEFT_HEEL = 29;
export const RIGHT_HEEL = 30;
export const LEFT_FOOT = 31;
export const RIGHT_FOOT = 32;

/**
 * The pose model has no point for the top of the head. When the body outline
 * (segmentation mask) doesn't give it, it is estimated from the face: the top
 * of a child's head sits about this many eye-to-mouth distances above the eyes.
 */
export const CROWN_ABOVE_EYES = 1.6;

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
  /** Missing when the model gave no outline for this frame. */
  mask?: Mask;
  imageWidth: number;
  imageHeight: number;
}

export interface MeasureResult {
  shoulder_cm: number;
  confidence: number;
  /**
   * The two readings the shoulder is worked out from, before the calibration
   * factor: joint centre to joint centre, and outline edge to edge. Only set
   * when the outline gave the edges; kept for checking against a tape.
   */
  joint_cm?: number;
  edge_cm?: number;
  /** Shoulder point to shoulder point on the outline (the reading used when it is found). */
  corner_cm?: number;
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

/** Rows above and below the shoulder line that are read for the edges. */
const EDGE_ROWS = 2;

/**
 * Width of the body outline across the shoulders, in image pixels: from each
 * shoulder joint outwards to where the outline ends, on the shoulder line and
 * the rows next to it (median). null when the outline is missing, the joints
 * aren't inside it, or it runs off the side of the picture.
 */
export function shoulderEdgePx(frame: MeasureFrame): number | null {
  const mask = frame.mask;
  const left = frame.landmarks[LEFT_SHOULDER];
  const right = frame.landmarks[RIGHT_SHOULDER];
  if (!mask || mask.width < 2 || mask.height < 2 || !left || !right) return null;
  const body = (x: number, row: number) => mask.data[row + x] >= MASK_BODY_MIN;
  const lineY = Math.round(((left.y + right.y) / 2) * mask.height);
  const innerLeft = Math.round(Math.min(left.x, right.x) * mask.width);
  const innerRight = Math.round(Math.max(left.x, right.x) * mask.width);
  if (innerLeft < 0 || innerRight >= mask.width) return null;

  const spans: number[] = [];
  for (let y = lineY - EDGE_ROWS; y <= lineY + EDGE_ROWS; y += 1) {
    if (y < 0 || y >= mask.height) continue;
    const row = y * mask.width;
    if (!body(innerLeft, row) || !body(innerRight, row)) continue;
    let edgeLeft = innerLeft;
    while (edgeLeft > 0 && body(edgeLeft - 1, row)) edgeLeft -= 1;
    let edgeRight = innerRight;
    while (edgeRight < mask.width - 1 && body(edgeRight + 1, row)) edgeRight += 1;
    // Touching the side of the picture: the real edge is out of view.
    if (edgeLeft === 0 || edgeRight === mask.width - 1) continue;
    spans.push(edgeRight - edgeLeft + 1);
  }
  if (spans.length < EDGE_ROWS + 1) return null;
  return median(spans) * (frame.imageWidth / mask.width);
}

/** The two shoulder points found on the outline, as shares of the picture (0 to 1). */
export interface ShoulderCorners {
  left: { x: number; y: number };
  right: { x: number; y: number };
}

/**
 * The shoulder points a tailor puts the tape on, found on the body outline.
 * Going down from the neck, each side of the outline first runs out fast along
 * the slope of the shoulder (flatter than 45 degrees), then turns down into the
 * arm. The shoulder point is where it turns: the first row after the slope where
 * the edge moves out less than CORNER_SLOPE pixels per row. null when the outline
 * doesn't show that shape on both sides (loose clothes, arms raised, no outline).
 */
export function shoulderCorners(frame: MeasureFrame): ShoulderCorners | null {
  const mask = frame.mask;
  const nose = frame.landmarks[NOSE];
  const left = frame.landmarks[LEFT_SHOULDER];
  const right = frame.landmarks[RIGHT_SHOULDER];
  if (!mask || mask.width < 2 || mask.height < 2 || !nose || !left || !right) return null;
  const noseY = nose.y * mask.height;
  const lineY = ((left.y + right.y) / 2) * mask.height;
  const reach = lineY - noseY;
  if (reach < 4) return null;
  const centre = Math.round(((left.x + right.x) / 2) * mask.width);
  if (centre < 0 || centre >= mask.width) return null;

  // From the chin to a little below the shoulder joints.
  const firstRow = Math.max(0, Math.round(noseY + 0.35 * reach));
  const lastRow = Math.min(mask.height - 1, Math.round(lineY + 0.6 * reach));
  const outLeft: (number | null)[] = [];
  const outRight: (number | null)[] = [];
  for (let y = firstRow; y <= lastRow; y += 1) {
    const run = runAt(mask, y * mask.width, centre);
    outLeft.push(run && run[0] > 0 ? centre - run[0] : null);
    outRight.push(run && run[1] < mask.width - 1 ? run[1] - centre : null);
  }

  // How far out each side reaches at the shoulder point, and on which row.
  const corner = (out: (number | null)[]): { reach: number; row: number } | null => {
    let onSlope = false;
    for (let i = 1; i < out.length - 1; i += 1) {
      const before = out[i - 1];
      const after = out[i + 1];
      if (before == null || after == null || out[i] == null) continue;
      const speed = (after - before) / 2;
      if (speed >= CORNER_SLOPE) onSlope = true;
      else if (onSlope) return { reach: out[i]!, row: firstRow + i };
    }
    return null;
  };
  const l = corner(outLeft);
  const r = corner(outRight);
  if (!l || !r) return null;
  return {
    left: { x: (centre - l.reach) / mask.width, y: l.row / mask.height },
    right: { x: (centre + r.reach + 1) / mask.width, y: r.row / mask.height },
  };
}

/** Body run on one outline row that contains column x: [left edge, right edge], or null. */
function runAt(mask: Mask, rowStart: number, x: number): [number, number] | null {
  if (mask.data[rowStart + x] < MASK_BODY_MIN) return null;
  let left = x;
  while (left > 0 && mask.data[rowStart + left - 1] >= MASK_BODY_MIN) left -= 1;
  let right = x;
  while (right < mask.width - 1 && mask.data[rowStart + right + 1] >= MASK_BODY_MIN) right += 1;
  return [left, right];
}

/**
 * Side photo: how deep the body is at the shoulders (chest to back), in image
 * pixels. The outline row through the near shoulder, read edge to edge around
 * that shoulder, on the shoulder line and the rows next to it (median).
 */
export function sideDepthPx(frame: MeasureFrame, shoulder: Landmark): number | null {
  const mask = frame.mask;
  if (!mask || mask.width < 2 || mask.height < 2) return null;
  const lineY = Math.round(shoulder.y * mask.height);
  const x = Math.round(shoulder.x * mask.width);
  if (x < 0 || x >= mask.width) return null;
  const spans: number[] = [];
  for (let y = lineY - EDGE_ROWS; y <= lineY + EDGE_ROWS; y += 1) {
    if (y < 0 || y >= mask.height) continue;
    const run = runAt(mask, y * mask.width, x);
    if (!run || run[0] === 0 || run[1] === mask.width - 1) continue;
    spans.push(run[1] - run[0] + 1);
  }
  if (spans.length < EDGE_ROWS + 1) return null;
  return median(spans) * (frame.imageWidth / mask.width);
}

export interface SideResult {
  /** Chest to back at shoulder height, in cm. */
  depth_cm: number;
  confidence: number;
}

/** Side photo reading: median body depth across the frames, scaled by the typed height. */
export function measureSideFrames(frames: MeasureFrame[], heightCm: number): SideResult | null {
  const rows = frames
    .map((frame) => {
      const left = frame.landmarks[LEFT_SHOULDER];
      const right = frame.landmarks[RIGHT_SHOULDER];
      const shoulder = (left?.visibility ?? 0) >= (right?.visibility ?? 0) ? left : right;
      const top = headY(frame);
      const floorY = floorPixelY(frame);
      if (!shoulder || top == null || floorY == null || floorY - top < 20 || heightCm <= 0) return null;
      const depthPx = sideDepthPx(frame, shoulder);
      if (depthPx == null) return null;
      return {
        depth_cm: (depthPx * heightCm) / (floorY - top),
        confidence: Math.min(shoulder.visibility ?? 0, frame.landmarks[NOSE]?.visibility ?? 0),
      };
    })
    .filter((row): row is SideResult => row != null);
  if (rows.length === 0) return null;
  const depth = median(rows.map((row) => row.depth_cm));
  const ratio = depth / heightCm;
  if (ratio < DEPTH_TO_HEIGHT.min || ratio > DEPTH_TO_HEIGHT.max) return null;
  return {
    depth_cm: Math.round(depth * 10) / 10,
    confidence: Math.round(Math.max(0, Math.min(1, median(rows.map((row) => row.confidence)))) * 1000) / 1000,
  };
}

/** Top of the head in image pixels, from the eyes and mouth. */
export function crownFromFace(frame: MeasureFrame): number | null {
  const points = [LEFT_EYE, RIGHT_EYE, MOUTH_LEFT, MOUTH_RIGHT].map((i) => frame.landmarks[i]);
  if (points.some((p) => !p)) return null;
  const eyeY = ((points[0].y + points[1].y) / 2) * frame.imageHeight;
  const mouthY = ((points[2].y + points[3].y) / 2) * frame.imageHeight;
  const eyeToMouth = mouthY - eyeY;
  if (eyeToMouth <= 0) return null;
  return eyeY - CROWN_ABOVE_EYES * eyeToMouth;
}

function headY(frame: MeasureFrame): number | null {
  const nose = frame.landmarks[NOSE];
  if (frame.mask && frame.mask.height > 1 && nose) {
    const fromMask = headPixelY(frame.mask, nose);
    if (fromMask != null) return fromMask * (frame.imageHeight / frame.mask.height);
  }
  return crownFromFace(frame);
}

/**
 * The floor: the lowest heel or toe point. The typed height is measured to the
 * floor, so this matches it better than the ankles, which sit a few cm higher.
 */
function floorPixelY(frame: MeasureFrame): number | null {
  const points = [LEFT_HEEL, RIGHT_HEEL, LEFT_FOOT, RIGHT_FOOT]
    .map((index) => frame.landmarks[index])
    .filter((point): point is Landmark => Boolean(point));
  if (points.length === 0) return null;
  return Math.max(...points.map((point) => point.y)) * frame.imageHeight;
}

function frameMeasure(frame: MeasureFrame, heightCm: number, factor: number): MeasureResult | null {
  const nose = frame.landmarks[NOSE];
  const left = frame.landmarks[LEFT_SHOULDER];
  const right = frame.landmarks[RIGHT_SHOULDER];
  if (!nose || !left || !right || heightCm <= 0) return null;

  const top = headY(frame);
  const floorY = floorPixelY(frame);
  if (top == null || floorY == null) return null;

  const pixelHeight = floorY - top;
  if (pixelHeight < 20) return null;

  const scale = heightCm / pixelHeight;
  const jointPx = Math.hypot((left.x - right.x) * frame.imageWidth, (left.y - right.y) * frame.imageHeight);
  // Move towards the outline's edges when they can be trusted (see SHOULDER_EDGE_BLEND).
  const edgePx = shoulderEdgePx(frame);
  const edgeOk = edgePx != null && edgePx >= jointPx && edgePx <= jointPx * SHOULDER_EDGE_MAX_RATIO;
  const blendPx = edgeOk ? jointPx + SHOULDER_EDGE_BLEND * (edgePx - jointPx) : jointPx;
  // The shoulder points on the outline come first; the joint and outline blend is the fallback.
  const corners = shoulderCorners(frame);
  const cornerPx = corners
    ? Math.hypot(
        (corners.right.x - corners.left.x) * frame.imageWidth,
        (corners.right.y - corners.left.y) * frame.imageHeight,
      )
    : null;
  const cornerOk =
    cornerPx != null && cornerPx >= jointPx * CORNER_TO_JOINTS.min && cornerPx <= jointPx * CORNER_TO_JOINTS.max;
  const shoulderPx = cornerOk ? cornerPx : blendPx;
  const visibility = Math.min(
    nose.visibility ?? 0,
    left.visibility ?? 0,
    right.visibility ?? 0,
    frame.landmarks[LEFT_HEEL]?.visibility ?? 0,
    frame.landmarks[RIGHT_HEEL]?.visibility ?? 0,
  );

  return {
    shoulder_cm: Math.round(shoulderPx * scale * factor * 10) / 10,
    confidence: Math.round(Math.max(0, Math.min(1, visibility)) * 1000) / 1000,
    ...(edgeOk
      ? { joint_cm: Math.round(jointPx * scale * 10) / 10, edge_cm: Math.round(edgePx * scale * 10) / 10 }
      : {}),
    ...(cornerOk ? { corner_cm: Math.round(cornerPx * scale * 10) / 10 } : {}),
  };
}

/** Median shoulder and confidence across the frames (the best ones around the capture). */
export function measureFrames(
  frames: MeasureFrame[],
  heightCm: number,
  factor: number = DEFAULT_SHOULDER_FACTOR,
): MeasureResult | null {
  const measured = frames
    .map((frame) => frameMeasure(frame, heightCm, factor))
    .filter((row): row is MeasureResult => row != null);
  if (measured.length === 0) return null;
  const withEdges = measured.filter((row) => row.edge_cm !== undefined && row.joint_cm !== undefined);
  return {
    shoulder_cm: Math.round(median(measured.map((row) => row.shoulder_cm)) * 10) / 10,
    confidence: Math.round(median(measured.map((row) => row.confidence)) * 1000) / 1000,
    ...(withEdges.length > 0
      ? {
          joint_cm: Math.round(median(withEdges.map((row) => row.joint_cm!)) * 10) / 10,
          edge_cm: Math.round(median(withEdges.map((row) => row.edge_cm!)) * 10) / 10,
        }
      : {}),
    ...(measured.some((row) => row.corner_cm !== undefined)
      ? {
          corner_cm:
            Math.round(
              median(measured.filter((row) => row.corner_cm !== undefined).map((row) => row.corner_cm!)) * 10,
            ) / 10,
        }
      : {}),
  };
}

/** A shoulder width a child of this height can have; anything else means retake. */
export function isSaneShoulder(shoulderCm: number, heightCm: number): boolean {
  if (!(shoulderCm > 0) || !(heightCm > 0)) return false;
  const ratio = shoulderCm / heightCm;
  return ratio >= SHOULDER_TO_HEIGHT.min && ratio <= SHOULDER_TO_HEIGHT.max;
}

/** The mass-correction multiplier for this BMI (see MASS_CURVE in config.ts). */
export function massMultiplier(bmi: number, curve = MASS_CURVE): number {
  const d = bmi - curve.bmiBase;
  const raw = curve.gain + curve.alpha * d + curve.beta * d * Math.abs(d);
  return Math.min(curve.max, Math.max(curve.min, raw));
}

/** The camera's shoulder reading corrected for build: scaled down for thin bodies, up for heavy ones. */
export function withMassCurve(shoulderCm: number, heightCm: number, weightKg: number, curve = MASS_CURVE): number {
  if (!(shoulderCm > 0) || !(heightCm > 0) || !(weightKg > 0)) return shoulderCm;
  const bmi = weightKg / (heightCm / 100) ** 2;
  return Math.round(shoulderCm * massMultiplier(bmi, curve) * 10) / 10;
}

/** The best `count` frames by quality, keeping their order. */
export function bestFrames<T extends { quality: number }>(frames: T[], count: number): T[] {
  const keep = new Set([...frames].sort((a, b) => b.quality - a.quality).slice(0, count));
  return frames.filter((frame) => keep.has(frame));
}
