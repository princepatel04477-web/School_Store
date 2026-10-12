import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { formatINR } from '../../utils/formatINR';
import { useStoreState } from '../../store/storeState';
import { ProductImage } from './ProductImage';
import { QuantityStepper } from './QuantityStepper';
import { AddToBagButton } from './AddToBagButton';
import { EASING, DURATION_FAST } from '../../motion/motionConfig';
import type { SeedProduct } from '../../data/seedData';
import './product.css';
import { useLang } from '../../i18n';

/** Real store items add a photo and whether the parent can order them here. */
export type CardProduct = SeedProduct & { imageUrl?: string; needsDetails?: boolean };

export interface ProductCardProps {
  product: CardProduct;
  onOpenDetails?: (product: CardProduct) => void;
}

export function ProductCard({ product, onOpenDetails }: ProductCardProps) {
  const { cart, addItem, updateQuantity } = useStoreState();
  const { t } = useLang();

  // Keeps the add button on screen while it shows "Added", before the stepper takes over
  const [settling, setSettling] = useState(false);

  // Check if this product is in the cart
  const cartMatches = cart.filter((c) => c.productId === product.id);
  const currentTotalQty = cartMatches.reduce((acc, c) => acc + c.quantity, 0);
  const inStock = product.sizes.some((s) => s.inStock);
  const orderable = inStock && !product.needsDetails;
  // The card shows the photo; sizes are chosen in the item's sheet
  const needsSizeChoice = product.sizes.length > 1;

  const handleAdd = (): boolean => {
    if (needsSizeChoice) {
      onOpenDetails?.(product);
      return false;
    }
    const chosenSize = product.sizes[0];
    addItem({
      productId: product.id,
      variantId: chosenSize.id,
      name: product.name,
      category: product.category,
      pricePaise: product.pricePaise,
      size: chosenSize.size,
      quantity: 1,
    });
    return true;
  };

  const handleIncrement = () => {
    if (cartMatches.length > 0) {
      const first = cartMatches[0];
      updateQuantity(first.id, first.quantity + 1);
    } else {
      handleAdd();
    }
  };

  const handleDecrement = () => {
    if (cartMatches.length > 0) {
      const first = cartMatches[0];
      updateQuantity(first.id, first.quantity - 1);
    }
  };

  return (
    <article className="product-card">
      {/* Top Image area */}
      <div
        className="product-card-media"
        onClick={() => onOpenDetails && onOpenDetails(product)}
      >
        <motion.div layoutId={`product-image-${product.id}`}>
          <ProductImage id={product.id} name={product.name} category={product.category} imageUrl={product.imageUrl} />
        </motion.div>
        {product.required && (
          <span className="required-badge">{t('product.required')}</span>
        )}
      </div>

      {/* Card Info */}
      <div className="product-card-content">
        <h3
          className="product-card-title"
          onClick={() => onOpenDetails && onOpenDetails(product)}
        >
          {product.name}
        </h3>
        <p className="product-card-descriptor">{product.descriptor}</p>
        <div className="product-card-price">{formatINR(product.pricePaise)}</div>

        {/* Add Button or Stepper */}
        {!orderable ? (
          <p className="card-unavailable">
            {product.needsDetails ? t('product.needsPhoto') : t('product.outOfStock')}
          </p>
        ) : (
        <div className="product-card-action">
          <AnimatePresence mode="popLayout" initial={false}>
            {currentTotalQty > 0 && !settling ? (
              <motion.div
                key="stepper"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: DURATION_FAST, ease: EASING }}
              >
                <QuantityStepper
                  quantity={currentTotalQty}
                  onIncrement={handleIncrement}
                  onDecrement={handleDecrement}
                />
              </motion.div>
            ) : needsSizeChoice ? (
              <motion.div key="choose" exit={{ opacity: 0 }} transition={{ duration: DURATION_FAST, ease: EASING }}>
                <button type="button" className="btn btn-outline card-add-btn" onClick={() => onOpenDetails?.(product)}>
                  {t('product.chooseSize')}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="add"
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: DURATION_FAST, ease: EASING }}
              >
                <AddToBagButton
                  className="card-add-btn"
                  onAdd={() => {
                    const ok = handleAdd();
                    if (ok) setSettling(true);
                    return ok;
                  }}
                  onSettled={() => setSettling(false)}
                >
                  {t('product.add')}
                </AddToBagButton>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        )}
      </div>
    </article>
  );
}
