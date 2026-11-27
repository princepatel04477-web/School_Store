// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderApi, type Order, type PaymentReconcileResponse } from '../api';
import contract from '../test/fixtures/payment-contract.json';
import Parent from './Parent';

vi.mock('../App', () => ({ Shell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'parent-1', role: 'PARENT' } }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    await waitFor(() => expect(screen.getByText('CONFIRMED')).toBeDefined());
    expect(screen.queryByText('PLACED')).toBeNull();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/orders/')).length).toBe(2);
  });
});
