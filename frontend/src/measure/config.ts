/** On-phone measurement settings. The camera step stays off until the flag is "1". */

export const MEASURE_WITH_CAMERA = import.meta.env.VITE_MEASURE_WITH_CAMERA === '1';

/** Added after the pixel scale. MediaPipe reads the joint, which is narrow. Default 0. */
export const SHOULDER_OFFSET_CM = 0;

export const MAX_SHOULDER_TILT_DEG = 3;
/** MediaPipe z is a depth ratio. A small left-right gap means the child faces the phone. */
export const MAX_SHOULDER_Z = 0.08;
export const STILL_MS = 1000;
export const STILL_MOVE_PX = 8;
export const MIN_CONFIDENCE = 0.6;
export const MIN_VISIBILITY = 0.5;
export const FRAME_TARGET = 8;
export const MIN_FRAMES = 5;
