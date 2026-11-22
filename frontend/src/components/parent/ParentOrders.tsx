import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Order } from '../../api';
import { useLang } from '../../i18n';
import { formatRupees } from '../../utils/formatINR';
import { ShoppingBag, ArrowLeft } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import { fulfilmentLabel, paymentLabel } from './orderLabels';
import { ParentTimeline } from './ParentTimeline';
import './ParentOrders.css';

interface OrderCursorResponse {
  next: string | null;
  previous: string | null;
  results: Order[];
}

export interface OrderItemDetail {
  id: string;
  variant: string;
  variant_sku: string;
  variant_size: string;
  product_name: string;
  category: string;
  quantity: number;
  unit_price_snapshot: string;
}

export interface OrderStatusEventDetail {
  id: string;
  status: string;
  timestamp: string;
  note?: string;
}

export interface OrderDetailPayload {
  id: string;
  order_number: string;
  student: string;
  student_name: string;
  student_gr: string;
  school_name: string;
  city_name: string;
  status: string;
  payment_status: string;
  payment_method: string;
  fulfillment_type: string;
  subtotal: string;
  total: string;
  delivery_details: Record<string, any>;
  items: OrderItemDetail[];
  status_events: OrderStatusEventDetail[];
  created_at: string;
}

/**
 * Parent Orders List View
 * Single column, token-based, separate fulfilment and payment labels,
 * custom timeline supporting all statuses, cursor load more.
 */
