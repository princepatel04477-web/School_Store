import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FulfilmentQueue,
  validateConsignmentFormat,
} from './FulfilmentQueue';
import * as apiModule from '../../api';

// Mock cityAdmin api calls
vi.mock('../../api', async () => {
  const actual = await vi.importActual('../../api');
  return {
    ...actual,
    cityAdmin: {
      ...((actual as any).cityAdmin || {}),
      fulfilmentQueue: vi.fn(),
      schools: vi.fn(),
      pack: vi.fn(),
      dispatch: vi.fn(),
      readyForPickup: vi.fn(),
      markDelivered: vi.fn(),
    },
  };
});

// Mock TailorSheetButton
vi.mock('./TailorSheetCard', () => ({
  TailorSheetButton: ({ orderId }: { orderId: string }) => (
    <button data-testid={`tailor-sheet-${orderId}`}>Tailor Sheet</button>
  ),
}));

describe('FulfilmentQueue & Consignment Helper Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. validateConsignmentFormat helper', () => {
    it('validates known good India Post S10 consignment numbers', () => {
      // Check digit 5
      expect(validateConsignmentFormat('EE123456785IN')).toBe(true);
      expect(validateConsignmentFormat('EE000000005IN')).toBe(true);
      // Check digit 0 (remainder 1 -> 11 - 1 = 10 -> 0)
      expect(validateConsignmentFormat('EE000000080IN')).toBe(true);
      // Check digit 4
      expect(validateConsignmentFormat('EE000000014IN')).toBe(true);
    });

    it('rejects invalid check digits', () => {
      expect(validateConsignmentFormat('EE123456789IN')).toBe(false);
      expect(validateConsignmentFormat('EE000000081IN')).toBe(false);
      expect(validateConsignmentFormat('EE123456780IN')).toBe(false);
    });

    it('rejects invalid length and format', () => {
      expect(validateConsignmentFormat('')).toBe(false);
      expect(validateConsignmentFormat('EE12345678IN')).toBe(false); // 8 digits (missing check digit)
      expect(validateConsignmentFormat('EE123456785INA')).toBe(false); // 14 chars
      expect(validateConsignmentFormat('12123456785IN')).toBe(false); // digits prefix
      expect(validateConsignmentFormat('EE12345678512')).toBe(false); // digits suffix
      expect(validateConsignmentFormat('invalid-consignment')).toBe(false);
    });

    it('handles whitespace and lowercase gracefully', () => {
      expect(validateConsignmentFormat('  ee123456785in  ')).toBe(true);
      expect(validateConsignmentFormat('ee000000080in')).toBe(true);
    });
  });

  describe('2. Queue renders skeleton during loading', () => {
    it('renders skeleton rows when query is in loading state', () => {
      // Query that never resolves during renderToString
      vi.mocked(apiModule.cityAdmin.fulfilmentQueue).mockImplementation(
        () => new Promise(() => {})
      );
      vi.mocked(apiModule.cityAdmin.schools).mockResolvedValue({
        next: null,
        previous: null,
        results: [],
      });

      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      const html = renderToString(
        <QueryClientProvider client={client}>
          <FulfilmentQueue />
        </QueryClientProvider>
      );

      expect(html).toContain('data-testid="queue-skeleton"');
      expect(html).toContain('skeleton-box');
    });
  });

  describe('3. Blocked row cannot be selected and shows reason message', () => {
    it('disables checkbox and renders blocked notice for gate-blocked orders', async () => {
      const mockOrders: apiModule.FulfilmentQueueOrder[] = [
        {
          id: 'ord-blocked-1',
          order_number: 'ORD-BLK-001',
          school_name: 'DPS Pune',
          school_code: 'DPS-PNQ',
          student_name: 'Rahul Sharma',
          student_gr: 'GR-101',
          fulfillment_type: 'HOME_DELIVERY',
          payment_status: 'PENDING',
          payment_method: 'RAZORPAY',
          status: 'CONFIRMED',
          items_count: 2,
          total: '2500.00',
          created_at: '2026-11-20T10:00:00Z',
          can_pack: false,
          blocked_reason: 'PAYMENT_NOT_VERIFIED',
          blocked_message: 'Payment signature missing. Please verify payment first.',
          consignment_number: null,
          dispatched_at: null,
        },
        {
          id: 'ord-allowed-2',
          order_number: 'ORD-OK-002',
          school_name: 'DPS Pune',
          school_code: 'DPS-PNQ',
          student_name: 'Aarav Patel',
          student_gr: 'GR-102',
          fulfillment_type: 'HOME_DELIVERY',
          payment_status: 'PAID',
          payment_method: 'RAZORPAY',
          status: 'CONFIRMED',
          items_count: 1,
          total: '1200.00',
          created_at: '2026-11-20T11:00:00Z',
          can_pack: true,
          blocked_reason: null,
          blocked_message: null,
          consignment_number: null,
          dispatched_at: null,
        },
      ];

      vi.mocked(apiModule.cityAdmin.fulfilmentQueue).mockResolvedValue({
        next: null,
        previous: null,
        results: mockOrders,
      });
      vi.mocked(apiModule.cityAdmin.schools).mockResolvedValue({
        next: null,
        previous: null,
        results: [],
      });

      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      // Prefetch data so renderToString renders resolved content
      await client.prefetchQuery({
        queryKey: ['fulfilment-queue', { stage: 'to_pack' }],
        queryFn: () =>
          apiModule.cityAdmin.fulfilmentQueue({ stage: 'to_pack' }),
      });

      const html = renderToString(
        <QueryClientProvider client={client}>
          <FulfilmentQueue />
        </QueryClientProvider>
      );

      // Verify blocked order has disabled checkbox and shows message
      expect(html).toContain('ORD-BLK-001');
      expect(html).toContain('row-blocked');
      expect(html).toContain('Payment signature missing. Please verify payment first.');
      expect(html).toContain('aria-label="Select order ORD-BLK-001" disabled=""');

      // Verify allowed order has enabled checkbox
      expect(html).toContain('ORD-OK-002');
      expect(html).toContain('aria-label="Select order ORD-OK-002"');
      // The allowed checkbox should not be disabled
      expect(html).not.toContain('aria-label="Select order ORD-OK-002" disabled=""');
    });
  });

  describe('4. 503 notice when Day 2 packing rule is missing', () => {
    it('displays notice and disables pack action on 503 PACKING_RULE_NOT_WIRED', () => {
      const noticeText = 'Packing is not available yet. Payment checks are not connected.';
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      const html = renderToString(
        <QueryClientProvider client={client}>
          <FulfilmentQueue initialNotice={noticeText} />
        </QueryClientProvider>
      );

      // The 503 error message should be displayed
      expect(html).toContain('Packing rule not connected');
      expect(html).toContain(noticeText);
      // Pack selected button should be disabled
      expect(html).toContain('disabled=""');
    });
  });
});
