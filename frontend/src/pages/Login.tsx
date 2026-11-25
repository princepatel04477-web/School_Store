import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { homeFor } from '../App';
import { ParentSignInSheet } from '../components/parent/ParentSignInSheet';
import { KeyIcon, Smartphone, UserPlus } from '../components/ui/icons';

/**
 * Parents choose: sign in with mobile OTP, or create an account with a user ID
 * and password (and sign in with it later). Staff use the username form underneath.
 */
export default function Login() {
  const nav = useNavigate();
  const { user, signIn } = useAuth();
  const [sheetStep, setSheetStep] = useState<'phone' | 'password' | 'register' | null>(null);
  const [finished, setFinished] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Once the sheet signs someone in, send them to their own home
  useEffect(() => {
    if (finished && user) nav(homeFor(user.role), { replace: true });
  }, [finished, user, nav]);

  async function submitStaff(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const signedIn = await signIn(login.trim(), password.trim());
      nav(homeFor(signedIn.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-art">
        <span className="brand-mark">S</span>
        <p>
          Everything your<br />
          <strong>school day</strong> needs.
        </p>
      </div>
      <div className="login-card">
        <div className="eyebrow">WELCOME TO SCHOOLSTORE</div>
        <h1>Sign in or create an account</h1>
        <p className="muted">Parents: choose how you want to continue.</p>

        <div className="login-choices">
          <button type="button" className="login-choice" onClick={() => setSheetStep('phone')}>
            <Smartphone width={26} height={26} strokeWidth={1.6} />
            <span>
              <strong>Sign in with mobile OTP</strong>
              <small>We send a 6-digit code. New number? Your account is made right away.</small>
            </span>
          </button>
          <button type="button" className="login-choice" onClick={() => setSheetStep('register')}>
            <UserPlus width={26} height={26} strokeWidth={1.6} />
            <span>
              <strong>Create account with user ID and password</strong>
              <small>Choose your own user ID and password.</small>
            </span>
          </button>
          <button type="button" className="login-choice login-choice-quiet" onClick={() => setSheetStep('password')}>
            <KeyIcon width={22} height={22} strokeWidth={1.6} />
            <span>
              <strong>Already have a user ID? Sign in with password</strong>
            </span>
          </button>
        </div>

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
                autoCapitalize="none"
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
              {busy ? 'Please wait…' : 'Sign in'}
            </button>
          </form>
        )}

        <Link className="link-button" to="/shop">
          Just browsing? View the catalogue
        </Link>
      </div>

      {sheetStep && (
        <ParentSignInSheet
          open
          initialStep={sheetStep}
          skipChildPicker
          onClose={() => setSheetStep(null)}
          onDone={() => {
            setSheetStep(null);
            setFinished(true);
          }}
        />
      )}
    </div>
  );
}
