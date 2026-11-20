import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight } from '../components/ui/icons';
import { useStoreSchools } from '../data/catalog';
import { useStoreState } from '../store/storeState';
import { SchoolCrest } from '../components/school/SchoolCrest';
import { useSelectSchool } from '../components/school/useSelectSchool';
import { KitIllustration, type KitKind } from '../components/home/KitIllustration';
import { CategoryPhoto } from '../components/CategoryPhoto';
import { prefetchFlowPage, prefetchSchoolData } from '../utils/prefetch';
import { motion } from 'motion/react';
import { Reveal, Stagger, SplitReveal, curtainVariants } from '../motion';
import { useLang } from '../i18n';
import { HomeHero } from '../components/home/HomeHero';
import { OurStorySection } from '../components/home/OurStorySection';
import { isCategoryLive } from '../data/liveCategories';
import { SHOP_LINK } from '../siteConfig';
import './home.css';

export interface HomePageProps {
  onOpenBag?: () => void;
  onOpenLanguage?: () => void;
}

export function HomePage({ onOpenBag, onOpenLanguage }: HomePageProps) {
  const navigate = useNavigate();
  const { selection, setSelection } = useStoreState();
  const { t } = useLang();
  const [isSchoolsOpen, setIsSchoolsOpen] = useState(false);

  // Our story's "Find your school" opens the shop, like every other shop link.
  const openShop = () => navigate(SHOP_LINK);

  const categoryTiles = [
    {
      title: t('cat.uniform'),
      category: 'Uniform',
      kind: 'uniform' as KitKind,
      href: SHOP_LINK,
    },
    {
      title: t('cat.shoes'),
      category: 'School Shoes',
      kind: 'shoes' as KitKind,
      href: SHOP_LINK,
    },
    {
      title: t('cat.accessories'),
      category: 'Uniform Accessories',
      kind: 'accessories' as KitKind,
      href: SHOP_LINK,
    },
    {
      title: t('cat.stationery'),
      category: 'Stationery',
      kind: 'stationery' as KitKind,
      href: SHOP_LINK,
    },
    {
      title: t('cat.idcard'),
      category: 'ID Cards',
      kind: 'idcard' as KitKind,
      href: SHOP_LINK,
    },
  ].filter((tile) => isCategoryLive(tile.category));

  const { data: schools = [] } = useStoreSchools();

  const handleSelectSchool = useSelectSchool();

  return (
    <div className="home-page" id="main">
      {/* 1. EMERALD STAGE HERO (P1) */}
      <HomeHero onOpenBag={onOpenBag} onOpenLanguage={onOpenLanguage} />

      {/* 2. OUR STORY: the second screen, right under the hero */}
      <OurStorySection showTitle showSchools={false} onFindSchool={openShop} />

      {/* 3. SHOP BY CATEGORY (Editorial Grid), on the one full-width highlight band */}
      <div className="highlight-band">
      <section className="section-wrap container">
        <div className="section-head">
          <SplitReveal className="home-h2">{t('home.shopByCategory')}</SplitReveal>
        </div>

        <Stagger className="editorial-category-grid" staggerDelay={0.09}>
          {categoryTiles.map((cat, idx) => (
            <Link
              key={cat.title}
              to={cat.href}
              className={`cat-tile house-${idx % 5}`}
              onMouseEnter={prefetchFlowPage}
            >
              <motion.div className="cat-tile-media" variants={curtainVariants}>
                <CategoryPhoto
                  category={cat.category}
                  size={400}
                  lazy
                  fallback={<KitIllustration kind={cat.kind} color="var(--tile)" />}
                />
              </motion.div>
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

      {/* 4. ALL SCHOOLS (Collapsible, collapsed by default) */}
      <section className="section-wrap container schools-accordion-section">
        <div className="section-head-split">
          <button
            type="button"
            className="schools-accordion-toggle"
            onClick={() => setIsSchoolsOpen((prev) => !prev)}
            aria-expanded={isSchoolsOpen}
            aria-controls="home-schools-list"
          >
            <SplitReveal className="home-h2">{t('home.allSchools')}</SplitReveal>
            <span className={`schools-toggle-badge ${isSchoolsOpen ? 'is-open' : ''}`} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="schools-chevron-icon"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>
        </div>

        {/* The list of schools is collapsed and not seen by default */}
        {isSchoolsOpen && (
          <div id="home-schools-list">
            <Stagger className="school-rows" staggerDelay={0.045}>
              {schools.slice(0, 8).map((school) => (
                <button
                  type="button"
                  key={school.id}
                  className="school-row"
                  onMouseEnter={() => {
                    prefetchFlowPage();
                    prefetchSchoolData(school.id);
                  }}
                  onClick={() => handleSelectSchool(school)}
                >
                  <SchoolCrest id={school.id} color={school.color} name={school.name} code={school.code} size={44} />
                  <span className="school-row-text">
                    <span className="school-row-name">{school.name}</span>
                    {(school.city || school.board) && (
                      <span className="school-row-meta">{[school.city, school.board].filter(Boolean).join(' · ')}</span>
                    )}
                  </span>
                  <ArrowRight className="school-row-arrow" width={18} height={18} aria-hidden="true" />
                </button>
              ))}
            </Stagger>
          </div>
        )}
      </section>

      {/* 5. STORE POLICY & GUARANTEE */}
      <section className="section-wrap container store-policy-section" aria-labelledby="store-policy-title">
        <div className="section-head policy-head">
          <span className="label policy-eyebrow">{t('home.policyEyebrow')}</span>
          <SplitReveal id="store-policy-title" className="home-h2 policy-title">
            {t('home.policyTitle')}
          </SplitReveal>
        </div>

        <div className="store-policy-grid">
          {/* Card 1: 100% School Approved */}
          <div className="policy-card">
            <div className="policy-icon-tile" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <h3 className="policy-card-title">{t('home.policy1Title')}</h3>
            <p className="policy-card-desc">{t('home.policy1Desc')}</p>
          </div>

          {/* Card 2: 7-Day Easy Exchange */}
          <div className="policy-card">
            <div className="policy-icon-tile" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </div>
            <h3 className="policy-card-title">{t('home.policy2Title')}</h3>
            <p className="policy-card-desc">{t('home.policy2Desc')}</p>
          </div>

          {/* Card 3: Convenient Delivery */}
          <div className="policy-card">
            <div className="policy-icon-tile" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </div>
            <h3 className="policy-card-title">{t('home.policy3Title')}</h3>
            <p className="policy-card-desc">{t('home.policy3Desc')}</p>
          </div>
        </div>
      </section>

      {/* 6. FOR SCHOOLS: institutional partnership banner with clear title and formatting */}
      <section className="for-schools-band" aria-labelledby="for-schools-heading">
        <div className="container for-schools-inner">
          <div className="for-schools-header">
            <span className="label for-schools-label">{t('home.partnerEyebrow')}</span>
            <SplitReveal as="h3" id="for-schools-heading" className="for-schools-title">
              {t('home.partnerTitle')}
            </SplitReveal>
            <p className="for-schools-lead">
              {t('home.partnerLead')}
            </p>
          </div>

          <div className="for-schools-pillars">
            <div className="for-schools-pillar">
              <span className="pillar-dot" aria-hidden="true" />
              <span>{t('home.partnerPoint1')}</span>
            </div>
            <div className="for-schools-pillar">
              <span className="pillar-dot" aria-hidden="true" />
              <span>{t('home.partnerPoint2')}</span>
            </div>
            <div className="for-schools-pillar">
              <span className="pillar-dot" aria-hidden="true" />
              <span>{t('home.partnerPoint3')}</span>
            </div>
          </div>

          <div className="for-schools-cta-wrap">
            <Link to="/for-schools" className="btn btn-lg for-schools-btn">
              {t('home.partnerCta')}
              <ArrowRight width={18} height={18} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
