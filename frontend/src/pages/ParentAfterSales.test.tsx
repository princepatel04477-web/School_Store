// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Parent from './Parent';
import * as apiModule from '../api';

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: { id: 'parent-1', role: 'PARENT', phone: '9876543210', username: 'parent' },
    signOut: vi.fn(),
  }),
}));

vi.mock('../components/SelectionFlow', () => ({
  SelectionFlow: () => <div data-testid="selection-flow">SelectionFlow</div>,
}));

vi.mock('../components/Store', () => ({
  Cart: () => <div data-testid="cart">Cart</div>,
  Timeline: () => <div data-testid="timeline">Timeline</div>,
}));

vi.mock('../services/paymentAdapter', () => ({
  loadRazorpay: vi.fn().mockResolvedValue(true),
  openRazorpayCheckout: vi.fn(),
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
      },
    },
  });
}

function renderParent(initialRoute = '/parent/orders', queryClient = createTestQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/parent/*" element={<Parent />} />
          <Route path="/*" element={<Parent />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Parent After-Sales Workflows (Cancellation, Size Exchange, Returns)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders "Cancel order" button when eligible before dispatch', async () => {
    const mockOrder: apiModule.Order = {
      id: 'ord-placed-1',
      order_number: 'ORD-1001',
      student_name: 'Aarav Patel',
      total: '500.00',
      status: 'CONFIRMED',
      payment_status: 'PAID',
      payment_method: 'ONLINE',
      fulfillment_type: 'HOME_DELIVERY',
      created_at: new Date().toISOString(),
      parent_actions: {
        cancel: { permitted: true, reason: 'Eligible for cancellation before dispatch.' },
        exchange: { permitted: false },
        return_or_report: { permitted: false },
      },
      after_sales_summary: {
        has_active_request: false,
      },
    };

    vi.spyOn(apiModule, 'api').mockImplementation((url: string) => {
      if (url === '/orders/' || url.startsWith('/orders/')) {
        return Promise.resolve({ results: [mockOrder] });
      }
      return Promise.resolve({ results: [] });
    });

    renderParent('/parent/orders');

    await waitFor(() => {
      expect(screen.getByText('ORD-1001')).toBeTruthy();
    });

    const cancelBtn = screen.getByRole('button', { name: /cancel order/i });
    expect(cancelBtn).toBeTruthy();
    expect(screen.queryByRole('button', { name: /request size exchange/i })).toBeNull();
  });

  it('renders "Request size exchange" and "Report damage" buttons when order is delivered', async () => {
    const mockOrder: apiModule.Order = {
      id: 'ord-delivered-1',
      order_number: 'ORD-1002',
      student_name: 'Diya Patel',
      total: '500.00',
      status: 'DELIVERED',
      payment_status: 'PAID',
      payment_method: 'ONLINE',
      fulfillment_type: 'HOME_DELIVERY',
      created_at: new Date().toISOString(),
      parent_actions: {
        cancel: { permitted: false },
        exchange: { permitted: true, reason: 'Eligible for size exchange within 7 days.' },
        return_or_report: { permitted: true, reason: 'Eligible to report damage within 7 days.' },
      },
      after_sales_summary: {
        has_active_request: false,
      },
    };

    vi.spyOn(apiModule, 'api').mockImplementation((url: string) => {
      if (url === '/orders/' || url.startsWith('/orders/')) {
        return Promise.resolve({ results: [mockOrder] });
      }
      return Promise.resolve({ results: [] });
    });

    renderParent('/parent/orders');

    await waitFor(() => {
      expect(screen.getByText('ORD-1002')).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: /request size exchange/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /report damage/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cancel order/i })).toBeNull();
  });

  it('renders active request badge when an after-sales request is already in progress', async () => {
    const mockOrder: apiModule.Order = {
      id: 'ord-exchanged-1',
      order_number: 'ORD-1003',
      student_name: 'Aarav Patel',
      total: '500.00',
      status: 'DELIVERED',
      payment_status: 'PAID',
      fulfillment_type: 'HOME_DELIVERY',
      created_at: new Date().toISOString(),
      after_sales_summary: {
        has_active_request: true,
        active_request_id: 'req-1',
        active_request_type: 'EXCHANGE',
        active_request_type_display: 'Size Exchange',
        active_request_status: 'REQUESTED',
        active_request_status_display: 'Requested',
        total_requests_count: 1,
      },
      parent_actions: {
        cancel: { permitted: false },
        exchange: { permitted: false },
        return_or_report: { permitted: false },
      },
    };

    vi.spyOn(apiModule, 'api').mockImplementation((url: string) => {
      if (url === '/orders/' || url.startsWith('/orders/')) {
        return Promise.resolve({ results: [mockOrder] });
      }
      return Promise.resolve({ results: [] });
    });

    renderParent('/parent/orders');

    await waitFor(() => {
      expect(screen.getByText('ORD-1003')).toBeTruthy();
    });

    expect(screen.getByText(/after-sales request: size exchange/i)).toBeTruthy();
    // Action buttons are hidden while active request is processing
    expect(screen.queryByRole('button', { name: /request size exchange/i })).toBeNull();
  });

  it('opens exchange modal and submits replacement request with reserved stock', async () => {
    const mockOrder: apiModule.Order = {
      id: 'ord-delivered-1',
      order_number: 'ORD-1004',
      student_name: 'Aarav Patel',
      total: '500.00',
      status: 'DELIVERED',
      payment_status: 'PAID',
      payment_method: 'ONLINE',
      fulfillment_type: 'HOME_DELIVERY',
      created_at: new Date().toISOString(),
      parent_actions: {
        cancel: { permitted: false },
        exchange: { permitted: true },
        return_or_report: { permitted: false },
      },
      after_sales_summary: {
        has_active_request: false,
      },
    };

    const mockEligibility: apiModule.OrderAfterSalesEligibility = {
      order_id: 'ord-delivered-1',
      order_number: 'ORD-1004',
      status: 'DELIVERED',
      payment_status: 'PAID',
      payment_method: 'ONLINE',
      is_delivered: true,
      within_7_days: true,
      first_exchange_free: true,
      can_cancel_order: false,
      total_refunded_paise: 0,
      items: [
        {
          item_id: 'item-1',
          product_name: 'School Shirt',
          variant_sku: 'SHIRT-30',
          current_size: '30',
          quantity: 1,
          unit_price: '500.00',
          is_customised: false,
          has_active_request: false,
          can_cancel: false,
          can_exchange: true,
          can_return: true,
          replacement_sizes: [
            { variant_id: 'v-32', size: '32', sku: 'SHIRT-32', stock_flag: 'IN_STOCK', available: true },
            { variant_id: 'v-34', size: '34', sku: 'SHIRT-34', stock_flag: 'OUT_OF_STOCK', available: false },
          ],
        },
      ],
    };

    vi.spyOn(apiModule, 'api').mockImplementation((url: string) => {
      if (url === '/orders/' || url.startsWith('/orders/')) {
        return Promise.resolve({ results: [mockOrder] });
      }
      return Promise.resolve({ results: [] });
    });

    const getEligibilitySpy = vi.spyOn(apiModule.orderApi, 'getAfterSalesEligibility').mockResolvedValue(mockEligibility);
    const requestAfterSaleSpy = vi.spyOn(apiModule.orderApi, 'requestAfterSale').mockResolvedValue({
      id: 'req-new',
      order: 'ord-delivered-1',
      request_type: 'EXCHANGE',
      status: 'REQUESTED',
      reason: 'TOO_SMALL',
      from_size: '30',
      target_size: '32',
      quantity: 1,
      charge_paise: 0,
      is_stock_reserved: true,
      is_item_restocked: false,
      created_at: new Date().toISOString(),
    });

    renderParent('/parent/orders');

    await waitFor(() => {
      expect(screen.getByText('ORD-1004')).toBeTruthy();
    });

    const exchangeBtn = screen.getByRole('button', { name: /request size exchange/i });
    fireEvent.click(exchangeBtn);

    // Modal opens and loads eligibility
    await waitFor(() => {
      expect(getEligibilitySpy).toHaveBeenCalledWith('ord-delivered-1');
      expect(screen.getByText('32')).toBeTruthy();
      expect(screen.getByText('34')).toBeTruthy();
    });

    // Variant 34 is out of stock and disabled
    const outOfStockBtn = screen.getByRole('button', { name: /34 out of stock/i }) as HTMLButtonElement;
    expect(outOfStockBtn.disabled).toBe(true);

    // Size 32 is in stock
    const inStockBtn = screen.getByRole('button', { name: /32 in stock/i });
    fireEvent.click(inStockBtn);

    // Submit request
    const submitBtn = screen.getByRole('button', { name: /submit request/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestAfterSaleSpy).toHaveBeenCalledWith('ord-delivered-1', {
        order_item: 'item-1',
        request_type: 'EXCHANGE',
        reason: 'TOO_SMALL',
        reason_details: '',
        target_size: '32',
      });
      expect(screen.getByText(/request submitted successfully/i)).toBeTruthy();
    });
  });
});
