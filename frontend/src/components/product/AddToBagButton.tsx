import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { flyToBag } from '../../motion/flyToBag';
import './product.css';
import { useLang } from '../../i18n';

/**
 * How long "Added" stays before the button hands over (the card shows its stepper,
 * the sheet opens the bag). Kept short on purpose: adding is instant, so there is no
 * loading state, and a longer hold would only make the parent wait.
 */
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

export function AddToBagButton({ onAdd, onSettled, variant = 'outline', className = '', children }: AddToBagButtonProps) {
  const { t } = useLang();
  const [added, setAdded] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (added || !onAdd()) return;
    flyToBag(e.currentTarget);
    setAdded(true);
    timer.current = window.setTimeout(() => {
      setAdded(false);
      onSettled?.();
    }, ADDED_HOLD_MS);
  };

  return (
    <>
      <Button
        variant={variant === 'primary' ? 'primary' : 'secondary'}
        state={added ? 'success' : 'idle'}
        successLabel={t('product.added')}
        className={`add-btn ${className}`.trim()}
        onClick={handleClick}
      >
        {children}
      </Button>
      <span className="visually-hidden" aria-live="polite">
        {added ? t('product.addedToBag') : ''}
      </span>
    </>
  );
}
