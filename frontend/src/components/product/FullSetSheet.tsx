import { useEffect, useMemo, useState } from 'react';
import { X } from '../ui/icons';
import { formatINR } from '../../utils/formatINR';
import { useStoreState } from '../../store/storeState';
import { useLang } from '../../i18n';
import { categoryLabel, classLabel } from '../../i18n/labels';
import { suggestSizeId } from '../../data/sizes';
import { preselectSizeId, suggestedSizeIds, type ProductFit } from '../../data/fit';
import { RecommendationNote } from '../fit/SizeChartTable';
import type { StoreProduct } from '../../data/catalog';
import { ProductImage } from './ProductImage';
import { ListenButton } from '../ListenButton';
import './fullSet.css';

/**
 * "Order full set": every item made for this school, for this class and boy/girl,
 * on one screen with sizes already chosen: from the child's height and weight when
 * the item has a size chart, otherwise where the school's size labels name the
 * class. One button adds them all.
 */
export function FullSetSheet({
  open,
  onClose,
  products,
  schoolName,
  className,
  onAdded,
  fits,
}: {
  open: boolean;
  onClose: () => void;
  products: StoreProduct[];
  schoolName: string;
  className?: string;
  onAdded?: () => void;
  fits?: Record<string, ProductFit>;
}) {
  const { t } = useLang();
  const { addItem } = useStoreState();

  const initial = useMemo(() => {
    const sizes: Record<string, string> = {};
    products.forEach((p) => {
      const suggested = preselectSizeId(p.sizes, fits?.[p.id]) ?? suggestSizeId(p.sizes, className);
      if (suggested) sizes[p.id] = suggested;
    });
    return sizes;
  }, [products, className, fits]);

  const [sizes, setSizes] = useState<Record<string, string>>(initial);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    if (open) {
      setSizes(initial);
      setSkipped({});
      setShowMissing(false);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const chosen = products.filter((p) => !skipped[p.id]);
  const missing = chosen.filter((p) => !sizes[p.id]);
  const totalPaise = chosen.reduce((sum, p) => sum + p.pricePaise, 0);

  const addAll = () => {
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }
    chosen.forEach((p) => {
      const size = p.sizes.find((s) => s.id === sizes[p.id])!;
      addItem({
        productId: p.id,
        variantId: size.id,
        name: p.name,
        category: p.category,
        pricePaise: p.pricePaise,
        size: size.size,
        quantity: 1,
      });
    });
    onClose();
    onAdded?.();
  };

  return (
    <div className="fullset-backdrop" onClick={onClose}>
      <div
        className="fullset-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('set.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fullset-head">
          <div>
            <h2 className="fullset-title">{t('set.title')}</h2>
            <p className="fullset-sub">
              {t('set.sub', { school: schoolName, cls: classLabel(className, t) })}
            </p>
          </div>
          <button type="button" className="fullset-close" aria-label={t('common.close')} onClick={onClose}>
            <X width={22} height={22} strokeWidth={1.5} />
          </button>
        </div>
        <ListenButton text={`${t('set.title')}. ${t('set.listen')}`} />

        <ul className="fullset-list">
          {products.map((p) => {
            const isSkipped = Boolean(skipped[p.id]);
            const needsSize = !isSkipped && !sizes[p.id];
            const suggested = initial[p.id] && initial[p.id] === sizes[p.id] && p.sizes.length > 1;
            const fit = fits?.[p.id];
            const marks = suggestedSizeIds(p.sizes, fit);
            const fromFit = Boolean(marks.primary);
            return (
              <li
                key={p.id}
                className={`fullset-row ${isSkipped ? 'is-skipped' : ''} ${showMissing && needsSize ? 'is-missing' : ''}`}
              >
                <div className="fullset-media">
                  <ProductImage id={p.id} name={p.name} category={p.category} imageUrl={p.imageUrl} />
                </div>
                <div className="fullset-info">
                  <span className="fullset-cat">{categoryLabel(p.category, t)}</span>
                  <strong className="fullset-name">{p.name}</strong>
                  <span className="fullset-price">{formatINR(p.pricePaise)}</span>

                  {!isSkipped && p.sizes.length > 1 && (
                    <div className="fullset-sizes" role="group" aria-label={t('product.size')}>
                      {p.sizes.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          disabled={!s.inStock}
                          className={`card-size-chip ${sizes[p.id] === s.id ? 'is-selected' : ''} ${s.id === marks.primary || s.id === marks.alt ? 'is-suggested' : ''}`}
                          onClick={() => setSizes((prev) => ({ ...prev, [p.id]: s.id }))}
                        >
                          {s.size}
                        </button>
                      ))}
                    </div>
                  )}
                  {!isSkipped && fromFit && <RecommendationNote recommendation={fit?.recommendation} />}
                  {suggested && !isSkipped && !fromFit && (
                    <span className="fullset-hint">{t('set.suggested', { cls: classLabel(className, t) })}</span>
                  )}
                  {showMissing && needsSize && <span className="field-err">{t('product.pickSize')}</span>}

                  <button
                    type="button"
                    className="fullset-skip"
                    onClick={() => setSkipped((prev) => ({ ...prev, [p.id]: !isSkipped }))}
                  >
                    {isSkipped ? t('set.include') : t('set.skip')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="fullset-footer">
          <button type="button" className="btn btn-primary fullset-add" onClick={addAll} disabled={chosen.length === 0}>
            {t('set.addAll', { count: chosen.length, total: formatINR(totalPaise) })}
          </button>
          {showMissing && missing.length > 0 && (
            <p className="field-err" role="alert">
              {t('set.chooseSizes', { count: missing.length })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
