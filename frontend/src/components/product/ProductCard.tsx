import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { formatINR } from '../../utils/formatINR';
import { useStoreState } from '../../store/storeState';
import { ProductImage } from './ProductImage';
import { QuantityStepper } from './QuantityStepper';
import type { SeedProduct } from '../../data/seedData';
import './product.css';

export interface ProductCardProps {
  product: SeedProduct;
  onOpenDetails?: (product: SeedProduct) => void;
}

export function ProductCard({ product, onOpenDetails }: ProductCardProps) {
  const { cart, addItem, updateQuantity } = useStoreState();

  const [selectedSizeId, setSelectedSizeId] = useState<string>(
    product.sizes.length === 1 ? product.sizes[0].id : ''
  );
  const [sizeError, setSizeError] = useState(false);

  // Check if this product is in the cart
  const cartMatches = cart.filter((c) => c.productId === product.id);
  const currentTotalQty = cartMatches.reduce((acc, c) => acc + c.quantity, 0);

  const handleAdd = () => {
    if (product.sizes.length > 1 && !selectedSizeId) {
      setSizeError(true);
      return;
    }
    setSizeError(false);
    const chosenSize = product.sizes.find((s) => s.id === selectedSizeId) || product.sizes[0];

    addItem({
      productId: product.id,
      variantId: chosenSize.id,
      name: product.name,
      category: product.category,
      pricePaise: product.pricePaise,
      size: chosenSize.size,
      quantity: 1,
    });
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
          <ProductImage id={product.id} name={product.name} category={product.category} />
        </motion.div>
        {product.required && (
          <span className="required-badge">Required</span>
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

        {/* Compact Size Selector if multiple sizes */}
        {product.sizes.length > 1 && currentTotalQty === 0 && (
          <div className="card-size-row">
            <span className="label">Size:</span>
            <div className="card-size-chips">
              {product.sizes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={!s.inStock}
                  className={`card-size-chip ${selectedSizeId === s.id ? 'is-selected' : ''}`}
                  onClick={() => {
                    setSelectedSizeId(s.id);
                    setSizeError(false);
                  }}
                >
                  {s.size}
                </button>
              ))}
            </div>
            {sizeError && <span className="card-size-error">Please pick a size</span>}
          </div>
        )}

        {/* Add Button or Stepper */}
        <div className="product-card-action">
          {currentTotalQty > 0 ? (
            <QuantityStepper
              quantity={currentTotalQty}
              onIncrement={handleIncrement}
              onDecrement={handleDecrement}
            />
          ) : (
            <button
              type="button"
              className="btn btn-outline card-add-btn"
              onClick={handleAdd}
            >
              Add to bag
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
