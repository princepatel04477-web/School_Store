// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ParentSignInSheet } from './ParentSignInSheet';

const signUp = vi.fn();
const signIn = vi.fn();

vi.mock('../../auth', () => ({
  useAuth: () => ({ user: null, signIn, signUp, signInWithOtp: vi.fn() }),
}));

vi.mock('../../api', () => {
  class ApiError extends Error {
    constructor(message: string, public status: number, public data: Record<string, unknown> = {}) {
      super(message);
    }
  }
  return {
    ApiError,
    auth: { sendOtp: vi.fn() },
    parentChildren: { list: vi.fn().mockResolvedValue({ results: [] }), schools: vi.fn().mockResolvedValue([]) },
  };
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('ParentSignInSheet', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    signUp.mockReset();
    signIn.mockReset();
  });

  it('opens on the choice between OTP and a user ID', () => {
    render(<ParentSignInSheet open onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText('Sign in with mobile OTP')).toBeTruthy();
    expect(screen.getByText('Create account with user ID and password')).toBeTruthy();
    expect(screen.getByText('Already have a user ID? Sign in with password')).toBeTruthy();
  });

  it('creates an account with a lower-case user ID and the 10-digit mobile', async () => {
    signUp.mockResolvedValue({ role: 'PARENT' });
    const onDone = vi.fn();
    render(<ParentSignInSheet open initialStep="register" skipChildPicker onClose={() => {}} onDone={onDone} />);
    fill('Your name', 'Ravi Kumar Patel');
    fill('Mobile number', '98200 11223');
    fill('Choose a user ID', 'Ravi.Patel');
    fill('Choose a password', 'secret12');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
    expect(signUp).toHaveBeenCalledWith({
      phone: '9820011223',
      username: 'ravi.patel',
      password: 'secret12',
      first_name: 'Ravi',
      last_name: 'Kumar Patel',
    });
  });

  it('points to OTP when the mobile number already has an account', async () => {
    const { ApiError } = (await import('../../api')) as unknown as {
      ApiError: new (m: string, s: number, d: Record<string, unknown>) => Error;
    };
    signUp.mockRejectedValue(new ApiError('bad', 400, { phone: ['An account with this phone number already exists.'] }));
    render(<ParentSignInSheet open initialStep="register" onClose={() => {}} onDone={() => {}} />);
    fill('Your name', 'Ravi');
    fill('Mobile number', '9820011223');
    fill('Choose a user ID', 'ravi1');
    fill('Choose a password', 'secret12');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/already has an account/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with mobile OTP' })).toBeTruthy();
  });

  it('says the password is wrong on a refused sign-in', async () => {
    const { ApiError } = (await import('../../api')) as unknown as {
      ApiError: new (m: string, s: number, d: Record<string, unknown>) => Error;
    };
    signIn.mockRejectedValue(new ApiError('No active account', 401, {}));
    render(<ParentSignInSheet open initialStep="password" onClose={() => {}} onDone={() => {}} />);
    fill('User ID or mobile number', 'ravi1');
    fill('Password', 'nope1234');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/User ID or password is wrong/)).toBeTruthy();
  });
});
