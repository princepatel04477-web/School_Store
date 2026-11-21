import type { PaymentView } from '../api';
import { api, ApiError } from '../api';
import type { MessageKey } from '../i18n';
import type { fitPayload } from '../data/fit';
import { readSaved, writeSaved, removeSaved } from '../store/persist';

/**
 * Sends a checkout to the server so that a bad signal can never lose or double an order.
 *
 * - For a signed-in parent the order is written to the phone before the first try, with a key that the
 *   server stores uniquely: sending it again returns the same order, never a second one.
 * - If the phone is offline or the server can't be reached, it keeps trying.
 * - If the page is closed mid-way, the saved order is sent again on the next visit.
 */

export interface OrderPayload {
  idempotency_key: string;
  student: string;
  fulfillment_type: 'HOME_DELIVERY' | 'SCHOOL_PICKUP';
  payment_method: 'COD' | 'ONLINE';
  expected_total_paise?: number;
  delivery_details: Record<string, string>;
  /** A shirt or trouser line carries the child's measurement it was sized from. */
  items: { variant: string; quantity: number; fit?: ReturnType<typeof fitPayload> }[];
}

export interface PlacedOrder {
  id: string;
  order_number: string;
  total: string;
  student_name?: string;
  fulfillment_type: string;
  payment_view: PaymentView;
  payment_method?: 'COD' | 'ONLINE';
  payment_status?: string;
  status?: string;
}

const PENDING_KEY = 'schoolstore_pending_order';
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** A saved attempt, plus the store order the server made from it (online orders only). */
type PendingOrder = OrderPayload & { order_id?: string };

/**
 * Same child, items and delivery as a saved attempt means it is the same order. The payment
 * choice and the expected total do not count: a parent who comes back after paying in the
 * UPI app and picks cash this time still has one order, not two.
 */
function sameOrder(a: Omit<OrderPayload, 'idempotency_key'>, b: Omit<OrderPayload, 'idempotency_key'>): boolean {
  const pick = (order: Omit<OrderPayload, 'idempotency_key'>) =>
    JSON.stringify([order.student, order.fulfillment_type, order.delivery_details, order.items]);
  return pick(a) === pick(b);
}

export function loadPendingOrder(): PendingOrder | null {
  try {
    const raw = readSaved(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingOrder) : null;
  } catch {
    return null;
  }
}

// Kept only for a signed-in parent; the order still goes out without a saved copy.
function savePendingOrder(payload: PendingOrder) {
  writeSaved(PENDING_KEY, JSON.stringify(payload));
}

export function clearPendingOrder() {
  removeSaved(PENDING_KEY);
}

/** Reuses the key of a saved attempt for the same order, so retrying can't double it. */
export function prepareOrder(order: Omit<OrderPayload, 'idempotency_key'>): OrderPayload {
  const pending = loadPendingOrder();
  if (pending && sameOrder(pending, order)) {
    const { order_id: _orderId, ...saved } = pending;
    // The choice made this time goes out; the server answers with the order it already has.
    const payload = { ...order, idempotency_key: saved.idempotency_key };
    savePendingOrder({ ...payload, ...(pending.order_id ? { order_id: pending.order_id } : {}) });
    return payload;
  }
  const payload = { ...order, idempotency_key: newKey() };
  savePendingOrder(payload);
  return payload;
}

/**
 * Called whenever the server reports an order's payment. Once the saved online order is paid,
 * released or moved to cash, the saved copy goes, so the next checkout starts a new order.
 * Returns true when the bag was bought (paid, or cash on delivery) and can be emptied.
 */
export function settlePendingOrder(orderId: string, view: PaymentView): boolean {
  const pending = loadPendingOrder();
  if (!pending?.order_id || pending.order_id !== orderId) return false;
  if (view.state === 'CHECKING' || view.state === 'NOT_PAID') return false;
  clearPendingOrder();
  return view.state !== 'RELEASED';
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function waitUntilOnline(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }));
}

/** Outages are worth retrying; a refusal (bad item, out of stock, not signed in) is not. */
function isTemporary(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500 || error.status === 429 || error.status === 408;
  return true; // fetch itself failed: no connection
}

export async function submitOrder(
  payload: OrderPayload,
  onRetry?: (attempt: number) => void,
): Promise<PlacedOrder> {
  for (let attempt = 0; ; attempt++) {
    await waitUntilOnline();
    try {
      const { order_id: _orderId, ...body } = payload as PendingOrder;
      const order = await api<PlacedOrder>('/orders/', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Idempotency-Key': payload.idempotency_key },
      });
      // An online order keeps its saved copy until its payment is settled: if the page reloads
      // while the parent pays in the UPI app, the same bag must find this order again.
      if (order.payment_method === 'ONLINE' && order.status !== 'CANCELLED') {
        savePendingOrder({ ...body, idempotency_key: payload.idempotency_key, order_id: order.id });
      } else {
        clearPendingOrder();
      }
      return order;
    } catch (error) {
      if (!isTemporary(error) || attempt >= RETRY_DELAYS_MS.length) {
        if (!isTemporary(error)) clearPendingOrder();
        throw error;
      }
      onRetry?.(attempt + 1);
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Turns a server refusal into words a parent can act on (a message key, see i18n/messages). */
export function orderErrorMessage(error: unknown): MessageKey {
  if (!(error instanceof ApiError)) return 'err.offline';
  if (error.status === 401) return 'err.signInAgain';
  if (isTemporary(error)) return 'err.storeDown';
  const text = JSON.stringify(error.data).toLowerCase();
  if (text.includes('insufficient stock') || text.includes('no stock')) return 'err.soldOut';
  if (text.includes('home delivery')) return 'err.noHomeDelivery';
  if (text.includes('school pickup')) return 'err.noPickup';
  if (['not available', 'does not match', 'not assigned', 'under review'].some((phrase) => text.includes(phrase))) {
    return 'err.notOnList';
  }
  if (text.includes('own children')) return 'err.notYourChild';
  return 'err.generic';
}
