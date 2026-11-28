import { ApiError, orderApi, type PaymentView } from '../api';
import { loadRazorpay, openRazorpayCheckout } from './paymentAdapter';

let checkoutActive = false;

export function paymentRefusal(error: unknown): PaymentView | undefined {
  if (error instanceof ApiError) return error.data.payment_view as PaymentView | undefined;
}

export function checkingPayment(view: PaymentView, unavailable = true): PaymentView {
  return { ...view, state: 'CHECKING', last_check_ok: unavailable ? false : view.last_check_ok, can_pay_now: false,
    can_switch_to_cod: false, can_refresh: true };
}

export async function runOrderPayment(orderId: string, onStatus: (view: PaymentView) => void) {
  if (checkoutActive) return;
  checkoutActive = true;
  try {
    const info = await orderApi.payment(orderId);
    if (!await loadRazorpay()) throw new Error('Checkout unavailable');
    const timeout = Math.floor((Date.parse(info.hold_expires_at) - Date.now()) / 1000) - 60;
    if (!(timeout > 0)) throw new Error('Checkout expired');
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = async (verify?: () => ReturnType<typeof orderApi.verifyPayment>) => {
        if (finished) return;
        finished = true;
        try {
          if (verify) {
            const result = await verify().catch(() => null);
            if (result?.payment_view?.receipt) {
              onStatus(result.payment_view);
              resolve();
              return;
            }
          }
          const result = await orderApi.reconcilePayment(orderId);
          const view = result.payment_view;
          onStatus(view.state === 'NOT_PAID' && (verify || !result.checked)
            ? checkingPayment(view, false) : view);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      openRazorpayCheckout({
        key: info.key_id, order_id: info.razorpay_order_id,
        amount: info.amount_paise, currency: info.currency, name: 'School Store',
        description: info.store_order_number, prefill: info.prefill, timeout,
        retry: { enabled: false },
        modal: { ondismiss: () => { void finish(); } },
        handler: response => { void finish(() => orderApi.verifyPayment(orderId, response)); },
      });
    });
  } finally {
    checkoutActive = false;
  }
}
