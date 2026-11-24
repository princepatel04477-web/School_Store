import { type ReactNode } from 'react';

export interface StepTransitionProps {
  stepKey: string | number;
  direction?: 'forward' | 'backward';
  children: ReactNode;
  className?: string;
}

/**
 * The next step slides in from the side the parent is heading. It shows at once
 * (CSS, so it always finishes): the old step no longer has to fade out first, which
 * left a blank screen when the back button was tapped quickly.
 */
export function StepTransition({ stepKey, direction = 'forward', children, className = '' }: StepTransitionProps) {
  return (
    <div key={stepKey} className={`step-enter step-enter--${direction} ${className}`.trim()}>
      {children}
    </div>
  );
}
