// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SizeChartTable, RecommendationNote } from './SizeChartTable';
import type { ChartRow, Recommendation } from '../../data/fit';

afterEach(() => {
  cleanup();
});

describe('SizeChartTable', () => {
  const sampleRows: ChartRow[] = [
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

  it('renders nothing when rows are empty or missing', () => {
    const { container } = render(<SizeChartTable rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders loading skeleton when loading is true', () => {
    render(<SizeChartTable rows={sampleRows} loading={true} />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders size chart rows and highlights suggested and selected rows', () => {
    const rec: Recommendation = {
      status: 'FIT',
      size: '30',
      alt_size: '',
      reason: 'HEIGHT_WEIGHT_EXACT',
      chart_version: 'v1',
    };

    const { container } = render(
      <SizeChartTable
        rows={sampleRows}
        recommendation={rec}
        selectedSize="28"
      />
    );

    expect(screen.getByText('Size')).toBeDefined();
    expect(screen.getByText('Height (cm)')).toBeDefined();

    const tbodyRows = container.querySelectorAll('tbody tr');
    expect(tbodyRows.length).toBe(2);

    // First row (28) should be selected
    expect(tbodyRows[0].className).toContain('is-selected-row');

    // Second row (30) should be suggested
    expect(tbodyRows[1].className).toContain('is-suggested');
  });
});

describe('RecommendationNote', () => {
  const sampleRows: ChartRow[] = [
    {
      variant_id: 'v30',
      size: '30',
      height_cm_min: 120,
      height_cm_max: 130,
      weight_kg_min: 25,
      weight_kg_max: 30,
      chest_cm_min: 66,
      chest_cm_max: 70,
      shoulder_cm_min: 31,
      shoulder_cm_max: 33,
      length_cm: 52,
    },
  ];

  const sampleSizes = [
    { id: 'v28', size: '28', inStock: true },
    { id: 'v30', size: '30', inStock: false },
    { id: 'v32', size: '32', inStock: true },
  ];

  it('renders neutral message when status is NO_CHART', () => {
    const rec: Recommendation = {
      status: 'NO_CHART',
      size: '',
      alt_size: '',
    };
    render(<RecommendationNote recommendation={rec} />);
    expect(
      screen.getByText(/Size chart is currently unavailable for this item/i)
    ).toBeDefined();
  });

  it('shows inputs used, date info, and garment specs', () => {
    const rec: Recommendation = {
      status: 'FIT',
      size: '30',
      alt_size: '',
      reason: 'HEIGHT_WEIGHT_EXACT',
      chart_version: 'v1',
      inputs_used: {
        height_cm: 125,
        weight_kg: 27,
      },
    };

    render(
      <RecommendationNote
        recommendation={rec}
        measuredAt="2026-03-01T10:00:00Z"
        chartRows={sampleRows}
        sizes={sampleSizes}
      />
    );

    // Shows suggested size badge and region
    expect(screen.getByRole('region', { name: 'Suggested' })).toBeDefined();
    expect(screen.getByText('30')).toBeDefined();

    // Sizing explanation with inputs used
    expect(
      screen.getByText(/Suggested based on height 125 cm and weight 27 kg/i)
    ).toBeDefined();

    // Garment measurements from chart row
    expect(screen.getByText(/Chest 66 cm, Length 52 cm/i)).toBeDefined();

    // Stock status check: size 30 is out of stock in sampleSizes
    expect(
      screen.getByText(/Recommended size 30 is currently out of stock in your city/i)
    ).toBeDefined();
  });

  it('clearly separates parent selection from recommendation when they differ', () => {
    const rec: Recommendation = {
      status: 'FIT',
      size: '30',
      alt_size: '',
      reason: 'HEIGHT_WEIGHT_EXACT',
      chart_version: 'v1',
    };

    render(
      <RecommendationNote
        recommendation={rec}
        selectedSize="32"
        chartRows={sampleRows}
        sizes={sampleSizes}
      />
    );

    // Both badges present
    expect(screen.getAllByText(/Suggested/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Size/i).length).toBeGreaterThan(0);
    expect(screen.getByText('32')).toBeDefined();

    // Difference notice
    expect(
      screen.getByText(/You have chosen size 32. Recommended size based on measurements is 30./i)
    ).toBeDefined();
  });

  it('indicates matching selection when parent selects recommended size', () => {
    const rec: Recommendation = {
      status: 'FIT',
      size: '30',
      alt_size: '',
      reason: 'HEIGHT_WEIGHT_EXACT',
      chart_version: 'v1',
    };

    render(
      <RecommendationNote
        recommendation={rec}
        selectedSize="30"
        chartRows={sampleRows}
        sizes={sampleSizes}
      />
    );

    expect(
      screen.getByText(/Selected size 30 matches/i)
    ).toBeDefined();
  });

  it('explains shoulder refined recommendation', () => {
    const rec: Recommendation = {
      status: 'FIT',
      size: '30',
      alt_size: '',
      reason: 'SHOULDER_REFINED_EXACT',
      inputs_used: {
        height_cm: 125,
        shoulder_cm: 32,
      },
    };

    render(<RecommendationNote recommendation={rec} />);
    expect(
      screen.getByText(/Refined to size 30 using measured shoulder width/i)
    ).toBeDefined();
  });
});
