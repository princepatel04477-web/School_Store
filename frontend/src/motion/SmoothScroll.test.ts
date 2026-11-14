import { describe, expect, it } from 'vitest';
import { isTrackpadWheel } from './SmoothScroll';

const wheel = (deltaY: number, deltaX = 0, deltaMode = 0) => ({ deltaY, deltaX, deltaMode });

describe('isTrackpadWheel', () => {
  it('treats notched wheel steps as a mouse', () => {
    expect(isTrackpadWheel(wheel(100))).toBe(false);
    expect(isTrackpadWheel(wheel(-120))).toBe(false);
    expect(isTrackpadWheel(wheel(3, 0, 1))).toBe(false); // Firefox, lines
  });
  it('treats small, fractional or sideways deltas as a trackpad', () => {
    expect(isTrackpadWheel(wheel(4))).toBe(true);
    expect(isTrackpadWheel(wheel(53.5))).toBe(true);
    expect(isTrackpadWheel(wheel(100, 2))).toBe(true);
  });
});
