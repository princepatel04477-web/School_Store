// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CityAdmin from './CityAdmin';
import { cityAdmin } from '../api';

const mockUser = {
  current: {
    id: 'user-admin-surat',
    username: 'admin_surat',
    role: 'ADMIN',
    city: 'city-surat-uuid',
    city_name: 'Surat',
  } as any,
  loading: false,
};

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: mockUser.current,
    loading: mockUser.loading,
    signOut: vi.fn(),
  }),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual('../api');
  return {
    ...actual,
    cityAdmin: {
      dailySales: vi.fn().mockResolvedValue({
        date: '2026-11-22',
        city_id: 'city-surat-uuid',
        city_code: 'SUR',
        city_name: 'Surat',
        totals: { orders: 0, units: 0, revenue: { paise: 0, inr: 0, formatted: '₹0.00' } },
        categories: [],
        schools: [],
      }),
      stockBalances: vi.fn().mockResolvedValue({
        count: 2,
        next: null,
        previous: null,
        results: [
          {
            id: 'bal-1',
            city: 'city-surat-uuid',
            variant: 'var-1',
            variant_sku: 'SHOE-BLK-UK2',
            product_name: 'Black School Shoes',
            product_category: 'Footwear',
            product_type: null,
            variant_size: 'UK-2',
            stock_quantity: 4,
            low_stock_threshold: 20,
            is_low_stock: true,
            severity: 'CRITICAL',
            affected_orders_count: 3,
            updated_at: '2026-11-22T10:00:00Z',
          },
          {
            id: 'bal-2',
            city: 'city-surat-uuid',
            variant: 'var-2',
            variant_sku: 'SHOE-WHT-UK2',
            product_name: 'White PT Shoes',
            product_category: 'Footwear',
            product_type: null,
            variant_size: 'UK-2',
            stock_quantity: 100,
            low_stock_threshold: 20,
            is_low_stock: false,
            severity: 'NORMAL',
            affected_orders_count: 0,
            updated_at: '2026-11-22T10:00:00Z',
          },
        ],
      }),
      lowStock: vi.fn().mockResolvedValue({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 'bal-1',
            city: 'city-surat-uuid',
            variant: 'var-1',
            variant_sku: 'SHOE-BLK-UK2',
            product_name: 'Black School Shoes',
            variant_size: 'UK-2',
            stock_quantity: 4,
            low_stock_threshold: 20,
            is_low_stock: true,
            severity: 'CRITICAL',
            affected_orders_count: 3,
            updated_at: '2026-11-22T10:00:00Z',
          },
        ],
      }),
      reconciliation: vi.fn().mockResolvedValue({
        total_balances_checked: 2,
        discrepant_count: 1,
        perfect_match_count: 1,
        discrepancies: [
          {
            balance_id: 'bal-1',
            city_id: 'city-surat-uuid',
            city_code: 'SUR',
            city_name: 'Surat',
            variant_id: 'var-1',
            sku: 'SHOE-BLK-UK2',
            product_name: 'Black School Shoes',
            size: 'UK-2',
            current_stock: 29,
            movement_ledger_sum: 4,
            discrepancy: 25,
            has_discrepancy: true,
            severity: 'CRITICAL',
            last_movement_at: '2026-11-22T09:30:00Z',
          },
          {
            balance_id: 'bal-2',
            city_id: 'city-surat-uuid',
            city_code: 'SUR',
            city_name: 'Surat',
            variant_id: 'var-2',
            sku: 'SHOE-WHT-UK2',
            product_name: 'White PT Shoes',
            size: 'UK-2',
            current_stock: 100,
            movement_ledger_sum: 100,
            discrepancy: 0,
            has_discrepancy: false,
            severity: 'NORMAL',
            last_movement_at: '2026-11-22T08:00:00Z',
          },
        ],
      }),
      stockMovements: vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, results: [] }),
      addStockMovement: vi.fn().mockResolvedValue({ id: 'mov-1', quantity_change: 15, reason: 'CORRECTION' }),
      orders: vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, results: [] }),
      schools: vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, results: [] }),
      users: vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, results: [] }),
    },
  };
});

