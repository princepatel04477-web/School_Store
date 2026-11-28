// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountPage } from './AccountPage';
import { setLang } from '../i18n';
import type { User } from '../api';
import type { ParentOrder } from '../data/orders';

// jsdom does not implement matchMedia or IntersectionObserver
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
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

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

let mockUser: User | null = {
  id: 'u1',
  username: 'parent_rahul',
  role: 'PARENT',
  first_name: 'Rahul',
  last_name: 'Patel',
  phone: '9876543210',
};
let mockAuthLoading = false;
const mockClearSession = vi.fn();

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: mockAuthLoading,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithOtp: vi.fn(),
    signOut: vi.fn(),
    clearSession: mockClearSession,
  }),
}));

const mockSetSelection = vi.fn();
vi.mock('../store/storeState', () => ({
  useStoreState: () => ({
    cart: [],
    selection: null,
    totalCount: 2,
    subtotalPaise: 0,
    setSelection: mockSetSelection,
  }),
}));

const mockApi = vi.fn();
vi.mock('../api', async () => {
  const actual = await vi.importActual('../api');
  return {
    ...actual,
    api: (...args: unknown[]) => mockApi(...args),
  };
});

function renderAccountPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleOrders: ParentOrder[] = [
  {
    id: 'ord-1',
    order_number: 'SS-1001',
    student_name: 'Aarav Patel',
    status: 'DISPATCHED',
    payment_status: 'PENDING',
    fulfillment_type: 'HOME_DELIVERY',
    payment_method: 'COD',
    total: '1250.00',
    created_at: '2026-11-20T10:00:00Z',
  },
  {
    id: 'ord-2',
    order_number: 'SS-1000',
    student_name: 'Diya Patel',
    status: 'DELIVERED',
    payment_status: 'PAID',
    fulfillment_type: 'SCHOOL_PICKUP',
    payment_method: 'ONLINE',
    total: '850.00',
    created_at: '2026-11-10T09:00:00Z',
  },
];

describe('AccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLang('en');
    mockAuthLoading = false;
    mockUser = {
      id: 'u1',
      username: 'parent_rahul',
      role: 'PARENT',
      first_name: 'Rahul',
      last_name: 'Patel',
      phone: '9876543210',
    };
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/orders/') return { next: null, previous: null, results: sampleOrders };
      if (path === '/orders/ord-1/') {
        return {
          ...sampleOrders[0],
          items: [
            {
              id: 'item-1',
              variant: 'v1',
              variant_sku: 'SHIRT-30',
              variant_size: '30',
              product_name: 'Summer Shirt',
              category: 'Uniform',
              quantity: 2,
              unit_price_snapshot: '625.00',
            },
          ],
          status_events: [
            { id: 'e1', status: 'PLACED', timestamp: '2026-11-20T10:00:00Z' },
            { id: 'e2', status: 'PACKED', timestamp: '2026-11-21T10:00:00Z' },
            { id: 'e3', status: 'DISPATCHED', timestamp: '2026-11-22T10:00:00Z' },
          ],
        };
      }
      if (path === '/students/') return { results: [] };
      return {};
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders greeting, masked mobile, and orders from mocked API', async () => {
    renderAccountPage();

    expect(screen.getByText(/••••• 43210/)).toBeTruthy();
    expect(screen.getAllByText('Rahul Patel').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText('Order #SS-1001')).toBeTruthy();
    });
    expect(screen.getByText('Order #SS-1000')).toBeTruthy();
    expect(screen.getByText(/Home delivery/)).toBeTruthy();
    expect(screen.getByText(/Collect at school/)).toBeTruthy();

    // Expand first order to load items
    const seeItemsButtons = screen.getAllByRole('button', { name: 'See items' });
    fireEvent.click(seeItemsButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Summer Shirt')).toBeTruthy();
    });
    expect(screen.getByText(/Size 30/)).toBeTruthy();
  });

  it('matches progress steps to order status', async () => {
    renderAccountPage();

    await waitFor(() => {
      expect(screen.getByText('Order #SS-1001')).toBeTruthy();
    });

    const lists = screen.getAllByRole('list');
    // First order is DISPATCHED -> step 0 (Placed) & 1 (Packed) are is-done, step 2 (On the way) is is-current, step 3 (Delivered) is neither
    const firstSteps = lists[0].querySelectorAll('.acct-step');
    expect(firstSteps[0].classList.contains('is-done')).toBe(true);
    expect(firstSteps[1].classList.contains('is-done')).toBe(true);
    expect(firstSteps[2].classList.contains('is-current')).toBe(true);
    expect(firstSteps[3].classList.contains('is-done')).toBe(false);
    expect(firstSteps[3].classList.contains('is-current')).toBe(false);

    // Second order is DELIVERED -> all 4 steps are is-done
    const secondSteps = lists[1].querySelectorAll('.acct-step');
    expect(Array.from(secondSteps).every((el) => el.classList.contains('is-done'))).toBe(true);
  });

  it('renders empty state when there are no orders', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/orders/') return { next: null, previous: null, results: [] };
      if (path === '/students/') return { results: [] };
      return {};
    });

    renderAccountPage();

    await waitFor(() => {
      expect(screen.getByText('No orders yet')).toBeTruthy();
    });
    const shopLink = screen.getByRole('link', { name: /Shop school uniform/i });
    expect(shopLink.getAttribute('href')).toBe('/shop');
  });

  it('renders error state with retry when orders API fails', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/orders/') throw new Error('Network error');
      if (path === '/students/') return { results: [] };
      return {};
    });

    renderAccountPage();

    await waitFor(() => {
      expect(screen.getByText('Check your internet and try again.')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows the sign-in choice when signed out', async () => {
    mockUser = null;
    renderAccountPage();

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    expect(screen.getByText('Sign in with mobile OTP')).toBeTruthy();
    expect(screen.getByText('Create account with user ID and password')).toBeTruthy();
  });

  it('renders in English, Gujarati, and Hindi', async () => {
    setLang('gu');
    const { unmount } = renderAccountPage();
    await waitFor(() => {
      expect(screen.getByText('મારા ઓર્ડર')).toBeTruthy();
    });
    expect(screen.getByText(/નમસ્તે/)).toBeTruthy();
    unmount();

    setLang('hi');
    renderAccountPage();
    await waitFor(() => {
      expect(screen.getByText('मेरे ऑर्डर')).toBeTruthy();
    });
    expect(screen.getByText(/नमस्ते/)).toBeTruthy();
  });
});
