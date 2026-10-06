import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export interface StaggerProps {
  children: ReactNode;
  staggerDelay?: number;
  className?: string;
}

export function Stagger({ children, staggerDelay = 0.06, className = '' }: StaggerProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-10% 0px' }}
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: staggerDelay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