function renderCityAdmin(initialPath = '/city/inventory') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/city/*" element={<CityAdmin />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CityAdmin Inventory & Reconciliation UI Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders severity badges and affected orders count in stock table', async () => {
    renderCityAdmin('/city/inventory');

    // Wait for stock balances to load
    await waitFor(() => {
      expect(screen.getByText('Black School Shoes')).toBeTruthy();
    });

    // Check severity badge
    expect(screen.getAllByText('Critical Low').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Normal').length).toBeGreaterThanOrEqual(1);

    // Check affected orders count
    expect(screen.getByText('3 active')).toBeTruthy();
  });

  it('supports size and severity filters in inventory view', async () => {
    renderCityAdmin('/city/inventory');

    await waitFor(() => {
      expect(screen.getByText('Black School Shoes')).toBeTruthy();
    });

    // Select Size filter
    const sizeSelect = screen.getByDisplayValue('All Sizes');
    fireEvent.change(sizeSelect, { target: { value: 'UK-2' } });

    await waitFor(() => {
      expect(cityAdmin.stockBalances).toHaveBeenCalledWith(
        expect.objectContaining({ size: 'UK-2' })
      );
    });

    // Select Severity filter
    const severitySelect = screen.getByDisplayValue('All Severities');
    fireEvent.change(severitySelect, { target: { value: 'CRITICAL' } });

    await waitFor(() => {
      expect(cityAdmin.stockBalances).toHaveBeenCalledWith(
        expect.objectContaining({ size: 'UK-2', severity: 'CRITICAL' })
      );
    });
  });

  it('allows staff to enter clear adjustment reasons and explanatory notes in modal', async () => {
    renderCityAdmin('/city/inventory');

    await waitFor(() => {
      expect(screen.getByText('Black School Shoes')).toBeTruthy();
    });

    // Click Adjust on first row
    const adjustButtons = screen.getAllByText('Adjust');
    fireEvent.click(adjustButtons[0]);

    // Modal opens
    expect(screen.getByText('Manual Stock Adjustment')).toBeTruthy();

    // Select Physical Count Correction reason (default is Manual Adjustment)
    const reasonSelect = screen.getByLabelText(/Reason:/i);
    fireEvent.change(reasonSelect, { target: { value: 'CORRECTION' } });

    // Enter non-zero quantity
    const quantityInput = screen.getByLabelText(/Quantity Change/i);
    fireEvent.change(quantityInput, { target: { value: '15' } });

    // Enter notes
    const notesInput = screen.getByPlaceholderText(/Surat warehouse physical audit/i);
    fireEvent.change(notesInput, {
      target: { value: 'Physical audit counted 15 surplus units in bay 2' },
    });

    // Submit movement
    const applyBtn = screen.getByText('Apply Movement');
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(cityAdmin.addStockMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'var-1',
          reason: 'CORRECTION',
          notes: 'Physical audit counted 15 surplus units in bay 2',
        })
      );
    });
  });

  it('renders reconciliation audit report comparing balances to ledger without silent correction', async () => {
    renderCityAdmin('/city/inventory');

    await waitFor(() => {
      expect(screen.getByText('Black School Shoes')).toBeTruthy();
    });

    // Click Reconciliation Audit tab
    const reconTab = screen.getByText('Reconciliation Audit');
    fireEvent.click(reconTab);

    // Verify report header and non-silent correction guarantee
    await waitFor(() => {
      expect(screen.getByText('Inventory Balance Reconciliation Report')).toBeTruthy();
    });

    expect(
      screen.getByText(/Discrepancies require physical warehouse review and are never silently corrected/i)
    ).toBeTruthy();

    // Check audited counts
    expect(screen.getByText('BALANCES AUDITED')).toBeTruthy();
    expect(screen.getByText('DISCREPANCIES DETECTED')).toBeTruthy();

    // Check discrepancy row display after reconciliation data loads
    await waitFor(() => {
      expect(screen.getByText('+25')).toBeTruthy();
    });
    expect(screen.getByText('0 (Match)')).toBeTruthy();
  });
});
