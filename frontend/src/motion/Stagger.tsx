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
  hidden: { opacity: 0, y: 36, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.7,
      ease: EASING,
    },
  },
};

/** A photo inside a staggered card wipes up into view as its card arrives. */
export const curtainVariants = {
  hidden: { clipPath: 'inset(100% 0% 0% 0%)' },
  visible: {
    clipPath: 'inset(0% 0% 0% 0%)',
    transition: { duration: 0.9, ease: EASING, delay: 0.12 },
  },
};

export function Stagger({ children, staggerDelay = 0.06, className = '' }: StaggerProps) {
  const shouldReduceMotion = useReducedMotion();

  // Same wrapper boxes with reduced motion, so layout rules that target them still apply.
  if (shouldReduceMotion) {
    return (
      <div className={className}>
        {Children.map(children, (child) =>
          isValidElement(child) ? <div className="stagger-item">{child}</div> : child
        )}
      </div>
    );
  }

  // Each child gets a real wrapper box (.stagger-item). A display:contents wrapper has
  // no box, so its opacity and movement never showed and the cards just appeared.
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      custom={staggerDelay}
      variants={staggerContainerVariants}
      className={className}
    >
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child;
        return (
          <motion.div variants={staggerChildVariants} className="stagger-item">
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
