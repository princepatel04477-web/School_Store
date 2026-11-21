// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SelectionFlowPage } from './SelectionFlowPage';
import { storeState } from '../store/storeState';
import type { StoreProduct } from '../data/catalog';

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

window.scrollTo = vi.fn();

const mockSchools = [
  {
    id: 'sch-1',
    name: 'Kendriya Vidyalaya Surat',
    code: 'KV-SUR',
    cityId: 'city-1',
    city: 'Surat',
    state: 'Gujarat',
    deliveryOptions: { homeDelivery: true, schoolPickup: true },
  },
];

const mockProducts: StoreProduct[] = [
  {
    id: 'prod-req-1',
    name: 'KV Boys Half Sleeve Shirt',
    category: 'Uniform',
    categorySlug: 'uniform',
    descriptor: 'Regular Fit',
    description: 'Cotton blend uniform shirt',
    pricePaise: 45000,
    required: true,
    official: true,
    needsDetails: false,
    sizes: [
      { id: 'v-1', size: '28', inStock: true },
      { id: 'v-2', size: '30', inStock: true },
    ],
  },
  {
    id: 'prod-req-2',
    name: 'KV Boys Navy Trousers',
    category: 'Uniform',
    categorySlug: 'uniform',
    descriptor: 'Navy Blue',
    description: 'Uniform trousers with pleats',
    pricePaise: 65000,
    required: true,
    official: true,
    needsDetails: false,
    sizes: [
      { id: 'v-3', size: '28', inStock: true },
    ],
  },
  {
    id: 'prod-req-oos',
    name: 'KV Leather Belt',
    category: 'Uniform Accessories',
    categorySlug: 'uniform-accessories',
    descriptor: 'Adjustable',
    description: 'Leather school belt',
    pricePaise: 18000,
    required: true,
    official: true,
    needsDetails: false,
    sizes: [
      { id: 'v-4', size: 'M', inStock: false },
    ],
  },
  {
    id: 'prod-opt-1',
    name: 'KV School Monogram Tie',
    category: 'Uniform Accessories',
    categorySlug: 'uniform-accessories',
    descriptor: 'Standard',
    description: 'Woven monogram tie',
    pricePaise: 12000,
    required: false,
    official: true,
    needsDetails: false,
    sizes: [
      { id: 'v-5', size: 'Standard', inStock: true },
    ],
  },
];

vi.mock('../data/catalog', () => ({
  useStoreSchools: () => ({
    data: mockSchools,
    isLoading: false,
    isSuccess: true,
  }),
  useStoreProducts: () => ({
    data: mockProducts,
    isLoading: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
}));

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: null,
  }),
}));

function renderFlowPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/flow?school=sch-1&class=cls-4&gender=boy&step=4']}>
        <SelectionFlowPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SelectionFlowPage Parent Uniform Checklist tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.clearCart();
    storeState.setSelection({
      schoolId: 'sch-1',
      schoolName: 'Kendriya Vidyalaya Surat',
      cityId: 'city-1',
      gradeId: 'cls-4',
      gradeName: 'Class 1',
      gender: 'boy',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the Parent Uniform Checklist with progress and status badges for required items', () => {
    renderFlowPage();

    // Checklist heading
    expect(screen.getByText('Uniform checklist')).toBeDefined();

    // Initial progress text: 0 of 3 required items in bag
    expect(screen.getByText(/0 of 3 required items in bag/i)).toBeDefined();

    // Required items names in checklist
    expect(screen.getAllByText('KV Boys Half Sleeve Shirt').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('KV Boys Navy Trousers').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('KV Leather Belt').length).toBeGreaterThanOrEqual(1);

    // Out of stock required item shows 'Out of stock in your city'
    expect(screen.getByText('Out of stock in your city')).toBeDefined();

    // In-stock missing items show 'Missing'
    const missingBadges = screen.getAllByText('Missing');
    expect(missingBadges.length).toBe(2);
  });

  it('updates checklist progress and badges immediately when item is added to the bag', async () => {
    renderFlowPage();

    // Add first required item to bag
    act(() => {
      storeState.addItem({
        productId: 'prod-req-1',
        variantId: 'v-1',
        name: 'KV Boys Half Sleeve Shirt',
        category: 'Uniform',
        pricePaise: 45000,
        size: '28',
        quantity: 1,
        schoolId: 'sch-1',
      });
    });

    // Progress updates to: 1 of 3 required items in bag
    expect(screen.getByText(/1 of 3 required items in bag/i)).toBeDefined();
    expect(screen.getByText('In bag')).toBeDefined();

    // Add second required item
    act(() => {
      storeState.addItem({
        productId: 'prod-req-2',
        variantId: 'v-3',
        name: 'KV Boys Navy Trousers',
        category: 'Uniform',
        pricePaise: 65000,
        size: '28',
        quantity: 1,
        schoolId: 'sch-1',
      });
    });

    // Progress updates to: 2 of 3 required items in bag
    expect(screen.getByText(/2 of 3 required items in bag/i)).toBeDefined();
  });

  it('renders Add remaining required items button and triggers full set sheet', () => {
    renderFlowPage();

    const addRemainingBtn = screen.getByRole('button', { name: /Add remaining required items/i });
    expect(addRemainingBtn).toBeDefined();

    fireEvent.click(addRemainingBtn);

    // Full set sheet dialog opens
    expect(screen.getByRole('dialog', { name: /Full uniform set/i })).toBeDefined();
  });
});
