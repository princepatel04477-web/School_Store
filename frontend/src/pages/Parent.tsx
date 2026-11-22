import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from '../App';
import { Timeline } from '../components/Store';
import { api, orderApi, type Order, type Page, type PaymentView } from '../api';
import { checkingPayment, paymentRefusal, runOrderPayment } from '../services/orderPayment';
import { settlePendingOrder } from '../services/placeOrder';
import { storeState } from '../store/storeState';
import { formatINR } from '../utils/formatINR';
import { PaymentStatus } from '../components/PaymentStatus';
import { PaymentReturnNotice } from '../components/PaymentReturnNotice';
import { useLang } from '../i18n';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ParentLanding } from '../components/parent/ParentLanding';
import { ParentOrderDetail } from './ParentOrderDetail';

export default function Parent() {
  return (
    <Shell title="A little easier today.">
      <Routes>
        <Route index element={<><PaymentReturnNotice /><ParentLanding /></>} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:orderId" element={<ParentOrderDetail />} />
      </Routes>
    </Shell>
  );
}

function Orders() {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } = useInfiniteQuery({
    queryKey: ['orders'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page<Order>>(pageParam
      ? '/orders/?' + new URLSearchParams({ cursor: pageParam }) : '/orders/'),
    getNextPageParam: (page) => page.next
      ? new URL(page.next, window.location.origin).searchParams.get('cursor') ?? undefined : undefined,
  });
  const results = useMemo(() => data?.pages.flatMap((page) => page.results) ?? [], [data]);
  const { hash } = useLocation();
  const focusedId = hash.startsWith('#order-') ? hash.slice(7) : '';
  const focused = useQuery({
    queryKey: ['orders', focusedId],
    queryFn: () => api<Order>(`/orders/${encodeURIComponent(focusedId)}/`),
    enabled: Boolean(focusedId && data && !results.some(order => order.id === focusedId)),
  });
  const orders = useMemo(() => focused.data
    ? [focused.data, ...results.filter(order => order.id !== focused.data?.id)]
    : results, [results, focused.data]);
  useEffect(() => {
    if (focusedId) document.getElementById(`order-${focusedId}`)?.scrollIntoView();
  }, [orders, focusedId]);
  const [views, setViews] = useState<Record<string, PaymentView>>({});
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const autoChecked = useRef(new Set<string>());
  const visiblePayment = (order: Order) => {
    const latest = order.payment_view;
    const previous = views[order.id];
    if (!previous || (latest.state !== 'CHECKING' && latest.state !== 'NOT_PAID')) return latest;
    if (latest.last_checked_at && previous.last_checked_at &&
        Date.parse(latest.last_checked_at) > Date.parse(previous.last_checked_at)) return latest;
    return previous;
  };
  const update = (id: string, view: PaymentView) => setViews(previous => ({ ...previous, [id]: view }));
  // A saved online order that is now paid, released or moved to cash no longer holds the bag.
  useEffect(() => {
    for (const order of orders) {
      if (settlePendingOrder(order.id, visiblePayment(order))) storeState.clearCart();
    }
  });

  async function refresh(order: Order) {
    try {
      const result = await orderApi.reconcilePayment(order.id);
      update(order.id, result.payment_view);
      const settled = result.payment_view.state;
      if (settled !== order.payment_view.state && settled !== 'CHECKING' && settled !== 'NOT_PAID') {
        // A capture or release also moves the order's status and timeline: fetch them again.
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        void queryClient.invalidateQueries({ queryKey: ['payment-attention'] });
      }
      const until = Date.now() + result.retry_after_seconds * 1000;
      setCooldowns(previous => ({ ...previous, [order.id]: until }));
      window.setTimeout(() => setCooldowns(previous => previous[order.id] === until
        ? { ...previous, [order.id]: 0 } : previous), result.retry_after_seconds * 1000);
    } catch (error) {
      update(order.id, paymentRefusal(error) ?? checkingPayment(order.payment_view));
    }
  }

  useEffect(() => {
    if (busy) return;
    const pending = orders.filter(order =>
      order.payment_view.state === 'CHECKING' && !autoChecked.current.has(order.id));
    if (!pending.length || active.current) return;
    active.current = true;
    setBusy(true);
    for (const order of pending) autoChecked.current.add(order.id);
    void (async () => {
      try {
        // Render the original server state before checking its provider status.
        for (const order of pending) await refresh(order);
      } finally {
        active.current = false;
        setBusy(false);
      }
    })();
  }, [orders, busy]);

  async function act(order: Order, action: 'pay' | 'cod' | 'refresh') {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    try {
      if (action === 'refresh') await refresh(order);
      if (action === 'pay') await runOrderPayment(order.id, view => update(order.id, view));
      if (action === 'cod') update(order.id, (await orderApi.switchToCod(order.id)).payment_view);
    } catch (error) {
      update(order.id, paymentRefusal(error) ?? checkingPayment(visiblePayment(order)));
    } finally {
      if (action !== 'refresh') {
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        void queryClient.invalidateQueries({ queryKey: ['payment-attention'] });
      }
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-row">
        <div>
          <span className="eyebrow">YOUR PURCHASES</span>
          <h2>{t('tracking.orders')}</h2>
        </div>
        <Link className="text-button" to="/parent">
          Shop again
        </Link>
      </div>

      {isPending ? (
        <div className="checkout-skeleton payment-orders-skeleton" aria-busy="true" />
      ) : isError ? (
        <p role="alert">{t('recovery.ordersError')} <button onClick={() => void refetch()}>{t('tracking.retry')}</button></p>
      ) : orders.length ? (
        orders.map((o) => (
          <article className="order-card" key={o.id} id={`order-${o.id}`}>
            <div className="section-row">
              <div>
                <b>{o.order_number}</b>
                <small>
                  {new Date(o.created_at).toLocaleDateString('en-IN')}
                </small>
              </div>
            </div>
            <p>
              {o.student_name} · <strong>{formatINR(Math.round(Number(o.total) * 100))}</strong>
            </p>
            <PaymentStatus payment={visiblePayment(o)} orderNumber={o.order_number}
              disabled={busy || Boolean(cooldowns[o.id])}
              onRefresh={() => void act(o, 'refresh')} onPay={() => void act(o, 'pay')}
              onCod={() => void act(o, 'cod')} />

            <Timeline order={o} />
            <Link className="text-button" to={'/parent/orders/' + o.id}>{t('tracking.details')}</Link>
          </article>
        ))
      ) : (
        <div className="empty">
          <span>⌁</span>
          <h3>No orders yet</h3>
          <p>Your orders and live delivery timeline will appear here.</p>
          <Link className="primary" to="/parent">
            Browse catalogue
          </Link>
        </div>
      )}
      {hasNextPage && (
        <button disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{t('tracking.loadMore')}</button>
      )}
    </>
  );
}
