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

/**
 * MediaPipe's shoulder points are the centres of the shoulder joints. Muscle and
 * fat sit outside them, a little on a slim child and a lot on a heavy one, so a
 * joint-to-joint reading comes out short on bigger bodies and no single factor
 * fixes that. The body outline at shoulder height shows the real edges. The
 * reading is taken this far from the joint width towards the outline width:
 * 0 is joints only, 1 is the outline edge to edge. A tape laid across the back
 * from shoulder point to shoulder point lands between the two.
 * Starting value from two Indian adults whose joints-only readings were short by
 * 4.9 cm (170 cm, 100 kg) and 2.0 cm (167 cm, 55 kg). Set it from tape checks on
 * Indian schoolchildren: see docs/shoulder-calibration.md.
 */
export const SHOULDER_EDGE_BLEND = 0.5;
/**
 * The curve of the back. A tape across the back follows it; the camera sees a
 * straight line from the front. The heavier someone is for their height, the
 * rounder the back and the bigger the gap, so the camera reading is raised by
 * `perBmi` for every BMI point above `bmiStart`, up to `maxBoost`.
 * From three Indian adults: BMI 20 read right (39.5, tape 40), BMI about 24 read
 * 3 to 4 cm short, BMI 34.6 read 44.9 against a 55 cm tape (+22% needed).
 */
export const BACK_CURVE = { bmiStart: 20, perBmi: 0.015, maxBoost: 0.3 };

/** The outline is trusted only within this many joint widths; wider means it ran into the background. */
export const SHOULDER_EDGE_MAX_RATIO = 1.6;
/** Outline pixels at or above this value (of 255) count as body. */
export const MASK_BODY_MIN = 128;

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

/** Side photo: the two shoulders closer than this share of the picture width means the child stands side-on. */
export const SIDE_MAX_SHOULDER_GAP = 0.05;
/** Body depth at the shoulders as a share of height that a body can have; outside it means retake. */
export const DEPTH_TO_HEIGHT = { min: 0.08, max: 0.3 };

/**
 * Shoulder width as a share of height that a child's body can have. A reading
 * outside it means the picture was taken badly, so the parent is asked to retake it.
 */
export const SHOULDER_TO_HEIGHT = { min: 0.17, max: 0.32 };
