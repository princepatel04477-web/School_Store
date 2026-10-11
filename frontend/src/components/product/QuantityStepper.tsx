import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { EASING } from '../../motion/motionConfig';
import './product.css';

export interface QuantityStepperProps {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  min?: number;
  max?: number;
  className?: string;
}

export function QuantityStepper({
  quantity,
  onIncrement,
  onDecrement,
  min = 0,
  max = 99,
  className = '',
}: QuantityStepperProps) {
  // Roll the number up when it grows and down when it shrinks
  const [previous, setPrevious] = useState(quantity);
  const [direction, setDirection] = useState(1);
  if (quantity !== previous) {
    setDirection(quantity > previous ? 1 : -1);
    setPrevious(quantity);
  }

  return (
    <div className={`quantity-stepper ${className}`.trim()} role="group" aria-label="Change quantity">
      <button
        type="button"
        className="stepper-btn"
        aria-label="Decrease quantity"
        disabled={quantity <= min}
        onClick={onDecrement}
      >
        <Minus width={16} height={16} strokeWidth={1.5} />
      </button>
      <span className="stepper-value" aria-live="polite" style={{ position: 'relative', overflow: 'hidden' }}>
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.span
            key={quantity}
            custom={direction}
            variants={{
              enter: (d: number) => ({ opacity: 0, y: 10 * d }),
              center: { opacity: 1, y: 0 },
              exit: (d: number) => ({ opacity: 0, y: -10 * d }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.15, ease: EASING }}
            style={{ display: 'inline-block' }}
          >
            {quantity}
          </motion.span>
        </AnimatePresence>
      </span>
      <button
        type="button"
        className="stepper-btn"
        aria-label="Increase quantity"
        disabled={quantity >= max}
        onClick={onIncrement}
      >
        <Plus width={16} height={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
