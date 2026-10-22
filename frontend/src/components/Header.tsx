import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, ShoppingBag, Menu, X, ArrowRight, User } from './ui/icons';
import { motion, AnimatePresence, useAnimate, useReducedMotion } from 'motion/react';
import { useAuth } from '../auth';
import { siteConfig } from '../siteConfig';
import { useStoreState } from '../store/storeState';
import { SchoolCrest } from './school/SchoolCrest';
import { EASING, DURATION_FAST } from '../motion/motionConfig';
import { prefetchFlowPage, prefetchBagDrawer } from '../utils/prefetch';
import { useLang } from '../i18n';
import { categoryLabel, classLabel } from '../i18n/labels';
import './headerFooter.css';

export interface HeaderProps {
  onOpenBag?: () => void;
  onOpenSearch?: () => void;
  onOpenLanguage?: () => void;
}

/** 01, 02, ... for the numbered category list in the phone menu. */
const indexLabel = (i: number) => String(i + 1).padStart(2, '0');

export function Header({ onOpenBag, onOpenSearch, onOpenLanguage }: HeaderProps) {
  const { user } = useAuth();
  const { t } = useLang();
  const { totalCount, selection } = useStoreState();

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
  // Pulse the school pill once when the parent picks a school (not on page load)
  const pickedSchoolId = selection?.schoolId;
  const lastSchoolId = useRef(pickedSchoolId);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (pickedSchoolId && pickedSchoolId !== lastSchoolId.current) setConfirming(true);
    lastSchoolId.current = pickedSchoolId;
  }, [pickedSchoolId]);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

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

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <>
      <a href="#main" className="skip-link">
        {t('nav.skip')}
      </a>

      {/* Utility bar: scrolls away, the main bar below stays */}
      <div className="utility-bar">
        <div className="utility-inner container">
          <button type="button" className="utility-lang" onClick={onOpenLanguage}>
            {t('nav.language')} · ગુજરાતી · हिन्दी · English
          </button>

          <div className="utility-right">
            {selection && (
              <div
                className={`selected-school-pill ${confirming ? 'is-confirming' : ''}`}
                onAnimationEnd={(e) => e.target === e.currentTarget && setConfirming(false)}
              >
                <SchoolCrest id={selection.schoolId} name={selection.schoolName} code={selection.schoolCode} size={20} />
                <span className="pill-school-info">
                  {selection.schoolName} {selection.gradeName ? `· ${classLabel(selection.gradeName, t)}` : ''}
                </span>
                <Link to="/flow?step=1" className="pill-change-link" aria-label={t('nav.changeSchool')}>
                  {t('nav.change')}
                </Link>
              </div>
            )}
            <Link to="/size-guide" className="utility-link">
              {t('nav.sizeGuide')}
            </Link>
            <Link to="/help" className="utility-link">
              {t('nav.help')}
            </Link>
            {siteConfig.supportPhone && (
              <span className="utility-phone">
                {t('nav.needHelp')}{' '}
                <a href={siteConfig.supportPhoneHref}>{siteConfig.supportPhone}</a>
              </span>
            )}
          </div>
        </div>
      </div>

      <header className="site-header">
        <div className="header-inner container">
          {/* Mobile menu button */}
          <button
            type="button"
            className="mobile-menu-trigger"
            aria-label={t('nav.openMenu')}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu width={22} height={22} strokeWidth={1.5} />
          </button>

          {/* Left: brand, a hairline, then the categories */}
          <div className="brand-group">
            <Link to="/" className="site-brand" aria-label={`${siteConfig.name} Home`}>
              <span className="brand-mark">{siteConfig.mark}</span>
              <span className="brand-wordmark">{siteConfig.logoText}</span>
            </Link>

            <span className="header-divider" aria-hidden="true" />

            <nav className="desktop-nav" aria-label="Primary Navigation">
              {siteConfig.categories.map((cat) => {
                const isActive =
                  location.pathname.startsWith('/shop') && location.search.includes(`cat=${encodeURIComponent(cat.slug)}`);
                return (
                  <Link
                    key={cat.slug}
                    to={`/shop?cat=${encodeURIComponent(cat.slug)}`}
                    className={`nav-link ${isActive ? 'is-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    onMouseEnter={prefetchFlowPage}
                  >
                    {categoryLabel(cat.slug, t)}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right actions */}
          <div className="header-actions">
            {/* Wide screens: a search field; narrower: the icon. Both open the school search. */}
            <button type="button" className="header-search-field" onClick={onOpenSearch}>
              <Search width={18} height={18} strokeWidth={1.5} />
              <span>{t('nav.search')}</span>
            </button>
            <button
              type="button"
              className="action-icon-btn action-search-btn"
              aria-label={t('nav.search')}
              onClick={onOpenSearch}
            >
              <Search width={20} height={20} strokeWidth={1.5} />
            </button>

            {user ? (
              <Link to="/parent" className="action-account-btn" aria-label={t('nav.myAccount')}>
                <User width={20} height={20} strokeWidth={1.5} />
              </Link>
            ) : (
              <Link to="/login" className="action-signin-link">
                {t('nav.signIn')}
              </Link>
            )}

            <button
              type="button"
              className="action-icon-btn bag-btn"
              aria-label={t('nav.bag', { count: totalCount })}
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

      {/* Phone menu: full screen, a numbered list of categories, then the smaller links */}
      {mobileMenuOpen && (
        <div className="mobile-menu-sheet" role="dialog" aria-modal="true" aria-label={t('nav.menu')}>
          <div className="sheet-top container">
            <Link to="/" className="site-brand" onClick={closeMenu}>
              <span className="brand-mark">{siteConfig.mark}</span>
              <span className="brand-wordmark">{siteConfig.logoText}</span>
            </Link>
            <button type="button" className="sheet-close-btn" aria-label={t('nav.closeMenu')} onClick={closeMenu}>
              <X width={24} height={24} strokeWidth={1.5} />
            </button>
          </div>

          <div className="sheet-body container">
            <nav className="sheet-nav-links" aria-label={t('nav.menu')}>
              {siteConfig.categories.map((cat, i) => (
                <Link
                  key={cat.slug}
                  to={`/shop?cat=${encodeURIComponent(cat.slug)}`}
                  className="sheet-nav-item"
                  onClick={closeMenu}
                >
                  <span className="sheet-index" aria-hidden="true">
                    {indexLabel(i)}
                  </span>
                  <span className="sheet-nav-label">{categoryLabel(cat.slug, t)}</span>
                  <ArrowRight width={20} height={20} strokeWidth={1.5} />
                </Link>
              ))}
            </nav>

            <div className="sheet-secondary">
              <Link to="/size-guide" className="sheet-secondary-item" onClick={closeMenu}>
                {t('nav.sizeGuide')}
              </Link>
              <Link to="/help" className="sheet-secondary-item" onClick={closeMenu}>
                {t('nav.help')}
              </Link>
              {user ? (
                <Link to="/parent" className="sheet-secondary-item" onClick={closeMenu}>
                  {t('nav.myAccount')}
                </Link>
              ) : (
                <Link to="/login" className="sheet-secondary-item" onClick={closeMenu}>
                  {t('nav.signIn')}
                </Link>
              )}
              <button
                type="button"
                className="sheet-secondary-item sheet-lang-item"
                onClick={() => {
                  closeMenu();
                  onOpenLanguage?.();
                }}
              >
                {t('nav.language')} · ગુજરાતી · हिन्दी · English
              </button>
            </div>

            {siteConfig.supportPhone && (
              <div className="sheet-footer">
                <span className="label">{t('nav.needHelp')}</span>
                <a href={siteConfig.supportPhoneHref} className="sheet-contact-link">
                  {siteConfig.supportPhone}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
