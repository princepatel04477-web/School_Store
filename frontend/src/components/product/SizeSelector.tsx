import { motion } from 'motion/react';
import { EASING } from '../../motion/motionConfig';
import './product.css';

export interface SizeOption {
  id: string;
  size: string;
  inStock: boolean;
}

export interface SizeSelectorProps {
  sizes: SizeOption[];
  selectedSizeId: string | null;
  onSelectSize: (sizeId: string) => void;
  onOpenSizeGuide?: () => void;
  error?: string;
  className?: string;
}

export function SizeSelector({
  sizes,
  selectedSizeId,
  onSelectSize,
  onOpenSizeGuide,
  error,
  className = '',
}: SizeSelectorProps) {
  return (
    <div className={`size-selector-wrap ${className}`.trim()} role="group" aria-label="Select size">
      <div className="size-selector-header">
        <span className="label">Select Size</span>
        {onOpenSizeGuide && (
          <button
            type="button"
            className="size-guide-trigger"
            onClick={onOpenSizeGuide}
            aria-label="Open size guide"
          >
            Size guide
          </button>
        )}
      </div>

      <div className="size-tiles-grid" role="radiogroup" aria-label="Available sizes">
        {sizes.map((s) => {
          const isSelected = selectedSizeId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={!s.inStock}
              className={`size-tile ${isSelected ? 'is-selected' : ''} ${!s.inStock ? 'is-out-of-stock' : ''}`}
              onClick={() => onSelectSize(s.id)}
            >
              {isSelected && (
                <motion.span
                  layoutId="active-size-pill"
                  className="size-tile-indicator"
                  transition={{ duration: 0.2, ease: EASING }}
                />
              )}
              <span className="size-tile-label">{s.size}</span>
              {!s.inStock && <span className="diagonal-strike" aria-label="Unavailable" />}
            </button>
          );
        })}
      </div>

      {error && (
        <span className="size-error-msg" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
