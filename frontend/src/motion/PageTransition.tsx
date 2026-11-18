import { type ReactNode, useEffect } from 'react';
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
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();

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
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: EASING } }}
          exit={{ opacity: 0, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
