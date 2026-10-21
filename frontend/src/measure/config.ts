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
export const HOLD_MS = 2000;
/** Landmarks are read from the best frames around the capture. */
export const FRAME_TARGET = 10;
export const MIN_FRAMES = 5;

export const MAX_SHOULDER_TILT_DEG = 3;
/** MediaPipe z is a depth ratio. A small left-right gap means the child faces the phone. */
export const MAX_SHOULDER_Z = 0.08;
export const STILL_MOVE_PX = 8;
export const MIN_VISIBILITY = 0.5;

/** Head to ankles should fill most of the outline, which spans most of the screen height. */
export const MIN_FILL = 0.55;
export const MAX_FILL = 0.88;
/** How far the middle of the body may sit from the middle of the screen (share of its width). */
export const CENTRE_TOLERANCE = 0.12;

/**
 * Shoulder width as a share of height that a child's body can have. A reading
 * outside it means the picture was taken badly, so the parent is asked to retake it.
 */
export const SHOULDER_TO_HEIGHT = { min: 0.17, max: 0.32 };
