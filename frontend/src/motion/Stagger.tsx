import { type ReactNode, type ReactElement, Children, isValidElement, useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EASING } from './motionConfig';

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
  if (shouldReduceMotion) {
    return (
      <div className={className}>
        {Children.map(children, (child) =>
          isValidElement(child) ? <div className="stagger-item">{child}</div> : child
        )}
      </div>
    );
  }

  // On phones: drop scale, shorten duration to 0.45s, cap total stagger duration to ~0.5s,
  // and items far below the fold (index >= 8) do not wait for the stagger queue.
  if (isMobile) {
    const validChildren = Children.toArray(children).filter(isValidElement) as ReactElement[];
    const count = validChildren.length;
    const mobileStagger = Math.min(staggerDelay, 0.5 / Math.max(count, 1));

    return (
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
        className={className}
      >
        {validChildren.map((child, i) => (
          <motion.div
            key={child.key ?? i}
            variants={mobileChildVariants}
            custom={i < 8 ? Math.min(i * mobileStagger, 0.5) : 0}
            className="stagger-item"
          >
            {child}
          </motion.div>
        ))}
      </motion.div>
    );
  }

  // Each child gets a real wrapper box (.stagger-item). A display:contents wrapper has
  // no box, so its opacity and movement never showed and the cards just appeared.
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      custom={staggerDelay}
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

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      variants={isMobile ? mobileChildVariants : staggerChildVariants}
      custom={0}
      className={className}
    >
      {children}
    </motion.div>
  );
}
