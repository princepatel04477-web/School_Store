// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ParentExchange from './ParentExchange';
import { exchangeService, type OrderExchangeSummary } from '../services/exchange';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockSummary: OrderExchangeSummary = {
  order_id: 'order-123',
  order_number: 'ORD-TEST-001',
  delivered_at: '2026-10-10T10:00:00Z',
  window_starts_at: '2026-10-10T10:00:00Z',
  window_ends_at: '2026-10-17T23:59:59Z',
  within_window: true,
  window_reason: 'Delivered within policy',
  delivered_event_exists: true,
  items: [
    {
      id: 'item-1',
      garment_name: 'Regular Uniform Shirt',
      product_id: 'prod-1',
      current_holdings: { '30': 2 },
      exchangeable_units: 2,
      candidate_sizes: [
        { size: '28', available_qty: 10, active: true, recommended: false, stock_status: 'IN_STOCK' },
        { size: '32', available_qty: 5, active: true, recommended: true, stock_status: 'IN_STOCK' },
        { size: '34', available_qty: 0, active: true, recommended: false, stock_status: 'OUT_OF_STOCK' },
      ],
      is_delivered: true,
      not_delivered_reason: '',
      has_active_exchange: false,
      active_exchange_id: null,
    },
  ],
  requests: [
    {
      id: 'req-1',
      order: 'order-123',
      order_number: 'ORD-TEST-001',
      order_item: 'item-1',
      garment_name: 'Regular Uniform Shirt',
      from_size: '30',
      to_size: '32',
      quantity: 1,
      reason: 'TOO_SMALL',
      parent_note: 'Need next size up',
      status: 'SUBMITTED',
      review_reason: 'NONE',
      review_note: '',
      inspection_result: 'PENDING',
      reservation_state: 'RESERVED',
      window_mode: 'NONE',
      window_start: null,
      window_end: null,
      reversal_window_end: null,
      created_at: '2026-10-12T14:00:00Z',
      updated_at: '2026-10-12T14:00:00Z',
      created_by_name: 'Parent User',
      can_withdraw: true,
      can_approve: false,
      can_confirm_window: false,
      can_set_handover: false,
      can_receive: false,
      can_complete: false,
      can_reject: false,
      can_return_original: false,
      can_reverse_receipt: false,
    },
  ],
};

function renderPage(orderId = 'order-123') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/parent/orders/${orderId}/exchange`]}>
        <Routes>
          <Route path="/parent/orders/:orderId/exchange" element={<ParentExchange />} />
          <Route path="/parent/orders" element={<div>Orders List</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ParentExchange Page', () => {
  it('renders exchange summary, window banner, and delivered items', async () => {
    vi.spyOn(exchangeService, 'getOrderSummary').mockResolvedValue(mockSummary);

    renderPage();

    expect((await screen.findAllByText('Regular Uniform Shirt')).length).toBeGreaterThan(0);
    expect(screen.getByText('Holdings: Size 30: 2')).toBeDefined();
    expect(screen.getByText(/Exchange window open until/i)).toBeDefined();
    expect(screen.getByText(/Exchanging/i)).toBeDefined();
    expect(screen.getByText('SUBMITTED')).toBeDefined();
  });

  it('allows filling exchange form and submitting a request', async () => {
    vi.spyOn(exchangeService, 'getOrderSummary').mockResolvedValue(mockSummary);
    const submitSpy = vi.spyOn(exchangeService, 'submitRequest').mockResolvedValue({
      ...mockSummary.requests[0],
      id: 'req-2',
      from_size: '30',
      to_size: '28',
    });

    renderPage();

    const changeSizeBtn = await screen.findByRole('button', { name: /Change size/i });
    fireEvent.click(changeSizeBtn);

    expect(screen.getByLabelText(/Select new size/i)).toBeDefined();
    const toSizeSelect = screen.getByLabelText(/Select new size/i);
    fireEvent.change(toSizeSelect, { target: { value: '28' } });

    const submitBtn = screen.getByRole('button', { name: /Submit exchange request/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith('order-123', expect.objectContaining({
        order_item_id: 'item-1',
        from_size: '30',
        to_size: '28',
        quantity: 1,
      }));
    });
  });

  it('allows withdrawing an active exchange request', async () => {
    vi.spyOn(exchangeService, 'getOrderSummary').mockResolvedValue(mockSummary);
    const withdrawSpy = vi.spyOn(exchangeService, 'withdrawRequest').mockResolvedValue({
      ...mockSummary.requests[0],
      status: 'WITHDRAWN',
      can_withdraw: false,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage();

    const withdrawBtn = await screen.findByRole('button', { name: /Withdraw request/i });
    fireEvent.click(withdrawBtn);

    await waitFor(() => {
      expect(withdrawSpy).toHaveBeenCalledWith('order-123', 'req-1');
    });
  });
});
