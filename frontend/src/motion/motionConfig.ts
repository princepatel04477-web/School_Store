export const EASING = [0.16, 1, 0.3, 1] as const;

export const DURATION_FAST = 0.2;
export const DURATION_BASE = 0.5;
export const DURATION_SLOW = 0.9;

export const motionConfig = {
  ease: EASING,
  duration: {
    fast: DURATION_FAST,
    base: DURATION_BASE,
    slow: DURATION_SLOW,
    // backwards-compatibility aliases
    micro: DURATION_FAST,
    ui: DURATION_FAST,
    reveal: DURATION_BASE,
    thread: DURATION_SLOW,
  },
};
