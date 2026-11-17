import { type ReactNode, useEffect, useRef } from 'react';
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

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    scrollPageTo(0);
    prevPathRef.current = location.pathname;
  }, [location.pathname]);

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  const isNative = isNativeApp();
  const isCurrentTabRoot = TAB_ROOT_PATHS.has(location.pathname);
  const isPrevTabRoot = TAB_ROOT_PATHS.has(prevPathRef.current);

  // Native app transitions: fade between tabs, slide on inner screens
  const isTabSwitch = isNative && isCurrentTabRoot && isPrevTabRoot;
  const isInnerSlide = isNative && !isTabSwitch;

  const duration = isNative ? 0.22 : 0.3;

  const variants = isInnerSlide
    ? {
        initial: { opacity: 0, x: 24 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -16 },
      }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={variants.initial}
        animate={variants.animate}
        exit={variants.exit}
        transition={{
          duration,
          ease: EASING,
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
