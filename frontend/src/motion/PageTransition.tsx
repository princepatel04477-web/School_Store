import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { scrollPageTo } from './SmoothScroll';

export interface PageTransitionProps {
  children: ReactNode;
}

/** Scroll position of each page visited in this tab, by history entry. */
const scrollByEntry = new Map<string, number>();

/**
 * Moving between pages. A new page shows at once: a link opens it with a short
 * fade-in (CSS, so it always finishes), while the phone's back and forward buttons
 * show the earlier page instantly, where the parent left it.
 *
 * The old version waited for the leaving page to fade out before it showed the next
 * one. Tapping back again during that fade left the screen empty.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const isBackOrForward = navigationType === 'POP';
  const entryRef = useRef(location.key);
  const pathRef = useRef(location.pathname);

  // The store puts the scroll back itself, so the browser does not jump first.
  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return undefined;
    const before = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = before;
    };
  }, []);

  // Remember how far down each page the parent was.
  useEffect(() => {
    const save = () => scrollByEntry.set(entryRef.current, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, []);

  useLayoutEffect(() => {
    const pageChanged = pathRef.current !== location.pathname;
    entryRef.current = location.key;
    pathRef.current = location.pathname;
    if (!pageChanged) return undefined;

    const saved = isBackOrForward ? scrollByEntry.get(location.key) : undefined;
    if (saved === undefined) {
      scrollPageTo(0);
      return undefined;
    }

    // The earlier page may still be loading its screen or its list, so keep trying
    // for a moment until it is tall enough to scroll back to the same place.
    let frame = 0;
    const started = performance.now();
    const restore = () => {
      const reachable = document.documentElement.scrollHeight - window.innerHeight >= saved;
      if (reachable || performance.now() - started > 1500) {
        scrollPageTo(saved);
        return;
      }
      frame = requestAnimationFrame(restore);
    };
    restore();
    return () => cancelAnimationFrame(frame);
  }, [location.key, location.pathname, isBackOrForward]);

  // Decided once per page, so moving between the shop's steps does not replay it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const animateIn = useMemo(() => !isBackOrForward, [location.pathname]);

  return (
    <>
      {animateIn && <span key={`bar-${location.pathname}`} className="route-sweep" aria-hidden="true" />}
      <div key={location.pathname} className={animateIn ? 'page-enter' : undefined}>
        {children}
      </div>
    </>
  );
}
