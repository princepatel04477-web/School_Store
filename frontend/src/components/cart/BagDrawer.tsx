import { useState, useEffect } from 'react';
import { X, Trash2, ArrowRight } from '../ui/icons';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { formatINR } from '../../utils/formatINR';
import { useStoreState } from '../../store/storeState';
import { QuantityStepper } from '../product/QuantityStepper';
import { CategoryOutlineIllustration } from '../product/CategoryOutlineIllustration';
import { EASING, DURATION_FAST } from '../../motion/motionConfig';
import { useLang } from '../../i18n';
import { classLabel } from '../../i18n/labels';
import { formatMeasure } from '../../data/fit';
import type { CartItem } from '../../store/storeState';
import './bagCheckout.css';

/** Bag lines grouped by the child they are for (school + class), in the order added. */
function byChild(lines: CartItem[]): { key: string; schoolName?: string; className?: string; lines: CartItem[] }[] {
  const groups = new Map<string, { key: string; schoolName?: string; className?: string; lines: CartItem[] }>();
  for (const line of lines) {
    const key = `${line.schoolName ?? ''}|${line.className ?? ''}`;
    if (!groups.has(key)) groups.set(key, { key, schoolName: line.schoolName, className: line.className, lines: [] });
    groups.get(key)!.lines.push(line);
  }
  return [...groups.values()];
}

export interface BagDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BagDrawer({ isOpen, onClose }: BagDrawerProps) {
  const navigate = useNavigate();
  const { cart, updateQuantity, removeItem, undoRemove, lastRemoved, subtotalPaise } = useStoreState();
  const { t } = useLang();
  const [showUndo, setShowUndo] = useState(false);

  useEffect(() => {
    if (lastRemoved) {
      setShowUndo(true);
      const timer = setTimeout(() => setShowUndo(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastRemoved]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Escape key closes drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleCheckout = () => {
    onClose();
    navigate('/checkout');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="bag-drawer-backdrop"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASING }}
        >
          <motion.div
            className="bag-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t('bag.title')}
            onClick={(e) => e.stopPropagation()}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: EASING }}
          >
        {/* Drawer Header */}
        <div className="bag-drawer-header">
          <div className="bag-title-wrap">
            <h2 className="bag-title">{t('bag.title')}</h2>
            <span className="bag-item-count">({t('bag.count', { count: cart.length })})</span>
          </div>
          <button
            type="button"
            className="bag-close-btn"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X width={22} height={22} strokeWidth={1.5} />
          </button>
        </div>

        {/* Undo notification bar */}
        <AnimatePresence initial={false}>
          {showUndo && lastRemoved && (
            <motion.div
              key="undo"
              className="bag-undo-banner"
              role="status"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: DURATION_FAST, ease: EASING }}
            >
              <span>{t('bag.removed')}</span>
              <button
                type="button"
                className="undo-btn"
                onClick={() => {
                  undoRemove();
                  setShowUndo(false);
                }}
              >
                {t('bag.undo')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Lines Container */}
        <div className="bag-lines-container">
          {cart.length > 0 ? (
            <div className="bag-lines-list">
              {byChild(cart).map((group) => (
              <section key={group.key} className="bag-child-group">
              {(group.className || group.schoolName) && (
                <h3 className="bag-child-head">
                  {t('bag.forChild', {
                    name: [group.className ? classLabel(group.className, t) : '', group.schoolName ?? '']
                      .filter(Boolean)
                      .join(' · '),
                  })}
                </h3>
              )}
              <AnimatePresence initial={false}>
                {group.lines.map((line) => (
                  <motion.div
                    key={line.id}
                    className="bag-line-item"
                    layout
                    initial={{ opacity: 1, height: 'auto' }}
                    exit={{
                      opacity: 0,
                      height: 0,
                      marginBottom: 0,
                      paddingTop: 0,
                      paddingBottom: 0,
                      overflow: 'hidden',
                    }}
                    transition={{ duration: 0.25, ease: EASING }}
                  >
                    <div className="bag-line-img">
                      {line.image ? (
                        <img src={line.image} alt={line.name} width={64} height={80} />
                      ) : (
                        <CategoryOutlineIllustration category={line.category} />
                      )}
                    </div>
                    <div className="bag-line-info">
                      <h3 className="bag-line-name">{line.name}</h3>
                      <div className="bag-line-meta">
                        <span>{t('product.size')} {line.size}</span>
                      </div>
                      {line.measurement && (
                        <div className="bag-line-measure">
                          {line.measurement.shoulderCm !== undefined
                            ? t('bag.measuredShoulder', {
                                h: formatMeasure(line.measurement.heightCm),
                                w: formatMeasure(line.measurement.weightKg),
                                s: formatMeasure(line.measurement.shoulderCm),
                              })
                            : t('bag.measured', {
                                h: formatMeasure(line.measurement.heightCm),
                                w: formatMeasure(line.measurement.weightKg),
                              })}
                        </div>
                      )}
                      <div className="bag-line-price">{formatINR(line.pricePaise * line.quantity)}</div>

                      <div className="bag-line-controls">
                        <div className="bag-stepper-wrap">
                          <QuantityStepper
                            quantity={line.quantity}
                            onIncrement={() => updateQuantity(line.id, line.quantity + 1)}
                            onDecrement={() => updateQuantity(line.id, line.quantity - 1)}
                            min={1}
                          />
                        </div>
                        <button
                          type="button"
                          className="bag-remove-link"
                          onClick={() => removeItem(line.id)}
                        >
                          {t('bag.remove')}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              </section>
              ))}
            </div>
          ) : (
            <div className="bag-empty-state">
              <div className="bag-empty-art">
                <CategoryOutlineIllustration category="Uniform" />
              </div>
              <h3>{t('bag.empty')}</h3>
              <p>{t('bag.emptySub')}</p>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  onClose();
                  navigate('/flow?step=1');
                }}
              >
                {t('home.findSchool')}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div className="bag-drawer-footer">
            <div className="bag-subtotal-row">
              <span className="label">{t('bag.total')}</span>
              <span className="bag-subtotal-value">{formatINR(subtotalPaise)}</span>
            </div>
            <p className="bag-shipping-note">{t('bag.note')}</p>
            <button
              type="button"
              className="btn btn-primary bag-checkout-btn"
              onClick={handleCheckout}
            >
              {t('bag.checkout', { total: formatINR(subtotalPaise) })}
              <ArrowRight width={16} height={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-text bag-continue-btn"
              onClick={onClose}
            >
              {t('home.continue')}
            </button>
          </div>
        )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
