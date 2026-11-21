import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type PanelOrder, type PaymentReconcileResponse } from '../api';

type Queue = {
  count: number;
  results: PanelOrder[];
  unmatched_events: { event_id: string; event_type: string; state: string; tries: number }[];
};

export function PaymentsToCheck({ school, open, onToggle }: { school?: string; open: boolean; onToggle: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(false);
  const queue = useQuery({
    queryKey: ['payments-to-check', school],
    queryFn: () => api<Queue>(`/panel/payments/needs-reconciliation/${school ? `?school=${encodeURIComponent(school)}` : ''}`),
  });

  async function check(id: string) {
    setBusy(true);
    setError('');
    try {
      const result = await api<PaymentReconcileResponse>(`/panel/orders/${id}/reconcile-payment/`, { method: 'POST' });
      if (!result.checked) setError('No fresh provider result. Try again shortly.');
      setCooldown(true);
      window.setTimeout(() => setCooldown(false), result.retry_after_seconds * 1000);
      await queue.refetch();
    } catch {
      setError('Could not check with Razorpay.');
    } finally {
      setBusy(false);
    }
  }

  return <section>
    <button type="button" className="btn btn-outline" aria-pressed={open} onClick={onToggle}>
      Payments to check{queue.data ? ` (${queue.data.count})` : ''}
    </button>
    {open && <div className="card">
      {queue.isPending && <div className="checkout-skeleton payment-orders-skeleton" aria-busy="true" />}
      {queue.isError && <p role="alert">Could not load payments to check.</p>}
      {error && <p role="status">{error}</p>}
      {queue.data?.count === 0 && <p>No payments need checking.</p>}
      {queue.data?.results.map(order => <article className="checkout-status-card" key={order.id}>
        <strong>{order.order_number}</strong>
        <p>{order.student_name} | INR {order.amount} | {order.payment_view.state}</p>
        <p>{order.reconciliation_reasons.map(reason => reason.toLowerCase().replace(/_/g, ' ')).join(', ')}</p>
        {order.payment_view.last_checked_at && <p>Last checked {new Date(order.payment_view.last_checked_at).toLocaleString('en-IN')}</p>}
        <button type="button" className="btn btn-outline" disabled={busy || cooldown} onClick={() => void check(order.id)}>Check with Razorpay</button>
      </article>)}
      {queue.data?.unmatched_events.map(event => <p key={event.event_id}>
        Unmatched event {event.event_id.slice(0, 6)}...{event.event_id.slice(-4)} | {event.event_type} | {event.tries} tries
      </p>)}
    </div>}
  </section>;
}
