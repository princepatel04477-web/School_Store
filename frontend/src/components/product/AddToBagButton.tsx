import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { EASING, DURATION_FAST } from '../../motion/motionConfig';
import './product.css';

/** How long "Added" stays on screen before the button hands over. */
const ADDED_HOLD_MS = 700;

export interface AddToBagButtonProps {
  /** Adds the item. Return false when it could not be added (e.g. no size picked). */
  onAdd: () => boolean;
  /** Called once the "Added" moment is over. */
  onSettled?: () => void;
  variant?: 'primary' | 'outline';
  className?: string;
  children: ReactNode;
}

export function AddToBagButton({
  onAdd,
  onSettled,
  variant = 'outline',
  className = '',
  children,
}: AddToBagButtonProps) {
  const [added, setAdded] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleClick = () => {
    if (added || !onAdd()) return;
    setAdded(true);
    timer.current = window.setTimeout(() => {
      setAdded(false);
      onSettled?.();
    }, ADDED_HOLD_MS);
  };

  return (
    <motion.button
      type="button"
      className={`btn btn-${variant} add-btn ${added ? 'is-added' : ''} ${className}`.trim()}
      onClick={handleClick}
      aria-disabled={added}
      whileTap={added ? undefined : { scale: 0.97 }}
      transition={{ duration: DURATION_FAST, ease: EASING }}
    >
      {/* Colour wipes in left to right when the item lands in the bag */}
      <motion.span
        className="add-btn-fill"
        aria-hidden="true"
        initial={false}
        animate={{ clipPath: added ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)' }}
        transition={{ duration: 0.25, ease: EASING }}
      />
      <span className="add-btn-labels">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={added ? 'added' : 'idle'}
            className="add-btn-label"
            initial={{ y: '110%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-110%', opacity: 0 }}
            transition={{ duration: DURATION_FAST, ease: EASING }}
          >
            {added ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <motion.path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.25, delay: 0.1, ease: EASING }}
                  />
                </svg>
                Added
              </>
            ) : (
              children
            )}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="visually-hidden" aria-live="polite">
        {added ? 'Added to bag' : ''}
      </span>
    </motion.button>
  );
}
