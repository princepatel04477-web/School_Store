import { useEffect, type ReactNode } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

let active: Lenis | null = null;

/**
 * Scrolls the page. Goes through the smooth scroller when it is on, so it never
 * pulls the page back to where it was heading before the jump.
 */
export function scrollPageTo(top: number, smooth = false) {
  if (active) active.scrollTo(top, { immediate: !smooth, force: true });
  else window.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
}

/**
 * A notched mouse wheel sends whole steps of 50 px or more (or lines). A trackpad sends
 * small, fractional or sideways deltas and already has its own momentum; smoothing it a
 * second time is what makes scrolling feel laggy, so trackpads keep the browser's scroll.
 */
export function isTrackpadWheel(event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>): boolean {
  if (event.deltaMode !== 0) return false;
  return event.deltaX !== 0 || !Number.isInteger(event.deltaY) || Math.abs(event.deltaY) < 50;
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Mouse wheels only: touch screens and trackpads keep native scrolling, and reduced motion is respected
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isDesktopPointer = window.matchMedia('(pointer: fine)').matches && !('ontouchstart' in window);

    if (prefersReducedMotion || !isDesktopPointer) {
      return;
    }

    let trackpad = false;
    const lenis = new Lenis({
      // Settles in about a third of a second: smooth, without floating after the wheel stops
      lerp: 0.14,
      wheelMultiplier: 0.9,
      smoothWheel: true,
      syncTouch: false,
      // Drawers, sheets and lists scroll themselves instead of the page behind them
      allowNestedScroll: true,
      autoRaf: true,
      // Once a trackpad is seen, every scroll stays native for this visit
      virtualScroll: ({ event }) => {
        if (!(event instanceof WheelEvent)) return true;
        trackpad ||= isTrackpadWheel(event);
        return !trackpad;
      },
    });
    active = lenis;

    // A dialog locks the page with body overflow hidden; the smooth scroller pauses with it
    const syncLock = () => (document.body.style.overflow === 'hidden' ? lenis.stop() : lenis.start());
    const observer = new MutationObserver(syncLock);
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });

    return () => {
      observer.disconnect();
      active = null;
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
