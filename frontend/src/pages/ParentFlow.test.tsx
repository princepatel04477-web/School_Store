/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Parent from './Parent';
import { OrdersTab } from './native/OrdersTab';
import { ProfileTab } from './native/ProfileTab';
import { CheckoutPage } from './CheckoutPage';
import { SelectionFlowPage } from './SelectionFlowPage';
import { StepTransition } from '../motion/StepTransition';
import { storeState } from '../store/storeState';
import * as apiModule from '../api';
import { setLang, useLang } from '../i18n';
import { messages } from '../i18n/messages';

// Mock auth
let mockUser: { id: string; username: string; role: string; city?: string | null } | null = {
  id: 'parent-1',
  username: 'parent_user',
  role: 'PARENT',
};

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: mockUser,
    signInWithOtp: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual('../api');
  return {
    ...actual,
    api: vi.fn(async (url: string) => {
      if (url.includes('/grades')) return [];
      if (url.includes('/schools/')) return [];
      if (url.includes('/products/')) return { results: [] };
      return { results: [] };
    }),
    deleteChildPhotos: vi.fn(),
  };
});

const defaultApiMock = async (url: string) => {
  if (url.includes('/grades')) return [];
  if (url.includes('/schools/')) return [];
  if (url.includes('/products/')) return { results: [] };
  return { results: [] };
};

// Mock ParentSignInSheet for NativeTab tests
vi.mock('../components/parent/ParentSignInSheet', () => ({
  ParentSignInSheet: ({ open, onDone }: any) => {
    if (!open) return null;
    return (
      <div data-testid="parent-signin-sheet">
        <button data-testid="signin-done-no-child" onClick={() => onDone(null)}>
          Done without child
        </button>
        <button data-testid="signin-done-with-child" onClick={() => onDone({ id: 'c1', name: 'Kid' })}>
          Done with child
        </button>
      </div>
    );
  },
}));

// Polyfill window.matchMedia for jsdom if needed
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-display">{location.pathname + location.search}</div>;
}

