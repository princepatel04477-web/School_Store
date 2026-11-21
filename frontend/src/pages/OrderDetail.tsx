import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Order } from '../api';
import { useLang, type MessageKey } from '../i18n';
import { Timeline, getOrderStatusLabel } from '../components/Store';
import { Skeleton } from '../components/ui/Skeleton';
import { PullToRefresh } from '../components/native/PullToRefresh';
import { isNativeApp } from '../native/nativePlatform';
import { openExternalUrl } from '../native/externalLinks';
import { siteConfig } from '../siteConfig';
import './orderDetail.css';

export function OrderDetailSkeleton() {
  return (
    <div className="order-detail-container" data-testid="order-detail-skeleton">
      <div className="order-detail-back-bar">
        <Skeleton width="120px" height="44px" borderRadius="var(--radius-md, 4px)" />
      </div>
      <div className="order-detail-header-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <Skeleton width="160px" height="24px" />
          <Skeleton width="80px" height="24px" borderRadius="12px" />
        </div>
        <Skeleton width="120px" height="16px" />
      </div>
      <div className="order-detail-section">
        <Skeleton width="140px" height="20px" style={{ marginBottom: '14px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
        </div>
      </div>
      <div className="order-detail-section">
        <Skeleton width="100px" height="20px" style={{ marginBottom: '14px' }} />
        <Skeleton width="100%" height="32px" />
      </div>
      <div className="order-detail-section">
        <Skeleton width="100px" height="20px" style={{ marginBottom: '14px' }} />
        <Skeleton width="100%" height="80px" />
      </div>
    </div>
  );
}

function formatEventTimestamp(isoString?: string | null): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

function formatOrderDate(isoString?: string | null): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLang();
  const [copied, setCopied] = useState(false);

  const { data: order, isLoading, isError, refetch } = useQuery({
    queryKey: ['order-detail', id],
    queryFn: () => api<Order>(`/orders/${id}/`),
    enabled: Boolean(id),
    refetchOnWindowFocus: true,
  });

  const isNative = isNativeApp();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(isNative ? '/orders' : '/parent/orders');
    }
  };

  const handleCopy = async (articleNumber: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(articleNumber);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = articleNumber;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (siteConfig.indiaPostTrackingUrl && isNative) {
      e.preventDefault();
      openExternalUrl(siteConfig.indiaPostTrackingUrl);
    }
  };

  if (isLoading) {
    return <OrderDetailSkeleton />;
  }

  if (isError || !order) {
    return (
      <div className="order-detail-container">
        <div className="order-detail-back-bar">
          <button
            type="button"
            className="order-detail-back-btn"
            onClick={handleBack}
            aria-label={t('orderDetail.back')}
          >
            ← {t('orderDetail.back')}
          </button>
        </div>
        <div className="order-detail-error" role="alert" data-testid="order-detail-error">
          <p>{t('orderDetail.loadError')}</p>
          <button
            type="button"
            className="primary"
            onClick={() => refetch()}
            style={{ minHeight: '44px', minWidth: '96px' }}
          >
            {t('orders.retry')}
          </button>
        </div>
      </div>
    );
  }

  const isPickup = order.fulfillment_type === 'SCHOOL_PICKUP';
  const steps = order.tracking?.steps || [];
  const latestStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const isDelivered = order.status === 'DELIVERED';
  const isDispatched = ['DISPATCHED', 'SHIPPED', 'DELIVERED'].includes(order.status);
  const consignmentNumber = order.tracking?.consignment_number;

  // Find specific store event timestamps
  const deliveredStep = steps.slice().reverse().find((s) => s.key === 'DELIVERED');
  const dispatchedStep = steps.slice().reverse().find((s) => s.key === 'DISPATCHED' || s.key === 'SHIPPED');

  const content = (
    <div className="order-detail-container" data-testid="order-detail-content">
      {/* Back button */}
      <div className="order-detail-back-bar">
        <button
          type="button"
          className="order-detail-back-btn"
          onClick={handleBack}
          aria-label={t('orderDetail.back')}
        >
          ← {t('orderDetail.back')}
        </button>
      </div>

      {/* Header card: Order number, Placed date, Status */}
      <header className="order-detail-header-card">
        <div className="order-detail-header-top">
          <div>
            <h1 className="order-detail-num">{order.order_number}</h1>
            <div className="order-detail-date">
              {t('orderDetail.placedOn', { date: formatOrderDate(order.created_at) })}
            </div>
          </div>
          <span className={`status status-${(order.status || '').toLowerCase()}`}>
            {getOrderStatusLabel(order, t)}
          </span>
        </div>
        {order.student_name && (
          <div className="order-detail-student">
            <strong>{order.student_name}</strong>
            {order.student_gr ? ` (${order.student_gr})` : ''}
          </div>
        )}
      </header>

      {/* Items bought block */}
      <section className="order-detail-section" aria-labelledby="order-items-heading">
        <h2 id="order-items-heading" className="order-detail-section-title">
          {t('orderDetail.itemsBought')}
        </h2>
        <div className="order-detail-items-list">
          {(order.items || []).map((item, idx: number) => {
            const sizeVal = item.size || item.variant_size || '-';
            const hasMultiple = item.quantity > 1;

            // Personalisation display check
            const customDisplay = (item.customisation_display || {}) as Record<string, unknown>;
            const customKeys = Object.keys(customDisplay);
            const customSummaries: string[] = [];
            for (const k of customKeys) {
              const val = customDisplay[k];
              if (val && typeof val === 'object' && 'value' in val) {
                customSummaries.push(`${k}: ${(val as { value: unknown }).value}`);
              } else if (typeof val === 'string' || typeof val === 'number') {
                customSummaries.push(`${k}: ${val}`);
              }
            }

            return (
              <div className="order-detail-item-row" key={item.id || idx}>
                <div className="order-detail-item-main">
                  <div className="order-detail-item-name">{item.product_name}</div>
                  <div className="order-detail-item-meta">
                    <span>{t('orderDetail.size', { size: sizeVal })}</span>
                    <span>·</span>
                    <span className={hasMultiple ? 'order-detail-qty-badge' : ''}>
                      {hasMultiple ? `x${item.quantity}` : t('orderDetail.qty', { qty: item.quantity })}
                    </span>
                  </div>
                  {customSummaries.length > 0 && (
                    <div className="order-detail-personalisation">
                      {t('orderDetail.personalisation', { details: customSummaries.join(', ') })}
                    </div>
                  )}
                </div>
                <div className="order-detail-item-price">
                  ₹{(Number(item.unit_price_snapshot) * item.quantity).toLocaleString('en-IN')}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Payment block (separate from delivery) */}
      <section className="order-detail-section" aria-labelledby="order-payment-heading">
        <h2 id="order-payment-heading" className="order-detail-section-title">
          {t('orderDetail.payment')}
        </h2>
        <div className="order-detail-payment-info">
          <div className="order-detail-info-row">
            <span className="order-detail-info-label">{t('orderDetail.paymentMethod')}</span>
            <span className="order-detail-info-val">
              {order.payment_method === 'COD'
                ? t('orderDetail.paymentMethod.cod')
                : t('orderDetail.paymentMethod.online')}
            </span>
          </div>

          <div className="order-detail-info-row">
            <span className="order-detail-info-label">Status</span>
            <span className="order-detail-info-val">
              {order.payment_status === 'PAID'
                ? t('orderDetail.paymentStatus.paid')
                : order.payment_status === 'FAILED'
                ? t('orderDetail.paymentStatus.failed')
                : order.payment_status === 'REFUNDED'
                ? t('orderDetail.paymentStatus.refunded')
                : order.payment_method === 'COD'
                ? t('orderDetail.payOnDelivery')
                : t('orderDetail.paymentStatus.pending')}
            </span>
          </div>

          {order.payment_method === 'COD' && order.payment_status !== 'PAID' && (
            <div className="order-detail-cod-due" data-testid="cod-amount-due">
              {t('orderDetail.payOnDeliveryDue', { amount: order.total })}
            </div>
          )}

          <div className="order-detail-info-row" style={{ borderTop: '1px solid var(--line, #DCE0E5)', paddingTop: '10px', marginTop: '4px' }}>
            <span style={{ fontWeight: 700, fontSize: '15px' }}>Total</span>
            <strong style={{ fontSize: '17px', color: 'var(--brand, #2F5D50)' }}>
              ₹{Number(order.total).toLocaleString('en-IN')}
            </strong>
          </div>
        </div>
      </section>

      {/* Delivery block (separate from payment) */}
      <section className="order-detail-section" aria-labelledby="order-delivery-heading">
        <h2 id="order-delivery-heading" className="order-detail-section-title">
          {t('orderDetail.delivery')}
        </h2>

        <div className="order-detail-delivery-info">
          {isPickup ? (
            /* School pickup */
            <>
              <div className="order-detail-pickup-notice" data-testid="school-pickup-info">
                {t('orderDetail.pickupAt', { school: order.school_name || 'School' })}
              </div>
              {isDispatched ? (
                <div className="order-detail-store-event" data-testid="pickup-ready-event">
                  <span>
                    {t('orderDetail.readyAtSchool')}
                    {dispatchedStep?.at ? ` (${formatEventTimestamp(dispatchedStep.at)})` : ''}
                  </span>
                </div>
              ) : latestStep ? (
                <div className="order-detail-store-event">
                  <span>
                    {t('orderDetail.latestStoreEvent', {
                      event: latestStep.key,
                      time: formatEventTimestamp(latestStep.at),
                    })}
                  </span>
                </div>
              ) : null}
            </>
          ) : (
            /* Home delivery */
            <>
              {isDelivered ? (
                <div className="order-detail-store-event" data-testid="store-delivered-event">
                  <span>
                    {t('orderDetail.markedDelivered')}
                    {deliveredStep?.at ? ` (${formatEventTimestamp(deliveredStep.at)})` : ''}
                  </span>
                </div>
              ) : latestStep ? (
                <div className="order-detail-store-event" data-testid="latest-store-event">
                  <span>
                    {t('orderDetail.latestStoreEvent', {
                      event: latestStep.key,
                      time: formatEventTimestamp(latestStep.at),
                    })}
                  </span>
                </div>
              ) : null}

              {isDispatched && consignmentNumber && (
                <div className="order-detail-article-block" data-testid="tracking-article-block">
                  <div className="order-detail-article-label">
                    {t('orderDetail.articleNumberLabel')}
                  </div>
                  <span className="order-detail-article-number" data-testid="article-number">
                    {consignmentNumber}
                  </span>
                  <div className="order-detail-article-actions">
                    <button
                      type="button"
                      className="order-detail-copy-btn"
                      onClick={() => handleCopy(consignmentNumber)}
                      aria-label={copied ? t('tracking.copied') : t('tracking.copy')}
                    >
                      {copied ? t('tracking.copied') : t('tracking.copy')}
                    </button>
                    <span aria-live="polite" className="sr-only">
                      {copied ? t('tracking.copied') : ''}
                    </span>
                    {Boolean(siteConfig.indiaPostTrackingUrl) && (
                      <a
                        href={siteConfig.indiaPostTrackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={handleTrackClick}
                        className="order-detail-track-link"
                      >
                        {t('tracking.trackOnIndiaPost')}
                      </a>
                    )}
                  </div>
                  <p className="order-detail-postal-hint">
                    {t('orderDetail.indiaPostHint')}
                  </p>
                </div>
              )}

              {isDispatched && !consignmentNumber && (
                <div className="order-detail-no-number-notice" data-testid="no-number-notice">
                  {t('orderDetail.noTrackingRecorded')}
                </div>
              )}
            </>
          )}
        </div>

        {/* Timeline */}
        <Timeline order={order} hideTrackingBlock={true} />
      </section>
    </div>
  );

  if (isNative) {
    return <PullToRefresh onRefresh={() => refetch()}>{content}</PullToRefresh>;
  }

  return content;
}
