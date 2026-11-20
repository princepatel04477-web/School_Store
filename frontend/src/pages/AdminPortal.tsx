import { useState, type FormEvent } from 'react';
import { Routes, Route, NavLink, Link, useNavigate } from 'react-router-dom';
import { SchoolBuilding, Package, Clock, ArrowRight, Check } from '../components/ui/icons';
import { SchoolManagerView } from '../components/admin/SchoolManagerView';
import { UniformCatalogView } from '../components/admin/UniformCatalogView';
import { CityAvailabilityView } from '../components/admin/CityAvailabilityView';
import { useAuth } from '../auth';

export default function AdminPortal() {
  const { user, signIn, signOut } = useAuth();
  const navigate = useNavigate();

  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);

  // Check if authenticated as uniform admin, boss, or admin
  const isAuth =
    localStorage.getItem('uniform_admin_auth') === 'true' ||
    user?.role === 'UNIFORM_ADMIN' ||
    user?.role === 'BOSS' ||
    user?.role === 'ADMIN';

  const handlePortalLogin = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setBusy(true);

    const u = usernameInput.trim().toLowerCase();
    const p = passwordInput.trim();

    const isMatch =
      (u === 'uniform admin' || u === 'uniform_admin' || u === 'uniformadmin' || u === 'admin') &&
      (p === 'admin@123' || p === 'admin at thread 123');

    if (isMatch) {
      try {
        await signIn(u, p);
      } catch {
        // Fallback for offline/mock
      }
      localStorage.setItem('uniform_admin_auth', 'true');
      setBusy(false);
      return;
    }

    try {
      await signIn(u, p);
      localStorage.setItem('uniform_admin_auth', 'true');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid credentials. Please enter ID: uniform admin and Password: admin@123');
    } finally {
      setBusy(false);
    }
  };

  const handlePortalLogout = () => {
    localStorage.removeItem('uniform_admin_auth');
    localStorage.removeItem('access');
    localStorage.removeItem('refresh');
    signOut();
  };

  if (!isAuth) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #063d27 0%, #0e5b38 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'var(--font-body, system-ui, sans-serif)',
        }}
      >
        <div
          style={{
            maxWidth: '440px',
            width: '100%',
            background: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
            padding: '36px 32px',
          }}
        >
          {/* Brand header */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                margin: '0 auto 16px',
                borderRadius: '12px',
                background: 'var(--brand, #0e5b38)',
                color: '#ffffff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: '24px',
                fontFamily: 'var(--font-display, inherit)',
                boxShadow: '0 8px 16px rgba(14, 91, 56, 0.25)',
              }}
            >
              SS
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
              Management Portal
            </h1>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
              Sign in with operations credentials to manage school catalog, uniform items & 24h city restock timers.
            </p>
          </div>

          <form onSubmit={handlePortalLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Admin User ID
              </label>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="uniform admin"
                required
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  borderRadius: '8px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Password
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  borderRadius: '8px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            {authError && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '12px',
                  color: '#991b1b',
                  lineHeight: 1.4,
                }}
              >
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                background: 'var(--brand, #0e5b38)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 700,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                marginTop: '4px',
              }}
            >
              <span>{busy ? 'Authenticating…' : 'Sign In to Portal'}</span>
              <ArrowRight width={16} height={16} />
            </button>
          </form>

          {/* Helper hint */}
          <div
            style={{
              marginTop: '22px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: '#f1f5f9',
              border: '1px dashed #cbd5e1',
              fontSize: '12px',
              color: '#475569',
              textAlign: 'center',
            }}
          >
            Authorized ID: <code style={{ fontWeight: 700, color: '#0e5b38' }}>uniform admin</code> &nbsp;|&nbsp;
            Password: <code style={{ fontWeight: 700, color: '#0e5b38' }}>admin@123</code>
          </div>

          <div style={{ textAlign: 'center', marginTop: '18px' }}>
            <Link to="/" style={{ fontSize: '13px', color: '#64748b', textDecoration: 'none' }}>
              ← Return to SchoolStore Frontpage
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-portal-shell" style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navbar */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div
          style={{
            maxWidth: '1360px',
            margin: '0 auto',
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: 'var(--brand, #0e5b38)',
                color: '#ffffff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: '18px',
                fontFamily: 'var(--font-display, inherit)',
              }}
            >
              SS
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                  SchoolStore Management Portal
                </span>
                <span
                  style={{
                    background: '#ecfdf5',
                    color: '#065f46',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    border: '1px solid #a7f3d0',
                  }}
                >
                  LIVE SYSTEM
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                Dedicated School, Uniform & 24h Stock Controller (Syncs App & Web)
              </p>
            </div>
          </div>

          {/* Quick External Actions & User status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#065f46',
                background: '#ecfdf5',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #a7f3d0',
              }}
            >
              <span>👤 Signed in as: <strong>uniform admin</strong></span>
            </div>

            <Link
              to="/shop"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--brand, #0e5b38)',
                background: 'var(--brand-tint, #ecfdf5)',
                padding: '8px 14px',
                borderRadius: '6px',
                textDecoration: 'none',
                border: '1px solid #a7f3d0',
              }}
            >
              <span>View Customer Storefront</span>
              <ArrowRight width={14} height={14} />
            </Link>

            <button
              type="button"
              onClick={handlePortalLogout}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#ef4444',
                background: '#fef2f2',
                padding: '7px 12px',
                borderRadius: '6px',
                border: '1px solid #fecaca',
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Portal Navigation Tabs */}
        <nav
          style={{
            maxWidth: '1360px',
            margin: '0 auto',
            padding: '0 24px',
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
          }}
        >
          <NavLink
            to=""
            end
            style={({ isActive }) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 18px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              color: isActive ? 'var(--brand, #0e5b38)' : '#64748b',
              borderBottom: isActive ? '3px solid var(--brand, #0e5b38)' : '3px solid transparent',
              transition: 'all 0.15s ease',
            })}
          >
            <Clock width={17} height={17} />
            <span>City Stock & 24h Timers</span>
          </NavLink>

          <NavLink
            to="uniforms"
            style={({ isActive }) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 18px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              color: isActive ? 'var(--brand, #0e5b38)' : '#64748b',
              borderBottom: isActive ? '3px solid var(--brand, #0e5b38)' : '3px solid transparent',
              transition: 'all 0.15s ease',
            })}
          >
            <Package width={17} height={17} />
            <span>Uniform Items & Sets</span>
          </NavLink>

          <NavLink
            to="schools"
            style={({ isActive }) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 18px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              color: isActive ? 'var(--brand, #0e5b38)' : '#64748b',
              borderBottom: isActive ? '3px solid var(--brand, #0e5b38)' : '3px solid transparent',
              transition: 'all 0.15s ease',
            })}
          >
            <SchoolBuilding width={17} height={17} />
            <span>Schools & Campuses</span>
          </NavLink>
        </nav>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, maxWidth: '1360px', width: '100%', margin: '0 auto', padding: '28px 24px' }}>
        <Routes>
          <Route index element={<CityAvailabilityView />} />
          <Route path="uniforms" element={<UniformCatalogView />} />
          <Route path="schools" element={<SchoolManagerView />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer style={{ background: '#ffffff', borderTop: '1px solid #e2e8f0', padding: '16px 24px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
        © 2025 School Store Operations Portal · All changes propagate live to Mobile App and Website
      </footer>
    </div>
  );
}
