// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth';
import { ApiError, auth, logout } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    logout: vi.fn(),
    auth: { ...actual.auth, me: vi.fn() },
  };
});

function Probe() {
  const { user, loading, offline, retry } = useAuth();
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : offline ? 'offline' : user ? `user:${user.role}` : 'none'}</span>
      <button type="button" onClick={retry}>retry</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

describe('AuthProvider: an outage is not a sign-out (review 2026-11-21)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('access', 'synthetic-access');
    localStorage.setItem('refresh', 'synthetic-refresh');
    vi.mocked(logout).mockClear();
    vi.mocked(auth.me).mockReset();
  });
  afterEach(cleanup);

  it('keeps the sign-in and reports offline when the server cannot be reached', async () => {
    vi.mocked(auth.me).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('offline'));
    expect(logout).not.toHaveBeenCalled();
    expect(localStorage.getItem('access')).toBe('synthetic-access');
  });

  it('keeps the sign-in on a server fault (5xx)', async () => {
    vi.mocked(auth.me).mockRejectedValueOnce(new ApiError('Bad gateway', 502));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('offline'));
    expect(logout).not.toHaveBeenCalled();
  });

  it('signs out when the server refuses the sign-in (401)', async () => {
    vi.mocked(auth.me).mockRejectedValueOnce(new ApiError('Expired', 401));
    renderProbe();
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it('Retry asks again and recovers once the server answers', async () => {
    vi.mocked(auth.me)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ id: 'u1', username: 'parent_synthetic', role: 'PARENT' } as never);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('offline'));
    fireEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('user:PARENT'));
    expect(logout).not.toHaveBeenCalled();
  });
});
