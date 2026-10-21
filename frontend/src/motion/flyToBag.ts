/**
 * A small highlight dot flies from the button that added an item to the bag icon
 * in the header. Transform and opacity only, 0.6s. Skipped with reduced motion or
 * when the bag icon is not on screen.
 */
export function flyToBag(from: Element | null) {
  if (!from || typeof document === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bag = document.querySelector('.bag-btn');
  if (!bag) return;
  const a = from.getBoundingClientRect();
  const b = bag.getBoundingClientRect();
  if (b.width === 0 || b.bottom < 0) return;

  const size = 10;
  const x0 = a.left + a.width / 2 - size / 2;
  const y0 = a.top + a.height / 2 - size / 2;
  const x1 = b.left + b.width / 2 - size / 2;
  const y1 = b.top + b.height / 2 - size / 2;
  // A shallow arc: the midpoint lifts above the straight line
  const lift = Math.min(120, Math.abs(y1 - y0) / 2 + 40);

  const dot = document.createElement('span');
  dot.className = 'fly-to-bag-dot';
  dot.setAttribute('aria-hidden', 'true');
  document.body.appendChild(dot);
  const animation = dot.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - lift}px) scale(0.9)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) scale(0.5)`, opacity: 0.4 },
    ],
    { duration: 600, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
  );
  animation.onfinish = animation.oncancel = () => dot.remove();
}
