import { motion } from 'motion/react';
import { EASING } from '../../motion/motionConfig';
import './product.css';
import { useLang } from '../../i18n';

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
  const { t } = useLang();
  return (
    <div className={`size-selector-wrap ${className}`.trim()} role="group" aria-label={t('product.size')}>
      <div className="size-selector-header">
        <span className="label">{t('product.size')}</span>
        {onOpenSizeGuide && (
          <button
            type="button"
            className="size-guide-trigger"
            onClick={onOpenSizeGuide}
            aria-label={t('product.sizeGuide')}
          >
            {t('product.sizeGuide')}
          </button>
        )}
      </div>

      <div className="size-tiles-grid" role="radiogroup" aria-label={t('product.size')}>
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
              {!s.inStock && <span className="diagonal-strike" aria-label={t('product.outOfStock')} />}
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
