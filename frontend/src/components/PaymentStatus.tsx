import { Link } from 'react-router-dom';
import type { PaymentView } from '../api';
import { useLang } from '../i18n';
import { formatINR } from '../utils/formatINR';

type Props = {
  payment: PaymentView;
  orderNumber: string;
  disabled?: boolean;
  onRefresh?: () => void;
  onPay?: () => void;
  onCod?: () => void;
};

export function PaymentStatus({ payment, orderNumber, disabled, onRefresh, onPay, onCod }: Props) {
  const { t } = useLang();
  const due = formatINR(payment.amount_due_paise);
  const paid = formatINR(payment.amount_paid_paise);
  const time = (value: string) => new Date(value).toLocaleString('en-IN');
  const receipt = payment.receipt;
  switch (payment.state) {
    case 'CHECKING':
      return <section className="checkout-status-card" aria-live="polite">
        <h3>{t('recovery.checking')}</h3>
        <p>{t('recovery.checkingBody', { amount: due, n: orderNumber })}</p>
        {payment.in_progress && <p>{t('recovery.progress')}</p>}
        {payment.last_check_ok === false && <p>{t('recovery.outage')}</p>}
        {payment.last_checked_at && <p>{t('recovery.checked', { time: time(payment.last_checked_at) })}</p>}
        {onRefresh && payment.can_refresh && <button type="button" className="btn btn-outline" disabled={disabled} onClick={onRefresh}>{t('recovery.refresh')}</button>}
      </section>;
    case 'NOT_PAID':
      return <section className="checkout-status-card">
        <p>{payment.hold_expires_at
          ? t('recovery.unpaid', { n: orderNumber, amount: due, time: time(payment.hold_expires_at) })
          : t('recovery.unavailable')}</p>
        {payment.last_failure_reason && <p>{t('recovery.failure', { reason: payment.last_failure_reason })}</p>}
        <div className="checkout-action-row">
          {onPay && payment.can_pay_now && <button type="button" className="btn btn-primary" disabled={disabled} onClick={onPay}>{t('recovery.pay', { amount: due })}</button>}
          {onCod && payment.can_switch_to_cod && <button type="button" className="btn btn-outline" disabled={disabled} onClick={onCod}>{t('recovery.codInstead')}</button>}
        </div>
      </section>;
    case 'PAID': {
      const method = receipt?.method === 'upi' ? 'UPI' : receipt?.method === 'card' ? t('recovery.methodCard') :
        receipt?.method === 'netbanking' ? t('recovery.methodBank') : t('recovery.methodUnknown');
      return <section className="checkout-status-card">
        <h3>{t('recovery.received')}</h3>
        {receipt && <p>{t('recovery.receipt', { n: receipt.order_number, amount: formatINR(receipt.amount_paise),
          time: time(receipt.paid_at), method, ref: receipt.payment_ref_last4 })}</p>}
      </section>;
    }
    case 'RELEASED':
      return <section className="checkout-status-card">
        <p>{t('co.orderReleased')}</p>
        <Link to="/parent" className="btn btn-outline">{t('co.placeOrderAgain')}</Link>
      </section>;
    case 'REFUND_DUE':
      return <p>{t('recovery.refund', { amount: paid })}</p>;
    case 'PAID_DO_NOT_COLLECT':
      return <p>{t('recovery.noCash', { amount: paid })}</p>;
    case 'COD_DUE':
      return payment.amount_due_paise > 0 ? <p>{t('recovery.codDue', { amount: due })}</p> : null;
  }
}
