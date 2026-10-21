import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageTransition } from './motion/PageTransition';
import { useSchoolTheme } from './theme/schoolTheme';
import { hasChosenLanguage, useLang } from './i18n';
import { LanguageChooser } from './components/LanguageChooser';

// Lazy Loaded Components
const BagDrawer = lazy(() =>
  import('./components/cart/BagDrawer').then((m) => ({ default: m.BagDrawer }))
);

// Lazy Loaded Pages
const SchoolSearchSheet = lazy(() =>
  import('./components/school/SchoolSearchSheet').then((m) => ({ default: m.SchoolSearchSheet }))
);
const HomePage = lazy(() =>
  import('./pages/HomePage').then((m) => ({ default: m.HomePage }))
);
const SelectionFlowPage = lazy(() =>
  import('./pages/SelectionFlowPage').then((m) => ({ default: m.SelectionFlowPage }))
);
const CheckoutPage = lazy(() =>
  import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage }))
);
const Login = lazy(() => import('./pages/Login'));
const Parent = lazy(() => import('./pages/Parent'));
const Teacher = lazy(() => import('./pages/Teacher'));
const SchoolAdmin = lazy(() => import('./pages/SchoolAdmin'));
const CityAdmin = lazy(() => import('./pages/CityAdmin'));
const BossPanel = lazy(() => import('./pages/BossPanel'));

import { ComingSoonPage, NotFoundPage } from './pages/InfoPages';
import { PrivacyPage, TermsPage, RefundPage } from './pages/LegalPages';

export const homeFor = (role?: string) =>
  role === 'BOSS'
    ? '/boss'
    : role === 'PARENT'
    ? '/parent'
    : role === 'TEACHER'
    ? '/teacher'
    : role === 'ADMIN'
    ? '/city'
    : '/school';

function Guard({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="splash">Loading your store…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

import { SmoothScroll } from './motion/SmoothScroll';

export default function App() {
  const [bagOpen, setBagOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();

  const isPortal =
    location.pathname.startsWith('/boss') ||
    location.pathname.startsWith('/city') ||
    location.pathname.startsWith('/school') ||
    location.pathname.startsWith('/teacher') ||
    location.pathname.startsWith('/login');

  useSchoolTheme(!isPortal);

  // First visit to the store: ask for the language before anything else.
  const { hasChosen, setLang } = useLang();
  const [langOpen, setLangOpen] = useState(false);
  useEffect(() => {
    if (!isPortal && !hasChosen) setLangOpen(true);
  }, [isPortal, hasChosen]);
  const closeLanguage = () => {
    // Closed without picking: stay in English and don't ask on every page.
    if (!hasChosenLanguage()) setLang('en');
    setLangOpen(false);
  };

  return (
    <ErrorBoundary>
      <SmoothScroll>
        <div className="store-application-root">
        {/* Render global Header for storefront */}
        {!isPortal && (
          <Header
            onOpenBag={() => setBagOpen(true)}
            onOpenLanguage={() => setLangOpen(true)}
            onOpenSearch={() => {
              // Phones, and pages without the home search: the full-screen search sheet
              const input = document.querySelector('.hero-search-input') as HTMLInputElement | null;
              if (!input || window.matchMedia('(max-width: 639px)').matches) return setSearchOpen(true);
              window.scrollTo({ top: 0, behavior: 'smooth' });
              input.focus();
            }}
          />
        )}

        <PageTransition>
          <Suspense fallback={<div className="splash">Loading…</div>}>
            <Routes>
              {/* Public Storefront Routes */}
              <Route path="/" element={<HomePage />} />
              <Route
                path="/shop"
                element={<SelectionFlowPage onOpenBag={() => setBagOpen(true)} />}
              />
              <Route
                path="/flow"
                element={<SelectionFlowPage onOpenBag={() => setBagOpen(true)} />}
              />
              <Route path="/checkout" element={<CheckoutPage />} />

              {/* Informational pages */}
              <Route path="/about" element={<ComingSoonPage title="About SchoolStore" />} />
              <Route path="/for-schools" element={<ComingSoonPage title="For Partner Schools" />} />
              <Route path="/contact" element={<ComingSoonPage title="Contact Us" />} />
              <Route path="/help" element={<ComingSoonPage title="Help & FAQs" />} />
              <Route path="/size-guide" element={<ComingSoonPage title="Size Guide" />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/refunds" element={<RefundPage />} />

              {/* Protected Management / Portal Routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/boss/*" element={<Guard roles={['BOSS']}><BossPanel /></Guard>} />
              <Route path="/city/*" element={<Guard roles={['ADMIN', 'BOSS']}><CityAdmin /></Guard>} />
              <Route path="/school/*" element={<Guard roles={['SCHOOL_ADMIN', 'ADMIN', 'BOSS']}><SchoolAdmin /></Guard>} />
              <Route path="/parent/*" element={<Guard roles={['PARENT']}><Parent /></Guard>} />
              <Route path="/teacher/*" element={<Guard roles={['TEACHER', 'SCHOOL_ADMIN']}><Teacher /></Guard>} />

              {/* Fallback 404 */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </PageTransition>

        {/* Global Footer for storefront */}
        {!isPortal && <Footer />}

        {!isPortal && <LanguageChooser open={langOpen} onClose={closeLanguage} />}

        {searchOpen && (
          <Suspense fallback={null}>
            <SchoolSearchSheet onClose={() => setSearchOpen(false)} />
          </Suspense>
        )}

        {/* Global Bag Drawer (code-split) */}
        <Suspense fallback={null}>
          <BagDrawer isOpen={bagOpen} onClose={() => setBagOpen(false)} />
        </Suspense>
      </div>
      </SmoothScroll>
    </ErrorBoundary>
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
