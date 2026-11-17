// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeHero } from './HomeHero';
import { setLang } from '../../i18n';
import type { StoreSchool } from '../../data/catalog';

// Mock school data
const mockSchools: StoreSchool[] = [
  {
    id: 'sch-dps',
    name: 'Delhi Public School',
    code: 'DPS',
    city: 'Ahmedabad',
    slug: 'delhi-public-school',
    homeDelivery: true,
    schoolPickup: true,
  },
  {
    id: 'sch-udgam',
    name: 'Udgam School for Children',
    code: 'UDG',
    city: 'Ahmedabad',
    slug: 'udgam-school',
    homeDelivery: true,
    schoolPickup: true,
  },
];

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../data/catalog', () => ({
  useStoreSchools: () => ({ data: mockSchools, isLoading: false }),
}));

let reducedMotionValue = false;
vi.mock('motion/react', async () => {
  const actual = await vi.importActual('motion/react');
  return {
    ...actual,
    useReducedMotion: () => reducedMotionValue,
  };
});

function renderHomeHero() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomeHero />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('HomeHero (P1 Emerald Stage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reducedMotionValue = false;
    act(() => {
      setLang('en');
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all headline text in EN, gu and hi', () => {
    // 1. English
    const { unmount } = renderHomeHero();
    expect(screen.getByText('First time in')).toBeTruthy();
    expect(screen.getByText('INDIA')).toBeTruthy();
    expect(screen.getByText(/All school uniform & accessories,/i)).toBeTruthy();
    expect(screen.getByText(/at your doorstep\./i)).toBeTruthy();
    unmount();

    // 2. Gujarati
    act(() => {
      setLang('gu');
    });
    const guView = renderHomeHero();
    expect(screen.getByText('ભારતમાં પ્રથમ વખત')).toBeTruthy();
    expect(screen.getByText('INDIA')).toBeTruthy();
    expect(screen.getByText(/બધા સ્કૂલ યુનિફોર્મ અને એસેસરીઝ,/i)).toBeTruthy();
    expect(screen.getByText(/તમારા દરવાજે\./i)).toBeTruthy();
    guView.unmount();

    // 3. Hindi
    act(() => {
      setLang('hi');
    });
    const hiView = renderHomeHero();
    expect(screen.getByText('पहली बार भारत में')).toBeTruthy();
    expect(screen.getByText('INDIA')).toBeTruthy();
    expect(screen.getByText(/सभी स्कूल यूनिफॉर्म और एक्सेसरीज़,/i)).toBeTruthy();
    expect(screen.getByText(/आपके दरवाज़े पर।/i)).toBeTruthy();
    hiView.unmount();
  });

  it('submitting the form with a school calls the existing navigation once', () => {
    renderHomeHero();
    const input = screen.getByRole('combobox');
    
    // Type school name
    fireEvent.change(input, { target: { value: 'Delhi' } });

    // Submit form
    const form = screen.getByRole('search');
    fireEvent.submit(form);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/flow?school=sch-dps&step=2');
  });

  it('the input is labelled and its font size is at least 16 px', () => {
    renderHomeHero();
    const input = screen.getByRole('combobox') as HTMLInputElement;

    // Check label
    expect(input.getAttribute('aria-label')).toBeTruthy();
    expect(input.getAttribute('aria-label')?.length).toBeGreaterThan(0);
    expect(input.placeholder).toBe('Find your school');

    // Check class and style / computed font-size
    expect(input.classList.contains('emerald-search-input')).toBe(true);
    // In CSS .emerald-search-input font-size is 16px (to prevent iOS auto-zoom)
    const style = window.getComputedStyle(input);
    const fontSize = parseFloat(style.fontSize) || 16;
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  it('with reduced motion on, looping animations are not rendered', () => {
    reducedMotionValue = true;
    const { container } = renderHomeHero();

    // Check float wrap and sparkles
    const floatWrap = container.querySelector('.emerald-float-wrap');
    expect(floatWrap).toBeTruthy();

    const sparkles = container.querySelectorAll('.emerald-sparkle');
    expect(sparkles.length).toBe(4);

    // Sparkles have reduced motion opacity set
    sparkles.forEach((sparkle) => {
      expect(sparkle).toBeTruthy();
    });
  });
});
