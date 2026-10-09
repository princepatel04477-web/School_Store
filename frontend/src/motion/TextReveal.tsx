import { motion, useReducedMotion } from 'motion/react';
import { EASING, DURATION_SLOW } from './motionConfig';

export interface TextRevealProps {
  lines?: string[];
  children?: string;
  className?: string;
  lineClassName?: string;
}

export function TextReveal({
  lines,
  children,
  className = '',
  lineClassName = '',
}: TextRevealProps) {
  const shouldReduceMotion = useReducedMotion();

  // Determine lines from props
  const rawLines = lines || (children ? children.split('\n') : []);

  if (shouldReduceMotion) {
    return (
      <div className={className}>
        {rawLines.map((line, idx) => (
          <div key={idx} className={lineClassName}>
            {line}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      {rawLines.map((line, idx) => (
        <div
          key={idx}
          style={{
            overflow: 'hidden',
            display: 'block',
          }}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{
              duration: DURATION_SLOW,
              ease: EASING,
              delay: idx * 0.08,
            }}
            className={lineClassName}
          >
            {line}
          </motion.div>
        </div>
      ))}
    </div>
  );
}
