import { type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { motionConfig } from './motionConfig';

export interface StepTransitionProps {
  stepKey: string | number;
  direction?: 'forward' | 'backward';
  children: ReactNode;
  className?: string;
}

export function StepTransition({
  stepKey,
  direction = 'forward',
  children,
  className = '',
}: StepTransitionProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  // The next step slides in from the side you're heading; the old one leaves quickly
  // so the wait between steps stays short.
  const offset = direction === 'forward' ? 36 : -36;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={stepKey}
        initial={{ opacity: 0, x: offset }}
        animate={{ opacity: 1, x: 0, transition: { duration: 0.42, ease: motionConfig.ease } }}
        exit={{ opacity: 0, x: -offset * 0.5, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
