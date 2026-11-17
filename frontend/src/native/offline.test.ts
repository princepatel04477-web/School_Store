import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({
  api: vi.fn(),
}));

import { api } from '../api';
import {
  isQueryKeyAllowed,
  filterAllowedQueries,
  FORBIDDEN_QUERY_KEYS,
  ALLOWED_QUERY_KEYS,
} from './offlineCache';
import { revalidateCart } from './cartRevalidate';
import { evictOldestEntries, MAX_CACHE_BYTES, type CacheEntry } from './imageCache';
import type { CartItem } from '../store/storeState';

describe('Offline Persistence Allow-List & Block-List', () => {
  it('allows read-only catalogue queries', () => {
    expect(isQueryKeyAllowed(['schools'])).toBe(true);
    expect(isQueryKeyAllowed(['products', 'DPS-SUR'])).toBe(true);
    expect(isQueryKeyAllowed(['classes'])).toBe(true);
    expect(isQueryKeyAllowed(['size_chart', 'shirt'])).toBe(true);
    expect(isQueryKeyAllowed(['catalog'])).toBe(true);
  });

  it('strictly blocks all sensitive auth, cart, payment, and measurement keys', () => {
    for (const forbidden of FORBIDDEN_QUERY_KEYS) {
      expect(isQueryKeyAllowed([forbidden])).toBe(false);
      expect(isQueryKeyAllowed(['schools', forbidden])).toBe(false);
      expect(isQueryKeyAllowed([forbidden, 'nested'])).toBe(false);
    }
  });

  it('rejects invalid or non-array keys', () => {
    expect(isQueryKeyAllowed([])).toBe(false);
    expect(isQueryKeyAllowed(null as any)).toBe(false);
    expect(isQueryKeyAllowed(undefined as any)).toBe(false);
    expect(isQueryKeyAllowed('not-an-array' as any)).toBe(false);
  });

  it('filters query client cache and completely drops blocked data', () => {
    const mockQueries = [
      {
        queryKey: ['schools'],
        state: { data: [{ id: '1', name: 'DPS' }], dataUpdatedAt: 1000 },
      },
      {
        queryKey: ['products'],
        state: { data: [{ id: 'p1', name: 'Shirt' }], dataUpdatedAt: 1000 },
      },
      {
        queryKey: ['auth', 'user'],
        state: { data: { token: 'secret-jwt', user: 'parent1' }, dataUpdatedAt: 1000 },
      },
      {
        queryKey: ['cart'],
        state: { data: [{ total: 500 }], dataUpdatedAt: 1000 },
      },
      {
        queryKey: ['payment', 'razorpay'],
        state: { data: { orderId: 'rzp_123' }, dataUpdatedAt: 1000 },
      },
      {
        queryKey: ['measurements', 'student_1'],
        state: { data: { shoulder: 32, height: 120 }, dataUpdatedAt: 1000 },
      },
      {
        queryKey: ['photo', 'student_1'],
        state: { data: 'https://example.com/face.jpg', dataUpdatedAt: 1000 },
      },
    ];

    const mockQueryClient: any = {
      getQueryCache: () => ({
        getAll: () => mockQueries,
      }),
    };

    const filtered = filterAllowedQueries(mockQueryClient);

    // Only ['schools'] and ['products'] should be preserved
    expect(filtered.length).toBe(2);
    expect(filtered.map((e) => e.queryKey[0])).toEqual(['schools', 'products']);

    // Ensure zero trace of any forbidden keyword in the output
    const serialized = JSON.stringify(filtered);
    for (const forbidden of FORBIDDEN_QUERY_KEYS) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });
});

describe('Cart Re-Validation Diff Logic', () => {
  const sampleCart: CartItem[] = [
    {
      id: 'v1',
      productId: 'p1',
      variantId: 'v1',
      name: 'School Shirt 30',
      category: 'shirts',
      pricePaise: 30000, // ₹300
      size: '30',
      quantity: 2,
    },
    {
      id: 'v2',
      productId: 'p2',
      variantId: 'v2',
      name: 'School Trouser 28',
      category: 'trousers',
      pricePaise: 45000, // ₹450
      size: '28',
      quantity: 1,
    },
  ];

  it('detects when prices have changed on the server', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      results: [
        {
          id: 'p1',
          variants: [
            { id: 'v1', selling_price: '350.00', in_stock: true }, // Changed from 300 to 350
          ],
        },
        {
          id: 'p2',
          variants: [
            { id: 'v2', selling_price: '450.00', in_stock: true }, // Unchanged
          ],
        },
      ],
    } as any);

    const result = await revalidateCart(sampleCart);
    expect(result.hasChanges).toBe(true);
    expect(result.priceChanges.length).toBe(1);
    expect(result.priceChanges[0].oldPricePaise).toBe(30000);
    expect(result.priceChanges[0].newPricePaise).toBe(35000);
    expect(result.stockChanges.length).toBe(0);
  });

  it('detects out-of-stock items', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      results: [
        {
          id: 'p1',
          variants: [
            { id: 'v1', selling_price: '300.00', in_stock: false }, // Out of stock
          ],
        },
      ],
    } as any);

    const result = await revalidateCart(sampleCart);
    expect(result.hasChanges).toBe(true);
    expect(result.stockChanges.length).toBe(1);
    expect(result.stockChanges[0].item.variantId).toBe('v1');
  });
});

describe('Image Cache LRU Eviction', () => {
  it('evicts oldest accessed image entries when 50MB limit is reached', async () => {
    const mockIndex: Record<string, CacheEntry> = {
      'img1.jpg': { url: 'img1.jpg', size: 20 * 1024 * 1024, lastAccessed: 100 },
      'img2.jpg': { url: 'img2.jpg', size: 20 * 1024 * 1024, lastAccessed: 200 },
      'img3.jpg': { url: 'img3.jpg', size: 8 * 1024 * 1024, lastAccessed: 300 },
    }; // Total: 48 MB

    // Adding 5 MB requires eviction (48 + 5 = 53 MB > 50 MB)
    const newBytes = 5 * 1024 * 1024;
    const evictedIndex = await evictOldestEntries(mockIndex, newBytes);

    // img1.jpg was oldest (lastAccessed: 100), it must be evicted first
    expect(evictedIndex['img1.jpg']).toBeUndefined();
    expect(evictedIndex['img2.jpg']).toBeDefined();
    expect(evictedIndex['img3.jpg']).toBeDefined();

    const remainingTotal = Object.values(evictedIndex).reduce((sum, e) => sum + e.size, 0);
    expect(remainingTotal + newBytes).toBeLessThanOrEqual(MAX_CACHE_BYTES);
  });
});
