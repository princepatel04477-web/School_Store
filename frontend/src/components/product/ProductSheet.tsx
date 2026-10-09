import { useState } from 'react';
import { X, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatINR } from '../../utils/formatINR';
import { useStoreState } from '../../store/storeState';
import { ProductImage } from './ProductImage';
import { SizeSelector } from './SizeSelector';
import { SizeGuide } from './SizeGuide';
import { QuantityStepper } from './QuantityStepper';
import { EASING } from '../../motion/motionConfig';
import type { SeedProduct } from '../../data/seedData';
import './product.css';

export interface ProductSheetProps {
  product: SeedProduct | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenBag?: () => void;
}

export function ProductSheet({ product, isOpen, onClose, onOpenBag }: ProductSheetProps) {
  const { addItem } = useStoreState();

  const [selectedSizeId, setSelectedSizeId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [sizeError, setSizeError] = useState<string | undefined>();
  const [isAddedSuccess, setIsAddedSuccess] = useState(false);

  // Accordion open states
  const [openFabric, setOpenFabric] = useState(true);
  const [openDelivery, setOpenDelivery] = useState(false);
  const [openExchange, setOpenExchange] = useState(false);

  if (!isOpen || !product) return null;

  const handleAdd = () => {
    if (product.sizes.length > 1 && !selectedSizeId) {
      setSizeError('Please select a size to continue');
      return;
    }
    setSizeError(undefined);

    const chosenSize = product.sizes.find((s) => s.id === selectedSizeId) || product.sizes[0];
    addItem({
      productId: product.id,
      variantId: chosenSize.id,
      name: product.name,
      category: product.category,
      pricePaise: product.pricePaise,
      size: chosenSize.size,
      quantity,
    });

    setIsAddedSuccess(true);
    setTimeout(() => {
      setIsAddedSuccess(false);
      if (onOpenBag) {
        onClose();
        onOpenBag();
      }
    }, 1500);
  };

  return (
    <>
      <div className="product-sheet-backdrop" onClick={onClose}>
        <div
          className="product-sheet-modal"
          role="dialog"
          aria-modal="true"
          aria-label={product.name}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            type="button"
            className="sheet-close-floating"
            aria-label="Close product view"
            onClick={onClose}
          >
            <X width={22} height={22} strokeWidth={1.5} />
          </button>

          <div className="sheet-content-grid">
            {/* Gallery Left */}
            <div className="sheet-gallery-col">
              <motion.div layoutId={`product-image-${product.id}`} style={{ width: '100%' }}>
                <ProductImage id={product.id} name={product.name} category={product.category} priority />
              </motion.div>
            </div>

            {/* Details Right */}
            <div className="sheet-details-col">
              {/* Breadcrumb */}
              <nav className="product-breadcrumb" aria-label="Breadcrumb">
                <span>{product.category}</span>
                <span className="crumb-sep">/</span>
                <span>{product.name}</span>
              </nav>

              <h1 className="product-sheet-title">{product.name}</h1>
              <div className="product-sheet-price">{formatINR(product.pricePaise)}</div>
              <p className="product-sheet-desc">{product.description}</p>

              {/* Sizing Radio Group */}
              {product.sizes.length > 0 && (
                <SizeSelector
                  sizes={product.sizes}
                  selectedSizeId={selectedSizeId}
                  onSelectSize={(id) => {
                    setSelectedSizeId(id);
                    setSizeError(undefined);
                  }}
                  onOpenSizeGuide={() => setSizeGuideOpen(true)}
                  error={sizeError}
                />
              )}

              {/* Quantity Stepper */}
              <div className="sheet-qty-row">
                <span className="label">Quantity</span>
                <QuantityStepper
                  quantity={quantity}
                  onIncrement={() => setQuantity((q) => q + 1)}
                  onDecrement={() => setQuantity((q) => Math.max(1, q - 1))}
                  min={1}
                />
              </div>

              {/* Main Add Button */}
              <div className="sheet-cta-row">
                <button
                  type="button"
                  className={`btn btn-primary sheet-add-btn ${isAddedSuccess ? 'btn-success-added' : ''}`}
                  onClick={handleAdd}
                  disabled={isAddedSuccess}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {isAddedSuccess ? (
                      <motion.span
                        key="added"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15, ease: EASING }}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      >
                        <Check width={18} height={18} strokeWidth={2} />
                        Added to Bag
                      </motion.span>
                    ) : (
                      <motion.span
                        key="add"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15, ease: EASING }}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        Add to Bag · {formatINR(product.pricePaise * quantity)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </div>

              {/* Accordions */}
              <div className="product-accordions">
                <div className="accordion-item">
                  <button
                    type="button"
                    className="accordion-trigger"
                    onClick={() => setOpenFabric(!openFabric)}
                    aria-expanded={openFabric}
                  >
                    <span>Fabric & Care</span>
                    {openFabric ? <ChevronUp width={18} height={18} /> : <ChevronDown width={18} height={18} />}
                  </button>
                  {openFabric && (
                    <div className="accordion-body">
                      <p>{product.fabricCare || 'Machine wash warm (40°C) with similar colours. Warm iron.'}</p>
                    </div>
                  )}
                </div>

                <div className="accordion-item">
                  <button
                    type="button"
                    className="accordion-trigger"
                    onClick={() => setOpenDelivery(!openDelivery)}
                    aria-expanded={openDelivery}
                  >
                    <span>Delivery & Collection</span>
                    {openDelivery ? <ChevronUp width={18} height={18} /> : <ChevronDown width={18} height={18} />}
                  </button>
                  {openDelivery && (
                    <div className="accordion-body">
                      <p>{product.deliveryNotes || 'Orders dispatched within 48 hours to home address or school counter.'}</p>
                    </div>
                  )}
                </div>

                <div className="accordion-item">
                  <button
                    type="button"
                    className="accordion-trigger"
                    onClick={() => setOpenExchange(!openExchange)}
                    aria-expanded={openExchange}
                  >
                    <span>Exchange & Returns</span>
                    {openExchange ? <ChevronUp width={18} height={18} /> : <ChevronDown width={18} height={18} />}
                  </button>
                  {openExchange && (
                    <div className="accordion-body">
                      <p>Free size exchange within 7 days of delivery. Unwashed with original tags intact.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Size Guide modal */}
      <SizeGuide
        category={product.category}
        isOpen={sizeGuideOpen}
        onClose={() => setSizeGuideOpen(false)}
      />
    </>
  );
}
