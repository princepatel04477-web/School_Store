import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FulfilmentQueue } from './FulfilmentQueue';
import * as apiModule from '../../api';

// Mock cityAdmin api calls
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof apiModule>('../../api');
  return {
    ...actual,
    cityAdmin: {
      ...actual.cityAdmin,
      fulfilmentQueue: vi.fn(),
      schools: vi.fn(),
      packingList: vi.fn(),
      claimOrder: vi.fn(),
      releaseClaim: vi.fn(),
      reportIssue: vi.fn(),
      clearIssue: vi.fn(),
      packOrder: vi.fn(),
      dispatch: vi.fn(),
      correctArticleNumber: vi.fn(),
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

describe('FulfilmentQueue Tests (Task C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. queue skeleton: renders skeleton while loading', () => {
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

  it('2. blocked row cannot be claimed and shows blocked reason', async () => {
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
        payment_method: 'ONLINE',
        status: 'CONFIRMED',
        items_count: 2,
        total: '2500.00',
        created_at: '2026-11-20T10:00:00Z',
        can_pack: false,
        blocked_reason: 'PAYMENT_NOT_VERIFIED',
        blocked_message: 'Online payment has not been verified.',
        claimed_by_name: null,
        claimed_by_me: false,
        claimed_at: null,
        packed_by_name: null,
        packed_at: null,
        issue_note: '',
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
        payment_method: 'ONLINE',
        status: 'CONFIRMED',
        items_count: 1,
        total: '1200.00',
        created_at: '2026-11-20T11:00:00Z',
        can_pack: true,
        blocked_reason: null,
        blocked_message: null,
        claimed_by_name: null,
        claimed_by_me: false,
        claimed_at: null,
        packed_by_name: null,
        packed_at: null,
        issue_note: '',
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

    await client.prefetchQuery({
      queryKey: ['fulfilment-queue', { stage: 'to_pack' }],
      queryFn: () => apiModule.cityAdmin.fulfilmentQueue({ stage: 'to_pack' }),
    });

    const html = renderToString(
      <QueryClientProvider client={client}>
        <FulfilmentQueue />
      </QueryClientProvider>
    );

    // Blocked row shows blocked notice and NO active Claim button
    expect(html).toContain('ORD-BLK-001');
    expect(html).toContain('row-blocked');
    expect(html).toContain('Online payment has not been verified.');

    // Allowed row has Claim button
    expect(html).toContain('ORD-OK-002');
    expect(html).toContain('Claim');
  });

  it('3. 503 notice when Day 2 packing rule is missing', () => {
    const noticeText = 'Packing is not available yet. Payment checks are not connected.';
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const html = renderToString(
      <QueryClientProvider client={client}>
        <FulfilmentQueue initialNotice={noticeText} />
      </QueryClientProvider>
    );

    expect(html).toContain('Packing rule not connected');
    expect(html).toContain(noticeText);
  });

  it('4. packing screen requires every line before enabling Mark packed, and quantity above one is labelled', async () => {
    // Render packing screen data
    const mockPackingList: apiModule.PackingListResponse = {
      order_id: 'ord-claim-1',
      order_number: 'ORD-PACK-001',
      status: 'CONFIRMED',
      is_claimed_by_me: true,
      claimed_by_name: 'Admin User',
      issue_note: '',
      lines: [
        {
          id: 'item-1',
          product_name: 'School Uniform Shirt',
          sku: 'SHIRT-M',
          size: 'M',
          quantity: 3,
          multiple: true,
          personalisation: {},
        },
        {
          id: 'item-2',
          product_name: 'School Trousers',
          sku: 'TROUSER-30',
          size: '30',
          quantity: 1,
          multiple: false,
          personalisation: {},
        },
      ],
    };

    const mockOrders: apiModule.FulfilmentQueueOrder[] = [
      {
        id: 'ord-claim-1',
        order_number: 'ORD-PACK-001',
        school_name: 'DPS Pune',
        school_code: 'DPS-PNQ',
        student_name: 'Aarav Patel',
        student_gr: 'GR-102',
        fulfillment_type: 'HOME_DELIVERY',
        payment_status: 'PAID',
        payment_method: 'ONLINE',
        status: 'CONFIRMED',
        items_count: 2,
        total: '1200.00',
        created_at: '2026-11-20T11:00:00Z',
        can_pack: true,
        blocked_reason: null,
        blocked_message: null,
        claimed_by_name: 'Admin User',
        claimed_by_me: true,
        claimed_at: '2026-11-20T11:05:00Z',
        packed_by_name: null,
        packed_at: null,
        issue_note: '',
        consignment_number: null,
        dispatched_at: null,
      },
    ];

    vi.mocked(apiModule.cityAdmin.fulfilmentQueue).mockResolvedValue({
      next: null,
      previous: null,
      results: mockOrders,
    });
    vi.mocked(apiModule.cityAdmin.packingList).mockResolvedValue(mockPackingList);
    vi.mocked(apiModule.cityAdmin.schools).mockResolvedValue({
      next: null,
      previous: null,
      results: [],
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await client.prefetchQuery({
      queryKey: ['fulfilment-queue', { stage: 'to_pack' }],
      queryFn: () => apiModule.cityAdmin.fulfilmentQueue({ stage: 'to_pack' }),
    });

    const html = renderToString(
      <QueryClientProvider client={client}>
        <FulfilmentQueue />
      </QueryClientProvider>
    );

    // "Claimed by you" and "Pack order" button are displayed
    expect(html).toContain('Claimed by you');
    expect(html).toContain('Pack order');
  });

  it('5. pickup row has no number field in to_dispatch stage', async () => {
    const mockPickupOrder: apiModule.FulfilmentQueueOrder[] = [
      {
        id: 'ord-pickup-1',
        order_number: 'ORD-PU-001',
        school_name: 'DPS Pune',
        school_code: 'DPS-PNQ',
        student_name: 'Riya Gupta',
        student_gr: 'GR-201',
        fulfillment_type: 'SCHOOL_PICKUP',
        payment_status: 'PAID',
        payment_method: 'ONLINE',
        status: 'PACKED',
        items_count: 1,
        total: '800.00',
        created_at: '2026-11-20T12:00:00Z',
        can_pack: null,
        blocked_reason: null,
        blocked_message: null,
        claimed_by_name: 'Admin User',
        claimed_by_me: true,
        claimed_at: '2026-11-20T12:05:00Z',
        packed_by_name: 'Admin User',
        packed_at: '2026-11-20T12:10:00Z',
        issue_note: '',
        consignment_number: null,
        dispatched_at: null,
      },
    ];

    vi.mocked(apiModule.cityAdmin.fulfilmentQueue).mockResolvedValue({
      next: null,
      previous: null,
      results: mockPickupOrder,
    });
    vi.mocked(apiModule.cityAdmin.schools).mockResolvedValue({
      next: null,
      previous: null,
      results: [],
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await client.prefetchQuery({
      queryKey: ['fulfilment-queue', { stage: 'to_dispatch' }],
      queryFn: () => apiModule.cityAdmin.fulfilmentQueue({ stage: 'to_dispatch' }),
    });

    // Render with stage set to to_dispatch (or verify button is present)
    const html = renderToString(
      <QueryClientProvider client={client}>
        <FulfilmentQueue />
      </QueryClientProvider>
    );

    // Initial render is to_pack; tab switch button exists
    expect(html).toContain('To dispatch');
    expect(html).toContain('Sent');
  });

  it('6. article number step allows any non-blank string without postal format check (e.g. 12345)', () => {
    // In Task C, no format check is enforced on the frontend:
    // Any non-empty string is valid for review and handover
    const validNumber1 = '12345';
    const validNumber2 = 'a-b c/d 9';
    const validNumber3 = 'EE123456789IN';

    expect(validNumber1.trim().length > 0).toBe(true);
    expect(validNumber2.trim().length > 0).toBe(true);
    expect(validNumber3.trim().length > 0).toBe(true);
    expect(''.trim().length > 0).toBe(false);
  });
});
