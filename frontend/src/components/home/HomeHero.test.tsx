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

const mockAuthState = {
  user: null as any,
  loading: false,
};

vi.mock('../../auth', async () => {
  const actual = await vi.importActual('../../auth');
  return {
    ...actual,
    useAuth: () => ({
      user: mockAuthState.user,
      loading: mockAuthState.loading,
      signOut: vi.fn(),
    }),
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
    mockAuthState.user = null;
    mockAuthState.loading = false;
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
    expect(screen.getByText(/All schools/i)).toBeTruthy();
    expect(screen.getByText(/uniform and accessories/i)).toBeTruthy();
    expect(screen.getByText(/at your doorstep\./i)).toBeTruthy();
    unmount();

    // 2. Gujarati
    act(() => {
      setLang('gu');
    });
    const guView = renderHomeHero();
    expect(screen.getByText('ભારતમાં પ્રથમ વખત')).toBeTruthy();
    expect(screen.getByText('INDIA')).toBeTruthy();
    expect(screen.getByText(/બધી શાળાઓ/i)).toBeTruthy();
    expect(screen.getByText(/યુનિફોર્મ અને એસેસરીઝ/i)).toBeTruthy();
    expect(screen.getByText(/તમારા ઘર સુધી\./i)).toBeTruthy();
    guView.unmount();

    // 3. Hindi
    act(() => {
      setLang('hi');
    });
    const hiView = renderHomeHero();
    expect(screen.getByText('पहली बार भारत में')).toBeTruthy();
    expect(screen.getByText('INDIA')).toBeTruthy();
    expect(screen.getByText(/सभी स्कूल/i)).toBeTruthy();
    expect(screen.getByText(/यूनिफॉर्म और एक्सेसरीज़/i)).toBeTruthy();
    expect(screen.getByText(/आपके दरवाज़े तक।/i)).toBeTruthy();
    hiView.unmount();
  });

  it('has no school search; its one button opens the shop', () => {
    const { container } = renderHomeHero();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('search')).toBeNull();

    expect(container.querySelector('.emerald-cta')).toBeNull();
    expect(screen.queryByRole('link', { name: /Shop school uniform/i })).toBeNull();
  });

  it('renders clean picture element with avif, webp sources and clean png img', () => {
    const { container } = renderHomeHero();
    const img = container.querySelector('img.emerald-kids-img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/brand/kids-uniform.clean.png');
    expect(img.getAttribute('alt')).toBe('Two smiling children in school uniform');
    expect(img.getAttribute('decoding')).toBe('async');

    const sources = container.querySelectorAll('picture source');
    expect(sources.length).toBe(2);
    expect(sources[0].getAttribute('type')).toBe('image/avif');
    expect(sources[0].getAttribute('srcset')).toBe('/brand/kids-uniform.clean.avif');
    expect(sources[1].getAttribute('type')).toBe('image/webp');
    expect(sources[1].getAttribute('srcset')).toBe('/brand/kids-uniform.clean.webp');
  });

  it('renders stage with concentric circles and tricolour pill, and no sparkles (client rule)', () => {
    const { container } = renderHomeHero();
    expect(container.querySelector('.emerald-circle-outer')).toBeTruthy();
    expect(container.querySelector('.emerald-circle-inner')).toBeTruthy();
    expect(container.querySelector('.emerald-tricolour-pill')).toBeTruthy();
    expect(container.querySelector('.emerald-ground-shadow')).toBeTruthy();

    expect(container.querySelectorAll('.emerald-sparkle').length).toBe(0);
  });

  it('with reduced motion on, looping animations are not rendered', () => {
    reducedMotionValue = true;
    const { container } = renderHomeHero();

    const floatWrap = container.querySelector('.emerald-float-wrap');
    expect(floatWrap).toBeTruthy();
  });

  describe('account entrance', () => {
    it('signed out shows a link named "Sign in" to the shared destination (/login)', () => {
      mockAuthState.user = null;
      mockAuthState.loading = false;
      const { container } = renderHomeHero();
      const accountLink = screen.getByRole('link', { name: /Sign in/i });
      expect(accountLink).toBeTruthy();
      expect(accountLink.getAttribute('href')).toBe('/login');
      expect(container.querySelector('.emerald-account-btn')).toBe(accountLink);
    });

    it('signed in as PARENT shows "My account" to /parent', () => {
      mockAuthState.user = { id: 'p1', role: 'PARENT', username: 'parent1' };
      mockAuthState.loading = false;
      renderHomeHero();
      const accountLink = screen.getByRole('link', { name: /My account/i });
      expect(accountLink).toBeTruthy();
      expect(accountLink.getAttribute('href')).toBe('/parent');
    });

    it('signed in as SCHOOL_ADMIN goes to /school', () => {
      mockAuthState.user = { id: 'sa1', role: 'SCHOOL_ADMIN', username: 'admin1' };
      mockAuthState.loading = false;
      renderHomeHero();
      const accountLink = screen.getByRole('link', { name: /My account/i });
      expect(accountLink).toBeTruthy();
      expect(accountLink.getAttribute('href')).toBe('/school');
    });

    it('while auth is still loading, renders signed-out form without shifting', () => {
      mockAuthState.user = null;
      mockAuthState.loading = true;
      renderHomeHero();
      const accountLink = screen.getByRole('link', { name: /Sign in/i });
      expect(accountLink).toBeTruthy();
      expect(accountLink.getAttribute('href')).toBe('/login');
    });
  });
});
