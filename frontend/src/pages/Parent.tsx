import { Link, Route, Routes } from 'react-router-dom';
import { Timeline } from '../components/Store';
import { api, type Order } from '../api';
import { useQuery } from '@tanstack/react-query';
import { ParentLanding } from '../components/parent/ParentLanding';

export default function Parent() {
  return (
    <Routes>
      <Route index element={<ParentLanding />} />
      <Route path="orders/*" element={<Orders />} />
    </Routes>
  );
}

function Orders() {
  const { data } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api<any>('/orders/').catch(() => []),
  });
  const orders: Order[] = (data?.results || data || []) as Order[];

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--space-4)' }}>
      <div className="section-row">
        <div>
          <span className="eyebrow">YOUR PURCHASES</span>
          <h2>My orders</h2>
        </div>
        <Link className="text-button" to="/parent">
          Shop again
        </Link>
      </div>

      {orders.length ? (
        orders.map((o) => (
          <article className="order-card" key={o.id}>
            <div className="section-row">
              <div>
                <b>{o.order_number}</b>
                <small>
                  {new Date(o.created_at).toLocaleDateString('en-IN')}
                </small>
              </div>
              <span className="status">{o.status}</span>
            </div>
            <p>
              {o.student_name} · <strong>₹{o.total}</strong>
            </p>
            <Timeline order={o} />
          </article>
        ))
      ) : (
        <div className="empty">
          <span></span>
          <h3>No orders yet</h3>
          <p>Your orders and live delivery timeline will appear here.</p>
          <Link className="primary" to="/parent">
            Browse catalogue
          </Link>
        </div>
      )}
    </div>
  );
}
