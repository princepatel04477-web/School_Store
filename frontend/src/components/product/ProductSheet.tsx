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
import { MEASURE_WITH_CAMERA, MIN_CONFIDENCE } from '../../measure/config';
import { MeasureCapture } from '../../measure/MeasureCapture';
import { recommendSize } from '../../measure/recommendSize';
import { api } from '../../api';
import '../../measure/measure.css';

export interface ProductSheetProps {
  product: CardProduct | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenBag?: () => void;
}

export function ProductSheet({ product, isOpen, onClose, onOpenBag }: ProductSheetProps) {
  const { addItem, selection } = useStoreState();
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
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [shoulderCm, setShoulderCm] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    setHeightCm('');
    setWeightKg('');
    setShoulderCm(null);
    setCameraOpen(false);
    setSelectedSizeId('');
  }, [product?.id]);

  const chart = product?.sizeChart ?? [];
  const uniform = (product?.category || '').toLowerCase() === 'uniform';
  const showFit = Boolean(product && uniform && product.sizes.length > 1 && chart.length > 0);
  const height = Number(heightCm);
  const weight = Number(weightKg);
  const recommended = showFit && height > 0 && weight > 0
    ? recommendSize({
        heightCm: height,
        weightKg: weight,
        className: selection?.gradeName,
        rows: chart,
        shoulderCm,
        useShoulder: shoulderCm != null,
      })
    : null;

  useEffect(() => {
    if (!product || !recommended) return;
    const match = product.sizes.find((size) => size.size === recommended && size.inStock);
    if (match) setSelectedSizeId(match.id);
  }, [product, recommended]);
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
                {showFit && (
                  <div className="fit-fields">
                    <label>
                      {t('measure.height')}
                      <input
                        inputMode="decimal"
                        value={heightCm}
                        onChange={(event) => {
                          setHeightCm(event.target.value);
                          setShoulderCm(null);
                        }}
                      />
                    </label>
                    <label>
                      {t('measure.weight')}
                      <input
                        inputMode="decimal"
                        value={weightKg}
                        onChange={(event) => {
                          setWeightKg(event.target.value);
                          setShoulderCm(null);
                        }}
                      />
                    </label>
                    <ul className="fit-chart">
                      {chart.map((row) => (
                        <li key={row.size}>
                          <span>{row.size}</span>
                          <span>
                            {row.heightCmMin}-{row.heightCmMax} cm, {row.weightKgMin}-{row.weightKgMax} kg
                          </span>
                        </li>
                      ))}
                    </ul>
                    {MEASURE_WITH_CAMERA && (
                      <button
                        type="button"
                        className="measure-open"
                        disabled={!(height > 0)}
                        onClick={() => setCameraOpen(true)}
                      >
                        {t('measure.open')}
                      </button>
                    )}
                  </div>
                )}
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
                </div>
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
      {cameraOpen && height > 0 && (
        <MeasureCapture
          heightCm={height}
          onSkip={() => setCameraOpen(false)}
          onResult={(result) => {
            setCameraOpen(false);
            if (result.confidence < MIN_CONFIDENCE) return;
            setShoulderCm(result.shoulder_cm);
            void api('/catalog/fit-reading/', {
              method: 'POST',
              body: JSON.stringify({
                shoulder_cm: result.shoulder_cm,
                confidence: result.confidence,
              }),
            }).catch(() => undefined);
          }}
        />
      )}
    </>
  );
}
