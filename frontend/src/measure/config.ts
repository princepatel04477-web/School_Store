/** On-phone measurement settings. The camera step is on unless VITE_MEASURE_WITH_CAMERA is "0". */

export const MEASURE_WITH_CAMERA = import.meta.env.VITE_MEASURE_WITH_CAMERA !== '0';

/**
 * Multiplies the shoulder width the camera reads. MediaPipe marks the shoulder
 * joints, which sit a little inside the shoulder edge, so this will end up a
 * little above 1 once 20 to 30 children are measured with a tape as well.
 * The live value comes from the server (SHOULDER_CALIBRATION_FACTOR); this is
 * the fallback when it can't be read.
 */
export const DEFAULT_SHOULDER_FACTOR = 1.0;

/** Pose checks run about 10 times a second. */
export const DETECT_INTERVAL_MS = 100;
/** The fit check must hold this long before the picture is taken by itself. */
export const HOLD_MS = 1500;
/** Landmarks are read from the best frames around the capture. */
export const FRAME_TARGET = 10;
export const MIN_FRAMES = 5;
/** Tapping Capture works from fewer frames: the parent has decided the child is in view. */
export const MANUAL_MIN_FRAMES = 2;

/** Looser than a tape needs: a phone held by hand is never quite level. */
export const MAX_SHOULDER_TILT_DEG = 5;
/**
 * MediaPipe z is a depth ratio. A small left-right gap means the child faces the phone.
 * It is noisy on a phone camera, so only a clearly turned body is refused.
 */
export const MAX_SHOULDER_Z = 0.2;
export const STILL_MOVE_PX = 12;
export const MIN_VISIBILITY = 0.5;

/**
 * Head to ankles as a share of the picture height. The whole camera picture is shown
 * (not zoomed), so a child standing far enough back to show the feet fills less of it.
 */
export const MIN_FILL = 0.4;
export const MAX_FILL = 0.88;
/** How far the middle of the body may sit from the middle of the screen (share of its width). */
export const CENTRE_TOLERANCE = 0.15;

/**
 * Shoulder width as a share of height that a child's body can have. A reading
 * outside it means the picture was taken badly, so the parent is asked to retake it.
 */
export const SHOULDER_TO_HEIGHT = { min: 0.17, max: 0.32 };
