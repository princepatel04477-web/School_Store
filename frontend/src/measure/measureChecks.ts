import {
  CENTRE_TOLERANCE,
  MAX_FILL,
  MAX_SHOULDER_TILT_DEG,
  MAX_SHOULDER_Z,
  MIN_FILL,
  MIN_VISIBILITY,
  SIDE_MAX_SHOULDER_GAP,
  STILL_MOVE_PX,
} from './config';
import {
  LEFT_ANKLE,
  LEFT_FOOT,
  LEFT_HEEL,
  LEFT_HIP,
  LEFT_SHOULDER,
  NOSE,
  RIGHT_ANKLE,
  RIGHT_FOOT,
  RIGHT_HEEL,
  RIGHT_HIP,
  RIGHT_SHOULDER,
  type Landmark,
} from './measureBody';

/** One short instruction at a time, in the order the parent should fix them. */
export type Guidance =
  | 'moveBack'
  | 'moveCloser'
  | 'standInside'
  | 'showFullBody'
  | 'standStraight'
  | 'holdStill'
  | 'turnSide'
  | 'ready';

export interface PoseCheck {
  /** Nose, shoulders, hips, ankles and heels all seen clearly. */
  wholeBody: boolean;
  centred: boolean;
  fillsOutline: boolean;
  shouldersLevel: boolean;
  facingFront: boolean;
  still: boolean;
  ready: boolean;
  guidance: Guidance;
  /** Lowest visibility of the points that matter: picks the best frames. */
  quality: number;
}

const REQUIRED = [NOSE, LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP, LEFT_ANKLE, RIGHT_ANKLE, LEFT_HEEL, RIGHT_HEEL];

function visible(point: Landmark | undefined): point is Landmark {
  return Boolean(point) && (point?.visibility ?? 0) >= MIN_VISIBILITY;
}

function tiltDegrees(left: Landmark, right: Landmark): number {
  const degrees = Math.abs(Math.atan2(right.y - left.y, right.x - left.x) * (180 / Math.PI));
  return degrees > 90 ? 180 - degrees : degrees;
}

function movedPx(current: Landmark, previous: Landmark, imageWidth: number, imageHeight: number): number {
  return Math.hypot((current.x - previous.x) * imageWidth, (current.y - previous.y) * imageHeight);
}

export function checkPose(
  landmarks: Landmark[],
  imageWidth: number,
  imageHeight: number,
  previous: Landmark[] | null,
): PoseCheck {
  const nose = landmarks[NOSE];
  const left = landmarks[LEFT_SHOULDER];
  const right = landmarks[RIGHT_SHOULDER];
  const quality = Math.min(...REQUIRED.map((index) => landmarks[index]?.visibility ?? 0));

  // Cut off at the top or the bottom of the picture: the child is too close.
  const cutOff =
    (visible(nose) && nose.y < 0.03) ||
    [LEFT_ANKLE, RIGHT_ANKLE, LEFT_HEEL, RIGHT_HEEL].some((i) => visible(landmarks[i]) && landmarks[i].y > 0.98);
  const wholeBody = REQUIRED.every((index) => visible(landmarks[index])) && !cutOff;

  let fillsOutline = false;
  let tooBig = false;
  let centred = false;
  if (wholeBody) {
    const ankleY = (landmarks[LEFT_ANKLE].y + landmarks[RIGHT_ANKLE].y) / 2;
    const fill = ankleY - nose.y;
    tooBig = fill > MAX_FILL;
    fillsOutline = fill >= MIN_FILL && !tooBig;
    const middleX = (left.x + right.x + landmarks[LEFT_HIP].x + landmarks[RIGHT_HIP].x) / 4;
    centred = Math.abs(middleX - 0.5) <= CENTRE_TOLERANCE;
  }

  const shouldersLevel = visible(left) && visible(right) && tiltDegrees(left, right) <= MAX_SHOULDER_TILT_DEG;
  const facingFront = visible(left) && visible(right) && Math.abs((left.z ?? 0) - (right.z ?? 0)) <= MAX_SHOULDER_Z;

  let still = false;
  if (previous && visible(nose) && visible(left) && visible(right)) {
    const shift = Math.max(
      movedPx(nose, previous[NOSE], imageWidth, imageHeight),
      movedPx(left, previous[LEFT_SHOULDER], imageWidth, imageHeight),
      movedPx(right, previous[RIGHT_SHOULDER], imageWidth, imageHeight),
    );
    still = shift <= STILL_MOVE_PX;
  }

  let guidance: Guidance = 'ready';
  if (cutOff || tooBig) guidance = 'moveBack';
  else if (!wholeBody) guidance = 'showFullBody';
  else if (!fillsOutline) guidance = 'moveCloser';
  else if (!centred) guidance = 'standInside';
  else if (!shouldersLevel || !facingFront) guidance = 'standStraight';
  else if (!still) guidance = 'holdStill';

  return {
    wholeBody,
    centred,
    fillsOutline,
    shouldersLevel,
    facingFront,
    still,
    ready: guidance === 'ready',
    guidance,
    quality,
  };
}

