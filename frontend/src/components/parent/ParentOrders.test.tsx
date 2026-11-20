// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ParentOrders, ParentOrderDetail } from './ParentOrders';
import { fulfilmentLabel, paymentLabel } from './orderLabels';
import { ParentTimeline } from './ParentTimeline';
import { api, ApiError } from '../../api';
import { setLang } from '../../i18n';
import { messages } from '../../i18n/messages';

vi.mock('../../api', async () => {
  const actual = await vi.importActual('../../api');
  return {
    ...actual,
    api: vi.fn(),
  };
});

describe('Prompt 4: Parent Orders, Labels, Timeline and Details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLang('en');
  });

  afterEach(() => {
    cleanup();
  });

  describe('Label Helpers (fulfilmentLabel & paymentLabel)', () => {
    const statuses = [
      'PLACED',
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'PACKED',
      'DISPATCHED',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'RETURNED',
      'REFUNDED',
    ] as const;

    it('has a translation for every Order.Status in en, gu, and hi', () => {
      const langs = ['en', 'gu', 'hi'] as const;

      for (const lang of langs) {
        setLang(lang);
        const t = (key: string) => messages[key as keyof typeof messages]?.[lang] || key;

        for (const st of statuses) {
          const label = fulfilmentLabel(st, t);
          expect(label).toBeTruthy();
          expect(label).not.toBe(st); // Must translate to a localized label, not raw key
        }
      }
    });

    it('has a translation for every PaymentStatus and PaymentMethod in en, gu, and hi', () => {
      const langs = ['en', 'gu', 'hi'] as const;

      for (const lang of langs) {
        setLang(lang);
        const t = (key: string) => messages[key as keyof typeof messages]?.[lang] || key;

        // COD + PENDING -> Pay on delivery
        const codLabel = paymentLabel('PENDING', 'COD', t);
        expect(codLabel).toBeTruthy();

        // Online paid
        const paidLabel = paymentLabel('PAID', 'ONLINE', t);
        expect(paidLabel).toBeTruthy();

        // Failed
        const failedLabel = paymentLabel('FAILED', 'ONLINE', t);
        expect(failedLabel).toBeTruthy();

        // Refunded
        const refundedLabel = paymentLabel('REFUNDED', 'ONLINE', t);
        expect(refundedLabel).toBeTruthy();
      }
    });

    it('falls back to raw status for unknown statuses rather than crashing', () => {
      const t = (key: string) => messages[key as keyof typeof messages]?.en || key;
      expect(fulfilmentLabel('UNKNOWN_NEW_STATUS', t)).toBe('UNKNOWN_NEW_STATUS');
      expect(paymentLabel('UNKNOWN_PAYMENT', 'ONLINE', t)).toBe('UNKNOWN_PAYMENT');
    });
  });

  describe('ParentTimeline Component', () => {
    it('renders single terminal badge for CANCELLED, RETURNED, and REFUNDED without 5-step progress bar', () => {
      const { rerender } = render(<ParentTimeline status="CANCELLED" />);
      expect(screen.getByRole('status')).toBeTruthy();
      expect(screen.getByText(/Cancelled/i)).toBeTruthy();
      expect(screen.queryByRole('list')).toBeNull();

      rerender(<ParentTimeline status="RETURNED" />);
      expect(screen.getByText(/Returned/i)).toBeTruthy();
      expect(screen.queryByRole('list')).toBeNull();

      rerender(<ParentTimeline status="REFUNDED" />);
      expect(screen.getByText(/Refunded/i)).toBeTruthy();
      expect(screen.queryByRole('list')).toBeNull();
    });

    it('maps PROCESSING with CONFIRMED and legacy SHIPPED to DISPATCHED in progress bar', () => {
      const { rerender, container } = render(<ParentTimeline status="PROCESSING" />);
      expect(screen.getByRole('list')).toBeTruthy();
      // Step 2 (Confirmed) should be active/current
      const steps = container.querySelectorAll('.parent-timeline-step');
      expect(steps.length).toBe(5);
      expect(steps[1].className).toContain('current');

      rerender(<ParentTimeline status="SHIPPED" />);
      // Step 4 (Dispatched) should be active/current
      const shippedSteps = container.querySelectorAll('.parent-timeline-step');
      expect(shippedSteps[3].className).toContain('current');
    });
  });

  describe('ParentOrders List View', () => {
    function renderOrdersView() {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      return render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <ParentOrders />
          </MemoryRouter>
        </QueryClientProvider>
      );
    }

    it('renders loading skeleton while fetching', () => {
      vi.mocked(api).mockReturnValue(new Promise(() => {})); // Never resolves
      renderOrdersView();
      expect(document.querySelector('.parent-orders-list[aria-busy="true"]')).not.toBeNull();
    });

    it('renders real error card with retry button on failure and retries on click', async () => {
      vi.mocked(api).mockRejectedValueOnce(new ApiError('Offline', 500));
      renderOrdersView();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText(/Could not load your orders/i)).toBeTruthy();
      });

      // Now mock success for retry
      vi.mocked(api).mockResolvedValueOnce({
        next: null,
        previous: null,
        results: [],
      });

      fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

      await waitFor(() => {
        expect(screen.getByText(/No orders yet/i)).toBeTruthy();
      });
    });

    it('renders friendly empty state when there are no orders', async () => {
      vi.mocked(api).mockResolvedValueOnce({
        next: null,
        previous: null,
        results: [],
      });
      renderOrdersView();

      await waitFor(() => {
        expect(screen.getByText(/No orders yet/i)).toBeTruthy();
        expect(screen.getByText(/Browse catalogue/i)).toBeTruthy();
      });
    });

    it('renders list with separate fulfilment and payment labels, and handles cursor load more', async () => {
      const order1 = {
        id: 'ord-1',
        order_number: 'ORD-2026-001',
        student: 'child-1',
        student_name: 'Aarav Patel',
        status: 'CONFIRMED',
        payment_status: 'PAID',
        payment_method: 'ONLINE',
        total: '1250.00',
        created_at: '2026-11-20T10:00:00Z',
      };
      const order2 = {
        id: 'ord-2',
        order_number: 'ORD-2026-002',
        student: 'child-1',
        student_name: 'Aarav Patel',
        status: 'PLACED',
        payment_status: 'PENDING',
        payment_method: 'COD',
        total: '450.00',
        created_at: '2026-11-19T10:00:00Z',
      };

      vi.mocked(api).mockResolvedValueOnce({
        next: '/api/orders/?cursor=cD0yMDI2LTExLTE5',
        previous: null,
        results: [order1],
      });

      renderOrdersView();

      await waitFor(() => {
        expect(screen.getByText('ORD-2026-001')).toBeTruthy();
        expect(screen.getByText(/Paid/i)).toBeTruthy();
        expect(screen.getAllByText(/Confirmed/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/Load more/i)).toBeTruthy();
      });

      // Mock second page response
      vi.mocked(api).mockResolvedValueOnce({
        next: null,
        previous: null,
        results: [order2],
      });

      fireEvent.click(screen.getByText(/Load more/i));

      await waitFor(() => {
        expect(screen.getByText('ORD-2026-002')).toBeTruthy();
        expect(screen.getByText(/Pay on delivery/i)).toBeTruthy();
      });
    });
  });

  describe('ParentOrderDetail View (/parent/orders/:id)', () => {
    function renderOrderDetail(orderId: string) {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      return render(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[`/parent/orders/${orderId}`]}>
            <Routes>
              <Route path="/parent/orders/:id" element={<ParentOrderDetail />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );
    }

    it('renders 404 friendly not found message when order not found or belongs to another parent', async () => {
      vi.mocked(api).mockImplementation(async () => {
        throw new ApiError('Not found', 404);
      });

      renderOrderDetail('unknown-order-id');

      await waitFor(() => {
        expect(screen.getByText(/We could not find this order/i)).toBeTruthy();
        expect(screen.getByText(/This order may not exist or belongs to another account/i)).toBeTruthy();
        expect(screen.getAllByText(/Back to My Orders/i).length).toBeGreaterThan(0);
      });
    });

    it('renders order detail (200) with items, totals, history and does not leak razorpay or internal user ids', async () => {
      const mockDetail = {
        id: 'ord-100',
        order_number: 'ORD-DETAIL-99',
        student: 'child-1',
        student_name: 'Aarav Patel',
        student_gr: 'GR-1001',
        school_name: 'DPS Surat',
        city_name: 'Surat',
        status: 'PACKED',
        payment_status: 'PAID',
        payment_method: 'ONLINE',
        fulfillment_type: 'HOME_DELIVERY',
        subtotal: '900.00',
        total: '900.00',
        delivery_details: {
          recipient_name: 'Rajesh Patel',
          phone: '9820011223',
          address: 'Flat 402, River View',
          city: 'Surat',
          state: 'Gujarat',
          pincode: '395007',
        },
        items: [
          {
            id: 'item-1',
            variant: 'var-1',
            variant_sku: 'SHIRT-M',
            variant_size: 'M',
            product_name: 'Oxford Cotton Shirt',
            category: 'Uniform',
            quantity: 3,
            unit_price_snapshot: '300.00',
          },
        ],
        status_events: [
          { id: 'ev-1', status: 'PLACED', timestamp: '2026-11-20T10:00:00Z', note: 'Created' },
          { id: 'ev-2', status: 'CONFIRMED', timestamp: '2026-11-20T10:15:00Z' },
          { id: 'ev-3', status: 'PACKED', timestamp: '2026-11-20T11:00:00Z' },
        ],
        created_at: '2026-11-20T10:00:00Z',
        // Internal IDs from API that MUST NOT be displayed
        razorpay_order_id: 'order_secret_rzp_123',
        razorpay_payment_id: 'pay_secret_rzp_456',
        placed_by: 'user-uuid-1',
        payer: 'user-uuid-1',
      };

      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path === '/orders/ord-100/') return mockDetail;
        throw new ApiError('Not found', 404);
      });

      const { container } = renderOrderDetail('ord-100');

      await waitFor(() => {
        expect(screen.getByText('ORD-DETAIL-99')).toBeTruthy();
        expect(screen.getByText(/Oxford Cotton Shirt/i)).toBeTruthy();
        expect(screen.getByText(/Rajesh Patel/i)).toBeTruthy();
        expect(screen.getByText(/Flat 402, River View/i)).toBeTruthy();
        expect(screen.getAllByText(/Packed/i).length).toBeGreaterThanOrEqual(1);
      });

      // Verify privacy: internal IDs must not be leaked into DOM
      const html = container.innerHTML;
      expect(html).not.toContain('order_secret_rzp_123');
      expect(html).not.toContain('pay_secret_rzp_456');
      expect(html).not.toContain('user-uuid-1');
    });
  });
});
