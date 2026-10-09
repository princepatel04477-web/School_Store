import { useAnimate, useReducedMotion } from 'motion/react';

/**
 * Two short sideways shakes, used when a required choice is missing
 * (e.g. no size picked). Attach `scope` to the group that needs attention.
 */
export function useShake<T extends Element = HTMLDivElement>() {
  const [scope, animate] = useAnimate<T>();
  const shouldReduceMotion = useReducedMotion();

  const shake = () => {
    if (shouldReduceMotion || !scope.current) return;
    animate(scope.current, { x: [0, -4, 4, -4, 4, 0] }, { duration: 0.3, ease: 'easeInOut' });
  };

  return [scope, shake] as const;
}
