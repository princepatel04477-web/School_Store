import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { homeFor } from '../App';
import { logout } from '../api';
import { BackButton } from '../components/BackButton';
import { ParentSignInSheet } from '../components/parent/ParentSignInSheet';

const ROLE_LABEL: Record<string, string> = {
  BOSS: 'Owner',
  ADMIN: 'City admin',
  SCHOOL_ADMIN: 'School admin',
  TEACHER: 'Teacher',
  PARENT: 'Parent',
  RETAILER: 'Shop',
};

/**
 * Parents sign in, or make their account the first time, with a mobile number
 * and a code. Staff use the username and password form underneath.
 */
export default function Login() {
  const nav = useNavigate();
  const { user, signIn } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitStaff(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const signedIn = await signIn(login.trim(), password.trim());
      nav(homeFor(signedIn.role, signedIn.city));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  }

  const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.phone || user.username : '';

  return (
    <div className="login-page">
      <div className="login-art">
        <div className="login-art-bar">
          <BackButton className="login-back-btn" />
          <span className="brand-mark">S</span>
        </div>
        <p>
          Everything your<br />
          <strong>school day</strong> needs.
        </p>
      </div>
      <div className="login-card">
        <div className="eyebrow">WELCOME TO SCHOOLSTORE</div>
        <h1>Sign in or create an account</h1>

        {user && (
          <div className="login-current" role="status">
            <p>
              You are signed in as <strong>{name}</strong>
              <span className="login-current-role">{ROLE_LABEL[user.role] ?? user.role}</span>
            </p>
            <div className="login-current-actions">
              <button type="button" className="secondary" onClick={() => nav(homeFor(user.role, user.city))}>
                Open my account
              </button>
              <button type="button" className="secondary" onClick={() => logout()}>
                Sign out
              </button>
            </div>
            {user.role !== 'PARENT' && (
              <p className="muted login-current-hint">
                Buying for your child? Use your mobile number below. It opens a separate parent account.
              </p>
            )}
          </div>
        )}

        <p className="muted">
          Parents: enter your mobile number and the 6-digit code. New number? Your account is made right away.
        </p>
        <button type="button" className="primary full login-mobile-cta" onClick={() => setSheetOpen(true)}>
          Continue with mobile number <span>→</span>
        </button>

        <button
          type="button"
          className="link-button"
          aria-expanded={staffOpen}
          onClick={() => setStaffOpen((v) => !v)}
        >
          {staffOpen ? 'Hide staff sign in' : 'School or shop staff? Sign in with username'}
        </button>

        {staffOpen && (
          <form onSubmit={submitStaff} className="login-staff-form">
            <label>
              Username or phone
              <input
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="e.g. shop1"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary full" disabled={busy}>
              {busy ? 'Please wait…' : 'Sign in'} <span>→</span>
            </button>
          </form>
        )}

        <Link className="link-button" to="/shop">
          Just browsing? View the catalogue
        </Link>
      </div>

      <ParentSignInSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onDone={() => {
          setSheetOpen(false);
          nav('/parent');
        }}
      />
    </div>
  );
}
