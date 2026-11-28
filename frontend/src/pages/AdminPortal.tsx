import { Routes, Route, NavLink, Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { SchoolBuilding, Package, Receipt, ArrowRight, SignOut, Users } from '../components/ui/icons';
import { UniformCatalogView } from '../components/admin/UniformCatalogView';
import { SchoolManagerView } from '../components/admin/SchoolManagerView';
import { CityAvailabilityView } from '../components/admin/CityAvailabilityView';
import { CityPricingView } from '../components/admin/CityPricingView';
import { TeacherControlView } from '../components/admin/TeacherControlView';
import '../components/admin/portal.css';

export default function AdminPortal() {
  const { user, signOut } = useAuth();
  const backPanelPath = user?.role === 'BOSS' ? '/boss' : user?.city_name ? '/city' : '/portal';

  return (
    <div className="portal-root">
      {/* Top Bar */}
      <header className="portal-topbar">
        <div className="portal-topbar-inner">
          <div className="portal-brand-block">
            <Link to={backPanelPath} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className="portal-brand-mark">S</div>
              <span className="portal-brand-text">SchoolStore</span>
            </Link>
            <span className="portal-brand-badge">Uniform Operations Portal</span>
          </div>

          <div className="portal-topbar-actions">
            <span className="portal-user-badge">
              {user?.username} ({user?.role === 'BOSS' ? 'Boss' : user?.city_name || 'All India'})
            </span>

            {backPanelPath !== '/portal' && (
              <Link to={backPanelPath} className="portal-btn portal-btn-secondary portal-btn-sm" style={{ textDecoration: 'none' }}>
                Back to {user?.role === 'BOSS' ? 'Executive Panel' : 'City Panel'}
              </Link>
            )}

            <Link
              to="/shop"
              target="_blank"
              rel="noreferrer"
              className="portal-link-store"
            >
              <span>Customer Storefront</span>
              <ArrowRight width={14} height={14} />
            </Link>

            <button
              type="button"
              className="portal-btn-signout"
              onClick={signOut}
              title="Sign Out"
            >
              <SignOut width={14} height={14} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="portal-nav-bar" aria-label="Portal Navigation">
        <div className="portal-nav-inner">
          <NavLink
            to=""
            end
            className={({ isActive }) => `portal-nav-tab ${isActive ? 'active' : ''}`}
          >
            <Package width={17} height={17} />
            <span>Uniform Catalogue</span>
          </NavLink>

          <NavLink
            to="schools"
            className={({ isActive }) => `portal-nav-tab ${isActive ? 'active' : ''}`}
          >
            <SchoolBuilding width={17} height={17} />
            <span>Schools & Campuses</span>
          </NavLink>

          <NavLink
            to="stock"
            className={({ isActive }) => `portal-nav-tab ${isActive ? 'active' : ''}`}
          >
            <Package width={17} height={17} />
            <span>City Stock & Availability</span>
          </NavLink>

          <NavLink
            to="pricing"
            className={({ isActive }) => `portal-nav-tab ${isActive ? 'active' : ''}`}
          >
            <Receipt width={17} height={17} />
            <span>City Pricing & Overrides</span>
          </NavLink>

          <NavLink
            to="teachers"
            className={({ isActive }) => `portal-nav-tab ${isActive ? 'active' : ''}`}
          >
            <Users width={17} height={17} />
            <span>Teachers & ID Access</span>
          </NavLink>
        </div>
      </nav>

      {/* Main Content */}
      <main className="portal-main">
        <Routes>
          <Route index element={<UniformCatalogView />} />
          <Route path="uniforms" element={<UniformCatalogView />} />
          <Route path="schools" element={<SchoolManagerView />} />
          <Route path="stock" element={<CityAvailabilityView />} />
          <Route path="pricing" element={<CityPricingView />} />
          <Route path="prices" element={<CityPricingView />} />
          <Route path="teachers" element={<TeacherControlView />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="portal-footer">
        SchoolStore Operations Portal · All catalogue and stock updates synchronize live via REST API
      </footer>
    </div>
  );
}
