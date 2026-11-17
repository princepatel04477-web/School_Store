import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { useStoreSchools, type StoreSchool } from '../data/catalog';
import { SchoolCrest } from '../components/school/SchoolCrest';
import { Reveal } from '../motion';
import { useAboutText, type AboutKey } from '../i18n/aboutMessages';
import './about.css';

/** Fewer schools than this and the row looks empty, so it is left out. */
export const MIN_SLIDER_SCHOOLS = 4;
const MAX_SLIDER_SCHOOLS = 16;

function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const previousTitle = document.title;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    const previousDescription = meta.content;
    document.title = title;
    meta.content = description;
    return () => {
      document.title = previousTitle;
      if (!meta) return;
      if (created) meta.remove();
      else meta.content = previousDescription;
    };
  }, [title, description]);
}

function Sparkle({ className }: { className: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
      <path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" />
    </svg>
  );
}

function CheckDot() {
  return (
    <span className="about-check" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5 9-10" />
      </svg>
    </span>
  );
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' | 'down' }) {
  const d = direction === 'down' ? 'M12 5v14M6 13l6 6 6-6' : direction === 'left' ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6';
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

interface ProblemCardProps {
  icon: 'clock' | 'box';
  title: string;
  body: string;
}

function ProblemCard({ icon, title, body }: ProblemCardProps) {
  return (
    <article className="about-problem-card">
      <div className="about-problem-icon" aria-hidden="true">
        {icon === 'clock' ? (
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 8.5V13l3 2M9.5 2.5h5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
            <path d="M3 8l9 5 9-5M12 13v8" />
            <path d="M16.5 15.5l3 3M19.5 15.5l-3 3" />
          </svg>
        )}
      </div>
      <h3 className="about-problem-title">{title}</h3>
      <p className="about-problem-body">{body}</p>
    </article>
  );
}

interface SchoolsSliderProps {
  schools: StoreSchool[];
  t: (key: AboutKey) => string;
}

function SchoolsSlider({ schools, t }: SchoolsSliderProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const reduceMotion = useReducedMotion();

  const updateEnds = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const max = rail.scrollWidth - rail.clientWidth;
    setCanPrev(rail.scrollLeft > 4);
    setCanNext(rail.scrollLeft < max - 4);
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    updateEnds();
    rail.addEventListener('scroll', updateEnds, { passive: true });
    window.addEventListener('resize', updateEnds);
    return () => {
      rail.removeEventListener('scroll', updateEnds);
      window.removeEventListener('resize', updateEnds);
    };
  }, [updateEnds, schools.length]);

  const scrollByPage = (direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * rail.clientWidth * 0.85, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <section className="about-schools" aria-labelledby="about-schools-title">
      <div className="about-schools-head">
        <h2 id="about-schools-title" className="about-h2 about-h2--small">
          {t('about.schoolsTitle')}
        </h2>
        <span className="about-swipe-hint" aria-hidden="true">
          {t('about.swipe')}
          <ArrowIcon direction="right" />
        </span>
        <div className="about-schools-nav">
          <button type="button" className="about-nav-btn" onClick={() => scrollByPage(-1)} disabled={!canPrev} aria-label={t('about.prev')}>
            <ArrowIcon direction="left" />
          </button>
          <button type="button" className="about-nav-btn" onClick={() => scrollByPage(1)} disabled={!canNext} aria-label={t('about.next')}>
            <ArrowIcon direction="right" />
          </button>
        </div>
      </div>
      <div ref={railRef} className="about-schools-rail" role="region" aria-label={t('about.schoolsRegion')} tabIndex={0}>
        <ul className="about-schools-list">
          {schools.map((school) => (
            <li key={school.id} className="about-school">
              <div className="about-school-badge">
                <SchoolCrest id={school.id} name={school.name} code={school.code} logoUrl={school.logoUrl} size={56} className="about-school-crest" />
              </div>
              <span className="about-school-name">{school.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function AboutPage() {
  const { t } = useAboutText();
  const navigate = useNavigate();
  const { data: allSchools } = useStoreSchools();

  usePageMeta(t('about.pageTitle'), t('about.metaDescription'));

  const sliderSchools = useMemo(() => {
    const list = allSchools ?? [];
    // Schools with a real logo lead the row; the rest show their monogram crest.
    const withLogo = list.filter((s) => s.logoUrl);
    const withoutLogo = list.filter((s) => !s.logoUrl);
    return [...withLogo, ...withoutLogo].slice(0, MAX_SLIDER_SCHOOLS);
  }, [allSchools]);

  const findSchool = () => navigate('/', { state: { focusSearch: true } });

  return (
    <div className="about-page">
      <section className="about-hero">
        <div className="about-hero-circles" aria-hidden="true">
          <span className="about-circle about-circle--outer" />
          <span className="about-circle about-circle--inner" />
        </div>
        <div className="about-container about-hero-grid">
          <div className="about-hero-copy">
            <p className="about-eyebrow about-eyebrow--light">{t('about.eyebrow')}</p>
            <h1 className="about-h1">
              {t('about.titleLead')} <span className="about-accent">{t('about.titleAccent')}</span>
            </h1>
            <p className="about-hero-sub">{t('about.sub')}</p>
          </div>
          <div className="about-hero-art">
            <Sparkle className="about-sparkle about-sparkle--a" />
            <Sparkle className="about-sparkle about-sparkle--b" />
            <picture>
              <source srcSet="/brand/kids-uniform.clean.avif" type="image/avif" />
              <source srcSet="/brand/kids-uniform.clean.webp" type="image/webp" />
              <img
                className="about-kids"
                src="/brand/kids-uniform.clean.png"
                alt={t('about.kidsAlt')}
                width={600}
                height={880}
                decoding="async"
              />
            </picture>
          </div>
        </div>
      </section>

      <div className="about-sheet">
        <div className="about-container about-stack">
          <Reveal as="section" className="about-problem">
            <p className="about-eyebrow about-eyebrow--problem">{t('about.problemEyebrow')}</p>
            <h2 className="about-h2">{t('about.problemTitle')}</h2>
            <div className="about-problem-grid">
              <ProblemCard icon="clock" title={t('about.timeTitle')} body={t('about.timeBody')} />
              <ProblemCard icon="box" title={t('about.stockTitle')} body={t('about.stockBody')} />
            </div>
          </Reveal>

          <div className="about-pivot">
            <span className="about-pivot-arrow" aria-hidden="true">
              <ArrowIcon direction="down" />
            </span>
            <p className="about-pivot-text">{t('about.pivot')}</p>
          </div>

          <Reveal as="section" className="about-fix">
            <div className="about-fix-head">
              <p className="about-eyebrow about-eyebrow--fix">{t('about.fixEyebrow')}</p>
              <h2 className="about-fix-title">{t('about.fixTitle')}</h2>
            </div>
            <ul className="about-fix-list">
              <li className="about-fix-item">
                <CheckDot />
                <span>{t('about.fixHome')}</span>
              </li>
              <li className="about-fix-item">
                <CheckDot />
                <span>{t('about.fixList')}</span>
              </li>
            </ul>
          </Reveal>

          <Reveal className="about-badge">
            <span className="about-badge-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.4 6.8 19.2l1-5.9L3.5 9.2l5.9-.8z" />
              </svg>
            </span>
            <span className="about-badge-copy">
              <strong className="about-badge-title">{t('about.badgeTitle')}</strong>
              <span className="about-badge-body">{t('about.badgeBody')}</span>
            </span>
          </Reveal>

          {sliderSchools.length >= MIN_SLIDER_SCHOOLS && <SchoolsSlider schools={sliderSchools} t={t} />}

          <div className="about-cta-wrap">
            <button type="button" className="about-cta" onClick={findSchool}>
              {t('about.cta')}
              <ArrowIcon direction="right" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutPage;
