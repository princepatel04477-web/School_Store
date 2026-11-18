import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { isNativeApp } from '../../native/nativePlatform';
import { setupNativeBackButton, handleNativeBack } from '../../native/backButton';
import { requestPageBack, hasStoreHistory } from '../BackButton';
import { setupNativeKeyboard } from '../../native/keyboard';
import {
  setupNativeStatusBar,
  setNativeStatusBarColor,
  STATUS_BAR_DEFAULT,
  STATUS_BAR_HOME,
} from '../../native/statusBar';
import { haptic } from '../../native/haptics';
import {
  ShoppingBag,
  Truck,
  Ruler,
  User,
  ArrowLeft,
  SchoolBuilding,
  Users,
  Overview,
  Package,
} from '../ui/icons';
import './nativeNavigation.css';

export interface TabItem {
  id: string;
  label: string;
  path: string;
  icon: (active: boolean) => ReactNode;
}

interface NativeNavigationProps {
  onOpenBag: () => void;
  bagCount?: number;
  /** Home has its own emerald header (logo, language, bag), so the compact top bar steps aside there. */
  hideTopBar?: boolean;
}

export function NativeNavigation({ onOpenBag, bagCount = 0, hideTopBar = false }: NativeNavigationProps) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [exitToast, setExitToast] = useState<string | null>(null);

  // Status Bar setup on mount
  useEffect(() => {
    if (!isNativeApp()) return;
    setupNativeStatusBar();
  }, []);

  // Home's emerald stage runs up to the status bar; other screens sit under the green top bar.
  useEffect(() => {
    if (!isNativeApp()) return;
    setNativeStatusBarColor(hideTopBar ? STATUS_BAR_HOME : STATUS_BAR_DEFAULT);
  }, [hideTopBar]);

  // Keyboard listener
  useEffect(() => {
    if (!isNativeApp()) return;
    let cleanup: (() => void) | undefined;
    setupNativeKeyboard((visible) => setKeyboardVisible(visible)).then((unsub) => {
      cleanup = unsub;
    });
    return () => cleanup?.();
  }, []);

  // Define tabs based on role
  const tabs: TabItem[] = useMemo(() => {
    const role = user?.role;
    if (role === 'TEACHER') {
      return [
        {
          id: 'teacher-home',
          label: 'Classes',
          path: '/teacher',
          icon: () => <SchoolBuilding width={22} height={22} />,
        },
        {
          id: 'teacher-students',
          label: 'Students',
          path: '/teacher/students',
          icon: () => <Users width={22} height={22} />,
        },
        {
          id: 'profile',
          label: 'Profile',
          path: '/profile',
          icon: () => <User width={22} height={22} />,
        },
      ];
    }
    if (role === 'SCHOOL_ADMIN') {
      return [
        {
          id: 'school-home',
          label: 'Overview',
          path: '/school',
          icon: () => <Overview width={22} height={22} />,
        },
        {
          id: 'school-classes',
          label: 'Classes',
          path: '/school/classes',
          icon: () => <SchoolBuilding width={22} height={22} />,
        },
        {
          id: 'school-orders',
          label: 'Orders',
          path: '/school/orders',
          icon: () => <Package width={22} height={22} />,
        },
        {
          id: 'profile',
          label: 'Profile',
          path: '/profile',
          icon: () => <User width={22} height={22} />,
        },
      ];
    }
    if (role === 'BOSS' || role === 'ADMIN') {
      const base = role === 'BOSS' ? '/boss' : '/city';
      return [
        {
          id: 'panel-home',
          label: 'Dashboard',
          path: base,
          icon: () => <Overview width={22} height={22} />,
        },
        {
          id: 'panel-schools',
          label: 'Schools',
          path: `${base}/schools`,
          icon: () => <SchoolBuilding width={22} height={22} />,
        },
        {
          id: 'panel-orders',
          label: 'Orders',
          path: `${base}/orders`,
          icon: () => <Package width={22} height={22} />,
        },
        {
          id: 'profile',
          label: 'Profile',
          path: '/profile',
          icon: () => <User width={22} height={22} />,
        },
      ];
    }

    // Default: Parent / Guest tabs
    return [
      {
        id: 'shop',
        label: 'Shop',
        path: '/',
        icon: () => <ShoppingBag width={22} height={22} />,
      },
      {
        id: 'orders',
        label: 'Orders',
        path: '/orders',
        icon: () => <Truck width={22} height={22} />,
      },
      {
        id: 'measure',
        label: 'Measure',
        path: '/measure',
        icon: () => <Ruler width={22} height={22} />,
      },
      {
        id: 'profile',
        label: 'Profile',
        path: '/profile',
        icon: () => <User width={22} height={22} />,
      },
    ];
  }, [user]);

  // Determine active tab
  const activeTab = useMemo(() => {
    const current = location.pathname;
    if (current === '/' || current.startsWith('/shop') || current.startsWith('/flow')) {
      return 'shop';
    }
    const matched = tabs.find((t) => t.path === current || (t.path !== '/' && current.startsWith(t.path)));
    return matched ? matched.id : tabs[0].id;
  }, [location.pathname, tabs]);

  // Determine if on a tab root or inner screen
  const isTabRoot = useMemo(() => {
    const p = location.pathname;
    return tabs.some((t) => t.path === p) || p === '/';
  }, [location.pathname, tabs]);

  // Hardware back button registration
  useEffect(() => {
    if (!isNativeApp()) return;

    const cleanup = setupNativeBackButton(() => {
      const isShop = activeTab === 'shop' && (location.pathname === '/' || location.pathname === '/shop');
      return {
        canGoBack: window.history.length > 1,
        onGoBack: () => navigate(-1),
        isTabRoot,
        isShopTab: isShop,
        onSwitchToShop: () => navigate('/'),
        pageBack: requestPageBack,
        showExitToast: (msg: string) => {
          setExitToast(msg);
          setTimeout(() => setExitToast(null), 2000);
        },
      };
    });

    return () => cleanup();
  }, [activeTab, isTabRoot, location.pathname, navigate]);

  if (!isNativeApp()) return null;

  // The shop pages are a tab root, but parents still need a way back through its steps
  const inShop = /^\/(shop|flow)/.test(location.pathname);

  // Derive Screen Title
  let screenTitle = 'School Store';
  if (location.pathname === '/' || location.pathname.startsWith('/shop')) screenTitle = 'School Store';
  else if (location.pathname.startsWith('/orders') || location.pathname.startsWith('/parent/orders')) screenTitle = 'My Orders';
  else if (location.pathname.startsWith('/measure')) screenTitle = 'Smart Sizing';
  else if (location.pathname.startsWith('/profile')) screenTitle = 'Account & Settings';
  else if (location.pathname.startsWith('/checkout')) screenTitle = 'Checkout';
  else if (location.pathname.startsWith('/teacher')) screenTitle = 'Teacher Portal';
  else if (location.pathname.startsWith('/school')) screenTitle = 'School Portal';
  else if (location.pathname.startsWith('/boss')) screenTitle = 'Boss Panel';
  else if (location.pathname.startsWith('/city')) screenTitle = 'City Admin';

  return (
    <>
      {/* Native Compact Top Bar */}
      {!hideTopBar && (
      <header className="native-top-bar">
        <div className="native-top-left">
          {!isTabRoot || inShop ? (
            <button
              type="button"
              className="native-back-button"
              onClick={() => {
                if (requestPageBack()) return;
                if (hasStoreHistory()) navigate(-1);
                else navigate('/');
              }}
              aria-label="Go back"
            >
              <ArrowLeft width={22} height={22} strokeWidth={2} />
            </button>
          ) : (
            <div className="native-brand-badge">S</div>
          )}
        </div>
        <div className="native-top-title">{screenTitle}</div>
        <div className="native-top-right">
          {onOpenBag && (
            <button
              type="button"
              className="native-top-bag-btn"
              onClick={onOpenBag}
              aria-label="Open Shopping Bag"
            >
              <ShoppingBag width={22} height={22} />
              {bagCount > 0 && <span className="native-bag-badge">{bagCount}</span>}
            </button>
          )}
        </div>
      </header>
      )}

      {/* Exit Toast Notification */}
      {exitToast && (
        <div className="native-exit-toast" role="status">
          {exitToast}
        </div>
      )}

      {/* Native Bottom Tab Bar */}
      {!keyboardVisible && (
        <nav className="native-bottom-tab-bar" aria-label="Main Navigation">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`native-tab-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  haptic.impactLight();
                  if (location.pathname !== tab.path) {
                    navigate(tab.path);
                  }
                }}
                aria-current={isActive ? 'page' : undefined}
              >
                <div className="native-tab-icon">{tab.icon(isActive)}</div>
                <span className="native-tab-label">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </>
  );
}
