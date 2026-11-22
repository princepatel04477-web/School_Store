// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ParentSignInSheet } from '../parent/ParentSignInSheet';
import { AccountSheetProvider, useAccountSheet } from './AccountSheetContext';
import { Header } from '../Header';
import { HomeHero } from '../home/HomeHero';
import { Guard } from '../../App';
import { setLang } from '../../i18n';
import { ApiError, auth as authApi, parentChildren } from '../../api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock auth module
const mockAuthState = {
  user: null as any,
  loading: false,
};

const mockSignInWithOtp = vi.fn();

vi.mock('../../auth', async () => {
  const actual = await vi.importActual('../../auth');
  return {
    ...actual,
    useAuth: () => ({
      user: mockAuthState.user,
      loading: mockAuthState.loading,
      signInWithOtp: mockSignInWithOtp,
      signOut: vi.fn(),
    }),
  };
});

// Mock api methods
vi.mock('../../api', async () => {
  const actual = await vi.importActual('../../api');
  return {
    ...actual,
    auth: {
      sendOtp: vi.fn(),
      verifyOtp: vi.fn(),
    },
    parentChildren: {
      list: vi.fn(),
      schools: vi.fn(),
      claim: vi.fn(),
    },
  };
});

// Mock catalog for HomeHero
vi.mock('../../data/catalog', () => ({
  useStoreSchools: () => ({ data: [], isLoading: false }),
}));

