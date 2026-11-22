import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, type Order } from '../api';
import { Timeline } from '../components/Store';
import { useLang } from '../i18n';
import { openExternalUrl } from '../native/externalLinks';
import { formatINR } from '../utils/formatINR';
import './native/nativePages.css';

export function ParentOrderDetail() {
  const { orderId } = useParams();
  const { user } = useAuth();
  const { lang, t } = useLang();
  const [copyState, setCopyState] = useState<'copied' | 'copyFailed' | null>(null);
  const query = useQuery({
    queryKey: ['native-orders', user?.id, orderId],
    queryFn: () => api<Order>('/orders/' + orderId + '/'),
    enabled: Boolean(user && orderId),
  });
  const order = query.data;
  const number = order?.tracking?.article_number;

  async function copyNumber() {
    if (!number) return;
    try {
      await navigator.clipboard.writeText(number);
      setCopyState('copied');
    } catch {
      setCopyState('copyFailed');
    }
  }

  if (!user) return <Link to="/orders">{t('tracking.orders')}</Link>;

  return (
    <section className="native-page-container native-order-card">
      <Link to="/orders">{t('tracking.orders')}</Link>
      {query.isPending && <p role="status">{t('tracking.loading')}</p>}
      {query.isError && <p role="alert">{t('tracking.error')} <button onClick={() => void query.refetch()}>{t('tracking.retry')}</button></p>}
      {order && (
        <>
          <h2>{order.order_number}</h2>
          <p>{order.student_name} · {formatINR(Math.round(Number(order.total) * 100))}</p>
          <ul>
            {order.items?.map((item) => (
              <li key={item.id}>{item.quantity} × {item.product_name}{item.variant_size ? ' · ' + item.variant_size : ''}</li>
            ))}
          </ul>
          <Timeline order={order} />
          {order.fulfillment_type === 'SCHOOL_PICKUP' ? <p>{t('tracking.pickup')}</p> : number && (
            <section>
              <h3>{t('tracking.article')}</h3>
              <p><strong>{number}</strong></p>
              {order.tracking && (
                <p>{t('tracking.booked', { date: new Date(order.tracking.booked_at).toLocaleDateString(lang + '-IN') })}</p>
              )}
              <button type="button" onClick={() => void copyNumber()}>{t('tracking.copy')}</button>
              {copyState && <p role="status">{t(copyState === 'copied' ? 'tracking.copied' : 'tracking.copyFailed')}</p>}
              <p><button type="button" onClick={() => void openExternalUrl('https://www.indiapost.gov.in/')}>{t('tracking.post')}</button></p>
            </section>
          )}
        </>
      )}
    </section>
  );
}
