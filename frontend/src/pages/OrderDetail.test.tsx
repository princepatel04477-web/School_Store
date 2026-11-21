import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderDetail, copyTextWithFallback } from './OrderDetail';
import * as apiModule from '../api';
import * as externalLinksModule from '../native/externalLinks';
import { siteConfig } from '../siteConfig';
import { setLang } from '../i18n';
import { messages } from '../i18n/messages';

let mockUseQueryError = false;

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<{ useQuery: (options: unknown) => unknown }>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: unknown) => {
      if (mockUseQueryError) {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error('Network error'),
          refetch: vi.fn(),
        };
      }
      return actual.useQuery(options);
    },
  };
});

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: vi.fn(),
  };
});

vi.mock('../native/externalLinks', () => ({
  openExternalUrl: vi.fn(),
}));

describe('OrderDetail Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQueryError = false;
    setLang('en');
    siteConfig.indiaPostTrackingUrl = 'https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx';

    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  afterEach(() => {
    siteConfig.indiaPostTrackingUrl = 'https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx';
  });

  const renderComponent = (orderId = 'ord-123', props: any = {}) => {
    return renderToString(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/orders/${orderId}`]}>
          <Routes>
            <Route path="/orders/:id" element={<OrderDetail {...props} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  it('1. shows skeleton while loading', () => {
    queryClient.setQueryData(['order-detail', 'ord-loading'], undefined);
    vi.mocked(apiModule.api).mockReturnValue(new Promise(() => {}));

    const html = renderComponent('ord-loading');
    expect(html).toContain('order-detail-skeleton');
    expect(html).toContain('skeleton-box');
    expect(html).not.toContain('No tracking');
    expect(html).not.toContain('We could not load your order details.');
  });

  it('2. shows error with Retry button on network failure (never empty state or no tracking)', () => {
    mockUseQueryError = true;

    const html = renderComponent('ord-err');
    expect(html).toContain('order-detail-error');
    expect(html).toContain('We could not load your order details.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('No orders');
    expect(html).not.toContain('No tracking');
  });

  it('3. renders older order with no tracking data normally', () => {
    const orderData: apiModule.Order = {
      id: 'ord-old',
      order_number: 'ORD-2025-0001',
      student_name: 'Aarav Patel',
      school_name: 'DPS Surat',
      status: 'PLACED',
      payment_status: 'PAID',
      fulfillment_type: 'HOME_DELIVERY',
      payment_method: 'ONLINE',
      total: '1200.00',
      created_at: '2025-01-15T10:00:00Z',
      items: [
        {
          id: 'item-1',
          product_name: 'School Blazer',
          size: '32',
          quantity: 1,
          unit_price_snapshot: '1200.00',
        },
      ],
    };
    queryClient.setQueryData(['order-detail', 'ord-old'], orderData);

    const html = renderComponent('ord-old');
    expect(html).toContain('ORD-2025-0001');
    expect(html).toContain('School Blazer');
    expect(html).toContain('Size: 32');
    expect(html).toContain('Paid');
    expect(html).toContain('1,200');
  });

  it('4. displays dispatched home delivery with long (40 char) article number and layout class', () => {
    const longArticle = 'EM123456789012345678901234567890123456IN'; // 40 chars
    const orderData: apiModule.Order = {
      id: 'ord-disp',
      order_number: 'ORD-2026-4040',
      student_name: 'Diya Patel',
      school_name: 'DPS Surat',
      status: 'DISPATCHED',
      payment_status: 'PAID',
      fulfillment_type: 'HOME_DELIVERY',
      payment_method: 'ONLINE',
      total: '650.00',
      created_at: '2026-11-20T10:00:00Z',
      items: [
        {
          id: 'item-2',
          product_name: 'School Skirt',
          size: 'M',
          quantity: 3,
          unit_price_snapshot: '650.00',
        },
      ],
      tracking: {
        carrier: 'INDIA_POST',
        consignment_number: longArticle,
        dispatched_at: '2026-11-21T12:00:00Z',
        delivered_at: null,
        steps: [
          { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
          { key: 'CONFIRMED', at: '2026-11-20T10:30:00Z' },
          { key: 'PACKED', at: '2026-11-20T18:00:00Z' },
          { key: 'DISPATCHED', at: '2026-11-21T12:00:00Z' },
        ],
      },
    };
    queryClient.setQueryData(['order-detail', 'ord-disp'], orderData);

    const html = renderComponent('ord-disp');
    // Header & items
    expect(html).toContain('ORD-2026-4040');
    expect(html).toContain('School Skirt');
    expect(html).toContain('Size: M');
    expect(html).toContain('x3'); // quantity > 1 format
    // Handover & tracking block
    expect(html).toContain('India Post article number');
    expect(html).toContain('order-detail-article-number');
    expect(html).toContain(longArticle);
    expect(html).toContain('Copy');
    expect(html).toContain('Track on India Post');
    expect(html).toContain('Copy the number, then paste it on the India Post page.');
    expect(html).toContain('https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx');
    // Ensure URL never contains the article number
    expect(html).not.toContain(`https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx?${longArticle}`);
    expect(html).not.toContain(`https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx/${longArticle}`);
  });

  it('5. older dispatched home order with no recorded number shows notice and no copy/track buttons', () => {
    const orderData: apiModule.Order = {
      id: 'ord-old-disp',
      order_number: 'ORD-2025-0099',
      student_name: 'Aarav Patel',
      school_name: 'DPS Surat',
      status: 'DISPATCHED',
      payment_status: 'PAID',
      fulfillment_type: 'HOME_DELIVERY',
      payment_method: 'ONLINE',
      total: '500.00',
      created_at: '2025-01-10T10:00:00Z',
      items: [
        {
          id: 'item-1',
          product_name: 'Uniform Tie',
          size: 'Standard',
          quantity: 1,
          unit_price_snapshot: '500.00',
        },
      ],
      tracking: {
        carrier: null,
        consignment_number: null,
        dispatched_at: '2025-01-11T12:00:00Z',
        delivered_at: null,
        steps: [
          { key: 'PLACED', at: '2025-01-10T10:00:00Z' },
          { key: 'DISPATCHED', at: '2025-01-11T12:00:00Z' },
        ],
      },
    };
    queryClient.setQueryData(['order-detail', 'ord-old-disp'], orderData);

    const html = renderComponent('ord-old-disp');
    expect(html).toContain('Handed over to India Post. The tracking number was not recorded for this order.');
    expect(html).not.toContain('order-detail-copy-btn');
    expect(html).not.toContain('order-detail-track-link');
  });

  it('6. school pickup shows pickup info and Ready at school once dispatched, never postal text', () => {
    const orderData: apiModule.Order = {
      id: 'ord-pickup',
      order_number: 'ORD-2026-PICKUP',
      student_name: 'Diya Patel',
      school_name: 'DPS Surat',
      status: 'DISPATCHED',
      payment_status: 'PAID',
      fulfillment_type: 'SCHOOL_PICKUP',
      payment_method: 'ONLINE',
      total: '400.00',
      created_at: '2026-11-20T10:00:00Z',
      items: [
        {
          id: 'item-1',
          product_name: 'School Cap',
          size: 'M',
          quantity: 1,
          unit_price_snapshot: '400.00',
        },
      ],
      tracking: {
        carrier: null,
        consignment_number: null,
        dispatched_at: '2026-11-21T10:00:00Z',
        delivered_at: null,
        steps: [
          { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
          { key: 'CONFIRMED', at: '2026-11-20T10:30:00Z' },
          { key: 'PACKED', at: '2026-11-20T17:00:00Z' },
          { key: 'DISPATCHED', at: '2026-11-21T10:00:00Z' },
        ],
      },
    };
    queryClient.setQueryData(['order-detail', 'ord-pickup'], orderData);

    const html = renderComponent('ord-pickup');
    expect(html).toContain('Pickup at DPS Surat');
    expect(html).toContain('Ready at school');
    // Must never leak article number, India Post, or tracking link
    expect(html).not.toContain('India Post article number');
    expect(html).not.toContain('Track on India Post');
    expect(html).not.toContain('order-detail-copy-btn');
  });

  it('7. store marked Delivered shows Marked delivered by the store with timestamp', () => {
    const orderData: apiModule.Order = {
      id: 'ord-deliv',
      order_number: 'ORD-2026-DELIV',
      student_name: 'Aarav Patel',
      school_name: 'DPS Surat',
      status: 'DELIVERED',
      payment_status: 'PAID',
      fulfillment_type: 'HOME_DELIVERY',
      payment_method: 'ONLINE',
      total: '800.00',
      created_at: '2026-11-19T10:00:00Z',
      items: [
        {
          id: 'item-1',
          product_name: 'Uniform Shirt',
          size: '34',
          quantity: 1,
          unit_price_snapshot: '800.00',
        },
      ],
      tracking: {
        carrier: 'INDIA_POST',
        consignment_number: 'EM999999999IN',
        dispatched_at: '2026-11-20T10:00:00Z',
        delivered_at: '2026-11-21T15:00:00Z',
        steps: [
          { key: 'PLACED', at: '2026-11-19T10:00:00Z' },
          { key: 'PACKED', at: '2026-11-19T18:00:00Z' },
          { key: 'DISPATCHED', at: '2026-11-20T10:00:00Z' },
          { key: 'DELIVERED', at: '2026-11-21T15:00:00Z' },
        ],
      },
    };
    queryClient.setQueryData(['order-detail', 'ord-deliv'], orderData);

    const html = renderComponent('ord-deliv');
    expect(html).toContain('Marked delivered by the store');
    expect(html).not.toContain('Carrier scan');
    expect(html).not.toContain('India Post scan');
  });

  it('8. cash on delivery unpaid shows Pay on delivery with amount due', () => {
    const orderData: apiModule.Order = {
      id: 'ord-cod',
      order_number: 'ORD-2026-COD1',
      student_name: 'Aarav Patel',
      school_name: 'DPS Surat',
      status: 'PACKED',
      payment_status: 'PENDING',
      fulfillment_type: 'HOME_DELIVERY',
      payment_method: 'COD',
      total: '950.00',
      created_at: '2026-11-20T10:00:00Z',
      items: [
        {
          id: 'item-1',
          product_name: 'School Shoes',
          size: '6',
          quantity: 1,
          unit_price_snapshot: '950.00',
        },
      ],
      tracking: {
        carrier: null,
        consignment_number: null,
        dispatched_at: null,
        delivered_at: null,
        steps: [
          { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
          { key: 'PACKED', at: '2026-11-20T16:00:00Z' },
        ],
      },
    };
    queryClient.setQueryData(['order-detail', 'ord-cod'], orderData);

    const html = renderComponent('ord-cod');
    expect(html).toContain('Cash on delivery');
    expect(html).toContain('Pay on delivery: ₹950.00 due');
  });

  it('9. renders cleanly in Gujarati and Hindi without missing keys', () => {
    const orderData: apiModule.Order = {
      id: 'ord-i18n',
      order_number: 'ORD-2026-LANG',
      student_name: 'Diya Patel',
      school_name: 'DPS Surat',
      status: 'DISPATCHED',
      payment_status: 'PAID',
      fulfillment_type: 'HOME_DELIVERY',
      payment_method: 'ONLINE',
      total: '500.00',
      created_at: '2026-11-20T10:00:00Z',
      items: [
        {
          id: 'item-1',
          product_name: 'Uniform Shirt',
          size: 'M',
          quantity: 2,
          unit_price_snapshot: '250.00',
        },
      ],
      tracking: {
        carrier: 'INDIA_POST',
        consignment_number: 'EM777777777IN',
        dispatched_at: '2026-11-21T10:00:00Z',
        delivered_at: null,
        steps: [
          { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
          { key: 'DISPATCHED', at: '2026-11-21T10:00:00Z' },
        ],
      },
    };
    queryClient.setQueryData(['order-detail', 'ord-i18n'], orderData);

    // Gujarati
    setLang('gu');
    const htmlGu = renderComponent('ord-i18n');
    expect(htmlGu).toContain('ઓર્ડર પર પાછા જાઓ');
    expect(htmlGu).toContain('ખરીદેલી વસ્તુઓ');
    expect(htmlGu).toContain('ચુકવણી');
    expect(htmlGu).toContain('ડિલિવરી');
    expect(htmlGu).toContain('ઇન્ડિયા પોસ્ટ આર્ટિકલ નંબર');
    expect(htmlGu).toContain('કૉપિ કરો');
    expect(htmlGu).toContain('ઇન્ડિયા પોસ્ટ પર ટ્રેક કરો');
    expect(htmlGu).not.toContain('orderDetail.');

    // Hindi
    setLang('hi');
    const htmlHi = renderComponent('ord-i18n');
    expect(htmlHi).toContain('ऑर्डर पर वापस जाएँ');
    expect(htmlHi).toContain('ख़रीदा गया सामान');
    expect(htmlHi).toContain('भुगतान');
    expect(htmlHi).toContain('डिलीवरी');
    expect(htmlHi).toContain('इंडिया पोस्ट आर्टिकल नंबर');
    expect(htmlHi).toContain('कॉपी करें');
    expect(htmlHi).toContain('इंडिया पोस्ट पर ट्रैक करें');
    expect(htmlHi).not.toContain('orderDetail.');
  });

  describe('E2: Copy consignment number tests', () => {
    const dispOrder: apiModule.Order = {
      id: 'ord-copy-test',
      order_number: 'ORD-COPY-001',
      student_name: 'Aarav Patel',
      school_name: 'DPS Surat',
      status: 'DISPATCHED',
      payment_status: 'PAID',
      fulfillment_type: 'HOME_DELIVERY',
      payment_method: 'ONLINE',
      total: '650.00',
      created_at: '2026-11-20T10:00:00Z',
      items: [
        {
          id: 'item-1',
          product_name: 'School Skirt',
          size: 'M',
          quantity: 1,
          unit_price_snapshot: '650.00',
        },
      ],
      tracking: {
        carrier: 'INDIA_POST',
        consignment_number: 'EM123456789IN',
        dispatched_at: '2026-11-21T12:00:00Z',
        delivered_at: null,
        steps: [
          { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
          { key: 'DISPATCHED', at: '2026-11-21T12:00:00Z' },
        ],
      },
    };

    it('clipboard success shows Copied', async () => {
      queryClient.setQueryData(['order-detail', 'ord-copy-test'], dispOrder);
      const nav = { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } };
      const ok = await copyTextWithFallback('EM123456789IN', nav as any);
      expect(ok).toBe(true);
      const html = renderComponent('ord-copy-test', { initialCopyStatus: ok ? 'copied' : 'failed' });
      expect(html).toContain('Copied');
      expect(html).not.toContain('Could not copy');
    });

    it('clipboard rejects and execCommand returns false shows the failure message and not Copied', async () => {
      queryClient.setQueryData(['order-detail', 'ord-copy-test'], dispOrder);
      const nav = { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) } };
      const doc = {
        createElement: vi.fn().mockReturnValue({ style: {}, select: vi.fn() }),
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
        execCommand: vi.fn().mockReturnValue(false),
      };
      const ok = await copyTextWithFallback('EM123456789IN', nav as any, doc as any);
      expect(ok).toBe(false);
      const html = renderComponent('ord-copy-test', { initialCopyStatus: ok ? 'copied' : 'failed' });
      expect(html).toContain('Could not copy. Press and hold the number to copy it.');
      expect(html).not.toContain('Copied');
    });

    it('clipboard missing and execCommand true shows Copied', async () => {
      queryClient.setQueryData(['order-detail', 'ord-copy-test'], dispOrder);
      const nav = {};
      const doc = {
        createElement: vi.fn().mockReturnValue({ style: {}, select: vi.fn() }),
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
        execCommand: vi.fn().mockReturnValue(true),
      };
      const ok = await copyTextWithFallback('EM123456789IN', nav as any, doc as any);
      expect(ok).toBe(true);
      const html = renderComponent('ord-copy-test', { initialCopyStatus: ok ? 'copied' : 'failed' });
      expect(html).toContain('Copied');
      expect(html).not.toContain('Could not copy');
    });

    it('message exists in all three languages', () => {
      expect((messages as any)['orderDetail.copyFailed']?.en).toBe('Could not copy. Press and hold the number to copy it.');
      expect((messages as any)['orderDetail.copyFailed']?.hi).toBe('कॉपी नहीं हो सका। नंबर को दबाकर रखें और कॉपी करें।');
      expect((messages as any)['orderDetail.copyFailed']?.gu).toBe('કૉપિ થઈ શક્યું નહીં. નંબર દબાવી રાખીને કૉપિ કરો.');
    });
  });
});
