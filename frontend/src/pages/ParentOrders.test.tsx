// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderApi, type Order, type PaymentReconcileResponse } from '../api';
import { Timeline } from '../components/Store';
import { setLang } from '../i18n';
import contract from '../test/fixtures/payment-contract.json';
import Parent from './Parent';

vi.mock('../App', () => ({ Shell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'parent-1', role: 'PARENT' } }) }));

afterEach(() => {
  cleanup();
  setLang('en');
  vi.restoreAllMocks();
});

it.each([
  { status: 'SHIPPED', lang: 'gu', label: 'મોકલ્યો' },
  { status: 'PENDING', lang: 'hi', label: 'ऑर्डर मिल गया' },
] as const)('shows the current legacy $status step in $lang', ({ status, lang, label }) => {
  setLang(lang);
  const order = { ...(contract.states.NOT_PAID.list as Order), status, fulfillment_type: 'HOME_DELIVERY' };
  const { container } = render(<Timeline order={order} />);
  const current = container.querySelector('[aria-current="step"]');
  expect(current?.textContent).toContain(label);
  expect(container.querySelector('time')).toBeNull();
});

function listResponse(order: Order) {
  return new Response(JSON.stringify({ results: [order] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('My Orders after the parent comes back', () => {
  it('re-reads the order when a check finds the payment, so status and timeline match the receipt', async () => {
    const checking = { ...(contract.states.CHECKING.list as Order), status: 'PLACED' };
    const paid = { ...(contract.states.PAID.list as Order), id: checking.id, order_number: checking.order_number, status: 'CONFIRMED' };
    const lists = [checking, paid];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/orders/?') || url.endsWith('/orders/')) return listResponse(lists.length > 1 ? lists.shift()! : lists[0]);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const reconcile = vi.spyOn(orderApi, 'reconcilePayment').mockResolvedValue({
      ...(contract.states.PAID.reconcile as PaymentReconcileResponse),
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/orders']}><Parent /></MemoryRouter>
    </QueryClientProvider>);

    // The order loads as CHECKING with an empty bag and nothing saved, and is checked once.
    await waitFor(() => expect(reconcile).toHaveBeenCalledWith(checking.id));
    expect(await screen.findByText('Payment received.')).toBeDefined();
    await waitFor(() => expect(screen.getByText('Confirmed').closest('[aria-current="step"]')).not.toBeNull());
    expect(screen.getByText('Order placed').closest('[aria-current="step"]')).toBeNull();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/orders/')).length).toBe(2);
  });
});
