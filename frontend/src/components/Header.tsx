import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, ShoppingBag, Menu, X, ArrowRight, User } from 'lucide-react';
import { motion, AnimatePresence, useAnimate, useReducedMotion } from 'motion/react';
import { useAuth } from '../auth';
import { siteConfig } from '../siteConfig';
import { useStoreState } from '../store/storeState';
import { SchoolCrest } from './school/SchoolCrest';
import { Thread } from '../motion/Thread';
import { EASING, DURATION_FAST } from '../motion/motionConfig';
import { prefetchFlowPage, prefetchBagDrawer } from '../utils/prefetch';
import './headerFooter.css';

export interface HeaderProps {
  onOpenBag?: () => void;
  onOpenSearch?: () => void;
}

export function Header({ onOpenBag, onOpenSearch }: HeaderProps) {
  const { user } = useAuth();
  const { totalCount, selection, setSelection } = useStoreState();

  // Bag feedback: the count rolls up or down, and the bag tilts when something is added
  const [bagIconRef, animateBag] = useAnimate<HTMLSpanElement>();
  const shouldReduceMotion = useReducedMotion();
  const lastCount = useRef(totalCount);
  const [countDirection, setCountDirection] = useState(1);
  useEffect(() => {
    const grew = totalCount > lastCount.current;
    if (totalCount !== lastCount.current) setCountDirection(grew ? 1 : -1);
    if (grew && !shouldReduceMotion && bagIconRef.current) {
      animateBag(bagIconRef.current, { rotate: [0, -10, 0] }, { duration: 0.3, ease: EASING });
    }
    lastCount.current = totalCount;
  }, [totalCount, shouldReduceMotion, animateBag, bagIconRef]);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 80);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // Close mobile menu on Esc key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className={`site-header ${isScrolled ? 'is-scrolled' : ''}`}>
        <div className="header-inner container">
          {/* Mobile menu button */}
          <button
            type="button"
            className="mobile-menu-trigger"
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu width={22} height={22} strokeWidth={1.5} />
          </button>

          {/* Left: Brand mark + wordmark */}
          <div className="brand-group">
            <Link to="/" className="site-brand" aria-label={`${siteConfig.name} Home`}>
              <span className="brand-mark">{siteConfig.mark}</span>
              <span className="brand-wordmark">{siteConfig.logoText}</span>
            </Link>

            {/* School Pill if selected */}
            {selection && (
              <div className="selected-school-pill">
                <SchoolCrest id={selection.schoolId} name={selection.schoolName} code={selection.schoolCode} size={24} />
                <span className="pill-school-info">
                  {selection.schoolName} {selection.gradeName ? `· ${selection.gradeName}` : ''}
                </span>
                <Link
                  to="/flow?step=1"
                  className="pill-change-link"
                  aria-label="Change school or class"
                >
                  Change
                </Link>
              </div>
            )}
          </div>

          {/* Desktop Categories Center Navigation */}
          <nav className="desktop-nav" aria-label="Primary Navigation">
            {siteConfig.categories.map((cat) => {
              const isActive = location.pathname.startsWith('/shop') && location.search.includes(`cat=${encodeURIComponent(cat.slug)}`);
              return (
                <Link
                  key={cat.slug}
                  to={`/shop?cat=${encodeURIComponent(cat.slug)}`}
                  className={`nav-link ${isActive ? 'is-active' : ''}`}
                  onMouseEnter={prefetchFlowPage}
                >
                  {isActive && (
                    <motion.span
                      layoutId="header-active-pill"
                      className="nav-active-pill"
                      transition={{ duration: 0.25, ease: EASING }}
                    />
                  )}
                  <span>{cat.label}</span>
                  {isActive && <Thread width={28} className="nav-thread" />}
                </Link>
              );
            })}
          </nav>

          {/* Right actions */}
          <div className="header-actions">
            <button
              type="button"
              className="action-icon-btn"
              aria-label="Search items"
              onClick={onOpenSearch}
            >
              <Search width={20} height={20} strokeWidth={1.5} />
            </button>

            {user ? (
              <Link to="/parent" className="action-account-btn" aria-label="My Account">
                <User width={20} height={20} strokeWidth={1.5} />
              </Link>
            ) : (
              <Link to="/login" className="action-signin-link">
                Sign in
              </Link>
            )}

            <button
              type="button"
              className="action-icon-btn bag-btn"
              aria-label={`Shopping bag, ${totalCount} items`}
              onClick={onOpenBag}
              onMouseEnter={prefetchBagDrawer}
            >
              <span ref={bagIconRef} className="bag-icon-wrap">
                <ShoppingBag width={20} height={20} strokeWidth={1.5} />
              </span>
              <AnimatePresence>
                {totalCount > 0 && (
                  <motion.span
                    className="bag-count-dot"
                    aria-hidden="true"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ duration: DURATION_FAST, ease: EASING }}
                  >
                    <AnimatePresence mode="popLayout" initial={false} custom={countDirection}>
                      <motion.span
                        key={totalCount}
                        className="bag-count-digit"
                        custom={countDirection}
                        variants={{
                          enter: (d: number) => ({ y: `${100 * d}%`, opacity: 0 }),
                          center: { y: 0, opacity: 1 },
                          exit: (d: number) => ({ y: `${-100 * d}%`, opacity: 0 }),
                        }}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{ duration: DURATION_FAST, ease: EASING }}
                      >
                        {totalCount}
                      </motion.span>
                    </AnimatePresence>
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Sheet */}
      {mobileMenuOpen && (
        <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)}>
          <div
            className="mobile-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-top">
              <Link to="/" className="site-brand" onClick={() => setMobileMenuOpen(false)}>
                <span className="brand-mark">{siteConfig.mark}</span>
                <span className="brand-wordmark">{siteConfig.logoText}</span>
              </Link>
              <button
                type="button"
                className="sheet-close-btn"
                aria-label="Close navigation menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X width={24} height={24} strokeWidth={1.5} />
              </button>
            </div>

            <div className="sheet-nav-links">
              {siteConfig.categories.map((cat) => (
                <Link
                  key={cat.slug}
                  to={`/shop?cat=${encodeURIComponent(cat.slug)}`}
                  className="sheet-nav-item"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span>{cat.label}</span>
                  <ArrowRight width={18} height={18} strokeWidth={1.5} />
                </Link>
              ))}

              <div className="sheet-divider" />

              <Link
                to="/size-guide"
                className="sheet-secondary-item"
                onClick={() => setMobileMenuOpen(false)}
              >
                Size Guide
              </Link>
              <Link
                to="/help"
                className="sheet-secondary-item"
                onClick={() => setMobileMenuOpen(false)}
              >
                Help & FAQs
              </Link>
              {user ? (
                <Link
                  to="/parent"
                  className="sheet-secondary-item"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  My Account
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="sheet-secondary-item"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Sign in
                </Link>
              )}
            </div>

            <div className="sheet-footer">
              <div className="sheet-support-row">
                <span className="label">Need assistance?</span>
                <a href={siteConfig.supportPhoneHref} className="sheet-contact-link">
                  {siteConfig.supportPhone}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
