import { type ReactNode, Children, isValidElement } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EASING, DURATION_BASE } from './motionConfig';

export interface StaggerProps {
  children: ReactNode;
  staggerDelay?: number;
  className?: string;
}

export const staggerContainerVariants = {
  hidden: {},
  visible: (staggerDelay = 0.06) => ({
    transition: {
      staggerChildren: staggerDelay,
    },
  }),
};

export const staggerChildVariants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: DURATION_BASE,
      ease: EASING,
    },
  },
};

export function Stagger({ children, staggerDelay = 0.06, className = '' }: StaggerProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      custom={staggerDelay}
      variants={staggerContainerVariants}
      className={className}
    >
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child;
        return (
          <motion.div variants={staggerChildVariants} style={{ display: 'contents' }}>
            {child}
          </motion.div>
        );
      })}
    </motion.div>
  );
}

export function StaggerItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div variants={staggerChildVariants} className={className}>
      {children}
    </motion.div>
  );
}
