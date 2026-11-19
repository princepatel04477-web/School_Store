// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AboutPage, MIN_SLIDER_SCHOOLS } from './AboutPage';
import { aboutMessages } from '../i18n/aboutMessages';
import { setLang, type Lang } from '../i18n';
import type { StoreSchool } from '../data/catalog';

// jsdom has no matchMedia; the motion helpers ask it whether this is a phone.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockSchools: StoreSchool[] = [];
vi.mock('../data/catalog', () => ({
  useStoreSchools: () => ({ data: mockSchools, isLoading: false }),
}));

vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...actual, useReducedMotion: () => true };
});

const school = (n: number, logo = false): StoreSchool => ({
  id: `sch-${n}`,
  name: `School ${n}`,
  code: `S${n}`,
  city: 'Surat',
  slug: `school-${n}`,
  homeDelivery: true,
  schoolPickup: true,
  logoUrl: logo ? `/api/public/schools/sch-${n}/logo/` : undefined,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>,
  );

describe('AboutPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockSchools = [];
    act(() => setLang('en'));
  });

  afterEach(() => cleanup());

  it.each<Lang>(['en', 'gu', 'hi'])('renders every section in %s', (lang) => {
    act(() => setLang(lang));
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(aboutMessages['about.titleAccent'][lang]);
    expect(screen.getByText(aboutMessages['about.problemTitle'][lang])).toBeTruthy();
    expect(screen.getByText(aboutMessages['about.timeTitle'][lang])).toBeTruthy();
    expect(screen.getByText(aboutMessages['about.stockTitle'][lang])).toBeTruthy();
    expect(screen.getByText(aboutMessages['about.fixTitle'][lang])).toBeTruthy();
    expect(screen.getByText(aboutMessages['about.badgeTitle'][lang])).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(aboutMessages['about.cta'][lang]) })).toBeTruthy();
  });

  it('has one h1 and sets the page title', () => {
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.title).toBe(aboutMessages['about.pageTitle'].en);
  });

  it('leaves the school slider out when there are too few schools', () => {
    mockSchools = Array.from({ length: MIN_SLIDER_SCHOOLS - 1 }, (_, i) => school(i));
    renderPage();
    expect(screen.queryByText(aboutMessages['about.schoolsTitle'].en)).toBeNull();
  });

  it('shows the school slider with enough schools, logos first', () => {
    mockSchools = [school(1), school(2), school(3, true), school(4), school(5)];
    renderPage();
    expect(screen.getByText(aboutMessages['about.schoolsTitle'].en)).toBeTruthy();
    const region = screen.getByRole('region', { name: aboutMessages['about.schoolsRegion'].en });
    const names = within(region).getAllByRole('listitem').map((li) => li.textContent);
    expect(names).toHaveLength(5);
    expect(names[0]).toContain('School 3');
    expect(screen.getByAltText('School 3 crest')).toBeTruthy();
  });

  it('starts with the previous-schools button disabled', () => {
    mockSchools = Array.from({ length: 8 }, (_, i) => school(i));
    renderPage();
    const prev = screen.getByRole('button', { name: aboutMessages['about.prev'].en }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it('"Find your school" opens the shop', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Find your school/ }));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/shop');
  });
});
