import { type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

export interface StepTransitionProps {
  stepKey: string | number;
  direction?: 'forward' | 'backward';
  children: ReactNode;
  className?: string;
}

const IOS_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * iOS-style push transition between steps (CSS/transform and opacity only, 320ms):
 * Forward: new step slides in from 100% right, old one shifts left to -30% and fades to 0.7.
 * Backward: reversed (new step enters from -30% to 0%, old one exits to 100%).
 * Reduced motion: 120ms fade only, no slide.
 */
export function StepTransition({ stepKey, direction = 'forward', children, className = '' }: StepTransitionProps) {
  const shouldReduceMotion = useReducedMotion();
  const isForward = direction === 'forward';

  if (shouldReduceMotion) {
    return (
      <div className={`step-transition-wrapper ${className}`.trim()}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={stepKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className="step-enter step-enter--reduced"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className={`step-transition-wrapper ${className}`.trim()}>
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div
          key={stepKey}
          custom={direction}
          initial={{
            x: isForward ? '100%' : '-30%',
            opacity: isForward ? 1 : 0.7,
          }}
          animate={{
            x: '0%',
            opacity: 1,
            transition: {
              duration: 0.32,
              ease: IOS_EASE,
            },
          }}
          exit={{
            x: isForward ? '-30%' : '100%',
            opacity: isForward ? 0.7 : 1,
            transition: {
              duration: 0.32,
              ease: IOS_EASE,
            },
          }}
          className={`step-enter step-enter--${direction}`}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