/** The body part a frame is missing for a reading, in the order the parent should fix them. */
export type Missing = 'head' | 'shoulders' | 'feet';

/** Feet points are small and often half hidden by shoes, so they count from a lower visibility. */
const FEET_VISIBILITY = 0.3;

/**
 * Enough of the child to work out a reading: the head, both shoulders and the
 * feet, with nothing cut off at the edge. Looser than the auto-capture check
 * (no need to stand perfectly still or straight), so Capture works whenever a
 * reading is possible.
 */
export function measurable(landmarks: Landmark[]): { ok: boolean; missing: Missing | null } {
  const nose = landmarks[NOSE];
  if (!visible(nose) || nose.y < 0.02) return { ok: false, missing: 'head' };
  if (!visible(landmarks[LEFT_SHOULDER]) || !visible(landmarks[RIGHT_SHOULDER])) {
    return { ok: false, missing: 'shoulders' };
  }
  const feet = seenFeet(landmarks);
  if (feet.length === 0 || feet.some((point) => point.y > 0.995)) return { ok: false, missing: 'feet' };
  return { ok: true, missing: null };
}

/** The feet points seen well enough to place the floor. */
function seenFeet(landmarks: Landmark[]): Landmark[] {
  return [LEFT_HEEL, RIGHT_HEEL, LEFT_FOOT, RIGHT_FOOT]
    .map((index) => landmarks[index])
    .filter((point): point is Landmark => Boolean(point) && (point.visibility ?? 0) >= FEET_VISIBILITY);
}

/** The shoulder the camera sees best: side-on, the far one is hidden behind the body. */
export function nearShoulder(landmarks: Landmark[]): Landmark | null {
  const left = landmarks[LEFT_SHOULDER];
  const right = landmarks[RIGHT_SHOULDER];
  const best = (left?.visibility ?? 0) >= (right?.visibility ?? 0) ? left : right;
  return visible(best) ? best : null;
}

/** Side photo: enough of the child for a reading (head, the near shoulder, the feet). */
export function measurableSide(landmarks: Landmark[]): { ok: boolean; missing: Missing | null } {
  const nose = landmarks[NOSE];
  if (!visible(nose) || nose.y < 0.02) return { ok: false, missing: 'head' };
  if (!nearShoulder(landmarks)) return { ok: false, missing: 'shoulders' };
  const feet = seenFeet(landmarks);
  if (feet.length === 0 || feet.some((point) => point.y > 0.995)) return { ok: false, missing: 'feet' };
  return { ok: true, missing: null };
}

/**
 * Side photo checks, in the order the parent should fix them. Side-on, the two
 * shoulders sit almost on top of each other in the picture.
 */
export function checkSide(
  landmarks: Landmark[],
  imageWidth: number,
  imageHeight: number,
  previous: Landmark[] | null,
): { ready: boolean; guidance: Guidance; quality: number } {
  const nose = landmarks[NOSE];
  const shoulder = nearShoulder(landmarks);
  const feet = seenFeet(landmarks);
  const quality = Math.min(nose?.visibility ?? 0, shoulder?.visibility ?? 0, ...feet.map((f) => f.visibility ?? 0), 1);

  const cutOff = (visible(nose) && nose.y < 0.03) || feet.some((point) => point.y > 0.98);
  let guidance: Guidance = 'ready';
  if (cutOff) guidance = 'moveBack';
  else if (!visible(nose) || !shoulder || feet.length === 0) guidance = 'showFullBody';
  else {
    const left = landmarks[LEFT_SHOULDER];
    const right = landmarks[RIGHT_SHOULDER];
    const gap = left && right ? Math.abs(left.x - right.x) : 0;
    const fill = Math.max(...feet.map((point) => point.y)) - nose.y;
    if (gap > SIDE_MAX_SHOULDER_GAP) guidance = 'turnSide';
    else if (fill > MAX_FILL) guidance = 'moveBack';
    else if (fill < MIN_FILL) guidance = 'moveCloser';
    else if (
      !previous ||
      movedPx(nose, previous[NOSE], imageWidth, imageHeight) > STILL_MOVE_PX ||
      movedPx(shoulder, previous[landmarks.indexOf(shoulder)], imageWidth, imageHeight) > STILL_MOVE_PX
    ) {
      guidance = 'holdStill';
    }
  }
  return { ready: guidance === 'ready', guidance, quality };
}
