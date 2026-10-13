import { useEffect, useState } from 'react';
import { X, ChevronDown, ChevronUp } from '../ui/icons';
import { motion } from 'motion/react';
import { formatINR } from '../../utils/formatINR';
import { useStoreState } from '../../store/storeState';
import { ProductImage } from './ProductImage';
import { SizeSelector } from './SizeSelector';
import { SizeGuide } from './SizeGuide';
import { QuantityStepper } from './QuantityStepper';
import { AddToBagButton } from './AddToBagButton';
import { useShake } from '../../motion/useShake';
import type { CardProduct } from './ProductCard';
import './product.css';
import { useLang } from '../../i18n';
import { categoryLabel } from '../../i18n/labels';
import { preselectSizeId, suggestedSizeIds, type ProductFit } from '../../data/fit';
import { RecommendationNote, SizeChartTable } from '../fit/SizeChartTable';

export interface ProductSheetProps {
  product: CardProduct | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenBag?: () => void;
  /** This product's size chart and suggestion, when it has one. */
  fit?: ProductFit;
  fitLoading?: boolean;
}

export function ProductSheet({ product, isOpen, onClose, onOpenBag, fit, fitLoading }: ProductSheetProps) {
  const { addItem } = useStoreState();
  const { t } = useLang();

  const [selectedSizeId, setSelectedSizeId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [sizeError, setSizeError] = useState<string | undefined>();
  const [sizeRowRef, shakeSizeRow] = useShake();

  // Accordion open states
  const [openFabric, setOpenFabric] = useState(true);
  const [openDelivery, setOpenDelivery] = useState(false);
  const [openExchange, setOpenExchange] = useState(false);

  // Each product opens on its suggested size (if in stock), never the last product's choice.
  const preselected = product ? preselectSizeId(product.sizes, fit) ?? '' : '';
  useEffect(() => {
    setSelectedSizeId(preselected);
    setSizeError(undefined);
  }, [product?.id, preselected]);

  // Escape key closes the sheet
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !sizeGuideOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, sizeGuideOpen, onClose]);

  if (!isOpen || !product) return null;

  const orderable = product.sizes.some((size) => size.inStock) && !product.needsDetails;
  const suggested = suggestedSizeIds(product.sizes, fit);
  const hasChart = Boolean(fit && fit.chart.length > 0);

  const handleAdd = (): boolean => {
    if (product.sizes.length > 1 && !selectedSizeId) {
      setSizeError(t('product.pickSize'));
      shakeSizeRow();
      return false;
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
    return true;
  };

  // After the "Added" moment, hand over to the bag
  const handleSettled = () => {
    if (onOpenBag) {
      onClose();
      onOpenBag();
    }
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
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X width={22} height={22} strokeWidth={1.5} />
          </button>

          <div className="sheet-content-grid">
            {/* Gallery Left */}
            <div className="sheet-gallery-col">
              <motion.div layoutId={`product-image-${product.id}`} style={{ width: '100%' }}>
                <ProductImage id={product.id} name={product.name} category={product.category} imageUrl={product.imageUrl} priority />
              </motion.div>
            </div>

            {/* Details Right */}
            <div className="sheet-details-col">
              {/* Breadcrumb */}
              <nav className="product-breadcrumb" aria-label="Breadcrumb">
                <span>{categoryLabel(product.category, t)}</span>
                <span className="crumb-sep">/</span>
                <span>{product.name}</span>
              </nav>

              <h1 className="product-sheet-title">{product.name}</h1>
              <div className="product-sheet-price">{formatINR(product.pricePaise)}</div>
              <p className="product-sheet-desc">{product.description}</p>

              {!orderable ? (
                <p className="card-unavailable sheet-unavailable">
                  {product.needsDetails ? t('product.needsPhoto') : t('product.outOfStock')}
                </p>
              ) : (
                <>
              {/* Sizing Radio Group */}
              {product.sizes.length > 0 && (
                <div ref={sizeRowRef}>
                <SizeSelector
                  sizes={product.sizes}
                  selectedSizeId={selectedSizeId}
                  onSelectSize={(id) => {
                    setSelectedSizeId(id);
                    setSizeError(undefined);
                  }}
                  onOpenSizeGuide={hasChart || fitLoading ? undefined : () => setSizeGuideOpen(true)}
                  error={sizeError}
                  suggestedIds={[suggested.primary, suggested.alt].filter((id): id is string => Boolean(id))}
                />
                </div>
              )}

              {product.sizes.length > 1 && (
                <>
                  <RecommendationNote recommendation={fit?.recommendation} />
                  <SizeChartTable rows={fit?.chart} loading={fitLoading} recommendation={fit?.recommendation} />
                </>
              )}

              {/* Quantity Stepper */}
              <div className="sheet-qty-row">
                <span className="label">{t('product.quantity')}</span>
                <QuantityStepper
                  quantity={quantity}
                  onIncrement={() => setQuantity((q) => q + 1)}
                  onDecrement={() => setQuantity((q) => Math.max(1, q - 1))}
                  min={1}
                />
              </div>

              {/* Main Add Button */}
              <div className="sheet-cta-row">
                <AddToBagButton
                  variant="primary"
                  className="sheet-add-btn"
                  onAdd={handleAdd}
                  onSettled={handleSettled}
                >
                  {t('product.addWithPrice', { price: formatINR(product.pricePaise * quantity) })}
                </AddToBagButton>
              </div>
                </>
              )}

              {/* Accordions */}
              <div className="product-accordions">
                <div className="accordion-item">
                  <button
                    type="button"
                    className="accordion-trigger"
                    onClick={() => setOpenFabric(!openFabric)}
                    aria-expanded={openFabric}
                  >
                    <span>{t('product.careTitle')}</span>
                    {openFabric ? <ChevronUp width={18} height={18} /> : <ChevronDown width={18} height={18} />}
                  </button>
                  {openFabric && (
                    <div className="accordion-body">
                      <p>{product.fabricCare || t('product.care')}</p>
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
                    <span>{t('product.deliveryTitle')}</span>
                    {openDelivery ? <ChevronUp width={18} height={18} /> : <ChevronDown width={18} height={18} />}
                  </button>
                  {openDelivery && (
                    <div className="accordion-body">
                      <p>{product.deliveryNotes || t('product.delivery')}</p>
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
                    <span>{t('product.exchangeTitle')}</span>
                    {openExchange ? <ChevronUp width={18} height={18} /> : <ChevronDown width={18} height={18} />}
                  </button>
                  {openExchange && (
                    <div className="accordion-body">
                      <p>{t('product.exchange')}</p>
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
