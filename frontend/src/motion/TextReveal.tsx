import { motion, useReducedMotion } from 'motion/react';
import { EASING, DURATION_SLOW } from './motionConfig';
import { InkUnderline } from './InkUnderline';

export interface TextRevealProps {
  lines?: string[];
  children?: string;
  className?: string;
  lineClassName?: string;
  /** Draw the highlight brush stroke under the last line */
  underlineLast?: boolean;
}

export function TextReveal({
  lines,
  children,
  className = '',
  lineClassName = '',
  underlineLast = false,
}: TextRevealProps) {
  const shouldReduceMotion = useReducedMotion();

  // Determine lines from props
  const rawLines = lines || (children ? children.split('\n') : []);
  const renderLine = (line: string, idx: number) =>
    underlineLast && idx === rawLines.length - 1 ? (
      <span className="ink-underline-word">
        {line}
        <InkUnderline />
      </span>
    ) : (
      line
    );

  if (shouldReduceMotion) {
    return (
      <div className={className}>
        {rawLines.map((line, idx) => (
          <div key={idx} className={lineClassName}>
            {renderLine(line, idx)}
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
            {renderLine(line, idx)}
          </motion.div>
        </div>
      ))}
    </div>
  );
}
