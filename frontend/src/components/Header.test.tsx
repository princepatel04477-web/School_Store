// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header } from './Header';
import { setLang } from '../i18n';

const mockAuthState = {
  user: null as any,
  loading: false,
};

vi.mock('../auth', async () => {
  const actual = await vi.importActual('../auth');
  return {
    ...actual,
    useAuth: () => ({
      user: mockAuthState.user,
      loading: mockAuthState.loading,
      signOut: vi.fn(),
    }),
  };
});

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>
  );
}

describe('Header shared account entrance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.user = null;
    mockAuthState.loading = false;
    setLang('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('signed out shows links to /login with "Sign in" label', () => {
    mockAuthState.user = null;
    mockAuthState.loading = false;
    const { container } = renderHeader();

    const desktopSignIn = container.querySelector('.action-signin-link') as HTMLAnchorElement;
    expect(desktopSignIn).toBeTruthy();
    expect(desktopSignIn.getAttribute('href')).toBe('/login');
    expect(desktopSignIn.textContent?.trim()).toBe('Sign in');

    const mobileProfile = container.querySelector('.mobile-profile-btn') as HTMLAnchorElement;
    expect(mobileProfile).toBeTruthy();
    expect(mobileProfile.getAttribute('href')).toBe('/login');
    expect(mobileProfile.getAttribute('aria-label')).toBe('Sign in');
  });

  it('signed in as PARENT links to /parent with "My account" label', () => {
    mockAuthState.user = { id: 'p1', role: 'PARENT', username: 'parent1' };
    mockAuthState.loading = false;
    const { container } = renderHeader();

    const desktopAccount = container.querySelector('.action-account-btn') as HTMLAnchorElement;
    expect(desktopAccount).toBeTruthy();
    expect(desktopAccount.getAttribute('href')).toBe('/parent');
    expect(desktopAccount.getAttribute('aria-label')).toBe('My account');

    const mobileProfile = container.querySelector('.mobile-profile-btn') as HTMLAnchorElement;
    expect(mobileProfile).toBeTruthy();
    expect(mobileProfile.getAttribute('href')).toBe('/parent');
    expect(mobileProfile.getAttribute('aria-label')).toBe('My account');
  });

  it('signed in as SCHOOL_ADMIN routes directly to /school with "My account" label', () => {
    mockAuthState.user = { id: 'sa1', role: 'SCHOOL_ADMIN', username: 'admin1' };
    mockAuthState.loading = false;
    const { container } = renderHeader();

    const desktopAccount = container.querySelector('.action-account-btn') as HTMLAnchorElement;
    expect(desktopAccount).toBeTruthy();
    expect(desktopAccount.getAttribute('href')).toBe('/school');
    expect(desktopAccount.getAttribute('aria-label')).toBe('My account');

    const mobileProfile = container.querySelector('.mobile-profile-btn') as HTMLAnchorElement;
    expect(mobileProfile).toBeTruthy();
    expect(mobileProfile.getAttribute('href')).toBe('/school');
    expect(mobileProfile.getAttribute('aria-label')).toBe('My account');
  });

  it('while auth is loading, renders signed-out form to /login', () => {
    mockAuthState.user = null;
    mockAuthState.loading = true;
    const { container } = renderHeader();

    const desktopSignIn = container.querySelector('.action-signin-link') as HTMLAnchorElement;
    expect(desktopSignIn).toBeTruthy();
    expect(desktopSignIn.getAttribute('href')).toBe('/login');

    const mobileProfile = container.querySelector('.mobile-profile-btn') as HTMLAnchorElement;
    expect(mobileProfile).toBeTruthy();
    expect(mobileProfile.getAttribute('href')).toBe('/login');
  });
});
