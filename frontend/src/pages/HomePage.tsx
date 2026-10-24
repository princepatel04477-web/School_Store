import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight } from '../components/ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import { useStoreSchools } from '../data/catalog';
import { useStoreState } from '../store/storeState';
import { SchoolCrest } from '../components/school/SchoolCrest';
import { SchoolSearch } from '../components/school/SchoolSearch';
import { useSelectSchool } from '../components/school/useSelectSchool';
import { Button } from '../components/ui/Button';
import { KitIllustration, type KitKind } from '../components/home/KitIllustration';
import { CategoryPhoto } from '../components/CategoryPhoto';
import { EASING } from '../motion/motionConfig';
import { prefetchFlowPage, prefetchSchoolData } from '../utils/prefetch';
import {
  Reveal,
  Stagger,
  Thread,
  TextReveal,
  Hairline,
} from '../motion';
import { siteConfig } from '../siteConfig';
import { useLang } from '../i18n';
import { classLabel, genderLabel } from '../i18n/labels';
import './home.css';

export function HomePage() {
  const navigate = useNavigate();
  const { selection, setSelection } = useStoreState();
  const { t } = useLang();

  const categoryTiles = [
    {
      title: t('cat.uniform'),
      category: 'Uniform',
      kind: 'uniform' as KitKind,
      href: '/shop?cat=Uniform',
    },
    {
      title: t('cat.shoes'),
      category: 'School Shoes',
      kind: 'shoes' as KitKind,
      href: '/shop?cat=School%20Shoes',
    },
    {
      title: t('cat.accessories'),
      category: 'Uniform Accessories',
      kind: 'accessories' as KitKind,
      href: '/shop?cat=Uniform%20Accessories',
    },
    {
      title: t('cat.stationery'),
      category: 'Stationery',
      kind: 'stationery' as KitKind,
      href: '/shop?cat=Stationery',
    },
    {
      title: t('cat.idcard'),
      category: 'ID Cards',
      kind: 'idcard' as KitKind,
      href: '/shop?cat=ID%20Cards',
    },
  ];

  const { data: schools = [] } = useStoreSchools();

  const handleSelectSchool = useSelectSchool();

  return (
    <div className="home-page" id="main">
      <div className="house-stripe" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>

      {/* 1. HERO SECTION: the headline across the page, the line and the school search under it */}
      <section className="hero-section">
        <div className="container">
          <TextReveal
            lines={[t('home.heroLine1'), t('home.heroLine2')]}
            className="hero-heading"
            underlineLast
          />

          <div className="hero-row">
            <Reveal delay={0.15} className="hero-sub-wrap">
              <p className="hero-subtext">
                {t('home.heroSub')}
              </p>
            </Reveal>

            <div className="hero-action">
              {/* Hero Selection State vs School Search Box */}
              <Reveal delay={0.25}>
                <AnimatePresence mode="wait">
                  {selection ? (
                    <motion.div
                      key="selected"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25, ease: EASING }}
                      className="hero-selected-state"
                    >
                      <div className="hero-selected-badge">
                        <SchoolCrest id={selection.schoolId} name={selection.schoolName} code={selection.schoolCode} size={42} />
                        <div className="hero-selected-text">
                          <span className="hero-selected-label">{t('home.currentSchool')}</span>
                          <h2 className="hero-selected-school">{t('home.shoppingFor', { school: selection.schoolName })}</h2>
                          <span className="hero-selected-grade">
                            {selection.cityName ? `${selection.cityName} ` : ''}
                            {selection.gradeName ? `· ${classLabel(selection.gradeName, t)}` : ''}
                            {selection.gender ? ` · ${genderLabel(selection.gender, t)}` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="hero-selected-actions">
                          <Button
                            className="hero-continue-btn"
                            arrow
                            onMouseEnter={prefetchFlowPage}
                            onClick={() => {
                              const nextStep = selection.gradeId
                                ? selection.gender
                                  ? '4'
                                  : '3'
                                : '2';
                              navigate(
                                `/flow?school=${encodeURIComponent(selection.schoolId)}&step=${nextStep}`
                              );
                            }}
                          >
                            {t('home.continue')}
                          </Button>
                        <button
                          type="button"
                          className="hero-change-school-link"
                          onClick={() => {
                            setSelection(null);
                            setTimeout(() => {
                              const input = document.querySelector('.hero-search-input') as HTMLInputElement;
                              if (input) input.focus();
                            }, 50);
                          }}
                        >
                          {t('home.changeSchool')}
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="search"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25, ease: EASING }}
                    >
                      <SchoolSearch schools={schools} onSelect={handleSelectSchool} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* 3. SHOP BY CATEGORY (Editorial Grid), on the one full-width highlight band */}
      <div className="highlight-band">
      <section className="section-wrap container">
        <Reveal>
          <div className="section-head">
            <span className="label">{t('home.catEyebrow')}</span>
            <h2>{t('home.shopByCategory')}</h2>
            <Hairline />
          </div>
        </Reveal>

        <Stagger className="editorial-category-grid">
          {categoryTiles.map((cat, idx) => (
            <Link
              key={cat.title}
              to={cat.href}
              className={`cat-tile house-${idx % 5}`}
              onMouseEnter={prefetchFlowPage}
            >
              <div className="cat-tile-media">
                <CategoryPhoto
                  category={cat.category}
                  size={400}
                  lazy
                  fallback={<KitIllustration kind={cat.kind} color="var(--tile)" />}
                />
              </div>
              <div className="cat-tile-body">
                <h3 className="cat-title">{cat.title}</h3>
                <span className="cat-arrow" aria-hidden="true">
                  <ArrowRight width={16} height={16} strokeWidth={1.5} />
                </span>
              </div>
            </Link>
          ))}
        </Stagger>
      </section>
      </div>

      {/* 4. FEATURED SCHOOLS */}
      <section className="section-wrap container">
        <Reveal>
          <div className="section-head-split">
            <div>
              <span className="label">{t('home.schoolsEyebrow')}</span>
              <h2>{t('home.schools')}</h2>
            </div>
            <Link
              to="/flow?step=1"
              className="plain-link"
              onMouseEnter={prefetchFlowPage}
            >
              {t('home.viewAll')} <ArrowRight width={16} height={16} />
            </Link>
          </div>
        </Reveal>

        <Stagger className="schools-grid">
          {schools.slice(0, 8).map((school) => (
            <div
              key={school.id}
              className="featured-school-card"
              onMouseEnter={() => {
                prefetchFlowPage();
                prefetchSchoolData(school.id);
              }}
              onClick={() => handleSelectSchool(school)}
            >
              <SchoolCrest id={school.id} color={school.color} name={school.name} code={school.code} size={52} />
              <div className="featured-school-info">
                <h3 className="featured-school-name">{school.name}</h3>
                <span className="featured-school-meta">
                  {[school.city, school.board].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
          ))}
        </Stagger>
      </section>

      {/* 5. REASSURANCE: one plain sentence, not a row of feature cards */}
      <section className="section-wrap container">
        <Reveal>
          <p className="reassurance-line">
            {t('home.reassure')}
          </p>
        </Reveal>
      </section>

      {/* 6. FOR SCHOOLS: a full-width house-blue band, big heading left, the line and button right */}
      <section className="for-schools-band">
        <div className="house-stripe" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <Reveal className="container for-schools-inner">
          <div className="for-schools-text">
            <span className="label for-schools-label">Institutional Partnership</span>
            <h3 className="for-schools-title">Partner your school with SchoolStore</h3>
          </div>
          <div className="for-schools-side">
            <p className="for-schools-sub">
              Simplify uniform distribution, custom stationery, and RFID cards for your student body with dedicated logistics.
            </p>
            <Link to="/for-schools" className="btn btn-lg for-schools-btn">
              Talk to us
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
