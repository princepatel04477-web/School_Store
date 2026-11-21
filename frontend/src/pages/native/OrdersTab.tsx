import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Order, type Page } from '../../api';
import { useAuth } from '../../auth';
import { Truck } from '../../components/ui/icons';
import { Timeline, getOrderStatusLabel } from '../../components/Store';
import { FitFeedbackPrompt } from '../../components/orders/FitFeedbackPrompt';
import { ParentSignInSheet } from '../../components/parent/ParentSignInSheet';
import { PullToRefresh } from '../../components/native/PullToRefresh';
import { OrderCardsSkeleton } from '../../components/ui/Skeleton';
import { shareOrderDetails } from '../../native/share';
import { useLang } from '../../i18n';
import './nativePages.css';

export function OrdersTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useLang();
  const [showSignIn, setShowSignIn] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['native-orders', user?.id],
    queryFn: () => api<Page<Order>>('/orders/'),
    enabled: Boolean(user),
  });

  const orders: Order[] = data?.results || (Array.isArray(data) ? (data as Order[]) : []);

  if (!user) {
    return (
      <div className="native-page-container">
        <div className="native-empty-state">
          <div className="native-empty-icon">
            <Truck width={40} height={40} strokeWidth={1.5} />
          </div>
          <h2>Track your orders</h2>
          <p>Sign in with your phone number to view live order status, tracking, and fit assistance.</p>
          <button
            type="button"
            className="native-primary-btn"
            onClick={() => setShowSignIn(true)}
          >
            Sign in with phone
          </button>
        </div>
        <ParentSignInSheet
          open={showSignIn}
          onClose={() => setShowSignIn(false)}
          onDone={() => setShowSignIn(false)}
        />
      </div>
    );
  }

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://school-store.aqualite.workers.dev';

  return (
    <PullToRefresh onRefresh={() => refetch()}>
      <div className="native-page-container">
        <div className="native-section-header">
          <div>
            <span className="native-eyebrow">PURCHASES</span>
            <h1>My Orders</h1>
          </div>
          <button
            type="button"
            className="native-secondary-btn"
            onClick={() => navigate('/')}
            style={{ minHeight: '44px' }}
          >
            Shop More
          </button>
        </div>

        {isLoading ? (
          <OrderCardsSkeleton count={3} />
        ) : isError ? (
          <div
            className="native-error-state"
            role="alert"
            style={{
              textAlign: 'center',
              padding: '32px 16px',
              background: 'var(--paper-raised)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-lg, 6px)',
              margin: '16px 0',
            }}
          >
            <p style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '15px', marginBottom: '8px' }}>
              {t('orders.loadError')}
            </p>
            <p style={{ color: 'var(--ink-soft)', fontSize: '13px', marginBottom: '16px' }}>
              {t('common.checkInternet')}
            </p>
            <button
              type="button"
              className="native-primary-btn"
              onClick={() => refetch()}
              style={{ minHeight: '44px', maxWidth: '200px', margin: '0 auto' }}
            >
              {t('orders.retry')}
            </button>
          </div>
        ) : orders.length > 0 ? (
          <div className="native-orders-list">
            {orders.map((o) => (
              <article className="native-order-card" key={o.id}>
                <div className="native-card-header">
                  <div>
                    <div className="native-order-num">{o.order_number}</div>
                    <small className="native-order-date">
                      {new Date(o.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </small>
                  </div>
                  <div className="native-header-actions">
                    <span className={`native-status-badge status-${(o.status || '').toLowerCase()}`}>
                      {getOrderStatusLabel(o, t)}
                    </span>
                    <button
                      type="button"
                      className="native-share-btn"
                      onClick={() =>
                        shareOrderDetails(
                          o.order_number,
                          o.total,
                          `${origin}/parent/orders`
                        )
                      }
                      aria-label="Share order details"
                      style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}
                    >
                      Share
                    </button>
                  </div>
                </div>
                <div className="native-order-details">
                  <span>{o.student_name || 'Student'}</span>
                  <strong>₹{o.total}</strong>
                </div>
                <div className="native-timeline-wrapper">
                  <Timeline order={o} />
                </div>
                <FitFeedbackPrompt
                  orderId={o.id}
                  orderStatus={o.status}
                  orderCreatedAt={o.created_at}
                  onFeedbackSubmitted={() =>
                    queryClient.invalidateQueries({ queryKey: ['native-orders'] })
                  }
                />
              </article>
            ))}
          </div>
        ) : (
          <div className="native-empty-state">
            <div className="native-empty-icon">
              <Truck width={40} height={40} strokeWidth={1.5} />
            </div>
            <h3>No orders placed yet</h3>
            <p>When you purchase uniforms or school kits, track delivery and exchange requests here.</p>
            <Link to="/" className="native-primary-btn" style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              Browse Catalogue
            </Link>
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
