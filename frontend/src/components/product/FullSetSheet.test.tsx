// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FullSetSheet } from './FullSetSheet';
import { storeState } from '../../store/storeState';
import * as apiModule from '../../api';
import type { StoreProduct } from '../../data/catalog';

// Mock flyToBag to avoid DOM measurement issues in tests
vi.mock('../../motion/flyToBag', () => ({
  flyToBag: vi.fn(),
}));

const mockProducts: StoreProduct[] = [
  {
    id: 'prod-1',
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
      { id: 'var-1', size: '28', inStock: true },
      { id: 'var-2', size: '30', inStock: true },
      { id: 'var-3', size: '32', inStock: false },
    ],
  },
  {
    id: 'prod-2',
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
      { id: 'var-4', size: '28', inStock: true },
      { id: 'var-5', size: '30', inStock: true },
    ],
  },
  {
    id: 'prod-3',
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
      { id: 'var-6', size: 'Standard', inStock: true },
    ],
  },
  {
    id: 'prod-4',
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
      { id: 'var-7', size: 'Free Size', inStock: false },
    ],
  },
];

describe('FullSetSheet reliable ordering and validation tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.clearCart();
    storeState.setSelection({
      schoolId: 'sch-1',
      schoolName: 'Kendriya Vidyalaya Surat',
      cityId: 'city-sur',
      cityName: 'Surat',
      gradeId: 'cls-5',
      gradeName: 'Class 5',
      gender: 'boy',
    });
    vi.spyOn(apiModule.cartApi, 'validate').mockResolvedValue({
      valid: true,
      price_changes: [],
      out_of_stock: [],
      has_price_changes: false,
      has_out_of_stock: false,
      message: 'Valid',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('displays required vs optional badges on products based on live product data', () => {
    render(
      <FullSetSheet
        open={true}
        onClose={vi.fn()}
        products={mockProducts}
        schoolName="Kendriya Vidyalaya Surat"
        schoolId="sch-1"
        className="Class 5"
      />
    );

    const requiredBadges = screen.getAllByText('Required');
    expect(requiredBadges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Optional')).toBeDefined();
  });

  it('supports independent quantity stepper controls and immediately updates the total', () => {
    render(
      <FullSetSheet
        open={true}
        onClose={vi.fn()}
        products={[mockProducts[0], mockProducts[2]]} // 1 shirt (45000) + 1 tie (12000) = 57000 paise (₹570)
        schoolName="Kendriya Vidyalaya Surat"
        schoolId="sch-1"
        className="Class 5"
      />
    );

    // Initial total: 2 items · ₹570
    const addBtn = screen.getByRole('button', { name: /Add all 2 to bag/i });
    expect(addBtn.textContent).toContain('₹570');

    // Increase shirt quantity (+ button)
    const plusButtons = screen.getAllByLabelText('Increase quantity');
    fireEvent.click(plusButtons[0]);

    // Total should immediately update: 2 shirts (900) + 1 tie (120) = ₹1,020
    expect(addBtn.textContent).toContain('₹1,020');

    // Decrease shirt quantity (- button)
    const minusButtons = screen.getAllByLabelText('Decrease quantity');
    fireEvent.click(minusButtons[0]);

    // Back to ₹570
    expect(addBtn.textContent).toContain('₹570');
  });

  it('clearly marks out-of-stock items and excludes them from add-all', () => {
    render(
      <FullSetSheet
        open={true}
        onClose={vi.fn()}
        products={mockProducts}
        schoolName="Kendriya Vidyalaya Surat"
        schoolId="sch-1"
        className="Class 5"
      />
    );

    // prod-4 has only var-7 which is out of stock -> shows out of stock notice
    const oosAlerts = screen.getAllByText(/Out of stock in your city/i);
    expect(oosAlerts.length).toBeGreaterThan(0);

    // Available products are 3 (prod-1, prod-2, prod-3)
    const addBtn = screen.getByRole('button', { name: /Add all 3 to bag/i });
    expect(addBtn).toBeDefined();
  });

  it('warns about omitted required items without preventing a parent from proceeding', async () => {
    const onAdded = vi.fn();
    render(
      <FullSetSheet
        open={true}
        onClose={vi.fn()}
        products={[mockProducts[0], mockProducts[2]]} // prod-1 is required, prod-3 is optional
        schoolName="Kendriya Vidyalaya Surat"
        schoolId="sch-1"
        className="Class 5"
        onAdded={onAdded}
      />
    );

    // Skip the required shirt (e.g. parent already has it from sibling)
    const skipButtons = screen.getAllByText('Don’t need this');
    fireEvent.click(skipButtons[0]);

    expect(screen.getByText('Required item not selected')).toBeDefined();

    // Click Add to bag
    const addBtn = screen.getByRole('button', { name: /Add all 1 to bag/i });
    fireEvent.click(addBtn);

    // Confirmation modal appears explaining they do not need to repurchase if already owned
    expect(screen.getByText('Some required items are omitted')).toBeDefined();

    // Click "Proceed and add to bag"
    const proceedBtn = screen.getByRole('button', { name: /Proceed and add to bag/i });
    fireEvent.click(proceedBtn);

    await waitFor(() => {
      // Tie was added to cart with quantity 1
      const cart = storeState.getCart();
      expect(cart.length).toBe(1);
      expect(cart[0].productId).toBe('prod-3');
      expect(onAdded).toHaveBeenCalled();
    });
  });

  it('prevents full sets from silently crossing schools when cart already contains items from another school', async () => {
    // Cart already has an item from DPS
    storeState.addItem({
      productId: 'dps-item-1',
      variantId: 'dps-var-1',
      name: 'DPS Blazer',
      category: 'Uniform',
      pricePaise: 95000,
      size: '32',
      quantity: 1,
      schoolId: 'sch-dps',
      schoolName: 'Delhi Public School',
    });

    render(
      <FullSetSheet
        open={true}
        onClose={vi.fn()}
        products={[mockProducts[2]]} // KV tie
        schoolName="Kendriya Vidyalaya Surat"
        schoolId="sch-kv"
        className="Class 5"
      />
    );

    const addBtn = screen.getByRole('button', { name: /Add all 1 to bag/i });
    fireEvent.click(addBtn);

    // Cross-school mismatch warning modal appears
    expect(screen.getByText('Different school in your bag')).toBeDefined();
    expect(screen.getByText(/A single order cannot mix items from different schools/i)).toBeDefined();

    // Cart was NOT modified yet
    expect(storeState.getCart()[0].schoolId).toBe('sch-dps');

    // Click "Clear bag and add set"
    const clearAndAddBtn = screen.getByRole('button', { name: /Clear bag and add set/i });
    fireEvent.click(clearAndAddBtn);

    await waitFor(() => {
      const cart = storeState.getCart();
      expect(cart.length).toBe(1);
      expect(cart[0].schoolId).toBe('sch-kv');
      expect(cart[0].name).toBe('KV School Monogram Tie');
    });
  });

  it('revalidates prices and stock with server and explains price changes before committing', async () => {
    vi.spyOn(apiModule.cartApi, 'validate').mockResolvedValue({
      valid: false,
      price_changes: [
        {
          product_id: 'prod-1',
          variant_id: 'var-1',
          name: 'KV Boys Half Sleeve Shirt',
          size: '28',
          client_price_paise: 45000,
          server_price_paise: 48000,
          diff_paise: 3000,
          explanation: 'Price updated in city catalog',
        },
      ],
      out_of_stock: [],
      has_price_changes: true,
      has_out_of_stock: false,
      message: 'Prices updated',
    });

    render(
      <FullSetSheet
        open={true}
        onClose={vi.fn()}
        products={[mockProducts[0]]}
        schoolName="Kendriya Vidyalaya Surat"
        schoolId="sch-1"
        className="Class 5"
      />
    );

    const addBtn = screen.getByRole('button', { name: /Add all 1 to bag/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByText('Notice: Prices or stock updated')).toBeDefined();
      expect(screen.getByText(/KV Boys Half Sleeve Shirt: ₹480.00/i)).toBeDefined();
    });

    // Accept and add updated prices
    const confirmAddBtn = screen.getByRole('button', { name: /Add all 1 to bag · ₹480/i });
    fireEvent.click(confirmAddBtn);

    await waitFor(() => {
      const cart = storeState.getCart();
      expect(cart.length).toBe(1);
      expect(cart[0].pricePaise).toBe(48000);
    });
  });
});
