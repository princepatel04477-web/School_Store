import { useState, useEffect } from 'react';
import { X, Trash2, ArrowRight } from '../ui/icons';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { formatINR } from '../../utils/formatINR';
import { useStoreState } from '../../store/storeState';
import { QuantityStepper } from '../product/QuantityStepper';
import { CategoryOutlineIllustration } from '../product/CategoryOutlineIllustration';
import { EASING, DURATION_FAST } from '../../motion/motionConfig';
import './bagCheckout.css';

export interface BagDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BagDrawer({ isOpen, onClose }: BagDrawerProps) {
  const navigate = useNavigate();
  const { cart, updateQuantity, removeItem, undoRemove, lastRemoved, subtotalPaise } = useStoreState();
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
            aria-label="Shopping Bag"
            onClick={(e) => e.stopPropagation()}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: EASING }}
          >
        {/* Drawer Header */}
        <div className="bag-drawer-header">
          <div className="bag-title-wrap">
            <h2 className="bag-title">Your Bag</h2>
            <span className="bag-item-count">({cart.length} items)</span>
          </div>
          <button
            type="button"
            className="bag-close-btn"
            aria-label="Close shopping bag"
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
              <span>Item removed from bag.</span>
              <button
                type="button"
                className="undo-btn"
                onClick={() => {
                  undoRemove();
                  setShowUndo(false);
                }}
              >
                Undo
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Lines Container */}
        <div className="bag-lines-container">
          {cart.length > 0 ? (
            <div className="bag-lines-list">
              <AnimatePresence initial={false}>
                {cart.map((line) => (
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
                        <span>Size: {line.size}</span>
                        {line.schoolName && <span> · {line.schoolName}</span>}
                      </div>
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
                          Remove
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="bag-empty-state">
              <div className="bag-empty-art">
                <CategoryOutlineIllustration category="Uniform" />
              </div>
              <h3>Your bag is empty</h3>
              <p>Pick your school and class to view your prescribed kit.</p>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  onClose();
                  navigate('/flow?step=1');
                }}
              >
                Find my school
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div className="bag-drawer-footer">
            <div className="bag-subtotal-row">
              <span className="label">Subtotal</span>
              <span className="bag-subtotal-value">{formatINR(subtotalPaise)}</span>
            </div>
            <p className="bag-shipping-note">Taxes and delivery calculated at checkout.</p>
            <button
              type="button"
              className="btn btn-primary bag-checkout-btn"
              onClick={handleCheckout}
            >
              Checkout · {formatINR(subtotalPaise)}
              <ArrowRight width={16} height={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-text bag-continue-btn"
              onClick={onClose}
            >
              Continue shopping
            </button>
          </div>
        )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
