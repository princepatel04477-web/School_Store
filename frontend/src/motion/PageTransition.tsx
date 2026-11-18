import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { EASING } from './motionConfig';
import { scrollPageTo } from './SmoothScroll';
import { isNativeApp } from '../native/nativePlatform';

export interface PageTransitionProps {
  children: ReactNode;
}

const TAB_ROOT_PATHS = new Set([
  '/',
  '/orders',
  '/measure',
  '/profile',
  '/parent',
  '/teacher',
  '/teacher/students',
  '/school',
  '/school/classes',
  '/school/orders',
  '/boss',
  '/city',
]);

/**
 * Moving between pages.
 * - Website: a saffron bar sweeps across the top, the old page fades out fast,
 *   and the new one rises in. Each page's heading then reveals word by word.
 * - App: tabs cross-fade like a native tab bar; inner screens slide in from the right.
 * - Website phones: no vertical movement, to avoid jitter.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const prevPathRef = useRef(location.pathname);
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
    prevPathRef.current = location.pathname;
  }, [location.pathname]);

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  const isNative = isNativeApp();

  if (isNative) {
    const isTabSwitch = TAB_ROOT_PATHS.has(location.pathname) && TAB_ROOT_PATHS.has(prevPathRef.current);
    const variants = isTabSwitch
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
      : { initial: { opacity: 0, x: 28 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -16 } };

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={variants.initial}
          animate={variants.animate}
          exit={variants.exit}
          transition={{ duration: 0.24, ease: EASING }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    );
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
