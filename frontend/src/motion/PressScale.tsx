import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export interface PressScaleProps {
  children: ReactNode;
  scale?: number;
  className?: string;
}

export function PressScale({ children, scale = 0.98, className = '' }: PressScaleProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div whileTap={{ scale }} className={className}>
      {children}
    </motion.div>
  );
}
