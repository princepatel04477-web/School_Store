import { useState, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useStoreState } from '../../store/storeState';
import { useAuth } from '../../auth';
import { User } from '../ui/icons';
import { isNativeApp } from '../../native/nativePlatform';
import { useLang } from '../../i18n';
import { EASING } from '../../motion/motionConfig';
import './homeHero.css';

export interface HomeHeroProps {
  onOpenBag?: () => void;
  onOpenLanguage?: () => void;
}

// 4 sparkles positioned in percentages of the stage
const SPARKLES = [
  { id: 'sp-1', size: 16, top: '12%', left: '14%', delay: 0 },
  { id: 'sp-2', size: 20, top: '18%', right: '12%', delay: 0.9 },
  { id: 'sp-3', size: 14, top: '54%', left: '8%', delay: 0.5 },
  { id: 'sp-4', size: 18, top: '58%', right: '10%', delay: 1.4 },
] as const;

export function HomeHero({ onOpenBag, onOpenLanguage }: HomeHeroProps) {
  const { lang, t, setLang } = useLang();
  const { totalCount } = useStoreState();
  const { user } = useAuth();
  const shouldReduceMotion = useReducedMotion();
  const [isCompact, setIsCompact] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const heroRef = useRef<HTMLElement>(null);

  // Short screens get the compact hero
  useEffect(() => {
    const handleViewport = () => {
      const vv = window.visualViewport;
      const height = vv ? vv.height : window.innerHeight;
      const width = vv ? vv.width : window.innerWidth;
      setIsCompact(height < 640);
      setIsMobile(width < 768);
    };

    handleViewport();

    const vv = window.visualViewport;
    if (vv) vv.addEventListener('resize', handleViewport, { passive: true });
    window.addEventListener('resize', handleViewport, { passive: true });

    return () => {
      if (vv) vv.removeEventListener('resize', handleViewport);
      window.removeEventListener('resize', handleViewport);
    };
  }, []);

  // Pause continuous looping animations when the hero is off-screen
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsHeroVisible(entry.isIntersecting);
      },
      { threshold: 0.05 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const canAnimateLoop = !shouldReduceMotion && isHeroVisible && !isMobile;

  const langPillLabel = lang === 'gu' ? 'ગુજ' : lang === 'hi' ? 'हिं' : 'EN';

  const handleLangClick = () => {
    if (onOpenLanguage) {
      onOpenLanguage();
    } else {
      const nextLang = lang === 'en' ? 'gu' : lang === 'gu' ? 'hi' : 'en';
      setLang(nextLang);
    }
  };

  // Staggered entrance variants (< 700ms total)
  const lineVariants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 14 },
    visible: (custom: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        duration: shouldReduceMotion ? 0 : 0.42,
        ease: EASING,
        delay: shouldReduceMotion ? 0 : custom * 0.08,
      },
    }),
  };

  const stageEntrance = {
    hidden: { opacity: 0, scale: shouldReduceMotion ? 1 : 0.96 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: shouldReduceMotion ? 0 : 0.5,
        ease: EASING,
        delay: shouldReduceMotion ? 0 : 0.16,
      },
    },
  };

  return (
    <header ref={heroRef} className={`emerald-hero ${isCompact ? 'is-compact' : ''}`}>
      {/* 1. Top bar: fixed to the top of the screen, so it stays while the page scrolls */}
      <div className="emerald-container emerald-header-container">
        <nav className="emerald-header" aria-label="Emerald Top Navigation">
          <div className="emerald-header-left">
            <div className="emerald-logo-square" aria-hidden="true">
              <span className="emerald-logo-letter">S</span>
            </div>
            <span className="emerald-logo-text">SchoolStore</span>
          </div>

          <div className="emerald-header-right">
            <button
              type="button"
              className="emerald-lang-pill"
              onClick={handleLangClick}
              aria-label={t('home.emerald.langLabel')}
            >
              <svg
                className="emerald-globe-icon"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="emerald-lang-name">{langPillLabel}</span>
            </button>

            {/* Sign in, or the parent's own page once signed in (staff are sent to their panel).
                In the app it opens the Profile tab, which offers sign-in when signed out. */}
            <Link
              to={isNativeApp() ? '/profile' : user ? '/parent' : '/login'}
              className="emerald-bag-btn emerald-profile-btn"
              aria-label={user ? t('nav.myAccount') : t('nav.signIn')}
              title={user ? t('nav.myAccount') : t('nav.signIn')}
            >
              <User width={22} height={22} strokeWidth={2} />
            </Link>

            <button
              type="button"
              className="emerald-bag-btn"
              onClick={onOpenBag}
              aria-label={t('home.emerald.bagLabel')}
            >
              <svg
                className="emerald-bag-icon"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
              {totalCount > 0 && (
                <span className="emerald-bag-badge" aria-hidden="true">
                  {totalCount}
                </span>
              )}
            </button>
          </div>
        </nav>
      </div>

      {/* Main Hero Section with shared container */}
      <div className="emerald-container emerald-main-container">
        <div className="emerald-hero-content">
          {/* Left column / Top text */}
          <div className="emerald-left-col">
            <h1 className="emerald-headline">
              {/* Line 1: First time in */}
              <motion.span
                className="emerald-eyebrow"
                custom={0}
                initial="hidden"
                animate="visible"
                variants={lineVariants}
              >
                {t('home.emerald.firstTimeIn')}
              </motion.span>

              {/* Line 2: INDIA + Tricolour bar (fit-content block, bar 100% width of INDIA) */}
              <motion.div
                className="emerald-country-wrap"
                custom={1}
                initial="hidden"
                animate="visible"
                variants={lineVariants}
              >
                <span className="emerald-country">
                  {t('home.emerald.india')}
                </span>
                <span className="emerald-tricolour-pill" aria-hidden="true">
                  <span className="emerald-flag-saffron" />
                  <span className="emerald-flag-white" />
                  <span className="emerald-flag-green" />
                </span>
              </motion.div>

              {/* Line 3: Tagline (3 distinct lines) */}
              <motion.span
                className="emerald-tagline"
                custom={2}
                initial="hidden"
                animate="visible"
                variants={lineVariants}
              >
                <span className="emerald-tagline-row emerald-tagline-white">{t('home.emerald.taglineLine1')}</span>
                <span className="emerald-tagline-row emerald-tagline-white">{t('home.emerald.taglineLine2')}</span>
                <span className="emerald-tagline-row emerald-tagline-saffron">{t('home.emerald.taglineLine3')}</span>
              </motion.span>
            </h1>
          </div>

          {/* Right column: Stage with concentric circles, sparkles and kids */}
          <div className="emerald-right-col">
            <motion.div
              className="emerald-stage-container"
              initial="hidden"
              animate="visible"
              variants={stageEntrance}
            >
              {/* Concentric circles (100% and 72% of stage width) */}
              <div className="emerald-circles-bg" aria-hidden="true">
                <div className="emerald-circle-outer" />
                <div className="emerald-circle-inner" />
              </div>

              {/* 4 Twinkling Sparkles positioned in percentages of the stage */}
              <div className="emerald-sparkles" aria-hidden="true">
                {SPARKLES.map((sp) => (
                  <motion.span
                    key={sp.id}
                    className={`emerald-sparkle ${sp.id}`}
                    style={{
                      top: sp.top,
                      left: 'left' in sp ? sp.left : undefined,
                      right: 'right' in sp ? sp.right : undefined,
                      width: sp.size,
                      height: sp.size,
                    }}
                    animate={
                      canAnimateLoop
                        ? {
                            opacity: [0.35, 1, 0.35],
                            scale: [0.75, 1.15, 0.75],
                          }
                        : { opacity: 0.85, scale: 1 }
                    }
                    transition={
                      canAnimateLoop
                        ? {
                            duration: 3,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: sp.delay,
                          }
                        : { duration: 0 }
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width={sp.size}
                      height={sp.size}
                      fill="var(--emerald-sparkle, #FFD964)"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M12 0C12 7.5 13.5 10.5 24 12C13.5 13.5 12 16.5 12 24C12 16.5 10.5 13.5 0 12C10.5 10.5 12 7.5 12 0Z" />
                    </svg>
                  </motion.span>
                ))}
              </div>

              {/* Soft elliptical floor shadow under feet */}
              <div className="emerald-ground-shadow" aria-hidden="true" />

              {/* Kids Illustration with Float Animation */}
              <div className="emerald-stage-img-wrap">
                <motion.div
                  className="emerald-float-wrap"
                  animate={canAnimateLoop ? { y: [0, -6, 0] } : { y: 0 }}
                  transition={
                    canAnimateLoop
                      ? {
                          duration: 5,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }
                      : { duration: 0 }
                  }
                >
                  <picture>
                    <source type="image/avif" srcSet="/brand/kids-uniform.clean.avif" />
                    <source type="image/webp" srcSet="/brand/kids-uniform.clean.webp" />
                    <img
                      src="/brand/kids-uniform.clean.png"
                      width={541}
                      height={682}
                      decoding="async"
                      {...{ fetchpriority: 'high' }}
                      alt={t('home.emerald.kidsAlt')}
                      className="emerald-kids-img"
                    />
                  </picture>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </header>
  );
}
