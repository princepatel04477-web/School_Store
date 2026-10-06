import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { motionConfig } from './motionConfig';

export interface ThreadProps {
  width?: string | number;
  animate?: boolean;
  delay?: number;
  className?: string;
}

export function Thread({ width = '100%', animate = true, delay = 0, className = '' }: ThreadProps) {
  const shouldReduceMotion = useReducedMotion();
  const rawId = useId();
  const maskId = `thread-mask-${rawId.replace(/:/g, '')}`;

  return (
    <svg
      width={width}
      height="4"
      viewBox="0 0 1000 4"
      preserveAspectRatio="none"
      className={`thread-line ${className}`.trim()}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'hidden' }}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="4">
          {shouldReduceMotion || !animate ? (
            <rect x="0" y="0" width="1000" height="4" fill="#ffffff" />
          ) : (
            <motion.rect
              x="0"
              y="0"
              height="4"
              fill="#ffffff"
              initial={{ width: 0 }}
              whileInView={{ width: 1000 }}
              viewport={{ once: true }}
              transition={{
                duration: motionConfig.duration.thread,
                ease: motionConfig.ease,
                delay,
              }}
            />
          )}
        </mask>
      </defs>
      <line
        x1="0"
        y1="2"
        x2="1000"
        y2="2"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="6 5"
        strokeLinecap="round"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
