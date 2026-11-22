// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExchangeQueue } from './ExchangeQueue';
import { exchangeService, type SizeExchangeRequestItem } from '../../services/exchange';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockRequest: SizeExchangeRequestItem = {
  id: 'req-queue-1',
  order: 'order-1',
  order_number: 'ORD-Q-001',
  order_item: 'item-1',
  garment_name: 'Regular Uniform Shirt',
  from_size: '30',
  to_size: '32',
  quantity: 1,
  reason: 'TOO_SMALL',
  parent_note: 'Size 30 too tight',
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
  student_name: 'Aarav Shah',
  school_name: 'DPS Surat',
  city_name: 'Surat',
  can_withdraw: false,
  can_approve: true,
  can_confirm_window: false,
  can_set_handover: false,
  can_receive: false,
  can_complete: false,
  can_reject: true,
  can_return_original: false,
  can_reverse_receipt: false,
};

function renderQueue(props: { readOnly?: boolean; schoolId?: string; cityId?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ExchangeQueue {...props} />
    </QueryClientProvider>
  );
}

describe('ExchangeQueue Component', () => {
  it('renders queue requests with order details, sizes, and status', async () => {
    vi.spyOn(exchangeService, 'listQueue').mockResolvedValue({
      count: 1,
      results: [mockRequest],
    });

    renderQueue();

    expect(await screen.findByText('ORD-Q-001')).toBeDefined();
    expect(screen.getByText('Aarav Shah')).toBeDefined();
    expect(screen.getByText('Regular Uniform Shirt')).toBeDefined();
    expect(screen.getByText('SUBMITTED')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDefined();
  });

  it('renders read-only notice when readOnly is true (School Admin)', async () => {
    vi.spyOn(exchangeService, 'listQueue').mockResolvedValue({
      count: 1,
      results: [mockRequest],
    });

    renderQueue({ readOnly: true });

    expect(await screen.findByText('ORD-Q-001')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(
      screen.getByText('Action reserved for City Admin / Boss')
    ).toBeDefined();
  });

  it('allows opening approval modal and executing staff action', async () => {
    vi.spyOn(exchangeService, 'listQueue').mockResolvedValue({
      count: 1,
      results: [mockRequest],
    });
    const actionSpy = vi.spyOn(exchangeService, 'executeAction').mockResolvedValue({
      ...mockRequest,
      status: 'APPROVED',
      can_approve: false,
      can_receive: true,
    });

    renderQueue();

    const approveBtn = await screen.findByRole('button', { name: 'Approve' });
    fireEvent.click(approveBtn);

    expect(screen.getByText(/APPROVE: Order ORD-Q-001/i)).toBeDefined();

    const confirmBtn = screen.getByRole('button', { name: 'Confirm APPROVE' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(actionSpy).toHaveBeenCalledWith('req-queue-1', expect.objectContaining({
        action: 'APPROVE',
      }));
    });
  });
});
