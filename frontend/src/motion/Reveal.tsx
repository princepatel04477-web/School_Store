import { type ReactNode, type ElementType } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EASING, DURATION_BASE } from './motionConfig';

export interface RevealProps {
  children: ReactNode;
  delay?: number;
  as?: ElementType;
  className?: string;
}

export function Reveal({ children, delay = 0, as = 'div', className = '' }: RevealProps) {
  const shouldReduceMotion = useReducedMotion();
  const MotionComponent = motion.create(as);

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <MotionComponent
      initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true }}
      transition={{
        duration: DURATION_BASE,
        ease: EASING,
        delay,
      }}
      className={className}
    >
      {children}
    </MotionComponent>
  );
}
