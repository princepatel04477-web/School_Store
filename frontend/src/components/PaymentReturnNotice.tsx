import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type Order } from '../api';
import { useAuth } from '../auth';
import { useLang } from '../i18n';

export function PaymentReturnNotice({ onOpen }: { onOpen?: () => void }) {
  const { user } = useAuth();
  const { t } = useLang();
  const { data } = useQuery({
    queryKey: ['payment-attention', user?.id],
    queryFn: () => api<{ results: Order[] }>('/orders/?payment_attention=1&page_size=1'),
    enabled: user?.role === 'PARENT',
  });
  const order = data?.results[0];
  if (!order || user?.role !== 'PARENT') return null;
  return <aside className="checkout-notice-banner payment-return-notice">
    {t('recovery.attention', { n: order.order_number })}{' '}
    <Link to={`/parent/orders#order-${order.id}`} onClick={onOpen}>{t('recovery.view')}</Link>
  </aside>;
}
