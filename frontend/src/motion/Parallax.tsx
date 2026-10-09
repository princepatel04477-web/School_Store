import { useRef, useState, useEffect, type ReactNode } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';

export interface ParallaxProps {
  children: ReactNode;
  offset?: number; // max 40px per brief
  className?: string;
}

export function Parallax({ children, offset = 40, className = '' }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const [isDesktopPointer, setIsDesktopPointer] = useState(false);

  useEffect(() => {
    const isDesktop = window.matchMedia('(pointer: fine)').matches && !('ontouchstart' in window);
    setIsDesktopPointer(isDesktop);
  }, []);

  const clampedOffset = Math.min(Math.abs(offset), 40);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  // Moves at most 40px against scroll: from +clampedOffset to -clampedOffset
  const y = useTransform(scrollYProgress, [0, 1], [clampedOffset, -clampedOffset]);

  if (shouldReduceMotion || !isDesktopPointer) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div ref={ref} className={className} style={{ display: 'contents' }}>
      <motion.div style={{ y }}>
        {children}
      </motion.div>
    </div>
  );
}
