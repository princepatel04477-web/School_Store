import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from '../ui/icons';
import { motion } from 'motion/react';
import { formatINR } from '../../utils/formatINR';
import { useStoreState } from '../../store/storeState';
import { ProductImage } from './ProductImage';
import { uniformSizeGuide } from '../../data/sizes';
import { SizeSelector } from './SizeSelector';
import { SizeGuide } from './SizeGuide';
import { SizeGuideNotice } from './SizeGuideNotice';
import { QuantityStepper } from './QuantityStepper';
import { AddToBagButton } from './AddToBagButton';
import { useShake } from '../../motion/useShake';
import type { CardProduct } from './ProductCard';
import './product.css';
import { useLang } from '../../i18n';
import { categoryLabel } from '../../i18n/labels';
import { preselectSizeId, suggestedSizeIds, usesMeasurement, type Fit, type ProductFit } from '../../data/fit';
import { RecommendationNote, SizeChartTable } from '../fit/SizeChartTable';
import { MeasurementPanel } from '../fit/MeasurementPanel';
import type { MeasureGarment } from '../fit/MeasureFlow';

export interface ProductSheetProps {
  product: CardProduct | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenBag?: () => void;
  /** This product's size chart and suggestion, when it has one. */
  fit?: ProductFit;
  fitLoading?: boolean;
  /**
   * The child's measurement and how to save a new one. Given, a shirt or
   * trouser opens as a size page with "Accurate size" (Prompt 21).
   */
  measurement?: Fit | null;
  onSaveMeasurement?: (fit: Fit) => Promise<boolean> | boolean;
  /** Shirts and trousers on this list, for the suggestions after measuring. */
  garments?: MeasureGarment[];
  className?: string;
  /** Which school the bag line is for, so the bag can group lines by child. */
  schoolName?: string;
  /** The size this child had last time, chosen when there is no suggestion (Prompt 24). */
  lastSize?: string;
  /** Called after the item is in the bag, instead of opening the bag. */
  onAdded?: (product: CardProduct) => void;
}

