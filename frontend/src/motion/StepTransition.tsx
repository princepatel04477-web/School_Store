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

  const offset = direction === 'forward' ? 12 : -12;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={stepKey}
        initial={{ opacity: 0, x: offset }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -offset }}
        transition={{
          duration: motionConfig.duration.ui,
          ease: motionConfig.ease,
        }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
