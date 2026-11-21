import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Orders } from './Parent';
import { OrdersTab } from './native/OrdersTab';
import * as apiModule from '../api';
import { siteConfig } from '../siteConfig';
import { setLang } from '../i18n';

let mockUseQueryError = false;

// Mock @tanstack/react-query useQuery to allow simulating error state
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: any) => {
      if (mockUseQueryError) {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error('Network error'),
          refetch: vi.fn(),
        };
      }
      return (actual as any).useQuery(options);
    },
  };
});

// Mock api
vi.mock('../api', async () => {
  const actual = await vi.importActual('../api');
  return {
    ...actual,
    api: vi.fn(),
  };
});

// Mock auth for OrdersTab
vi.mock('../auth', () => ({
  useAuth: () => ({
    user: { id: 'parent-123', username: 'test_parent', role: 'PARENT' },
  }),
}));

describe('Orders Screens (Web & Native)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    setLang('en');
    siteConfig.indiaPostTrackingUrl = '';
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  afterEach(() => {
    siteConfig.indiaPostTrackingUrl = '';
  });

  describe('Web Orders screen (Parent.tsx Orders)', () => {
    it('shows skeleton cards while loading (not text)', () => {
      // Create a query that never resolves during render to trigger isLoading
      queryClient.setQueryData(['orders'], undefined);
      vi.mocked(apiModule.api).mockReturnValue(new Promise(() => {}));

      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Orders />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Skeleton loader should be present
      expect(html).toContain('orders-skeleton-list');
      expect(html).toContain('skeleton-box');
      // Must not be empty state
      expect(html).not.toContain('No orders yet');
    });

    it('shows error state with Retry button on a failed request (not the empty state)', () => {
      mockUseQueryError = true;

      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Orders />
          </MemoryRouter>
        </QueryClientProvider>
      );

      mockUseQueryError = false;

      // Error message and retry button
      expect(html).toContain('orders-error-state');
      expect(html).toContain('We could not load your orders.');
      expect(html).toContain('Retry');
      // Must never look like "No orders yet"
      expect(html).not.toContain('No orders yet');
      expect(html).not.toContain('Browse catalogue');
    });

    it('shows empty state with Truck icon when no orders exist', async () => {
      queryClient.setQueryData(['orders'], { results: [] });

      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Orders />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('No orders yet');
      expect(html).toContain('Browse catalogue');
      // Contains Truck SVG icon, not "⌁" glyph
      expect(html).toContain('<svg');
      expect(html).not.toContain('⌁');
    });

    it('shows tracking block with copy and hides link when indiaPostTrackingUrl is empty', async () => {
      const dispatchedOrder: apiModule.Order = {
        id: 'ord-hd-1',
        order_number: 'ORD-HD-101',
        student_name: 'Aarav Patel',
        status: 'DISPATCHED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 1200,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: 'INDIA_POST',
          consignment_number: 'EE123456785IN',
          dispatched_at: '2026-11-20T14:00:00Z',
          delivered_at: null,
          steps: [
            { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
            { key: 'CONFIRMED', at: '2026-11-20T10:05:00Z' },
            { key: 'PACKED', at: '2026-11-20T11:00:00Z' },
            { key: 'DISPATCHED', at: '2026-11-20T14:00:00Z' },
          ],
        },
      };

      siteConfig.indiaPostTrackingUrl = '';
      queryClient.setQueryData(['orders'], { results: [dispatchedOrder] });

      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Orders />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('tracking-block');
      expect(html).toContain('India Post tracking number');
      expect(html).toContain('EE123456785IN');
      expect(html).toContain('Copy');
      // Hidden link when indiaPostTrackingUrl is empty
      expect(html).not.toContain('Track on India Post');
    });

    it('shows "Track on India Post" link when indiaPostTrackingUrl is configured', async () => {
      const dispatchedOrder: apiModule.Order = {
        id: 'ord-hd-2',
        order_number: 'ORD-HD-102',
        student_name: 'Aarav Patel',
        status: 'DISPATCHED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 1200,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: 'INDIA_POST',
          consignment_number: 'EE123456785IN',
          dispatched_at: '2026-11-20T14:00:00Z',
          delivered_at: null,
          steps: [{ key: 'DISPATCHED', at: '2026-11-20T14:00:00Z' }],
        },
      };

      siteConfig.indiaPostTrackingUrl = 'https://www.indiapost.gov.in/_layouts/15/dptpc/articletracking.aspx';
      queryClient.setQueryData(['orders'], { results: [dispatchedOrder] });

      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Orders />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('Track on India Post');
      expect(html).toContain('rel="noopener noreferrer"');
    });
  });

  describe('Native Orders screen (OrdersTab.tsx)', () => {
    it('shows skeleton cards while loading (not text "Loading your orders…")', () => {
      queryClient.setQueryData(['native-orders', 'parent-123'], undefined);
      vi.mocked(apiModule.api).mockReturnValue(new Promise(() => {}));

      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <OrdersTab />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Shows skeleton loader
      expect(html).toContain('orders-skeleton-list');
      // Does not show raw text "Loading your orders…"
      expect(html).not.toContain('Loading your orders…');
      // Does not show empty state
      expect(html).not.toContain('No orders placed yet');
    });

    it('shows error state with Retry button on a failed request (not empty state)', () => {
      mockUseQueryError = true;

      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <OrdersTab />
          </MemoryRouter>
        </QueryClientProvider>
      );

      mockUseQueryError = false;

      expect(html).toContain('native-error-state');
      expect(html).toContain('We could not load your orders.');
      expect(html).toContain('Retry');
      expect(html).not.toContain('No orders placed yet');
    });

    it('shows empty state with Truck icon when no orders exist', async () => {
      queryClient.setQueryData(['native-orders', 'parent-123'], { results: [] });

      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <OrdersTab />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('No orders placed yet');
      expect(html).toContain('Browse Catalogue');
      expect(html).toContain('<svg');
    });

    it('shows tracking block with copy and hides link when indiaPostTrackingUrl is empty', async () => {
      const dispatchedOrder: apiModule.Order = {
        id: 'ord-app-1',
        order_number: 'ORD-APP-001',
        student_name: 'Pooja Shah',
        status: 'DISPATCHED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 950,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: 'INDIA_POST',
          consignment_number: 'EE123456785IN',
          dispatched_at: '2026-11-20T14:00:00Z',
          delivered_at: null,
          steps: [{ key: 'DISPATCHED', at: '2026-11-20T14:00:00Z' }],
        },
      };

      siteConfig.indiaPostTrackingUrl = '';
      queryClient.setQueryData(['native-orders', 'parent-123'], { results: [dispatchedOrder] });

      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <OrdersTab />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('India Post tracking number');
      expect(html).toContain('EE123456785IN');
      expect(html).toContain('Copy');
      expect(html).not.toContain('Track on India Post');
    });
  });
});
