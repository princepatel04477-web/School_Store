import { useRef, useState, useEffect, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { useLang } from '../i18n';
import { useStoreState } from '../store/storeState';
import { SHOP_LINK } from '../siteConfig';
import { useStoreDeliveredSchools, type StoreDeliveredSchool } from '../data/catalog';
import { hasStoreHistory } from '../components/BackButton';
import { useAuth } from '../auth';
import { User } from '../components/ui/icons';
import './aboutPage.css';

export interface AboutPageProps {
  onOpenBag?: () => void;
  onOpenLanguage?: () => void;
}

export function AboutPage({ onOpenBag, onOpenLanguage }: AboutPageProps) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();
  const { totalCount } = useStoreState();
  const { user } = useAuth();

  // SEO: Update page title and meta description
  useEffect(() => {
    document.title = t('about.metaTitle');
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', t('about.metaDescription'));
  }, [t]);

  // Delivered schools query
  const { data: deliveredSchools = [], isLoading: isLoadingSchools } = useStoreDeliveredSchools();

  // Slider controls
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);

  const updateScrollButtons = () => {
    const el = trackRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 4;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 6;
    setCanScrollPrev(!atStart);
    setCanScrollNext(!atEnd);
  };

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons, { passive: true });
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [deliveredSchools]);

  const handlePrev = () => {
    if (!trackRef.current) return;
    trackRef.current.scrollBy({ left: -trackRef.current.clientWidth, behavior: 'smooth' });
  };

  const handleNext = () => {
    if (!trackRef.current) return;
    trackRef.current.scrollBy({ left: trackRef.current.clientWidth, behavior: 'smooth' });
  };

  const handleTrackKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handlePrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      handleNext();
    }
  };

  const handleBack = () => {
    // history.length also counts the site the parent came from, so going back
    // from a page opened straight from Google or WhatsApp would leave the store.
    if (hasStoreHistory()) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleCtaClick = () => {
    navigate(SHOP_LINK);
  };

  const langLabel = lang === 'gu' ? 'ગુજરાતી' : lang === 'hi' ? 'हिन्दी' : 'EN';

  return (
    <div className="about-page-root">
      {/* 1. Header Navigation */}
      <nav className="about-top-bar" aria-label="About Page Navigation">
        <div className="about-nav-left">
          <button
            type="button"
            className="about-back-btn"
            onClick={handleBack}
            aria-label={t('about.header.back')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <Link to="/" className="about-brand-link" aria-label="SchoolStore Home">
            <div className="about-logo-sq" aria-hidden="true">
              <span className="about-logo-letter">S</span>
            </div>
            <span className="about-brand-text">SchoolStore</span>
          </Link>
        </div>

        <div className="about-nav-right">
          <button
            type="button"
            className="about-lang-pill"
            onClick={onOpenLanguage}
            aria-label={t('nav.language')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>{langLabel}</span>
          </button>

          {/* Sign in, or the parent's own page once signed in (staff are sent to their panel). */}
          <Link
            to={user?.role === 'PARENT' ? '/parent' : '/login'}
            className="about-bag-btn about-profile-btn"
            aria-label={user ? t('nav.myAccount') : t('nav.signIn')}
            title={user ? t('nav.myAccount') : t('nav.signIn')}
          >
            <User width={22} height={22} strokeWidth={2} />
          </Link>

          <button
            type="button"
            className="about-bag-btn"
            onClick={onOpenBag}
            aria-label={t('nav.bag', { count: totalCount })}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            {totalCount > 0 && (
              <span className="about-bag-badge" aria-hidden="true">
                {totalCount}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* 2. Hero Band */}
      <section className="about-hero-band" aria-label="Our Story Introduction">
        <div className="about-circle-outer" aria-hidden="true" />
        <div className="about-circle-inner" aria-hidden="true" />

        <div className="about-hero-container">
          <div className="about-hero-copy">
            <span className="about-hero-eyebrow">{t('about.hero.eyebrow')}</span>
            <h1 className="about-hero-title">
              {t('about.hero.titlePrefix')}
              <span className="about-hero-title-accent">{t('about.hero.titleAccent')}</span>
            </h1>
            <p className="about-hero-subline">{t('about.hero.subline')}</p>
          </div>

          <motion.div
            className="about-hero-stage"
            animate={shouldReduceMotion ? undefined : { y: [0, -6, 0] }}
            transition={shouldReduceMotion ? undefined : { duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <img
              src="/brand/kids-uniform.clean.webp"
              alt={t('about.hero.imageAlt')}
              className="about-hero-kids"
              width={224}
              height={330}
              decoding="async"
              {...{ fetchpriority: 'high' }}
            />
            <div className="about-hero-shadow" aria-hidden="true" />
          </motion.div>
        </div>
      </section>

      {/* 3. White Content Sheet */}
      <main className="about-sheet">
        <div className="about-sheet-container">
          {/* 3a. The Problem */}
          <motion.section
            className="about-problem-section"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.45 }}
            aria-labelledby="problem-heading"
          >
            <div className="about-section-head">
              <span className="about-section-eyebrow about-problem-eyebrow">
                {t('about.problem.eyebrow')}
              </span>
              <h2 id="problem-heading" className="about-section-title">
                {t('about.problem.title')}
              </h2>
            </div>

            <div className="about-problem-grid">
              {/* Card 1: Time */}
              <div className="about-problem-card">
                <div className="about-icon-tile-problem" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <h3 className="about-problem-card-title">{t('about.problem.card1.title')}</h3>
                <p className="about-problem-card-desc">{t('about.problem.card1.desc')}</p>
              </div>

              {/* Card 2: Stock */}
              <div className="about-problem-card">
                <div className="about-icon-tile-problem" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                </div>
                <h3 className="about-problem-card-title">{t('about.problem.card2.title')}</h3>
                <p className="about-problem-card-desc">{t('about.problem.card2.desc')}</p>
              </div>
            </div>
          </motion.section>

          {/* 3b. Pivot */}
          <motion.div
            className="about-pivot-section"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.45 }}
            aria-hidden="true"
          >
            <motion.div
              className="about-pivot-circle"
              animate={shouldReduceMotion ? undefined : { y: [0, 4, 0] }}
              transition={shouldReduceMotion ? undefined : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </motion.div>
            <p className="about-pivot-line">{t('about.pivot.line')}</p>
          </motion.div>

          {/* 3c. The Fix */}
          <motion.section
            className="about-fix-card"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.45 }}
            aria-labelledby="fix-heading"
          >
            <div className="about-fix-layout">
              <div>
                <span className="about-section-eyebrow about-fix-eyebrow">
                  {t('about.fix.eyebrow')}
                </span>
                <h2 id="fix-heading" className="about-fix-headline">
                  {t('about.fix.headline')}
                </h2>
              </div>

              <div className="about-fix-bullets">
                <div className="about-fix-row">
                  <div className="about-fix-check-icon" aria-hidden="true">1</div>
                  <span>{t('about.fix.bullet1')}</span>
                </div>

                <div className="about-fix-row">
                  <div className="about-fix-check-icon" aria-hidden="true">2</div>
                  <span>{t('about.fix.bullet2')}</span>
                </div>
              </div>
            </div>
          </motion.section>

          {/* 3d. First time in India Badge Callout */}
          <motion.div
            className="about-badge-callout"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.45 }}
            role="note"
          >
            <div className="about-badge-icon-tile" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            <div className="about-badge-content">
              <h3 className="about-badge-title">{t('about.badge.title')}</h3>
              <p className="about-badge-subtitle">{t('about.badge.subtitle')}</p>
            </div>
          </motion.div>

          {/* 3e. Schools We Deliver To (Only if >= 4 schools with logo_url) */}
          {(isLoadingSchools || deliveredSchools.length >= 4) && (
            <motion.section
              className="about-network-section"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.45 }}
              aria-labelledby="network-heading"
            >
              <div className="about-network-head-row">
                <div className="about-section-head" style={{ marginBottom: 0 }}>
                  <span className="about-section-eyebrow about-network-eyebrow">
                    {t('about.network.eyebrow')}
                  </span>
                  <h2 id="network-heading" className="about-section-title">
                    {t('about.network.title')}
                  </h2>
                </div>
                <span className="about-swipe-hint" aria-hidden="true">
                  {t('about.network.swipeHint')}
                </span>
              </div>

              <div className="about-slider-wrapper">
                <button
                  type="button"
                  className="about-slider-nav-btn is-prev"
                  onClick={handlePrev}
                  disabled={!canScrollPrev}
                  aria-label={t('about.network.prevSchools')}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>

                <div
                  ref={trackRef}
                  className="about-slider-track"
                  tabIndex={0}
                  role="region"
                  aria-label={t('about.network.listRegion')}
                  onKeyDown={handleTrackKeyDown}
                >
                  {isLoadingSchools ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="about-school-card" aria-hidden="true">
                        <div className="about-school-skeleton-tile" />
                        <div className="about-school-skeleton-text" />
                      </div>
                    ))
                  ) : (
                    deliveredSchools.map((school: StoreDeliveredSchool) => (
                      <div key={school.id} className="about-school-card">
                        <div className="about-school-tile">
                          <img
                            src={school.logo_url}
                            alt={t('about.network.logoAlt', { name: school.name })}
                            className="about-school-logo"
                            width={56}
                            height={56}
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                        <span className="about-school-name" title={school.name}>
                          {school.name}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  className="about-slider-nav-btn is-next"
                  onClick={handleNext}
                  disabled={!canScrollNext}
                  aria-label={t('about.network.nextSchools')}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </motion.section>
          )}

          {/* 3f. Call To Action Button */}
          <motion.div
            className="about-cta-section"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20px' }}
            transition={{ duration: 0.45 }}
          >
            <button
              type="button"
              className="about-cta-btn"
              onClick={handleCtaClick}
            >
              <span>{t('about.cta.button')}</span>
              <div className="about-cta-arrow-circle" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
            </button>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
