import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check } from './icons';
import { EASING, DURATION_FAST } from '../../motion/motionConfig';
import './ui.css';

export type ButtonState = 'idle' | 'loading' | 'success';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'> {
  /** primary: filled CTA. secondary: outline. icon: square icon-only (give it an aria-label). */
  variant?: 'primary' | 'secondary' | 'icon';
  size?: 'md' | 'lg';
  /** loading shows three pulsing dots; success shows a check and successLabel. */
  state?: ButtonState;
  successLabel?: ReactNode;
  /** A trailing arrow after the label (primary CTAs). It never moves. */
  arrow?: boolean;
  children: ReactNode;
}

/**
 * The site's button. All three states are stacked in the same grid cell and only
 * the current one is visible, so the button keeps the width of its widest state
 * and nothing around it shifts when the state changes.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', state = 'idle', successLabel, arrow = false, disabled, children, className = '', ...props },
  ref,
) {
  const reduce = useReducedMotion();
  const busy = state !== 'idle';

  if (variant === 'icon') {
    return (
      <button ref={ref} type="button" disabled={disabled} className={`btn-icon ${className}`.trim()} {...props}>
        {children}
      </button>
    );
  }

  // The leaving layer slides up, the arriving one comes in from below (up/down swap)
  const layer = (show: boolean) => ({
    animate: show ? { opacity: 1, y: 0 } : { opacity: 0, y: reduce ? 0 : '-60%' },
    initial: false as const,
    transition: { duration: reduce ? 0 : DURATION_FAST, ease: EASING },
    'aria-hidden': !show,
  });

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-busy={state === 'loading' || undefined}
      aria-disabled={busy || undefined}
      data-state={state}
      className={`btn btn-${variant === 'secondary' ? 'outline' : 'primary'} btn-${size} ${className}`.trim()}
      {...props}
      onClick={busy ? undefined : props.onClick}
    >
      <span className="btn-layers">
        <motion.span className="btn-layer" {...layer(state === 'idle')}>
          {children}
          {arrow && <ArrowRight className="btn-arrow" width={18} height={18} aria-hidden="true" />}
        </motion.span>
        <motion.span className="btn-layer" {...layer(state === 'loading')}>
          <span className="btn-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </motion.span>
        <motion.span className="btn-layer" {...layer(state === 'success')}>
          <Check width={18} height={18} strokeWidth={2.5} aria-hidden="true" />
          {successLabel}
        </motion.span>
      </span>
    </button>
  );
});
