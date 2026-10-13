import {
  MAX_SHOULDER_TILT_DEG,
  MAX_SHOULDER_Z,
  MIN_VISIBILITY,
  STILL_MOVE_PX,
} from './config';
import { LEFT_HEEL, LEFT_SHOULDER, NOSE, RIGHT_HEEL, RIGHT_SHOULDER, type Landmark } from './measureBody';

export type Guidance = 'stepBack' | 'facePhone' | 'holdStill' | 'ready';

export interface PoseCheck {
  wholeBody: boolean;
  shouldersLevel: boolean;
  facingFront: boolean;
  still: boolean;
  ready: boolean;
  guidance: Guidance;
}

function visible(point: Landmark | undefined): boolean {
  return Boolean(point) && (point?.visibility ?? 0) >= MIN_VISIBILITY;
}

function tiltDegrees(left: Landmark, right: Landmark): number {
  const degrees = Math.abs(Math.atan2(right.y - left.y, right.x - left.x) * (180 / Math.PI));
  return degrees > 90 ? 180 - degrees : degrees;
}

function movedPx(
  current: Landmark,
  previous: Landmark,
  imageWidth: number,
  imageHeight: number,
): number {
  const dx = (current.x - previous.x) * imageWidth;
  const dy = (current.y - previous.y) * imageHeight;
  return Math.hypot(dx, dy);
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
  const leftHeel = landmarks[LEFT_HEEL];
  const rightHeel = landmarks[RIGHT_HEEL];

  const inFrame =
    visible(nose) &&
    visible(leftHeel) &&
    visible(rightHeel) &&
    nose.y > 0.04 &&
    nose.y < 0.7 &&
    leftHeel.y < 0.98 &&
    rightHeel.y < 0.98 &&
    leftHeel.y > nose.y &&
    rightHeel.y > nose.y;

  const shouldersLevel =
    visible(left) && visible(right) && tiltDegrees(left, right) <= MAX_SHOULDER_TILT_DEG;
  const facingFront =
    visible(left) && visible(right) && Math.abs((left.z ?? 0) - (right.z ?? 0)) <= MAX_SHOULDER_Z;

  let still = false;
  if (previous && visible(nose) && visible(left) && visible(right)) {
    const shift = Math.max(
      movedPx(nose, previous[NOSE], imageWidth, imageHeight),
      movedPx(left, previous[LEFT_SHOULDER], imageWidth, imageHeight),
      movedPx(right, previous[RIGHT_SHOULDER], imageWidth, imageHeight),
    );
    still = shift <= STILL_MOVE_PX;
  }

  const ready = inFrame && shouldersLevel && facingFront && still;
  let guidance: Guidance = 'ready';
  if (!inFrame) guidance = 'stepBack';
  else if (!shouldersLevel || !facingFront) guidance = 'facePhone';
  else if (!still) guidance = 'holdStill';

  return {
    wholeBody: inFrame,
    shouldersLevel,
    facingFront,
    still,
    ready,
    guidance,
  };
}
