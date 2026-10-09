import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EASING, DURATION_SLOW } from './motionConfig';

export interface ImageCurtainProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function ImageCurtain({ children, className = '', delay = 0 }: ImageCurtainProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ clipPath: 'inset(0 100% 0 0)' }}
      whileInView={{ clipPath: 'inset(0 0% 0 0)' }}
      viewport={{ once: true }}
      transition={{
        duration: DURATION_SLOW,
        ease: EASING,
        delay,
      }}
      className={className}
      style={{ overflow: 'hidden', display: 'block' }}
    >
      <motion.div
        initial={{ scale: 1.15 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        transition={{
          duration: DURATION_SLOW,
          ease: EASING,
          delay,
        }}
        style={{ width: '100%', height: '100%' }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
