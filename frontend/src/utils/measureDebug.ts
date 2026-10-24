/**
 * Tape checks: with "measuredebug" in the address (once is enough for the visit),
 * the camera and results screens also show the raw readings and the build.
 */
export function measureDebug(): boolean {
  try {
    if (window.location.search.includes('measuredebug')) sessionStorage.setItem('measuredebug', '1');
    return sessionStorage.getItem('measuredebug') === '1';
  } catch {
    return window.location.search.includes('measuredebug');
  }
}
