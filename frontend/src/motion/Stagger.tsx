import { type ReactNode, Children, isValidElement, useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EASING } from './motionConfig';

// Start as soon as any part of the list is on screen. A share of the list's height
// ("amount: 0.15") can never be reached by a list taller than about 6 screens
// (a city with 70 schools), so its items stayed at opacity 0 and the page looked blank.
const IN_VIEW = { once: true, amount: 'some' } as const;
// Longest wait, in seconds, before the last item of a long list starts to appear.
const MAX_STAGGER_TOTAL = 0.6;

export interface StaggerProps {
  children: ReactNode;
  staggerDelay?: number;
  className?: string;
  maxAnimated?: number;
}

export const staggerContainerVariants = {
  hidden: {},
  visible: (staggerDelay = 0.02) => ({
    transition: {
      staggerChildren: staggerDelay,
    },
  }),
};

const IOS_EASE = [0.32, 0.72, 0, 1] as const;

export const staggerChildVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.24,
      ease: IOS_EASE,
    },
  },
};

export const immediateChildVariants = {
  hidden: { opacity: 1, y: 0 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0,
    },
  },
};

/** Phone-specific child animation: drops scale, shortens duration to 0.45s */
export const mobileChildVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.45,
      ease: EASING,
      delay: typeof delay === 'number' ? delay : 0,
    },
  }),
};

/** A photo inside a staggered card wipes up into view as its card arrives. Disabled on phones. */
export const curtainVariants = {
  hidden: () => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767.98px)').matches;
    return isMobile ? { clipPath: 'none' } : { clipPath: 'inset(100% 0% 0% 0%)' };
  },
  visible: () => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767.98px)').matches;
    return isMobile
      ? { clipPath: 'none', transition: { duration: 0 } }
      : {
          clipPath: 'inset(0% 0% 0% 0%)',
          transition: { duration: 0.9, ease: EASING, delay: 0.12 },
        };
  },
};

export function Stagger({ children, staggerDelay = 0.02, className = '', maxAnimated = 8 }: StaggerProps) {
  const shouldReduceMotion = useReducedMotion();
  const [seen, setSeen] = useState(false);
  const reveal = seen
    ? ({ animate: 'visible' } as const)
    : ({ whileInView: 'visible', viewport: IN_VIEW, onViewportEnter: () => setSeen(true) } as const);

  if (shouldReduceMotion) {
    return (
      <div className={className}>
        {Children.map(children, (child) =>
          isValidElement(child) ? <div className="stagger-item">{child}</div> : child
        )}
      </div>
    );
  }

  const count = Children.toArray(children).filter(isValidElement).length;
  return (
    <motion.div
      initial="hidden"
      {...reveal}
      custom={Math.min(staggerDelay, MAX_STAGGER_TOTAL / Math.max(count, 1))}
      variants={staggerContainerVariants}
      className={className}
    >
      {Children.map(children, (child, index) => {
        if (!isValidElement(child)) return child;
        const animateThis = maxAnimated !== undefined ? index < maxAnimated : true;
        return (
          <motion.div variants={animateThis ? staggerChildVariants : immediateChildVariants} className="stagger-item">
            {child}
          </motion.div>
        );
      })}
    </motion.div>
  );
}

export function StaggerItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767.98px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767.98px)');
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (shouldReduceMotion || isMobile) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      variants={staggerChildVariants}
      custom={0}
      className={className}
    >
      {children}
    </motion.div>
  );
}
