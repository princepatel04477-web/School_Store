import {
  useState,
  useRef,
  useEffect,
  useId,
  useMemo,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useStoreSchools, type StoreSchool } from '../../data/catalog';
import { useSelectSchool } from '../school/useSelectSchool';
import { useStoreState } from '../../store/storeState';
import { useLang } from '../../i18n';
import { SchoolCrest } from '../school/SchoolCrest';
import { EASING } from '../../motion/motionConfig';
import { prefetchFlowPage, prefetchSchoolData } from '../../utils/prefetch';
import './homeHero.css';

export interface HomeHeroProps {
  onOpenBag?: () => void;
  onOpenLanguage?: () => void;
}

const DEBOUNCE_MS = 180;
const POPULAR_COUNT = 5;

function matches(school: StoreSchool, q: string) {
  return (
    school.name.toLowerCase().includes(q) ||
    Boolean(school.city && school.city.toLowerCase().includes(q))
  );
}

function filterSchools(schools: StoreSchool[], query: string) {
  const q = query.trim().toLowerCase();
  return q ? schools.filter((s) => matches(s, q)) : schools.slice(0, POPULAR_COUNT);
}

function highlight(text: string, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: (string | JSX.Element)[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="emerald-mark">
        {text.slice(at, at + q.length)}
      </mark>
    );
    from = at + q.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
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
  const shouldReduceMotion = useReducedMotion();
  const listId = useId();

  const { data: schools = [] } = useStoreSchools();
  const handleSelectSchool = useSelectSchool();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isCompact, setIsCompact] = useState(false);

  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if ((location.state as { focusSearch?: boolean } | null)?.focusSearch) {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [location.state]);

  // Debounce search query
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const results = useMemo(() => filterSchools(schools, debounced), [schools, debounced]);

  // Handle virtual viewport (short screens or keyboard open)
  useEffect(() => {
    const handleViewport = () => {
      const vv = window.visualViewport;
      const height = vv ? vv.height : window.innerHeight;
      const isShort = height < 640;
      const isKeyboard = Boolean(vv && vv.height < window.innerHeight * 0.78);
      setIsCompact(isShort || isKeyboard);
    };

    handleViewport();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', handleViewport);
      vv.addEventListener('scroll', handleViewport);
    }
    window.addEventListener('resize', handleViewport);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', handleViewport);
        vv.removeEventListener('scroll', handleViewport);
      }
      window.removeEventListener('resize', handleViewport);
    };
  }, []);

  // Close suggestions on outside click
  useEffect(() => {
    if (!isPanelOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsPanelOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isPanelOpen]);

  const selectSchoolAndNavigate = (school: StoreSchool) => {
    setIsPanelOpen(false);
    handleSelectSchool(school);
  };

  const handleSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const currentSchools = filterSchools(schools, query);
    const chosen = (debounced === query && results[activeIndex]) || currentSchools[0];
    if (chosen) {
      selectSchoolAndNavigate(chosen);
    } else {
      setIsPanelOpen(true);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isPanelOpen) {
        setIsPanelOpen(true);
        return;
      }
      if (results.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((prev) => (prev + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setIsPanelOpen(false);
      setActiveIndex(-1);
    }
  };

  const langPillLabel = lang === 'gu' ? 'ગુજ' : lang === 'hi' ? 'हिં' : 'EN';

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

  const searchEntrance = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 18 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: shouldReduceMotion ? 0 : 0.44,
        ease: EASING,
        delay: shouldReduceMotion ? 0 : 0.24,
      },
    },
  };

  return (
    <header ref={rootRef} className={`emerald-hero ${isCompact ? 'is-compact' : ''}`}>
      {/* 1. Header with shared container */}
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

              {/* Line 3: Tagline */}
              <motion.span
                className="emerald-tagline"
                custom={2}
                initial="hidden"
                animate="visible"
                variants={lineVariants}
              >
                <span className="emerald-tagline-white">{t('home.emerald.taglineWhite')}{' '}</span>
                <span className="emerald-tagline-saffron">{t('home.emerald.taglineAccent')}</span>
              </motion.span>
            </h1>

            {/* Search Box */}
            <div className="emerald-search-wrapper">
              <motion.form
                role="search"
                className="emerald-search-form"
                onSubmit={handleSubmit}
                initial="hidden"
                animate="visible"
                variants={searchEntrance}
              >
                <div className="emerald-search-bar">
                  <svg
                    className="emerald-search-icon"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>

                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="search"
                    enterKeyHint="search"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    role="combobox"
                    aria-expanded={isPanelOpen}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      isPanelOpen && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
                    }
                    aria-label={t('home.emerald.searchLabel')}
                    placeholder={t('home.emerald.searchPlaceholder')}
                    className="emerald-search-input"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setIsPanelOpen(true);
                      setActiveIndex(-1);
                    }}
                    onFocus={() => {
                      setIsPanelOpen(true);
                    }}
                    onKeyDown={handleKeyDown}
                  />

                  <button
                    type="submit"
                    className="emerald-submit-btn"
                    aria-label={t('home.emerald.submitLabel')}
                  >
                    <svg
                      className="emerald-arrow-icon"
                      viewBox="0 0 24 24"
                      width="22"
                      height="22"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                </div>

                {/* Suggestions Panel */}
                <AnimatePresence>
                  {isPanelOpen && (
                    <motion.div
                      ref={panelRef}
                      className="emerald-suggestions-panel"
                      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scaleY: 0.96 }}
                      animate={{ opacity: 1, y: 0, scaleY: 1 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: EASING }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {results.length > 0 ? (
                        <ul className="emerald-results-list" id={listId} role="listbox" aria-label={t('home.schools')}>
                          {results.map((school, idx) => (
                            <li
                              key={school.id}
                              id={`${listId}-opt-${idx}`}
                              role="option"
                              aria-selected={idx === activeIndex}
                              className={`emerald-school-row ${idx === activeIndex ? 'is-active' : ''}`}
                              onPointerEnter={() => {
                                prefetchFlowPage();
                                prefetchSchoolData(school.id);
                              }}
                              onClick={() => selectSchoolAndNavigate(school)}
                            >
                              <SchoolCrest
                                id={school.id}
                                color={school.color}
                                name={school.name}
                                code={school.code}
                                size={34}
                              />
                              <div className="emerald-school-info">
                                <span className="emerald-school-name">{highlight(school.name, debounced)}</span>
                                {school.city && (
                                  <span className="emerald-school-city">{highlight(school.city, debounced)}</span>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="emerald-empty-results" role="status">
                          {t('search.noMatch', { query: debounced.trim() })}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.form>
            </div>
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
                      shouldReduceMotion
                        ? { opacity: 0.85, scale: 1 }
                        : {
                            opacity: [0.35, 1, 0.35],
                            scale: [0.75, 1.15, 0.75],
                          }
                    }
                    transition={
                      shouldReduceMotion
                        ? { duration: 0 }
                        : {
                            duration: 3,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: sp.delay,
                          }
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
                  animate={shouldReduceMotion ? { y: 0 } : { y: [0, -6, 0] }}
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : {
                          duration: 5,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }
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
