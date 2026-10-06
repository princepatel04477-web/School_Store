import { type ReactNode, type ElementType } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { motionConfig } from './motionConfig';

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
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{
        duration: motionConfig.duration.reveal,
        ease: motionConfig.ease,
        delay,
      }}
      className={className}
    >
      {children}
    </MotionComponent>
  );
}
