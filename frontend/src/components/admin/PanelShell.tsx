import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth';
import { Menu, SignOut, X, type IconProps } from '../ui/icons';
import './panel.css';

export interface PanelNavItem {
  /** Path under the panel's base; '' is the panel's home. */
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  /** Only the exact base path counts as this item (the home item). */
  end?: boolean;
}

/**
 * The frame every staff panel (boss, city admin, school admin) sits in.
 * Wide screens: a full-height navy sidebar (brand, what this panel looks at,
 * the sections, the signed-in person) and the page beside it, no top bar.
 * Phones: a slim navy bar whose menu button opens the same sidebar as a drawer.
 */
export function PanelShell({
  base,
  role,
  context,
  nav,
  children,
}: {
  base: string;
  /** Short role name, e.g. "City Admin Panel". */
  role: string;
  /** What this panel is looking at: a city, a school, or a school picker. */
  context?: ReactNode;
  nav: PanelNavItem[];
  children: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // A new section closes the phone drawer
  useEffect(() => setMenuOpen(false), [pathname]);

  const isCurrent = (item: PanelNavItem) =>
    item.end ? pathname === base || pathname === `${base}/` : pathname.startsWith(`${base}/${item.to}`);
  const current = nav.find(isCurrent);
  const initial = user?.username?.slice(0, 1).toUpperCase();

  return (
    <div className={`admin ${menuOpen ? 'menu-open' : ''}`}>
      {/* Phones only */}
      <header className="admin-mobilebar">
        <button
          type="button"
          className="admin-menu-btn"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X width={20} height={20} /> : <Menu width={20} height={20} />}
        </button>
        <Link to={base} className="admin-brand">
          <span className="brand-mark">S</span>
        </Link>
        <span className="admin-mobile-title">{current?.label ?? role}</span>
      </header>

      <aside className="admin-side" aria-label={role}>
        <Link to={base} className="admin-brand">
          <span className="brand-mark">S</span>
          <span className="admin-brand-name">SchoolStore</span>
        </Link>

        <div className="admin-workspace">
          <span className="admin-role">{role}</span>
          {context && <div className="admin-context">{context}</div>}
        </div>

        <nav className="admin-nav">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = item === current;
            return (
              <Link
                key={item.to}
                to={item.to ? `${base}/${item.to}` : base}
                className={active ? 'active' : ''}
                aria-current={active ? 'page' : undefined}
              >
                <Icon width={18} height={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="admin-user">
          <span className="admin-avatar" aria-hidden="true">{initial}</span>
          <span className="admin-username">{user?.username}</span>
          <button type="button" className="admin-signout" onClick={signOut} aria-label="Sign out" title="Sign out">
            <SignOut width={18} height={18} />
          </button>
        </div>
      </aside>

      {menuOpen && <div className="admin-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <main className="admin-main">{children}</main>
    </div>
  );
}
