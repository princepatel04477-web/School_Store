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
}

export const staggerContainerVariants = {
  hidden: {},
  visible: (staggerDelay = 0.06) => ({
    transition: {
      staggerChildren: staggerDelay,
    },
  }),
};

export const staggerChildVariants = {
  hidden: { opacity: 0, y: 36, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.7,
      ease: EASING,
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

export function Stagger({ children, staggerDelay = 0.06, className = '' }: StaggerProps) {
  const shouldReduceMotion = useReducedMotion();
  // "Appear when on screen" fires once. Items added after that (a list refilled with
  // other choices, a search cleared) would stay at opacity 0, so once the list has
  // been seen it simply stays shown and new items come in with it.
  const [seen, setSeen] = useState(false);
  const reveal = seen
    ? ({ animate: 'visible' } as const)
    : ({ whileInView: 'visible', viewport: IN_VIEW, onViewportEnter: () => setSeen(true) } as const);
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

  // Same wrapper boxes with reduced motion, so layout rules that target them still apply.
  // Phones show the list at once: a scroll-triggered fade left blank gaps while the
  // parent scrolled, and product cards took a second or more to appear.
  if (shouldReduceMotion || isMobile) {
    return (
      <div className={className}>
        {Children.map(children, (child) =>
          isValidElement(child) ? <div className="stagger-item">{child}</div> : child
        )}
      </div>
    );
  }

  // Each child gets a real wrapper box (.stagger-item). A display:contents wrapper has
  // no box, so its opacity and movement never showed and the cards just appeared.
  const count = Children.toArray(children).filter(isValidElement).length;
  return (
    <motion.div
      initial="hidden"
      {...reveal}
      custom={Math.min(staggerDelay, MAX_STAGGER_TOTAL / Math.max(count, 1))}
      variants={staggerContainerVariants}
      className={className}
    >
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child;
        return (
          <motion.div variants={staggerChildVariants} className="stagger-item">
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