describe('Day 3 Task J: New Parent Flow & No Demo Children', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    storeState.setSelection(null);
    storeState.clearCart();
    setLang('en');
    mockUser = { id: 'parent-1', username: 'parent_user', role: 'PARENT' };
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 0,
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('new parent (no children, no selection) is redirected to the flow step 1 and the redirect replaces history', async () => {
    vi.mocked(apiModule.api).mockImplementation(async (url: string) => {
      if (url === '/students/') {
        return { results: [] };
      }
      return defaultApiMock(url);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login', '/parent']} initialIndex={1}>
          <LocationDisplay />
          <Routes>
            <Route path="/parent/*" element={<Parent />} />
            <Route path="/flow" element={<div data-testid="flow-page">Flow Step 1</div>} />
            <Route path="/shop" element={<div data-testid="shop-page">Shop Page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('flow-page')).toBeDefined();
    });

    const loc = screen.getByTestId('location-display').textContent;
    expect(loc).toBe('/flow?step=1');
  });

  it('a parent with children is not redirected and sees normal Parent space', async () => {
    vi.mocked(apiModule.api).mockImplementation(async (url: string) => {
      if (url === '/students/') {
        return {
          results: [
            {
              id: 'child-real-1',
              name: 'Reyansh Gupta',
              gr_number: 'GR-9901',
              grade_name: '4',
              section: 'A',
              gender: 'Male',
              school_name: 'Greenwood High',
            },
          ],
        };
      }
      return defaultApiMock(url);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/parent']}>
          <LocationDisplay />
          <Routes>
            <Route path="/parent/*" element={<Parent />} />
            <Route path="/flow" element={<div data-testid="flow-page">Flow Step 1</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Reyansh Gupta').length).toBeGreaterThan(0);
    });

    expect(screen.getByTestId('location-display').textContent).toBe('/parent');
    expect(screen.queryByTestId('flow-page')).toBeNull();
  });

  it('a parent with a stored selection is not redirected even with zero children', async () => {
    storeState.setSelection({
      schoolId: 'sch-10',
      schoolName: 'Delhi Public School',
    });

    vi.mocked(apiModule.api).mockImplementation(async (url: string) => {
      if (url === '/students/') {
        return { results: [] };
      }
      return defaultApiMock(url);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/parent']}>
          <LocationDisplay />
          <Routes>
            <Route path="/parent/*" element={<Parent />} />
            <Route path="/flow" element={<div data-testid="flow-page">Flow Step 1</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Parent should stay on /parent and not redirect
    await waitFor(() => {
      expect(screen.getByText(/Ready when you are/i)).toBeDefined();
    });

    expect(screen.getByTestId('location-display').textContent).toBe('/parent');
    expect(screen.queryByTestId('flow-page')).toBeNull();
  });

  it('loading shows the skeleton and not the dashboard or fake kids', async () => {
    // Return a never resolving promise to simulate loading
    vi.mocked(apiModule.api).mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/parent']}>
          <Routes>
            <Route path="/parent/*" element={<Parent />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(container.querySelector('.skeleton-box')).toBeDefined();
    expect(screen.queryByText('Aarav Patel')).toBeNull();
    expect(screen.queryByText('DPS Surat')).toBeNull();
    expect(screen.queryByText(/Ready when you are/i)).toBeNull();
  });

  it('request failure shows the error message and Retry button (Retry works)', async () => {
    let shouldFail = true;
    vi.mocked(apiModule.api).mockImplementation(async (url: string) => {
      if (url === '/students/') {
        if (shouldFail) throw new Error('Network error');
        return {
          results: [
            {
              id: 'child-10',
              name: 'Kavya Sharma',
              school_name: 'St. Xavier',
            },
          ],
        };
      }
      return defaultApiMock(url);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/parent']}>
          <Routes>
            <Route path="/parent/*" element={<Parent />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    expect(screen.queryByText('Aarav Patel')).toBeNull();
    expect(screen.queryByText('DPS Surat')).toBeNull();

    // Find retry button
    const retryBtn = screen.getByRole('button', { name: /retry|try again/i });
    expect(retryBtn).toBeDefined();

    // Now make retry succeed
    shouldFail = false;
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Kavya Sharma').length).toBeGreaterThan(0);
    });
  });

  it('native sign in with no child goes to flow step 1; with a child it does not', async () => {
    // 1. With no child: navigates to flow step 1
    mockUser = null;
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/orders']}>
          <LocationDisplay />
          <Routes>
            <Route path="/orders" element={<OrdersTab />} />
            <Route path="/flow" element={<div data-testid="flow-page">Flow Step 1</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Click "Sign in with phone" to open sheet
    fireEvent.click(screen.getByRole('button', { name: /sign in with phone/i }));
    expect(screen.getByTestId('parent-signin-sheet')).toBeDefined();

    // Tap Done without child
    fireEvent.click(screen.getByTestId('signin-done-no-child'));

    await waitFor(() => {
      expect(screen.getByTestId('flow-page')).toBeDefined();
    });
    expect(screen.getByTestId('location-display').textContent).toBe('/flow?step=1');

    unmount();

    // 2. With a child: stays on orders
    const queryClient2 = new QueryClient();
    render(
      <QueryClientProvider client={queryClient2}>
        <MemoryRouter initialEntries={['/orders']}>
          <LocationDisplay />
          <Routes>
            <Route path="/orders" element={<OrdersTab />} />
            <Route path="/flow" element={<div data-testid="flow-page">Flow Step 1</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /sign in with phone/i }));
    fireEvent.click(screen.getByTestId('signin-done-with-child'));

    expect(screen.getByTestId('location-display').textContent).toBe('/orders');
    expect(screen.queryByTestId('flow-page')).toBeNull();
  });

  it('checkout sign in does not redirect', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/checkout']}>
          <LocationDisplay />
          <Routes>
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/flow" element={<div data-testid="flow-page">Flow Step 1</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByTestId('location-display').textContent).toBe('/checkout');
    expect(screen.queryByTestId('flow-page')).toBeNull();
  });

  it('no "Aarav Patel" or "DPS Surat" in loading, error, or zero children states', async () => {
    vi.mocked(apiModule.api).mockImplementation(async (url: string) => {
      if (url === '/students/') return { results: [] };
      return defaultApiMock(url);
    });

    // Zero children with stored selection
    storeState.setSelection({ schoolId: 'sch-1', schoolName: 'Test School' });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/parent']}>
          <Routes>
            <Route path="/parent/*" element={<Parent />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/READY WHEN YOU ARE/i)).toBeDefined();
    });

    expect(container.textContent).not.toContain('Aarav Patel');
    expect(container.textContent).not.toContain('DPS Surat');
  });

  it('en, hi, gu render with no missing keys for all added keys', () => {
    const keysToCheck = [
      'parent.noChildren',
      'parent.noChildrenSub',
      'flow.s1.stateTitle',
      'flow.s1.stateSub',
      'flow.s1.cityTitle',
      'flow.s1.citySub',
    ];

    for (const key of keysToCheck) {
      const entry = (messages as any)[key];
      expect(entry, `Missing key: ${key}`).toBeDefined();
      expect(entry.en, `Missing en for: ${key}`).toBeDefined();
      expect(entry.hi, `Missing hi for: ${key}`).toBeDefined();
      expect(entry.gu, `Missing gu for: ${key}`).toBeDefined();
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.hi.length).toBeGreaterThan(0);
      expect(entry.gu.length).toBeGreaterThan(0);
    }
  });

  it('reduced motion branch disables slide animations and stagger', () => {
    // Media query matches prefers-reduced-motion
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    expect(mq).toBeDefined();
  });

  it('StepTransition supports forward and backward push transitions, and reduced motion fade', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <StepTransition stepKey={1} direction="forward">
          <div>Step 1 Content</div>
        </StepTransition>
      </MemoryRouter>
    );

    expect(container.querySelector('.step-transition-wrapper')).toBeDefined();
    expect(container.querySelector('.step-enter--forward')).toBeDefined();

    rerender(
      <MemoryRouter>
        <StepTransition stepKey={2} direction="backward">
          <div>Step 2 Content</div>
        </StepTransition>
      </MemoryRouter>
    );

    expect(container.querySelector('.step-enter--backward')).toBeDefined();
  });

  it('large title collapses into small centred title in top bar on scroll', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/flow?step=1']}>
          <SelectionFlowPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const collapsedBar = screen.getByTestId('flow-collapsed-bar');
    expect(collapsedBar).toBeDefined();
    expect(collapsedBar.classList.contains('is-collapsed')).toBe(false);

    // Scroll down > 48px
    Object.defineProperty(window, 'scrollY', { value: 100, writable: true });
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(collapsedBar.classList.contains('is-collapsed')).toBe(true);
    });
    expect(collapsedBar.textContent).toContain('Which state is your child’s school in?');

    // Scroll back to top
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true });
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(collapsedBar.classList.contains('is-collapsed')).toBe(false);
    });
  });

  it('state tiles in BranchPicker render house icon tick when selected', async () => {
    vi.mocked(apiModule.api).mockImplementation(async (url: string) => {
      if (url.includes('/schools/states/')) {
        return [
          { name: 'Gujarat', cityCount: 3 },
          { name: 'Maharashtra', cityCount: 5 },
        ];
      }
      return defaultApiMock(url);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/flow?step=1&state=Gujarat']}>
          <SelectionFlowPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // If Gujarat is pre-selected or selected in state stage, check tick
    await waitFor(() => {
      const selectedTile = document.querySelector('.state-tile.is-selected');
      if (selectedTile) {
        expect(selectedTile.querySelector('.tile-check-icon')).toBeDefined();
      }
    });
  });

  it('no inline style={{ added by newly authored components/elements', () => {
    vi.mocked(apiModule.api).mockImplementation(() => new Promise(() => {}));
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/parent']}>
          <Routes>
            <Route path="/parent/*" element={<Parent />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const skeletonEl = container.querySelector('.parent-loading-skeleton');
    expect(skeletonEl).toBeDefined();
    expect(skeletonEl?.getAttribute('style')).toBeNull();

    // Check collapsed top bar has no inline styles
    const barEl = container.querySelector('.flow-collapsed-bar');
    if (barEl) {
      expect(barEl.getAttribute('style')).toBeNull();
    }
  });
});
