// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ParentLanding, INACTIVE_ORDER_STATUSES } from './ParentLanding';
import { mapRosterClassToSeedClass, normalizeClassString } from './classNormalizer';
import { parentChildren, api } from '../../api';
import { setLang } from '../../i18n';
import { storeState } from '../../store/storeState';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api', async () => {
  const actual = await vi.importActual('../../api');
  return {
    ...actual,
    parentChildren: {
      list: vi.fn(),
      claim: vi.fn(),
      schools: vi.fn(),
    },
    api: vi.fn(),
    deleteChildPhotos: vi.fn(),
  };
});

const mockSchools = [
  {
    id: 'sch-dps',
    name: 'Delhi Public School',
    code: 'DPS',
    city: 'Surat',
    homeDelivery: true,
    schoolPickup: true,
  },
];

vi.mock('../../data/catalog', () => ({
  useStoreSchools: () => ({ data: mockSchools, isLoading: false }),
}));

function renderParentLanding() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ParentLanding />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Prompt 3: Parent Landing Page & Class Normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLang('en');
    localStorage.clear();
    sessionStorage.clear();
    storeState.clearCart();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Class name normalization', () => {
    it('normalizes various roster spellings ("V", "5th", "Class 5") to canonical "Class 5"', () => {
      expect(normalizeClassString('V')).toBe('Class 5');
      expect(normalizeClassString('5th')).toBe('Class 5');
      expect(normalizeClassString('Class 5')).toBe('Class 5');
      expect(normalizeClassString('5')).toBe('Class 5');
      expect(normalizeClassString('Grade 5')).toBe('Class 5');

      const mapped1 = mapRosterClassToSeedClass('V');
      const mapped2 = mapRosterClassToSeedClass('5th');
      const mapped3 = mapRosterClassToSeedClass('Class 5');

      expect(mapped1?.name).toBe('Class 5');
      expect(mapped2?.name).toBe('Class 5');
      expect(mapped3?.name).toBe('Class 5');
    });

    it('normalizes pre-primary and kindergarten aliases', () => {
      expect(normalizeClassString('Jr KG')).toBe('Junior KG');
      expect(normalizeClassString('LKG')).toBe('Junior KG');
      expect(normalizeClassString('Sr KG')).toBe('Senior KG');
      expect(normalizeClassString('UKG')).toBe('Senior KG');
      expect(normalizeClassString('Nursery')).toBe('Nursery');
    });
  });

  describe('ParentLanding Acceptance Scenarios', () => {
    it('(a) active order present -> order card leads the page', async () => {
      (parentChildren.list as any).mockResolvedValueOnce({
        results: [
          {
            id: 'c1',
            name: 'Rohan Sharma',
            gr_number: 'GR-101',
            class_name: 'Class 5',
            section: 'A',
            gender: 'MALE',
            school: 'sch-dps',
            school_name: 'Delhi Public School',
            active: true,
          },
        ],
      });

      (api as any).mockResolvedValueOnce({
        results: [
          {
            id: 'ord-1',
            order_number: 'ORD-999',
            student: 'c1',
            status: 'PROCESSING',
            payment_status: 'PAID',
            total: '1200.00',
            created_at: new Date().toISOString(),
          },
        ],
      });

      renderParentLanding();

      await waitFor(() => {
        expect(screen.getByText('Order in progress')).toBeTruthy();
        expect(screen.getByText('Order #ORD-999')).toBeTruthy();
        // Readable labels, not raw status codes
        expect(screen.getByText('Processing')).toBeTruthy();
        expect(screen.getByText('Paid')).toBeTruthy();
        // The card opens this order's detail
        expect(screen.getByText('View in My Orders').closest('a')?.getAttribute('href')).toBe('/parent/orders/ord-1');
        // A parent can reach their orders and sign out from the account page
        expect(screen.getByRole('link', { name: 'My orders' }).getAttribute('href')).toBe('/parent/orders');
        expect(screen.getByRole('button', { name: /Sign out/ })).toBeTruthy();
      });
    });

    it('(b) no active order, one child -> "Shop for <child>" link with right school, class, branch in selection and URL', async () => {
      (parentChildren.list as any).mockResolvedValueOnce({
        results: [
          {
            id: 'c1',
            name: 'Ananya Mehta',
            gr_number: 'GR-202',
            grade_name: '5th',
            section: 'B',
            gender: 'FEMALE',
            school: 'sch-dps',
            school_name: 'Delhi Public School',
            school_code: 'DPS',
            branch: 'br-city',
            branch_name: 'City Campus',
            city: 'Surat',
            active: true,
          },
        ],
      });

      // No active orders (either empty or only DELIVERED)
      (api as any).mockResolvedValueOnce({
        results: [
          {
            id: 'ord-old',
            order_number: 'ORD-OLD',
            student: 'c1',
            status: 'DELIVERED',
            payment_status: 'PAID',
          },
        ],
      });

      renderParentLanding();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Shop for Ananya Mehta' })).toBeTruthy();
        expect(screen.queryByText('Order in progress')).toBeNull();
      });

      // Click "Shop for Ananya Mehta"
      fireEvent.click(screen.getByRole('button', { name: 'Shop for Ananya Mehta' }));

      // Check navigation
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringMatching(/\/flow\?school=sch-dps&class=.*&gender=girl&step=3/)
      );

      // Check in-memory selection
      const sel = storeState.getSelection();
      expect(sel?.schoolId).toBe('sch-dps');
      expect(sel?.branchId).toBe('br-city');
      expect(sel?.branchName).toBe('City Campus');
      expect(sel?.gender).toBe('girl');
      expect(sel?.gradeName).toBe('Class 5');
    });

    it('(c) no children -> offers "Find your school" and "Add your child"', async () => {
      (parentChildren.list as any).mockResolvedValueOnce({ results: [] });
      (api as any).mockResolvedValueOnce({ results: [] });

      renderParentLanding();

      await waitFor(() => {
        expect(screen.getByText('No children linked yet')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Find your school' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add your child' })).toBeTruthy();
      });
    });

    it('(d) two children -> child switcher chips allow switching the card and details', async () => {
      (parentChildren.list as any).mockResolvedValueOnce({
        results: [
          {
            id: 'c1',
            name: 'Kabir Verma',
            gr_number: 'GR-301',
            class_name: 'Class 4',
            section: 'A',
            gender: 'MALE',
            school: 'sch-dps',
            school_name: 'Delhi Public School',
            active: true,
          },
          {
            id: 'c2',
            name: 'Tara Verma',
            gr_number: 'GR-302',
            class_name: 'Class 7',
            section: 'C',
            gender: 'FEMALE',
            school: 'sch-dps',
            school_name: 'Delhi Public School',
            active: true,
          },
        ],
      });
      (api as any).mockResolvedValueOnce({ results: [] });

      renderParentLanding();

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Kabir Verma' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Tara Verma' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Shop for Kabir Verma' })).toBeTruthy();
        expect(screen.getByText('GR-301')).toBeTruthy();
      });

      // Switch to Tara
      fireEvent.click(screen.getByRole('tab', { name: 'Tara Verma' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Shop for Tara Verma' })).toBeTruthy();
        expect(screen.getByText('GR-302')).toBeTruthy();
      });
    });

    it('(e) children request fails -> displays error message with retry button, never invented names', async () => {
      (parentChildren.list as any).mockRejectedValueOnce(new Error('Network failure'));
      (api as any).mockResolvedValueOnce({ results: [] });

      renderParentLanding();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('Could not load your account')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
        // Never invented names
        expect(screen.queryByText('Aarav Patel')).toBeNull();
        expect(screen.queryByText('Diya Patel')).toBeNull();
      });
    });

    it('(f) fresh mount does not restore child choice or bag from storage', () => {
      expect(storeState.getCart()).toEqual([]);
      expect(localStorage.getItem('schoolstore_cart')).toBeNull();
      expect(sessionStorage.getItem('selected_child')).toBeNull();
    });
  });
});
