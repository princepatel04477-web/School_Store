import { useState, type ReactNode } from 'react';
import { CATEGORY_FALLBACK_PHOTOS, CATEGORY_PHOTOS } from '../data/categoryPhotos';

/**
 * A category's photo. If it can't load, a similar product photo is tried, then `fallback`
 * (nothing by default), so a missing file never shows as a broken image.
 */
export function CategoryPhoto({
  category,
  className,
  size,
  fallback = null,
  lazy = false,
}: {
  category: string;
  className?: string;
  size: number;
  fallback?: ReactNode;
  lazy?: boolean;
}) {
  const sources = [CATEGORY_PHOTOS[category], CATEGORY_FALLBACK_PHOTOS[category]].filter(Boolean);
  const [attempt, setAttempt] = useState(0);
  if (attempt >= sources.length) return <>{fallback}</>;
  return (
    <img
      key={sources[attempt]}
      className={className}
      src={sources[attempt]}
      alt=""
      width={size}
      height={size}
      loading={lazy ? 'lazy' : undefined}
      onError={() => setAttempt((n) => n + 1)}
    />
  );
}
