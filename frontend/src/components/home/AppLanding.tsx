import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowRight, Search, ShoppingBag } from '../ui/icons';
import { useStoreState } from '../../store/storeState';
import { useLang } from '../../i18n';
import { siteConfig } from '../../siteConfig';
import { isNativeApp } from '../../native/nativePlatform';
import { StatusBar } from '@capacitor/status-bar';
import './appLanding.css';

/** Landing background, and the colour the rest of the app uses (see native/statusBar.ts). */
const LANDING_STATUS_BAR = '#0E5E3E';
const APP_STATUS_BAR = '#2F5D50';

const SchoolSearchSheet = lazy(() =>
  import('../school/SchoolSearchSheet').then((m) => ({ default: m.SchoolSearchSheet }))
);

interface AppLandingProps {
  onOpenBag?: () => void;
  onOpenLanguage?: () => void;
}

/** Sparkle positions on the stage, as a share of its width and height. */
const SPARKLES: { left: string; top: string; size: number; color: string; delay: string }[] = [
  { left: '9%', top: '6%', size: 18, color: '#FFD964', delay: '0s' },
  { left: '87%', top: '14%', size: 14, color: '#FFFFFF', delay: '1.2s' },
  { left: '8%', top: '52%', size: 12, color: '#FFB766', delay: '2.1s' },
  { left: '90%', top: '55%', size: 16, color: '#FFD964', delay: '0.6s' },
];

/**
 * The app's first screen: "First time in INDIA", the two characters in uniform,
 * and the school search at the bottom. Shown only inside the Android/iOS app.
 */
export function AppLanding({ onOpenBag, onOpenLanguage }: AppLandingProps) {
  const { t, lang } = useLang();
  const { totalCount } = useStoreState();
  const [searchOpen, setSearchOpen] = useState(false);

  // This screen carries its own header, so the app's compact top bar steps aside here.
  // The status bar takes the landing's green, and goes back to the app colour on leaving.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('app-landing-active');
    const setBar = (color: string) => {
      if (!isNativeApp()) return;
      StatusBar.setBackgroundColor({ color }).catch(() => undefined);
    };
    setBar(LANDING_STATUS_BAR);
    return () => {
      root.classList.remove('app-landing-active');
      setBar(APP_STATUS_BAR);
    };
  }, []);

  return (
    <section className="app-landing" aria-labelledby="app-landing-title">
      <div className="app-landing-ring app-landing-ring-outer" aria-hidden="true" />
      <div className="app-landing-ring app-landing-ring-inner" aria-hidden="true" />

      <div className="app-landing-header">
        <div className="app-landing-brand">
          <span className="app-landing-mark" aria-hidden="true">{siteConfig.mark}</span>
          <span className="app-landing-name">{siteConfig.logoText}</span>
        </div>
        <div className="app-landing-actions">
          <button
            type="button"
            className="app-landing-lang"
            onClick={onOpenLanguage}
            aria-label={t('nav.language')}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
            </svg>
            {lang.toUpperCase()}
          </button>
          <button
            type="button"
            className="app-landing-bag"
            onClick={onOpenBag}
            aria-label={t('nav.bag', { count: totalCount })}
          >
            <ShoppingBag width={24} height={24} />
            {totalCount > 0 && <span className="app-landing-bag-count">{totalCount}</span>}
          </button>
        </div>
      </div>

      <h1 id="app-landing-title" className="app-landing-title">
        <span className="app-landing-first">{t('landing.firstTime')}</span>
        <span className="app-landing-india">INDIA</span>
        <span className="app-landing-tricolour" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="app-landing-sub">
          <span>{t('landing.line1')}</span>
          <span>{t('landing.line2')}</span>
          <span className="app-landing-accent">{t('landing.line3')}</span>
        </span>
      </h1>

      <div className="app-landing-stage">
        {SPARKLES.map((s) => (
          <svg
            key={`${s.left}-${s.top}`}
            className="app-landing-sparkle"
            aria-hidden="true"
            style={{ left: s.left, top: s.top, animationDelay: s.delay }}
            width={s.size}
            height={s.size}
            viewBox="0 0 24 24"
          >
            <path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" fill={s.color} />
          </svg>
        ))}
        <div className="app-landing-shadow" aria-hidden="true" />
        <img
          className="app-landing-kids"
          src="/brand/kids-uniform.webp"
          alt={t('landing.imageAlt')}
          width={540}
          height={819}
          decoding="async"
          fetchPriority="high"
        />
      </div>

      <div className="app-landing-search" role="search">
        <button
          type="button"
          className="app-landing-search-field"
          onClick={() => setSearchOpen(true)}
        >
          <Search width={20} height={20} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('landing.search')}</span>
        </button>
        <button
          type="button"
          className="app-landing-search-go"
          onClick={() => setSearchOpen(true)}
          aria-label={t('landing.search')}
        >
          <ArrowRight width={24} height={24} strokeWidth={2.6} />
        </button>
      </div>

      {searchOpen && (
        <Suspense fallback={null}>
          <SchoolSearchSheet onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}
