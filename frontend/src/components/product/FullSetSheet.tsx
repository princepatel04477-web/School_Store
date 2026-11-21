import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { X, Plus, Minus, AlertCircle } from '../ui/icons';
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
import { flyToBag } from '../../motion/flyToBag';
import { cartApi } from '../../api';
import './fullSet.css';

export interface FullSetSheetProps {
  open: boolean;
  onClose: () => void;
  products: StoreProduct[];
  schoolName: string;
  schoolId?: string;
  cityId?: string;
  className?: string;
  studentId?: string;
  studentName?: string;
  onAdded?: () => void;
  fits?: Record<string, ProductFit>;
}

interface PreparedItem {
  product: StoreProduct;
  size: StoreProduct['sizes'][number];
  qty: number;
  pricePaise: number;
}

export function FullSetSheet({
  open,
  onClose,
  products,
  schoolName,
  schoolId,
  cityId,
  className,
  studentId,
  studentName,
  onAdded,
  fits,
}: FullSetSheetProps) {
  const { t } = useLang();
  const { cart, selection, addItem, clearCart } = useStoreState();

  const effectiveSchoolId = schoolId || selection?.schoolId;
  const effectiveSchoolName = schoolName || selection?.schoolName || '';
  const effectiveCityId = cityId || selection?.cityId;

  const initial = useMemo(() => {
    const defaultSizes: Record<string, string> = {};
    products.forEach((p) => {
      const suggested = preselectSizeId(p.sizes, fits?.[p.id]) ?? suggestSizeId(p.sizes, className);
      const suggestedObj = suggested ? p.sizes.find((s) => s.id === suggested) : undefined;
      if (suggestedObj && suggestedObj.inStock) {
        defaultSizes[p.id] = suggestedObj.id;
      } else {
        const firstInStock = p.sizes.find((s) => s.inStock);
        if (firstInStock) {
          defaultSizes[p.id] = firstInStock.id;
        } else if (suggested) {
          defaultSizes[p.id] = suggested;
        } else if (p.sizes.length === 1) {
          defaultSizes[p.id] = p.sizes[0].id;
        }
      }
    });
    return defaultSizes;
  }, [products, className, fits]);

  const [sizes, setSizes] = useState<Record<string, string>>(initial);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [showMissing, setShowMissing] = useState(false);
  const [omittedConfirmed, setOmittedConfirmed] = useState(false);
  const [showOmittedModal, setShowOmittedModal] = useState(false);
  const [showSchoolMismatchModal, setShowSchoolMismatchModal] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationNotice, setValidationNotice] = useState<{ title: string; messages: string[] } | null>(null);
  const [pendingItems, setPendingItems] = useState<PreparedItem[] | null>(null);

  useEffect(() => {
    if (open) {
      setSizes(initial);
      setQuantities({});
      setSkipped({});
      setShowMissing(false);
      setOmittedConfirmed(false);
      setShowOmittedModal(false);
      setShowSchoolMismatchModal(false);
      setIsValidating(false);
      setValidationNotice(null);
      setPendingItems(null);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isOutOfStock = (p: StoreProduct) => p.sizes.length > 0 && !p.sizes.some((s) => s.inStock);

  const getEffectiveVariant = (p: StoreProduct) => {
    if (sizes[p.id]) {
      return p.sizes.find((s) => s.id === sizes[p.id]) || null;
    }
    if (p.sizes.length === 1) {
      return p.sizes[0];
    }
    return null;
  };

  const chosen = products.filter((p) => !skipped[p.id] && !isOutOfStock(p));
  const missing = chosen.filter((p) => p.sizes.length > 0 && !getEffectiveVariant(p));
  const totalPaise = chosen.reduce((sum, p) => sum + p.pricePaise * (quantities[p.id] || 1), 0);

  const omittedRequired = products.filter(
    (p) => Boolean(p.required) && (Boolean(skipped[p.id]) || isOutOfStock(p))
  );

  const commitToBag = (items: PreparedItem[]) => {
    items.forEach(({ product, size, qty, pricePaise }) => {
      addItem({
        productId: product.id,
        variantId: size.id,
        name: product.name,
        category: product.category,
        pricePaise,
        size: size.size,
        quantity: qty,
        schoolId: effectiveSchoolId,
        schoolName: effectiveSchoolName,
        className,
        studentId,
        studentName,
      });
    });
    onClose();
    onAdded?.();
  };

  const executeValidationAndAdd = async (items: PreparedItem[]) => {
    setIsValidating(true);
    try {
      const payloadItems = items.map((it) => ({
        product_id: it.product.id,
        variant_id: it.size.id,
        quantity: it.qty,
        price_paise: it.pricePaise,
      }));

      const val = await cartApi.validate({
        school: effectiveSchoolId,
        school_id: effectiveSchoolId,
        city: effectiveCityId,
        city_id: effectiveCityId,
        class: className,
        items: payloadItems,
      });

      const priceNotices: string[] = [];
      const stockNotices: string[] = [];
      let updatedItems = [...items];

      if (val.price_changes && val.price_changes.length > 0) {
        val.price_changes.forEach((pc) => {
          priceNotices.push(
            `${pc.name || 'Item'}: ₹${(pc.server_price_paise / 100).toFixed(2)} (was ₹${(pc.client_price_paise / 100).toFixed(2)})`
          );
          updatedItems = updatedItems.map((it) =>
            it.product.id === pc.product_id ? { ...it, pricePaise: pc.server_price_paise } : it
          );
        });
      }

      if (val.out_of_stock && val.out_of_stock.length > 0) {
        val.out_of_stock.forEach((si) => {
          stockNotices.push(
            `${si.name} (${si.size}): ${
              si.available <= 0
                ? t('set.outOfStock')
                : `${si.available} available`
            }`
          );
        });
        updatedItems = updatedItems
          .map((it) => {
            const issue = val.out_of_stock?.find(
              (si) => si.product_id === it.product.id && si.variant_id === it.size.id
            );
            if (!issue) return it;
            return { ...it, qty: Math.min(it.qty, issue.available) };
          })
          .filter((it) => it.qty > 0);
      }

      if (priceNotices.length > 0 || stockNotices.length > 0) {
        setValidationNotice({
          title: t('set.priceChangedTitle'),
          messages: [...stockNotices, ...priceNotices],
        });
        setPendingItems(updatedItems);
        setIsValidating(false);
        return;
      }

      commitToBag(updatedItems);
    } catch {
      // If server validate is unreachable, commit local items
      commitToBag(items);
    } finally {
      setIsValidating(false);
    }
  };

  const handleAddAll = (e: MouseEvent<HTMLButtonElement>) => {
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }

    // Check school mismatch with current cart items
    const bagSchoolIds = Array.from(new Set(cart.map((item) => item.schoolId).filter(Boolean)));
    const hasSchoolMismatch =
      cart.length > 0 &&
      bagSchoolIds.length > 0 &&
      Boolean(effectiveSchoolId) &&
      bagSchoolIds.some((id) => id !== effectiveSchoolId);

    if (hasSchoolMismatch) {
      setShowSchoolMismatchModal(true);
      return;
    }

    const itemsToAdd: PreparedItem[] = chosen.map((p) => {
      const v = getEffectiveVariant(p)!;
      return {
        product: p,
        size: v,
        qty: quantities[p.id] || 1,
        pricePaise: p.pricePaise,
      };
    });

    if (omittedRequired.length > 0 && !omittedConfirmed) {
      setShowOmittedModal(true);
      return;
    }

    flyToBag(e.currentTarget);
    executeValidationAndAdd(itemsToAdd);
  };

  const currentItemsToAdd: PreparedItem[] = chosen
    .map((p) => {
      const v = getEffectiveVariant(p);
      if (!v) return null;
      return {
        product: p,
        size: v,
        qty: quantities[p.id] || 1,
        pricePaise: p.pricePaise,
      };
    })
    .filter((it): it is PreparedItem => it !== null);

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
            const oos = isOutOfStock(p);
            const needsSize = !isSkipped && !oos && p.sizes.length > 1 && !sizes[p.id];
            const suggested = initial[p.id] && initial[p.id] === sizes[p.id] && p.sizes.length > 1;
            const fit = fits?.[p.id];
            const marks = suggestedSizeIds(p.sizes, fit);
            const fromFit = Boolean(marks.primary);
            const qty = quantities[p.id] || 1;

            return (
              <li
                key={p.id}
                className={`fullset-row ${isSkipped ? 'is-skipped' : ''} ${oos ? 'is-oos' : ''} ${
                  showMissing && needsSize ? 'is-missing' : ''
                }`}
              >
                <div className="fullset-media">
                  <ProductImage id={p.id} name={p.name} category={p.category} imageUrl={p.imageUrl} alt={p.imageAlt} />
                </div>
                <div className="fullset-info">
                  <div className="fullset-meta-row">
                    <span className="fullset-cat">{categoryLabel(p.category, t)}</span>
                    {p.required ? (
                      <span className="fullset-required-badge">{t('set.requiredBadge')}</span>
                    ) : (
                      <span className="fullset-optional-badge">{t('set.optionalBadge')}</span>
                    )}
                  </div>

                  <strong className="fullset-name">{p.name}</strong>
                  <div className="fullset-price-row">
                    <span className="fullset-price">{formatINR(p.pricePaise)}</span>
                    {qty > 1 && !isSkipped && !oos && (
                      <span className="fullset-line-total">
                        ({formatINR(p.pricePaise * qty)})
                      </span>
                    )}
                  </div>

                  {oos ? (
                    <div className="fullset-oos-alert" role="alert">
                      <span className="fullset-oos-badge">{t('set.outOfStock')}</span>
                    </div>
                  ) : (
                    <>
                      {!isSkipped && p.sizes.length > 1 && (
                        <div className="fullset-sizes" role="group" aria-label={t('product.size')}>
                          {p.sizes.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              disabled={!s.inStock}
                              className={`card-size-chip ${sizes[p.id] === s.id ? 'is-selected' : ''} ${
                                s.id === marks.primary || s.id === marks.alt ? 'is-suggested' : ''
                              }`}
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

                      {/* Quantity Stepper */}
                      {!isSkipped && (
                        <div className="fullset-qty-row">
                          <span className="fullset-qty-label">{t('set.qty')}:</span>
                          <div className="fullset-qty-ctrl" role="group" aria-label={t('set.quantity')}>
                            <button
                              type="button"
                              className="fullset-qty-btn"
                              aria-label="Decrease quantity"
                              disabled={qty <= 1}
                              onClick={() =>
                                setQuantities((prev) => ({
                                  ...prev,
                                  [p.id]: Math.max(1, qty - 1),
                                }))
                              }
                            >
                              <Minus width={14} height={14} />
                            </button>
                            <span className="fullset-qty-val" aria-live="polite">
                              {qty}
                            </span>
                            <button
                              type="button"
                              className="fullset-qty-btn"
                              aria-label="Increase quantity"
                              disabled={qty >= 10}
                              onClick={() =>
                                setQuantities((prev) => ({
                                  ...prev,
                                  [p.id]: Math.min(10, qty + 1),
                                }))
                              }
                            >
                              <Plus width={14} height={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {isSkipped && p.required && (
                    <span className="fullset-omitted-note">{t('set.requiredOmitted')}</span>
                  )}

                  {!oos && (
                    <button
                      type="button"
                      className="fullset-skip"
                      onClick={() => setSkipped((prev) => ({ ...prev, [p.id]: !isSkipped }))}
                    >
                      {isSkipped ? t('set.include') : t('set.skip')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="fullset-footer">
          <button
            type="button"
            className="btn btn-primary fullset-add"
            onClick={handleAddAll}
            disabled={chosen.length === 0 || isValidating}
          >
            {isValidating
              ? t('set.validating')
              : t('set.addAll', { count: chosen.length, total: formatINR(totalPaise) })}
          </button>
          {showMissing && missing.length > 0 && (
            <p className="field-err" role="alert">
              {t('set.chooseSizes', { count: missing.length })}
            </p>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Omitted Required Items */}
      {showOmittedModal && (
        <div className="fullset-alert-backdrop" role="dialog" aria-modal="true">
          <div className="fullset-alert-card">
            <div className="fullset-alert-head">
              <AlertCircle width={20} height={20} className="fullset-alert-icon" />
              <h3 className="fullset-alert-title">{t('set.omittedModalTitle')}</h3>
            </div>
            <p className="fullset-alert-text">
              {t('set.omittedModalBody', { count: omittedRequired.length })}
            </p>
            <ul className="fullset-omitted-list">
              {omittedRequired.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  {isOutOfStock(p) && <span className="fullset-oos-badge">{t('set.outOfStock')}</span>}
                </li>
              ))}
            </ul>
            <div className="fullset-alert-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowOmittedModal(false)}
              >
                {t('set.reviewItems')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setShowOmittedModal(false);
                  setOmittedConfirmed(true);
                  executeValidationAndAdd(currentItemsToAdd);
                }}
              >
                {t('set.proceedWithout')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Cross-School Mismatch */}
      {showSchoolMismatchModal && (
        <div className="fullset-alert-backdrop" role="dialog" aria-modal="true">
          <div className="fullset-alert-card">
            <div className="fullset-alert-head">
              <AlertCircle width={20} height={20} className="fullset-alert-icon" />
              <h3 className="fullset-alert-title">{t('set.schoolMismatchTitle')}</h3>
            </div>
            <p className="fullset-alert-text">
              {t('set.schoolMismatchBody', {
                bagSchool: cart[0]?.schoolName || 'another school',
                newSchool: effectiveSchoolName,
              })}
            </p>
            <div className="fullset-alert-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowSchoolMismatchModal(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  clearCart();
                  setShowSchoolMismatchModal(false);
                  executeValidationAndAdd(currentItemsToAdd);
                }}
              >
                {t('set.clearAndAdd')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price / Stock Change Notice Dialog */}
      {validationNotice && (
        <div className="fullset-alert-backdrop" role="dialog" aria-modal="true">
          <div className="fullset-alert-card">
            <div className="fullset-alert-head">
              <AlertCircle width={20} height={20} className="fullset-alert-icon" />
              <h3 className="fullset-alert-title">{validationNotice.title}</h3>
            </div>
            <ul className="fullset-notice-list">
              {validationNotice.messages.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
            <div className="fullset-alert-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setValidationNotice(null);
                  setPendingItems(null);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (pendingItems) {
                    commitToBag(pendingItems);
                  }
                  setValidationNotice(null);
                  setPendingItems(null);
                }}
              >
                {t('set.addAll', {
                  count: (pendingItems || []).length,
                  total: formatINR(
                    (pendingItems || []).reduce((s, it) => s + it.pricePaise * it.qty, 0)
                  ),
                })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
