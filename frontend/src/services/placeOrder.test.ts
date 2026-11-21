// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import contract from '../test/fixtures/payment-contract.json';
import type { PaymentView } from '../api';
import { loadPendingOrder, prepareOrder, settlePendingOrder, submitOrder } from './placeOrder';

type State = PaymentView['state'];
const states = (contract as unknown as { states: Record<State, { detail: { payment_view: PaymentView } }> }).states;
const views = Object.fromEntries(
  Object.entries(states).map(([state, shapes]) => [state, shapes.detail.payment_view]),
) as Record<State, PaymentView>;

const base = {
  student: 'child-1',
  fulfillment_type: 'HOME_DELIVERY' as const,
  payment_method: 'ONLINE' as const,
  expected_total_paise: 80000,
  delivery_details: { recipient_name: 'Parent', phone: '9999990001' },
  items: [{ variant: 'variant-1', quantity: 1 }],
};

function serverReturns(order: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(order), { status: 201, headers: { 'Content-Type': 'application/json' } }),
  );
}

describe('retry safety when the same bag is checked out again', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('access', 'token');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps the key of a placed online order so checking out the same bag again returns that order', async () => {
    const first = prepareOrder(base);
    const fetchMock = serverReturns({ id: 'order-1', order_number: 'ORD-1', payment_method: 'ONLINE', payment_view: views.CHECKING });
    await submitOrder(first);

    // The parent leaves the payment screen for the bag, which still holds the same items
    // (or re-adds them after a reload), and checks out again.
    const again = prepareOrder(base);
    expect(again.idempotency_key).toBe(first.idempotency_key);
    // Choosing cash on the second go is still the same order, not a second one.
    expect(prepareOrder({ ...base, payment_method: 'COD' }).idempotency_key).toBe(first.idempotency_key);
    // The saved order id is never sent to the server.
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty('order_id');
  });

  it('forgets a placed COD order once the server has it', async () => {
    prepareOrder({ ...base, payment_method: 'COD' });
    serverReturns({ id: 'order-2', order_number: 'ORD-2', payment_method: 'COD', payment_view: views.COD_DUE });
    await submitOrder(loadPendingOrder()!);
    expect(loadPendingOrder()).toBeNull();
  });

  it('forgets the saved order once its payment is settled, and says when the bag is done', async () => {
    const first = prepareOrder(base);
    serverReturns({ id: 'order-1', order_number: 'ORD-1', payment_method: 'ONLINE', payment_view: views.CHECKING });
    await submitOrder(first);

    expect(settlePendingOrder('another-order', views.PAID)).toBe(false);
    expect(settlePendingOrder('order-1', views.CHECKING)).toBe(false);
    expect(loadPendingOrder()).not.toBeNull();
    expect(settlePendingOrder('order-1', views.PAID)).toBe(true);
    expect(loadPendingOrder()).toBeNull();
  });

  it('a released order lets the same bag start a new order, and keeps the bag', async () => {
    const first = prepareOrder(base);
    serverReturns({ id: 'order-1', order_number: 'ORD-1', payment_method: 'ONLINE', payment_view: views.CHECKING });
    await submitOrder(first);

    expect(settlePendingOrder('order-1', views.RELEASED)).toBe(false);
    expect(loadPendingOrder()).toBeNull();
    expect(prepareOrder(base).idempotency_key).not.toBe(first.idempotency_key);
  });
});