export function ParentOrders() {
  const { t } = useLang();
  const [accumulatedPages, setAccumulatedPages] = useState<Order[]>([]);
  const [nextCursorUrl, setNextCursorUrl] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const {
    data: firstPage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['parent-orders-list'],
    queryFn: async () => {
      const res = await api<OrderCursorResponse>('/orders/');
      setNextCursorUrl(res.next);
      return res;
    },
  });

  // Combine initial page with any pages fetched via "Load more", deduplicating by ID
  const allOrders = useMemo(() => {
    const initial = firstPage?.results || [];
    const combined = [...initial, ...accumulatedPages];
    const unique = new Map<string, Order>();
    for (const o of combined) {
      if (o && o.id) {
        unique.set(o.id, o);
      }
    }
    return Array.from(unique.values());
  }, [firstPage, accumulatedPages]);

  async function handleLoadMore() {
    if (!nextCursorUrl || loadingMore) return;
    setLoadingMore(true);
    try {
      // nextCursorUrl is full URL or relative query path
      const path = nextCursorUrl.startsWith('/api')
        ? nextCursorUrl.slice(4)
        : nextCursorUrl.includes('/orders/')
        ? `/orders/${nextCursorUrl.split('/orders/')[1]}`
        : nextCursorUrl;
      const res = await api<OrderCursorResponse>(path);
      setNextCursorUrl(res.next);
      setAccumulatedPages((prev) => [...prev, ...(res.results || [])]);
    } catch {
      // Keep next cursor so parent can retry
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="parent-orders-page">
      <div className="parent-orders-header">
        <div className="parent-orders-header-row">
          <div>
            <span className="eyebrow">{t('orders.subtitle')}</span>
            <h1>{t('orders.title')}</h1>
          </div>
          <Link to="/parent" className="parent-shop-again-link">
            {t('orders.shopAgain')}
          </Link>
        </div>
      </div>

      {/* Loading Skeletons */}
      {isLoading && (
        <div className="parent-orders-list" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="parent-order-card">
              <Skeleton width="40%" height="20px" />
              <Skeleton width="100%" height="40px" />
              <Skeleton width="70%" height="16px" />
              <Skeleton width="100%" height="36px" borderRadius="var(--radius-sm)" />
            </div>
          ))}
        </div>
      )}

      {/* Real Error with Retry */}
      {!isLoading && isError && (
        <div className="parent-orders-error" role="alert">
          <h3>{t('orders.errorTitle')}</h3>
          <p>{t('err.offline')}</p>
          <button
            type="button"
            className="parent-orders-retry-btn"
            onClick={() => void refetch()}
          >
            {t('parent.retry')}
          </button>
        </div>
      )}

      {/* Friendly Empty State without glyphs */}
      {!isLoading && !isError && allOrders.length === 0 && (
        <div className="parent-orders-empty">
          <ShoppingBag className="parent-empty-icon" />
          <h3>{t('orders.noOrdersTitle')}</h3>
          <p>{t('orders.noOrdersDesc')}</p>
          <Link to="/parent" className="parent-empty-cta">
            {t('orders.browseCatalog')}
          </Link>
        </div>
      )}

      {/* Orders List */}
      {!isLoading && !isError && allOrders.length > 0 && (
        <div className="parent-orders-list">
          {allOrders.map((o) => {
            const rawTotal = typeof o.total === 'number' ? o.total : parseFloat(String(o.total || '0'));
            const formattedTotal = isNaN(rawTotal) ? '₹0' : formatRupees(rawTotal);
            const createdDate = o.created_at
              ? new Date(o.created_at).toLocaleDateString('en-IN')
              : '';

            return (
              <article key={o.id} className="parent-order-card">
                <div className="parent-order-card-top">
                  <div className="parent-order-number-group">
                    <span className="parent-order-number">{o.order_number}</span>
                    <span className="parent-order-date">{createdDate}</span>
                  </div>
                  <div className="parent-order-badges">
                    <span className="fulfilment-label">{fulfilmentLabel(o.status, t)}</span>
                    <span className="payment-label">
                      {paymentLabel(o.payment_status, (o as any).payment_method, t)}
                    </span>
                  </div>
                </div>

                <div className="parent-order-meta">
                  <span className="parent-order-student">{o.student_name}</span>
                  <span className="parent-order-total">{formattedTotal}</span>
                </div>

                <ParentTimeline status={o.status} />

                <Link to={`/parent/orders/${o.id}`} className="parent-view-detail-link">
                  {t('orders.viewDetail')}
                </Link>
              </article>
            );
          })}

          {/* Load More Button */}
          {nextCursorUrl && (
            <button
              type="button"
              className="parent-load-more-btn"
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? t('orders.loadingMore') : t('orders.loadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Parent Order Detail View (/parent/orders/:id)
 * Fetches order detail, hides sensitive internal ids (razorpay, placed_by, payer),
 * shows items, sizes, totals, fulfilment details, and status history.
 */
export function ParentOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLang();

  const {
    data: order,
    isLoading,
    error,
    refetch,
  } = useQuery<OrderDetailPayload, any>({
    queryKey: ['parent-order-detail', id],
    queryFn: () => api<OrderDetailPayload>(`/orders/${id}/`),
    enabled: Boolean(id),
    retry: false,
  });

  const is404 = error?.status === 404;

  if (isLoading) {
    return (
      <div className="parent-detail-page" aria-busy="true">
        <Skeleton width="120px" height="20px" />
        <div className="parent-detail-card" style={{ marginTop: 'var(--space-4)' }}>
          <Skeleton width="60%" height="28px" />
          <Skeleton width="100%" height="60px" />
          <Skeleton width="100%" height="100px" />
        </div>
      </div>
    );
  }

  // 404 handler: "We could not find this order" (same whether not existing or belongs to another parent)
  if (is404) {
    return (
      <div className="parent-detail-page">
        <Link to="/parent/orders" className="parent-back-btn">
          <ArrowLeft width={18} height={18} />
          <span>{t('orders.backToOrders')}</span>
        </Link>
        <div className="parent-orders-empty">
          <ShoppingBag className="parent-empty-icon" />
          <h3>{t('orders.notFoundTitle')}</h3>
          <p>{t('orders.notFoundDesc')}</p>
          <Link to="/parent/orders" className="parent-empty-cta">
            {t('orders.backToOrders')}
          </Link>
        </div>
      </div>
    );
  }

  // Other errors -> retry
  if (error || !order) {
    return (
      <div className="parent-detail-page">
        <Link to="/parent/orders" className="parent-back-btn">
          <ArrowLeft width={18} height={18} />
          <span>{t('orders.backToOrders')}</span>
        </Link>
        <div className="parent-orders-error" role="alert">
          <h3>{t('orders.errorTitle')}</h3>
          <p>{t('err.offline')}</p>
          <button
            type="button"
            className="parent-orders-retry-btn"
            onClick={() => void refetch()}
          >
            {t('parent.retry')}
          </button>
        </div>
      </div>
    );
  }

  const rawSubtotal = parseFloat(order.subtotal || '0');
  const formattedSubtotal = isNaN(rawSubtotal) ? '₹0' : formatRupees(rawSubtotal);
  const rawTotal = parseFloat(order.total || '0');
  const formattedTotal = isNaN(rawTotal) ? '₹0' : formatRupees(rawTotal);
  const createdDate = order.created_at
    ? new Date(order.created_at).toLocaleDateString('en-IN')
    : '';

  const isHomeDelivery = order.fulfillment_type === 'HOME_DELIVERY';

  return (
    <div className="parent-detail-page">
      <Link to="/parent/orders" className="parent-back-btn">
        <ArrowLeft width={18} height={18} />
        <span>{t('orders.backToOrders')}</span>
      </Link>

      {/* Main Order Card */}
      <div className="parent-detail-card">
        <div className="parent-order-card-top">
          <div className="parent-order-number-group">
            <span className="parent-order-number">{order.order_number}</span>
            <span className="parent-order-date">{`${t('orders.date')}: ${createdDate}`}</span>
          </div>
          <div className="parent-order-badges">
            <span className="fulfilment-label">{fulfilmentLabel(order.status, t)}</span>
            <span className="payment-label">
              {paymentLabel(order.payment_status, order.payment_method, t)}
            </span>
          </div>
        </div>

        <div className="parent-detail-section-row">
          <span className="parent-detail-label">{t('parent.studentProfile')}</span>
          <span className="parent-detail-val">
            {order.student_name} ({order.student_gr || ''})
          </span>
        </div>

        <div className="parent-detail-section-row">
          <span className="parent-detail-label">{t('parent.school')}</span>
          <span className="parent-detail-val">
            {order.school_name || order.city_name || ''}
          </span>
        </div>

        <div className="parent-detail-section-row">
          <span className="parent-detail-label">{t('orders.fulfilmentType')}</span>
          <span className="parent-detail-val">
            {isHomeDelivery ? t('orders.homeDelivery') : t('orders.schoolPickup')}
          </span>
        </div>
      </div>

      {/* Progress Timeline */}
      <div className="parent-detail-card">
        <h2>{t('orders.statusHistory')}</h2>
        <ParentTimeline status={order.status} />

        {order.status_events && order.status_events.length > 0 && (
          <div className="status-history-list" style={{ marginTop: 'var(--space-3)' }}>
            {order.status_events.map((ev) => (
              <div key={ev.id} className="status-history-item">
                <span className="status-history-name">{fulfilmentLabel(ev.status, t)}</span>
                <span className="status-history-time">
                  {new Date(ev.timestamp).toLocaleString('en-IN')}
                </span>
                {ev.note && <span className="status-history-note">{ev.note}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Items Ordered */}
      <div className="parent-detail-card">
        <h2>{t('orders.items')}</h2>
        <div>
          {order.items &&
            order.items.map((item) => {
              const unitPrice = parseFloat(item.unit_price_snapshot || '0');
              const lineTotal = isNaN(unitPrice) ? '₹0' : formatRupees(unitPrice * item.quantity);
              return (
                <div key={item.id} className="detail-item-row">
                  <div className="detail-item-info">
                    <span className="detail-item-name">{item.product_name}</span>
                    <span className="detail-item-meta">
                      {`${t('orders.size')}: ${item.variant_size || 'Standard'} · ${t(
                        'orders.qty'
                      )}: ${item.quantity}`}
                    </span>
                  </div>
                  <span className="detail-item-total">{lineTotal}</span>
                </div>
              );
            })}
        </div>

        <div style={{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--line)', paddingTop: 'var(--space-2)' }}>
          <div className="parent-detail-section-row">
            <span className="parent-detail-label">{t('orders.subtotal')}</span>
            <span className="parent-detail-val">{formattedSubtotal}</span>
          </div>
          <div className="parent-detail-section-row" style={{ marginTop: 'var(--space-1)' }}>
            <span className="parent-detail-label" style={{ fontWeight: 700, color: 'var(--ink)' }}>
              {t('orders.total')}
            </span>
            <span className="parent-detail-val" style={{ fontWeight: 700, fontSize: '1.125rem' }}>
              {formattedTotal}
            </span>
          </div>
        </div>
      </div>

      {/* Delivery Details */}
      {order.delivery_details && Object.keys(order.delivery_details).length > 0 && (
        <div className="parent-detail-card">
          <h2>{t('orders.deliveryDetails')}</h2>
          {order.delivery_details.recipient_name && (
            <div className="parent-detail-section-row">
              <span className="parent-detail-label">Recipient</span>
              <span className="parent-detail-val">{order.delivery_details.recipient_name}</span>
            </div>
          )}
          {order.delivery_details.phone && (
            <div className="parent-detail-section-row">
              <span className="parent-detail-label">Phone</span>
              <span className="parent-detail-val">{order.delivery_details.phone}</span>
            </div>
          )}
          {order.delivery_details.address && (
            <div className="parent-detail-section-row">
              <span className="parent-detail-label">Address</span>
              <span className="parent-detail-val">
                {[
                  order.delivery_details.address,
                  order.delivery_details.city,
                  order.delivery_details.state,
                  order.delivery_details.pincode,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
