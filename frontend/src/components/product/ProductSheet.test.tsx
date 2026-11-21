// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ProductSheet } from './ProductSheet';
import type { CardProduct } from './ProductCard';
import type { ProductFit } from '../../data/fit';

afterEach(() => {
  cleanup();
});

// Mock motion to handle all tags dynamically
vi.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        return ({ children, ...props }: any) => {
          return React.createElement(prop, props, children);
        };
      },
    }
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useReducedMotion: () => false,
}));

vi.mock('../../motion/useShake', () => ({
  useShake: () => [{ current: null }, vi.fn()],
}));

vi.mock('../../motion/flyToBag', () => ({
  flyToBag: vi.fn(),
}));

describe('ProductSheet - Material, Care and Sizing', () => {
  const baseProduct: CardProduct = {
    id: 'prod-101',
    name: 'Boys Cotton Shirt',
    category: 'Uniform',
    categorySlug: 'shirt',
    descriptor: 'Half Sleeve',
    description: 'School uniform regular shirt',
    pricePaise: 45000,
    required: true,
    needsDetails: false,
    sizes: [
      { id: 'v28', size: '28', inStock: true },
      { id: 'v30', size: '30', inStock: true },
    ],
  };

  it('renders material composition and care instructions when present', () => {
    const productWithCare: CardProduct = {
      ...baseProduct,
      materialComposition: '65% Polyester, 35% Cotton',
      careInstructions: 'Machine wash warm, tumble dry low, warm iron if needed.',
    };

    render(
      <ProductSheet
        product={productWithCare}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Material:/i)).toBeDefined();
    expect(screen.getByText(/65% Polyester, 35% Cotton/i)).toBeDefined();
    expect(screen.getByText(/Care instructions:/i)).toBeDefined();
    expect(screen.getByText(/Machine wash warm, tumble dry low/i)).toBeDefined();
  });

  it('renders neutral noCareInfo message when no material/care info is available', () => {
    const productWithoutCare: CardProduct = {
      ...baseProduct,
      materialComposition: undefined,
      careInstructions: undefined,
      fabricCare: undefined,
    };

    render(
      <ProductSheet
        product={productWithoutCare}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    // Should render neutral fallback without inventing claims
    expect(
      screen.getByText(/Care instructions not specified for this item/i)
    ).toBeDefined();
  });

  it('displays sizing recommendation when fit is provided', () => {
    const sampleRows = [
      {
        variant_id: 'v28',
        size: '28',
        height_cm_min: 110,
        height_cm_max: 120,
        weight_kg_min: 20,
        weight_kg_max: 25,
        chest_cm_min: 60,
        chest_cm_max: 64,
        shoulder_cm_min: 28,
        shoulder_cm_max: 30,
        length_cm: 45,
      },
      {
        variant_id: 'v30',
        size: '30',
        height_cm_min: 120,
        height_cm_max: 130,
        weight_kg_min: 25,
        weight_kg_max: 30,
        chest_cm_min: 65,
        chest_cm_max: 69,
        shoulder_cm_min: 30,
        shoulder_cm_max: 32,
        length_cm: 50,
      },
    ];

    const fitData: ProductFit = {
      chart: sampleRows,
      chart_version: 'v1',
      recommendation: {
        status: 'FIT',
        size: '30',
        alt_size: '',
        reason: 'HEIGHT_WEIGHT_EXACT',
        chart_version: 'v1',
        inputs_used: {
          height_cm: 125,
          weight_kg: 28,
        },
      },
    };

    render(
      <ProductSheet
        product={baseProduct}
        isOpen={true}
        onClose={vi.fn()}
        fit={fitData}
      />
    );

    expect(screen.getAllByText(/Suggested/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('30').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Suggested based on height 125 cm and weight 28 kg/i)
    ).toBeDefined();
  });
});
