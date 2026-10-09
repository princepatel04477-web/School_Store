import { useRef, useState, useEffect, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EASING, DURATION_FAST } from './motionConfig';

export interface MagneticProps {
  children: ReactNode;
  maxDistance?: number; // max 6px per brief
  className?: string;
}

export function Magnetic({ children, maxDistance = 6, className = '' }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const [isDesktopPointer, setIsDesktopPointer] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const isDesktop = window.matchMedia('(pointer: fine)').matches && !('ontouchstart' in window);
    setIsDesktopPointer(isDesktop);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current || !isDesktopPointer || shouldReduceMotion) return;
    const { clientX, clientY } = e;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    const centerX = left + width / 2;
    const centerY = top + height / 2;

    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;

    // Pull up to 6px toward cursor
    const pullX = Math.max(-maxDistance, Math.min(maxDistance, deltaX * 0.2));
    const pullY = Math.max(-maxDistance, Math.min(maxDistance, deltaY * 0.2));

    setPosition({ x: pullX, y: pullY });
  };

  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 });
  };

  if (shouldReduceMotion || !isDesktopPointer) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={className}
      style={{ display: 'inline-block' }}
    >
      <motion.div
        animate={{ x: position.x, y: position.y }}
        transition={{
          type: 'tween',
          duration: DURATION_FAST,
          ease: EASING,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
