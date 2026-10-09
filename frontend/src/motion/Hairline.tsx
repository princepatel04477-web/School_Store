import { motion, useReducedMotion } from 'motion/react';
import { EASING, DURATION_BASE } from './motionConfig';

export interface HairlineProps {
  width?: string | number;
  className?: string;
  delay?: number;
}

export function Hairline({ width = '48px', className = '', delay = 0.1 }: HairlineProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return (
      <div
        className={className}
        style={{
          width,
          height: '1px',
          backgroundColor: 'var(--accent)',
          marginTop: '8px',
          marginBottom: '12px',
        }}
      />
    );
  }

  return (
    <motion.div
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true }}
      transition={{
        duration: DURATION_BASE,
        ease: EASING,
        delay,
      }}
      className={className}
      style={{
        width,
        height: '1px',
        backgroundColor: 'var(--accent)',
        transformOrigin: 'left center',
        marginTop: '8px',
        marginBottom: '12px',
        display: 'block',
      }}
    />
  );
}