export function ProductSheet({
  product,
  isOpen,
  onClose,
  onOpenBag,
  fit,
  fitLoading,
  measurement,
  onSaveMeasurement,
  garments,
  className,
  schoolName,
  lastSize,
  onAdded,
}: ProductSheetProps) {
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

  const photoDialog = useRef<HTMLDialogElement>(null);
  const [chartOpen, setChartOpen] = useState(false);
  // Several photos swipe sideways; the dots and the enlarged view follow the one shown.
  const photoTrack = useRef<HTMLDivElement>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  useEffect(() => {
    setPhotoIndex(0);
    photoTrack.current?.scrollTo?.({ left: 0 });
  }, [product?.id]);
  const showPhoto = (index: number) => {
    const track = photoTrack.current;
    // The arrows and dots switch at once; a finger swipe keeps its own glide.
    if (track) track.scrollTo?.({ left: index * track.clientWidth, behavior: 'auto' });
    setPhotoIndex(index);
  };

  // Each product opens on its suggested size (if in stock), or the size the
  // child had last time, never the last product's choice.
  const lastSizeId = product?.sizes.find((s) => s.size === lastSize && s.inStock)?.id;
  const guide = product && uniformSizeGuide(product.category, product.sizes, className);
  const preselected = product ? (measurement ? preselectSizeId(product.sizes, fit) : undefined) ?? guide?.availableId ?? lastSizeId ?? preselectSizeId(product.sizes, fit) ?? '' : '';
  useEffect(() => {
    setSelectedSizeId(preselected);
    setSizeError(undefined);
  }, [product?.id, preselected]);

  // Escape key closes the sheet
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !sizeGuideOpen && !photoDialog.current?.open) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, sizeGuideOpen, onClose]);

  // The product is a full page: the list behind it doesn't scroll.
  useEffect(() => {
    if (!isOpen) return undefined;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen || !product) return null;

  const orderable = product.sizes.some((size) => size.inStock) && !product.needsDetails;
  const suggested = suggestedSizeIds(product.sizes, fit);
  const hasChart = Boolean(fit && fit.chart.length > 0);
  const sizePage = usesMeasurement(product) && Boolean(onSaveMeasurement);

  const photos = product.gallery ?? [];
  const shownPhoto = Math.min(photoIndex, Math.max(photos.length - 1, 0));
  const hero = product.heroUrl || product.imageUrl;
  const enlarged = photos.length > 1 ? photos[shownPhoto] : hero ? { src: hero, alt: product.imageAlt } : null;
  /** The arrows: one photo back or on, wrapping round at either end. */
  const stepPhoto = (step: number) => showPhoto((shownPhoto + step + photos.length) % photos.length);

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
      ...(product.imageUrl ? { image: product.imageUrl } : {}),
      category: product.category,
      pricePaise: product.pricePaise,
      size: chosenSize.size,
      quantity,
      // The numbers this line was sized from, kept with the line (Prompt 23).
      ...(sizePage && measurement ? { measurement } : {}),
      ...(className ? { className } : {}),
      ...(schoolName ? { schoolName } : {}),
    });
    return true;
  };

  // After the "Added" moment, hand over to the next step, or the bag
  const handleSettled = () => {
    if (onAdded) {
      onAdded(product);
      return;
    }
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
          {/* Back to the list */}
          <div className="sheet-topbar">
            <button type="button" className="sheet-back" aria-label={t('common.close')} onClick={onClose}>
              <ArrowLeft width={20} height={20} />
              <span>{t('product.back')}</span>
            </button>
            <span className="sheet-topbar-title">{product.name}</span>
          </div>

          <div className="sheet-content-grid">
            {/* Gallery Left */}
            <div className="sheet-gallery-col">
              <motion.div layoutId={`product-image-${product.id}`} style={{ width: '100%', position: 'relative' }}>
                {photos.length > 1 ? (
                  // Several photos: swipe sideways (plain shot first, then the child wearing it).
                  <div className="sheet-photos">
                    <div className="sheet-photos-stage">
                      <div
                        ref={photoTrack}
                        className="sheet-photos-track"
                        onScroll={(event) => {
                          const track = event.currentTarget;
                          setPhotoIndex(Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)));
                        }}
                      >
                        {photos.map((photo, index) => (
                          <div className="sheet-photos-slide" key={photo.src}>
                            <ProductImage
                              id={`${product.id}-${index}`}
                              name={product.name}
                              category={product.category}
                              imageUrl={photo.src}
                              alt={photo.alt ?? product.imageAlt}
                              imageSize={1000}
                              priority={index === 0}
                            />
                            <button type="button" className="sheet-photo-trigger" aria-label={t('product.enlargePhoto')}
                              aria-haspopup="dialog" onClick={() => photoDialog.current?.showModal()} />
                          </div>
                        ))}
                      </div>
                      {/* Arrows to the previous and next photo; the last one wraps to the first. */}
                      <button type="button" className="sheet-photos-arrow sheet-photos-arrow--prev"
                        aria-label={t('product.prevPhoto')} onClick={() => stepPhoto(-1)}>
                        <ChevronLeft width={22} height={22} />
                      </button>
                      <button type="button" className="sheet-photos-arrow sheet-photos-arrow--next"
                        aria-label={t('product.nextPhoto')} onClick={() => stepPhoto(1)}>
                        <ChevronRight width={22} height={22} />
                      </button>
                      <span className="sheet-photos-count" aria-hidden="true">{shownPhoto + 1} / {photos.length}</span>
                    </div>
                    <div className="sheet-photos-dots">
                      {photos.map((photo, index) => (
                        <button
                          key={photo.src}
                          type="button"
                          className={`sheet-photos-dot ${index === shownPhoto ? 'is-active' : ''}`}
                          aria-label={t('product.photoOf', { n: index + 1, total: photos.length })}
                          aria-current={index === shownPhoto}
                          onClick={() => showPhoto(index)}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <ProductImage
                      id={product.id}
                      name={product.name}
                      category={product.category}
                      imageUrl={product.heroUrl ?? product.imageUrl}
                      alt={product.imageAlt}
                      imageSize={product.heroUrl ? 1000 : 400}
                      priority
                    />
                    {hero && (
                      <button type="button" className="sheet-photo-trigger" aria-label={t('product.enlargePhoto')}
                        aria-haspopup="dialog" onClick={() => photoDialog.current?.showModal()} />
                    )}
                  </>
                )}
              </motion.div>
              <dialog ref={photoDialog} className="sheet-photo-viewer" aria-label={product.name}
                onClick={(event) => { if (event.target === event.currentTarget) photoDialog.current?.close(); }}>
                {enlarged && (
                  <img src={enlarged.src} alt={enlarged.alt || product.imageAlt || product.name} loading="lazy" />
                )}
                {photos.length > 1 && (
                  <>
                    <button type="button" className="sheet-photos-arrow sheet-photos-arrow--prev sheet-photos-arrow--viewer"
                      aria-label={t('product.prevPhoto')} onClick={() => stepPhoto(-1)}>
                      <ChevronLeft width={24} height={24} />
                    </button>
                    <button type="button" className="sheet-photos-arrow sheet-photos-arrow--next sheet-photos-arrow--viewer"
                      aria-label={t('product.nextPhoto')} onClick={() => stepPhoto(1)}>
                      <ChevronRight width={24} height={24} />
                    </button>
                    <span className="sheet-photos-count sheet-photos-count--viewer" aria-live="polite">
                      {t('product.photoOf', { n: shownPhoto + 1, total: photos.length })}
                    </span>
                  </>
                )}
                <button type="button" className="sheet-photo-close" aria-label={t('common.close')}
                  onClick={() => photoDialog.current?.close()}>×</button>
              </dialog>
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

              {guide && <p>{t('size.classDefault', { size: guide.label })}</p>}
              {!orderable && guide && <SizeSelector sizes={guide.choices.map(s => ({ ...s, inStock: false }))} selectedSizeId="" onSelectSize={() => {}} />}
              {!orderable ? (
                <p className="card-unavailable sheet-unavailable">
                  {product.needsDetails ? t('product.needsPhoto') : t('product.outOfStock')}
                </p>
              ) : (
                <>
              {product.sizes.length > 1 && (
                <SizeGuideNotice productId={product.id} onOpen={() => setSizeGuideOpen(true)} />
              )}

              {/* Sizing Radio Group */}
              {product.sizes.length > 0 && (
                <div ref={sizeRowRef}>
                <SizeSelector
                  sizes={guide?.choices ?? product.sizes}
                  selectedSizeId={selectedSizeId}
                  onSelectSize={(id) => {
                    setSelectedSizeId(id);
                    setSizeError(undefined);
                  }}
                  error={sizeError}
                  suggestedIds={[suggested.primary, suggested.alt].filter((id): id is string => Boolean(id))}
                />
                </div>
              )}

              {sizePage && (
                <MeasurementPanel
                  measurement={measurement ?? null}
                  garments={garments}
                  className={className}
                  onSave={onSaveMeasurement!}
                />
              )}

              {product.sizes.length > 1 && (
                <>
                  <RecommendationNote recommendation={fit?.recommendation} />
                  {sizePage && hasChart ? (
                    <>
                      <button
                        type="button"
                        className="size-chart-toggle"
                        aria-expanded={chartOpen}
                        onClick={() => setChartOpen(!chartOpen)}
                      >
                        {chartOpen ? t('size.hideChart') : t('size.viewChart')}
                      </button>
                      {chartOpen && (
                        <SizeChartTable rows={fit?.chart} recommendation={fit?.recommendation} />
                      )}
                    </>
                  ) : (
                    <SizeChartTable rows={fit?.chart} loading={fitLoading} recommendation={fit?.recommendation} />
                  )}
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
      >
        {hasChart ? <SizeChartTable rows={fit?.chart} recommendation={fit?.recommendation} /> : undefined}
      </SizeGuide>
    </>
  );
}