describe('Prompt 2: Parent OTP Entrance and Sheet Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.user = null;
    mockAuthState.loading = false;
    setLang('en');
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('in account mode, renders account title and "Staff sign in" link to /login', () => {
    render(
      <MemoryRouter>
        <ParentSignInSheet open={true} onClose={vi.fn()} onDone={vi.fn()} mode="account" />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Sign in with your mobile number'
    );
    const staffLink = screen.getByText('Staff sign in');
    expect(staffLink).toBeTruthy();
    expect(staffLink.getAttribute('href')).toBe('/login');
  });

  it('in order mode, renders order title and moves to children step after verify', async () => {
    (authApi.sendOtp as any).mockResolvedValueOnce({ status: 'ok', otp_debug: '123456' });
    mockSignInWithOtp.mockResolvedValueOnce({
      user: { id: 'p1', role: 'PARENT' },
      childrenLinked: 1,
    });
    (parentChildren.list as any).mockResolvedValueOnce({
      results: [{ id: 'c1', name: 'Aarav Test', school_name: 'DPS', active: true }],
    });

    const onDone = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <ParentSignInSheet open={true} onClose={vi.fn()} onDone={onDone} mode="order" />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Sign in to order');

    // Enter phone
    const phoneInput = container.querySelector('#psi-phone') as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: '9820011223' } });
    fireEvent.click(screen.getByRole('button', { name: /Send OTP/i }));

    await waitFor(() => {
      expect(container.querySelector('#psi-otp')).toBeTruthy();
    });

    // Enter OTP
    const otpInput = container.querySelector('#psi-otp') as HTMLInputElement;
    fireEvent.change(otpInput, { target: { value: '123456' } });

    await waitFor(() => {
      expect(mockSignInWithOtp).toHaveBeenCalledWith('9820011223', '123456');
      expect(parentChildren.list).toHaveBeenCalled();
    });

    // Children step rendered
    await waitFor(() => {
      expect(screen.getByText('Aarav Test')).toBeTruthy();
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('in account mode, successful verify immediately calls onDone(null)', async () => {
    (authApi.sendOtp as any).mockResolvedValueOnce({ status: 'ok' });
    mockSignInWithOtp.mockResolvedValueOnce({
      user: { id: 'p1', role: 'PARENT' },
      childrenLinked: 0,
    });

    const onDone = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <ParentSignInSheet open={true} onClose={vi.fn()} onDone={onDone} mode="account" />
      </MemoryRouter>
    );

    const phoneInput = container.querySelector('#psi-phone') as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: '9820011223' } });
    fireEvent.click(screen.getByRole('button', { name: /Send OTP/i }));

    await waitFor(() => {
      expect(container.querySelector('#psi-otp')).toBeTruthy();
    });

    const otpInput = container.querySelector('#psi-otp') as HTMLInputElement;
    fireEvent.change(otpInput, { target: { value: '654321' } });

    await waitFor(() => {
      expect(mockSignInWithOtp).toHaveBeenCalledWith('9820011223', '654321');
      expect(onDone).toHaveBeenCalledWith(null);
    });
  });

  it('displays correct messages for each error code: otp_wrong, otp_expired, staff_account, 429 too many, and offline', async () => {
    (authApi.sendOtp as any).mockResolvedValue({ status: 'ok' });

    // 1. otp_wrong
    mockSignInWithOtp.mockRejectedValueOnce(
      new ApiError('Wrong code', 400, { code: 'otp_wrong' })
    );

    const { container } = render(
      <MemoryRouter>
        <ParentSignInSheet open={true} onClose={vi.fn()} onDone={vi.fn()} mode="account" />
      </MemoryRouter>
    );

    const phoneInput = container.querySelector('#psi-phone') as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: '9820011223' } });
    fireEvent.click(screen.getByRole('button', { name: /Send OTP/i }));

    await waitFor(() => expect(container.querySelector('#psi-otp')).toBeTruthy());
    const otpInput = container.querySelector('#psi-otp') as HTMLInputElement;
    fireEvent.change(otpInput, { target: { value: '111111' } });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'That OTP is wrong or old. Try again.'
      );
    });

    // 2. otp_expired
    mockSignInWithOtp.mockRejectedValueOnce(
      new ApiError('Expired code', 400, { code: 'otp_expired' })
    );
    fireEvent.change(otpInput, { target: { value: '222222' } });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'That code has expired or was used up. Send a new code.'
      );
    });

    // 3. staff_account
    mockSignInWithOtp.mockRejectedValueOnce(
      new ApiError('Staff account', 400, { code: 'staff_account' })
    );
    fireEvent.change(otpInput, { target: { value: '333333' } });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Staff accounts sign in with a username and password.'
      );
    });

    // 4. 429 too many
    mockSignInWithOtp.mockRejectedValueOnce(
      new ApiError('Throttled', 429, {})
    );
    fireEvent.change(otpInput, { target: { value: '444444' } });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Too many tries. Please wait a few minutes.'
      );
    });

    // 5. Offline error
    mockSignInWithOtp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.change(otpInput, { target: { value: '555555' } });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'No internet. Your order is saved on this phone. Tap Place order again when you are online.'
      );
    });
  });

  it('resend timer counts down and re-enables resend link', async () => {
    vi.useFakeTimers();
    (authApi.sendOtp as any).mockResolvedValue({ status: 'ok' });

    const { container } = render(
      <MemoryRouter>
        <ParentSignInSheet open={true} onClose={vi.fn()} onDone={vi.fn()} mode="account" />
      </MemoryRouter>
    );

    const phoneInput = container.querySelector('#psi-phone') as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: '9820011223' } });
    fireEvent.click(screen.getByRole('button', { name: /Send OTP/i }));

    // Fast-forward initial async resolution
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Send again in 30 seconds/i)).toBeTruthy();

    // Advance 30 seconds step by step
    for (let i = 0; i < 30; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }

    expect(screen.getByRole('button', { name: /Send OTP again/i })).toBeTruthy();
  });

  it('clicking Change number resets OTP state and returns to phone step', async () => {
    (authApi.sendOtp as any).mockResolvedValue({ status: 'ok', otp_debug: '999888' });

    const { container } = render(
      <MemoryRouter>
        <ParentSignInSheet open={true} onClose={vi.fn()} onDone={vi.fn()} mode="account" />
      </MemoryRouter>
    );

    const phoneInput = container.querySelector('#psi-phone') as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: '9820011223' } });
    fireEvent.click(screen.getByRole('button', { name: /Send OTP/i }));

    await waitFor(() => expect(container.querySelector('#psi-otp')).toBeTruthy());
    expect(screen.getByText(/Test mode: your code is 999888/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    await waitFor(() => {
      expect(container.querySelector('#psi-phone')).toBeTruthy();
      expect(screen.queryByText(/Test mode/i)).toBeNull();
    });
  });

  it('Header account entrance opens the sheet when signed out', () => {
    let sheetOpened = false;
    const TestConsumer = () => {
      const { open } = useAccountSheet();
      sheetOpened = open;
      return <Header />;
    };

    render(
      <MemoryRouter>
        <AccountSheetProvider>
          <TestConsumer />
        </AccountSheetProvider>
      </MemoryRouter>
    );

    const signinLink = screen.getByText('Sign in');
    fireEvent.click(signinLink);

    expect(sheetOpened).toBe(true);
  });

  it('HomeHero account entrance opens the sheet when signed out', () => {
    let sheetOpened = false;
    const TestConsumer = () => {
      const { open } = useAccountSheet();
      sheetOpened = open;
      return <HomeHero />;
    };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AccountSheetProvider>
            <TestConsumer />
          </AccountSheetProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const accountBtn = screen.getByLabelText('Sign in');
    fireEvent.click(accountBtn);

    expect(sheetOpened).toBe(true);
  });

  it('signed-out visit to /parent/orders opens the sheet and sets returnTo', async () => {
    mockAuthState.user = null;
    let sheetState = { open: false, returnTo: null as string | null };

    const StateWatcher = () => {
      const state = useAccountSheet();
      sheetState.open = state.open;
      sheetState.returnTo = state.returnTo;
      return null;
    };

    render(
      <MemoryRouter initialEntries={['/parent/orders']}>
        <AccountSheetProvider>
          <StateWatcher />
          <Routes>
            <Route path="/" element={<div>Home Page</div>} />
            <Route
              path="/parent/orders"
              element={
                <Guard roles={['PARENT']}>
                  <div>Orders Content</div>
                </Guard>
              }
            />
          </Routes>
        </AccountSheetProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(sheetState.open).toBe(true);
      expect(sheetState.returnTo).toBe('/parent/orders');
      expect(screen.getByText('Home Page')).toBeTruthy();
    });
  });
});
