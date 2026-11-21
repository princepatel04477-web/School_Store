/**
 * Fulfilment and Payment label helpers with i18n support.
 * Covers every Order.Status value (including legacy PENDING, SHIPPED, REFUNDED)
 * and payment state (COD + PENDING = "Pay on delivery").
 * Falls back to raw status rather than crashing if an unknown value is encountered.
 */

export type TranslateFn = (key: any, vars?: Record<string, any>) => string;

export function fulfilmentLabel(
  status: string | undefined | null,
  t: TranslateFn
): string {
  if (!status) return '';
  const s = String(status).trim().toUpperCase();

  switch (s) {
    case 'PLACED':
      return t('orders.status.placed');
    case 'PENDING':
      return t('orders.status.pending');
    case 'CONFIRMED':
      return t('orders.status.confirmed');
    case 'PROCESSING':
      return t('orders.status.processing');
    case 'PACKED':
      return t('orders.status.packed');
    case 'DISPATCHED':
      return t('orders.status.dispatched');
    case 'SHIPPED':
      return t('orders.status.shipped');
    case 'DELIVERED':
      return t('orders.status.delivered');
    case 'CANCELLED':
      return t('orders.status.cancelled');
    case 'RETURNED':
      return t('orders.status.returned');
    case 'REFUNDED':
      return t('orders.status.refunded');
    default:
      return status;
  }
}

export function paymentLabel(
  paymentStatus: string | undefined | null,
  paymentMethod: string | undefined | null,
  t: TranslateFn
): string {
  const pStatus = paymentStatus ? String(paymentStatus).trim().toUpperCase() : '';
  const pMethod = paymentMethod ? String(paymentMethod).trim().toUpperCase() : '';

  // COD + PENDING (or unverified/authorized) = "Pay on delivery"
  if (pMethod === 'COD' && (pStatus === 'PENDING' || !pStatus || pStatus === 'AUTHORIZED')) {
    return t('orders.payment.cod');
  }

  switch (pStatus) {
    case 'PAID':
      return t('orders.payment.paid');
    case 'FAILED':
      return t('orders.payment.failed');
    case 'REFUNDED':
      return t('orders.payment.refunded');
    case 'AUTHORIZED':
    case 'PENDING':
      return t('orders.payment.pending');
    default:
      if (pMethod === 'COD') return t('orders.payment.cod');
      return paymentStatus || t('orders.payment.pending');
  }
}
