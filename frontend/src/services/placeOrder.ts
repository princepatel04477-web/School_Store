import { api, ApiError } from '../api';
import type { MessageKey } from '../i18n';

/**
 * Sends a checkout to the server so that a bad signal can never lose or double an order.
 *
 * - The order is written to the phone before the first try, with a key that the
 *   server stores uniquely: sending it again returns the same order, never a second one.
 * - If the phone is offline or the server can't be reached, it keeps trying.
 * - If the page is closed mid-way, the saved order is sent again on the next visit.
 */

export interface OrderPayload {
  idempotency_key: string;
  student: string;
  fulfillment_type: 'HOME_DELIVERY' | 'SCHOOL_PICKUP';
  payment_method: 'COD';
  delivery_details: Record<string, string>;
  items: { variant: string; quantity: number }[];
  /** The child's height and weight from the size check, kept on the order lines. */
  fit?: { height_cm: number; weight_kg: number };
}

export interface PlacedOrder {
  id: string;
  order_number: string;
  total: string;
  student_name?: string;
  fulfillment_type: string;
}

const PENDING_KEY = 'schoolstore_pending_order';
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Same child, items and delivery as a saved attempt means it is the same order. */
function sameOrder(a: Omit<OrderPayload, 'idempotency_key'>, b: Omit<OrderPayload, 'idempotency_key'>): boolean {
  const { idempotency_key: _a, ...left } = a as OrderPayload;
  const { idempotency_key: _b, ...right } = b as OrderPayload;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function loadPendingOrder(): OrderPayload | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as OrderPayload) : null;
  } catch {
    return null;
  }
}

function savePendingOrder(payload: OrderPayload) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  } catch {
    // Private mode or full storage: the order still goes out, just without a saved copy.
  }
}

export function clearPendingOrder() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // nothing saved
  }
}

/** Reuses the key of a saved attempt for the same order, so retrying can't double it. */
export function prepareOrder(order: Omit<OrderPayload, 'idempotency_key'>): OrderPayload {
  const pending = loadPendingOrder();
  const payload = pending && sameOrder(pending, order) ? pending : { ...order, idempotency_key: newKey() };
  savePendingOrder(payload);
  return payload;
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
      const order = await api<PlacedOrder>('/orders/', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Idempotency-Key': payload.idempotency_key },
      });
      clearPendingOrder();
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
