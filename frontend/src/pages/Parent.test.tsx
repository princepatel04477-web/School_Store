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

function renderParent(initialRoute = '/parent', queryClient = createTestQueryClient()) {
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

describe('Parent Dashboard & Orders data loading states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Dashboard: Student loading behaviour', () => {
    it('shows skeleton loader while student data is loading and never displays invented children', async () => {
      // API call stays pending
      vi.spyOn(apiModule, 'api').mockImplementation(() => new Promise(() => {}));

      renderParent('/parent');

      expect(screen.getByRole('status', { name: /loading student records/i })).toBeDefined();
      // Verify invented children are NOT present
      expect(screen.queryByText('Aarav Patel')).toBeNull();
      expect(screen.queryByText('Diya Patel')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('displays distinct error state with accessible retry on initial load failure without showing invented children', async () => {
      const apiSpy = vi.spyOn(apiModule, 'api').mockRejectedValue(new Error('Network error / 500 outage'));

      renderParent('/parent');

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
      });

      // Verify the error message and retry button
      expect(screen.getByText(/could not load student records/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /try again/i })).toBeDefined();

      // Crucial requirement: outage cannot display invented fallback children
      expect(screen.queryByText('Aarav Patel')).toBeNull();
      expect(screen.queryByText('Diya Patel')).toBeNull();
      expect(screen.queryByText(/no children linked/i)).toBeNull();
    });

    it('restores real student data when retry action is clicked after an outage', async () => {
      let fail = true;
      vi.spyOn(apiModule, 'api').mockImplementation((path: string) => {
        if (path === '/students/') {
          if (fail) return Promise.reject(new Error('Outage'));
          return Promise.resolve({
            results: [
              {
                id: 'real-child-101',
                name: 'Kavya Sharma',
                gr_number: 'GR-9901',
                grade_name: '6',
                class_name: '6',
                section: 'A',
                gender: 'Female',
                school_name: 'Delhi Public School',
              },
            ],
          });
        }
        return Promise.resolve({ results: [] });
      });

      renderParent('/parent');

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
      });

      // Server recovers
      fail = false;

      const retryBtn = screen.getByRole('button', { name: /try again/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getAllByText('Kavya Sharma').length).toBeGreaterThanOrEqual(1);
      });

      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText('GR-9901')).toBeDefined();
      expect(screen.getByText('Delhi Public School')).toBeDefined();
    });

    it('displays genuine empty state with helpful next steps when parent has no linked children', async () => {
      vi.spyOn(apiModule, 'api').mockResolvedValue({ results: [] });

      renderParent('/parent');

      await waitFor(() => {
        expect(screen.getByText(/no children linked to this mobile number/i)).toBeDefined();
      });

      // Verify helpful next actions
      expect(screen.getByRole('button', { name: /link a child/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /browse catalogue/i })).toBeDefined();
      expect(screen.getByText(/contact your school to correct this/i)).toBeDefined();

      // Never shows fallback/invented kids
      expect(screen.queryByText('Aarav Patel')).toBeNull();
      expect(screen.queryByText('Diya Patel')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('reconciles selected child to first real child and updates when selection or child list changes', async () => {
      const realKids = [
        {
          id: 'child-aaa',
          name: 'Ishaan Verma',
          gr_number: 'GR-1111',
          grade_name: '3',
          class_name: '3',
          section: 'C',
          gender: 'Male',
          school_name: 'National Public School',
        },
        {
          id: 'child-bbb',
          name: 'Ananya Verma',
          gr_number: 'GR-2222',
          grade_name: '7',
          class_name: '7',
          section: 'B',
          gender: 'Female',
          school_name: 'National Public School',
        },
      ];

      vi.spyOn(apiModule, 'api').mockResolvedValue({ results: realKids });

      renderParent('/parent');

      // First child is automatically selected
      await waitFor(() => {
        expect(screen.getAllByText('Ishaan Verma').length).toBeGreaterThanOrEqual(1);
      });

      const profileName = screen.getByRole('heading', { level: 3, name: 'Ishaan Verma' });
      expect(profileName).toBeDefined();
      expect(screen.getByText('GR-1111')).toBeDefined();

      // Click second child
      const secondKidBtn = screen.getByRole('button', { name: /Ananya Verma/i });
      fireEvent.click(secondKidBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 3, name: 'Ananya Verma' })).toBeDefined();
      });
      expect(screen.getByText('GR-2222')).toBeDefined();
    });

    it('retains useful previously loaded children and selected child during a refresh failure, showing a retry banner', async () => {
      const qc = createTestQueryClient();
      let fail = false;
      vi.spyOn(apiModule, 'api').mockImplementation((path: string) => {
        if (path === '/students/') {
          if (fail) return Promise.reject(new Error('Outage on refresh'));
          return Promise.resolve({
            results: [
              {
                id: 'child-persistent',
                name: 'Reyansh Gupta',
                gr_number: 'GR-7788',
                grade_name: '4',
                class_name: '4',
                section: 'A',
                gender: 'Male',
                school_name: 'DPS Surat',
              },
            ],
          });
        }
        return Promise.resolve({ results: [] });
      });

      renderParent('/parent', qc);

      await waitFor(() => {
        expect(screen.getAllByText('Reyansh Gupta').length).toBeGreaterThanOrEqual(1);
      });

      // Now trigger a refresh failure
      fail = true;
      await qc.refetchQueries({ queryKey: ['parent-students'] });

      await waitFor(() => {
        expect(screen.getByText(/could not refresh student records\. showing saved details\./i)).toBeDefined();
      });

      // Crucial: retains previously loaded child and selection!
      expect(screen.getAllByText('Reyansh Gupta').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('GR-7788')).toBeDefined();
      // Has retry button on banner
      expect(screen.getByRole('button', { name: /try again/i })).toBeDefined();
    });
  });

  describe('Orders: Loading and outage behaviour', () => {
    it('shows skeleton loader while orders are loading and does not display "No orders yet"', async () => {
      vi.spyOn(apiModule, 'api').mockImplementation(() => new Promise(() => {}));

      renderParent('/parent/orders');

      expect(screen.getByRole('status', { name: /loading your orders/i })).toBeDefined();
      expect(screen.queryByText(/no orders yet/i)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows distinct error alert with retry button on orders load outage and never displays "No orders yet"', async () => {
      vi.spyOn(apiModule, 'api').mockRejectedValue(new Error('500 server error'));

      renderParent('/parent/orders');

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
      });

      expect(screen.getByText(/could not load your orders right now/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /try again/i })).toBeDefined();
      // Crucial: an outage cannot look like no orders exist!
      expect(screen.queryByText(/no orders yet/i)).toBeNull();
    });

    it('displays genuine empty orders view when order list is successfully empty', async () => {
      vi.spyOn(apiModule, 'api').mockResolvedValue({ results: [] });

      renderParent('/parent/orders');

      await waitFor(() => {
        expect(screen.getByText(/no orders yet/i)).toBeDefined();
      });

      expect(screen.getByText(/your orders and live delivery timeline will appear here/i)).toBeDefined();
      expect(screen.getByRole('link', { name: /browse catalogue/i })).toBeDefined();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('retains previously loaded orders during a refresh failure, showing a retry banner', async () => {
      const qc = createTestQueryClient();
      let fail = false;
      vi.spyOn(apiModule, 'api').mockImplementation((path: string) => {
        if (path === '/orders/') {
          if (fail) return Promise.reject(new Error('Refresh outage'));
          return Promise.resolve({
            results: [
              {
                id: 'order-123',
                order_number: 'ORD-2026-999',
                student_name: 'Aarav Sharma',
                status: 'CONFIRMED',
                payment_status: 'PAID',
                total: 1250,
                created_at: new Date().toISOString(),
              },
            ],
          });
        }
        return Promise.resolve({ results: [] });
      });

      renderParent('/parent/orders', qc);

      await waitFor(() => {
        expect(screen.getByText('ORD-2026-999')).toBeDefined();
      });

      // Now fail on refetch
      fail = true;
      await qc.refetchQueries({ queryKey: ['orders'] });

      await waitFor(() => {
        expect(screen.getByText(/could not refresh orders\. showing previously loaded orders\./i)).toBeDefined();
      });

      // Preserves existing orders
      expect(screen.getByText('ORD-2026-999')).toBeDefined();
      expect(screen.queryByText(/no orders yet/i)).toBeNull();
    });
  });
});
