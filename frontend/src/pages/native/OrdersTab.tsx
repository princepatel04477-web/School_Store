import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Order } from '../../api';
import { useAuth } from '../../auth';
import { Truck } from '../../components/ui/icons';
import { Timeline } from '../../components/Store';
import { FitFeedbackPrompt } from '../../components/orders/FitFeedbackPrompt';
import { ParentSignInSheet } from '../../components/parent/ParentSignInSheet';
import { PullToRefresh } from '../../components/native/PullToRefresh';
import { shareOrderDetails } from '../../native/share';
import './nativePages.css';

export function OrdersTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showSignIn, setShowSignIn] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['native-orders', user?.id],
    queryFn: () => api<any>('/orders/').catch(() => []),
    enabled: Boolean(user),
  });

  const orders: Order[] = (data?.results || data || []) as Order[];

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

  return (
    <PullToRefresh onRefresh={() => queryClient.invalidateQueries({ queryKey: ['native-orders'] })}>
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
          >
            Shop More
          </button>
        </div>

        {isLoading ? (
          <div className="native-loading">Loading your orders…</div>
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
                      {o.status}
                    </span>
                    <button
                      type="button"
                      className="native-share-btn"
                      onClick={() =>
                        shareOrderDetails(
                          o.order_number,
                          o.total,
                          `https://school-store.aqualite.workers.dev/parent/orders`
                        )
                      }
                      aria-label="Share order details"
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
            <Link to="/" className="native-primary-btn">
              Browse Catalogue
            </Link>
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
