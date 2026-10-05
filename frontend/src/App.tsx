import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, Link } from 'react-router-dom';
import { useAuth } from './auth';
import { Catalogue } from './components/Store';

const Login = lazy(() => import('./pages/Login'));
const Parent = lazy(() => import('./pages/Parent'));
const Teacher = lazy(() => import('./pages/Teacher'));
const SchoolAdmin = lazy(() => import('./pages/SchoolAdmin'));
const Boss = lazy(() => import('./pages/Boss'));

/** Where each role lands after signing in. */
export const homeFor = (role?: string) =>
  role === 'PARENT' ? '/parent'
  : role === 'TEACHER' ? '/teacher'
  : role === 'BOSS' ? '/boss'
  : '/school';

function Guard({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="splash">Loading your store…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<div className="splash">Loading…</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/boss/*" element={<Guard roles={['BOSS']}><Boss /></Guard>} />
        <Route path="/school/*" element={<Guard roles={['SCHOOL_ADMIN', 'ADMIN', 'BOSS']}><SchoolAdmin /></Guard>} />
        <Route path="/parent/*" element={<Guard roles={['PARENT']}><Parent /></Guard>} />
        <Route path="/teacher/*" element={<Guard roles={['TEACHER', 'SCHOOL_ADMIN']}><Teacher /></Guard>} />
        <Route path="/shop" element={<Shop />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Suspense>
  );
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="splash">Loading your store…</div>;
  return user ? <Navigate to={homeFor(user.role)} replace /> : <Shop />;
}

function Shop() {
  const { user } = useAuth();
  return (
    <div className="app">
      <header>
        <Link to="/shop" className="brand">
          <span className="brand-mark">S</span>
          <span>School<span className="ink">Store</span></span>
        </Link>
        <div className="header-right">
          {user ? (
            <Link className="text-button" to={homeFor(user.role)}>My account</Link>
          ) : (
            <Link className="text-button" to="/login">Sign in</Link>
          )}
        </div>
      </header>
      <main>
        <div className="eyebrow">WELCOME</div>
        <h1>School essentials, sorted.</h1>
        <Catalogue publicView />
      </main>
    </div>
  );
}

export function Shell({ children, title }: { children: ReactNode; title: string }) {
  const { user, signOut } = useAuth();
  const home = homeFor(user?.role);
  return (
    <div className="app">
      <header>
        <Link to={home} className="brand">
          <span className="brand-mark">S</span>
          <span>School<span className="ink">Store</span></span>
        </Link>
        <div className="header-right">
          <span className="avatar">{user?.username?.slice(0, 1).toUpperCase()}</span>
          <button className="icon-btn" onClick={signOut} aria-label="Sign out">↗</button>
        </div>
      </header>
      <main>
        <div className="eyebrow">{user?.role === 'PARENT' ? 'PARENT SPACE' : 'SCHOOL STAFF'}</div>
        <h1>{title}</h1>
        {children}
      </main>
      <nav className="bottom-nav">
        <Link to={home}>⌂<small>Home</small></Link>
        <Link to={user?.role === 'PARENT' ? '/parent/orders' : '/teacher/students'}>
          ▣<small>{user?.role === 'PARENT' ? 'Orders' : 'Students'}</small>
        </Link>
        <Link to="#" onClick={(e) => { e.preventDefault(); signOut(); }}>↗<small>Sign out</small></Link>
      </nav>
    </div>
  );
}
