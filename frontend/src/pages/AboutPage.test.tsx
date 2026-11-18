// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AboutPage } from './AboutPage';
import { setLang } from '../i18n';
import type { StoreDeliveredSchool } from '../data/catalog';

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

Object.defineProperty(globalThis, 'IntersectionObserver', {
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

let mockDeliveredSchools: StoreDeliveredSchool[] = [
  { id: '1', name: 'Delhi Public School Surat', logo_url: '/brand/schools/dps.svg' },
  { id: '2', name: 'Fountainhead School Surat', logo_url: '/brand/schools/fountainhead.svg' },
  { id: '3', name: 'Udgam School for Children', logo_url: '/brand/schools/udgam.svg' },
  { id: '4', name: 'Podar International School', logo_url: '/brand/schools/podar.svg' },
  { id: '5', name: 'Anand Niketan School', logo_url: '/brand/schools/anand-niketan.svg' },
];

vi.mock('../data/catalog', () => ({
  useStoreDeliveredSchools: () => ({
    data: mockDeliveredSchools,
    isLoading: false,
  }),
}));

vi.mock('../store/storeState', () => ({
  useStoreState: () => ({ totalCount: 2 }),
}));

let reducedMotionValue = false;
vi.mock('motion/react', async () => {
  const actual = await vi.importActual('motion/react');
  return {
    ...actual,
    useReducedMotion: () => reducedMotionValue,
  };
});

function renderAboutPage(props: { onOpenBag?: () => void; onOpenLanguage?: () => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AboutPage {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AboutPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLang('en');
    reducedMotionValue = false;
    mockDeliveredSchools = [
      { id: '1', name: 'Delhi Public School Surat', logo_url: '/brand/schools/dps.svg' },
      { id: '2', name: 'Fountainhead School Surat', logo_url: '/brand/schools/fountainhead.svg' },
      { id: '3', name: 'Udgam School for Children', logo_url: '/brand/schools/udgam.svg' },
      { id: '4', name: 'Podar International School', logo_url: '/brand/schools/podar.svg' },
      { id: '5', name: 'Anand Niketan School', logo_url: '/brand/schools/anand-niketan.svg' },
    ];
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all sections properly in English', () => {
    renderAboutPage();

    // 1. Hero
    expect(screen.getByText('BY COLORBENZ')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(screen.getByText('We fixed what frustrated every parent.')).toBeDefined();
    expect(screen.getByAltText('SchoolStore school children in uniform')).toBeDefined();

    // 2. The Problem
    expect(screen.getByText('THE PROBLEM')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: /School shopping is a struggle/i })).toBeDefined();
    expect(screen.getByText('Parents waste time')).toBeDefined();
    expect(screen.getByText('Stock unavailable')).toBeDefined();

    // 3. Pivot
    expect(screen.getByText('So Colorbenz built SchoolStore')).toBeDefined();

    // 4. The Fix
    expect(screen.getByText('THE FIX')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: /Your school's uniform, delivered to your door\./i })).toBeDefined();
    expect(screen.getByText(/Order in a few taps/i)).toBeDefined();
    expect(screen.getByText(/Everything on your school's list/i)).toBeDefined();

    // 5. Badge
    expect(screen.getByText('FIRST TIME IN INDIA')).toBeDefined();
    expect(screen.getByText('School uniform and accessories, delivered.')).toBeDefined();

    // 6. Network Slider
    expect(screen.getByText('DELIVERY NETWORK')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: /Schools we deliver to/i })).toBeDefined();
    expect(screen.getByText('Delhi Public School Surat')).toBeDefined();

    // 7. CTA
    expect(screen.getByRole('button', { name: /Find your school/i })).toBeDefined();
  });

  it('switches text correctly in Gujarati and Hindi', () => {
    const { rerender } = renderAboutPage();

    // Gujarati
    act(() => {
      setLang('gu');
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AboutPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByText('COLORBENZ દ્વારા')).toBeDefined();
    expect(screen.getByText('વાર્તા')).toBeDefined();
    expect(screen.getByText('સમસ્યા')).toBeDefined();
    expect(screen.getByText('સમયનો બગાડ')).toBeDefined();
    expect(screen.getByText('સ્ટોક મળતો નથી')).toBeDefined();
    expect(screen.getByText('ઉકેલ')).toBeDefined();

    // Hindi
    act(() => {
      setLang('hi');
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AboutPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByText('COLORBENZ द्वारा')).toBeDefined();
    expect(screen.getByText('कहानी')).toBeDefined();
    expect(screen.getByText('समस्या')).toBeDefined();
    expect(screen.getByText('समय की बर्बादी')).toBeDefined();
    expect(screen.getByText('स्टॉक उपलब्ध नहीं')).toBeDefined();
    expect(screen.getByText('समाधान')).toBeDefined();
  });

  it('omits the delivered schools section if fewer than 4 schools have logos', () => {
    mockDeliveredSchools = [
      { id: '1', name: 'Delhi Public School Surat', logo_url: '/brand/schools/dps.svg' },
      { id: '2', name: 'Fountainhead School Surat', logo_url: '/brand/schools/fountainhead.svg' },
      { id: '3', name: 'Udgam School for Children', logo_url: '/brand/schools/udgam.svg' },
    ];
    renderAboutPage();

    expect(screen.queryByText('DELIVERY NETWORK')).toBeNull();
    expect(screen.queryByText('Schools we deliver to')).toBeNull();
  });

  it('"Find your school" opens the shop', () => {
    renderAboutPage();

    const ctaButton = screen.getByRole('button', { name: /Find your school/i });
    fireEvent.click(ctaButton);

    expect(mockNavigate).toHaveBeenCalledWith('/shop');
  });

  it('handles back button clicking', () => {
    renderAboutPage();

    const backButton = screen.getByRole('button', { name: /Back/i });
    fireEvent.click(backButton);

    expect(mockNavigate).toHaveBeenCalled();
  });

  it('opens bag and language callbacks when clicked', () => {
    const onOpenBag = vi.fn();
    const onOpenLanguage = vi.fn();
    renderAboutPage({ onOpenBag, onOpenLanguage });

    const bagButton = screen.getByLabelText(/Bag, 2 items/i);
    fireEvent.click(bagButton);
    expect(onOpenBag).toHaveBeenCalledTimes(1);

    const langButton = screen.getByLabelText(/Language/i);
    fireEvent.click(langButton);
    expect(onOpenLanguage).toHaveBeenCalledTimes(1);
  });
});
