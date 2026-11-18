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

      {/* 4. FEATURED SCHOOLS */}
      <section className="section-wrap container">
        <div className="section-head-split">
          <SplitReveal className="home-h2">{t('home.schools')}</SplitReveal>
          <Link
            to="/flow?step=1"
            className="plain-link"
            onMouseEnter={prefetchFlowPage}
          >
            {t('home.viewAll')} <ArrowRight width={16} height={16} />
          </Link>
        </div>

        {/* A ruled list, not a wall of identical cards */}
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
      </section>

      {/* 5. THE PROMISE: one sentence set big, word by word */}
      <section className="section-wrap container promise">
        <SplitReveal as="p" className="promise-line">
          {t('home.reassure')}
        </SplitReveal>
      </section>

      {/* 6. FOR SCHOOLS: emerald band, big heading left, the line and button right */}
      <section className="for-schools-band">
        <div className="container for-schools-inner">
          <div className="for-schools-text">
            <SplitReveal as="h3" className="for-schools-title">Partner your school with SchoolStore</SplitReveal>
          </div>
          <Reveal className="for-schools-side" delay={0.25}>
            <p className="for-schools-sub">
              We stock your school&rsquo;s uniform list, take orders from parents, and deliver to their homes or your school counter.
            </p>
            <Link to="/for-schools" className="btn btn-lg for-schools-btn">
              Talk to us
            </Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
