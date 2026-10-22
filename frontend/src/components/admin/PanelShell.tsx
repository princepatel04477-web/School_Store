import type { ComponentType, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth';
import { SignOut, type IconProps } from '../ui/icons';
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
 * The frame every staff panel (boss, city admin, school admin) sits in:
 * a navy top bar like the store's, a sidebar of sections on wide screens,
 * and a row of tabs under the bar on phones.
 */
export function PanelShell({
  base,
  role,
  context,
  nav,
  children,
}: {
  base: string;
  /** Short role name shown next to the logo, e.g. "City Admin Panel". */
  role: string;
  /** What this panel is looking at: a city, a school, or a school picker. */
  context?: ReactNode;
  nav: PanelNavItem[];
  children: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const isCurrent = (item: PanelNavItem) =>
    item.end ? pathname === base || pathname === `${base}/` : pathname.startsWith(`${base}/${item.to}`);
  const initial = user?.username?.slice(0, 1).toUpperCase();

  return (
    <div className="admin">
      <header className="admin-top">
        <Link to={base} className="admin-brand">
          <span className="brand-mark">S</span>
          <span className="admin-brand-name">SchoolStore</span>
        </Link>
        <span className="admin-divider" aria-hidden="true" />
        <span className="admin-role">{role}</span>
        {context && <div className="admin-context">{context}</div>}
        <div className="admin-user">
          <span className="admin-avatar" aria-hidden="true">{initial}</span>
          <span className="admin-username">{user?.username}</span>
          <button type="button" className="admin-signout" onClick={signOut} aria-label="Sign out">
            <SignOut width={18} height={18} />
          </button>
        </div>
      </header>

      <div className="admin-body">
        <nav className="admin-nav" aria-label={role}>
          {nav.map((item) => {
            const Icon = item.icon;
            const current = isCurrent(item);
            return (
              <Link
                key={item.to}
                to={item.to ? `${base}/${item.to}` : base}
                className={current ? 'active' : ''}
                aria-current={current ? 'page' : undefined}
              >
                <Icon width={18} height={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
