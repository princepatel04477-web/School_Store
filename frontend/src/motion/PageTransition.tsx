import { type ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { EASING } from './motionConfig';
import { scrollPageTo } from './SmoothScroll';

export interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Moving between pages: a saffron bar sweeps across the top, the old page fades out
 * fast, and the new one rises in. Each page's own heading then reveals word by word.
 * On phones, vertical translation is omitted to prevent layout thrash and jitter.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767.98px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767.98px)');
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    scrollPageTo(0);
  }, [location.pathname]);

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  return (
    <>
      <motion.span
        key={`bar-${location.pathname}`}
        className="route-sweep"
        aria-hidden="true"
        initial={{ scaleX: 0, opacity: 1 }}
        animate={{ scaleX: 1, opacity: [1, 1, 0] }}
        transition={{ scaleX: { duration: 0.55, ease: EASING }, opacity: { duration: 0.8, times: [0, 0.7, 1] } }}
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={isMobile ? { opacity: 0 } : { opacity: 0, y: 18 }}
          animate={
            isMobile
              ? { opacity: 1, transition: { duration: 0.25, ease: EASING } }
              : { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASING } }
          }
          exit={{ opacity: 0, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
