import { useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowRight } from '../components/ui/icons';
import { useStoreSchools } from '../data/catalog';
import { useStoreState } from '../store/storeState';
import { SchoolCrest } from '../components/school/SchoolCrest';
import { useSelectSchool } from '../components/school/useSelectSchool';
import { KitIllustration, type KitKind } from '../components/home/KitIllustration';
import { CategoryPhoto } from '../components/CategoryPhoto';
import { prefetchFlowPage, prefetchSchoolData } from '../utils/prefetch';
import {
  Reveal,
  Stagger,
  Hairline,
} from '../motion';
import { useLang } from '../i18n';
import { HomeHero } from '../components/home/HomeHero';
import { OurStorySection } from '../components/home/OurStorySection';
import { scrollPageTo } from '../motion/SmoothScroll';
import { isCategoryLive } from '../data/liveCategories';
import './home.css';

export interface HomePageProps {
  onOpenBag?: () => void;
  onOpenLanguage?: () => void;
}

export function HomePage({ onOpenBag, onOpenLanguage }: HomePageProps) {
  const navigate = useNavigate();
  const { selection, setSelection } = useStoreState();
  const { t } = useLang();
  const location = useLocation();

  // "Find your school" on other pages (Our story) lands here with the search ready to type in.
  const focusSearch = (location.state as { focusSearch?: boolean } | null)?.focusSearch === true;
  useEffect(() => {
    if (!focusSearch) return undefined;
    let tries = 0;
    let frame = 0;
    const focusWhenReady = () => {
      const input = document.querySelector<HTMLInputElement>('.emerald-search-input');
      if (input) {
        input.focus({ preventScroll: false });
        navigate(location.pathname + location.search, { replace: true, state: null });
        return;
      }
      if (tries++ < 60) frame = requestAnimationFrame(focusWhenReady);
    };
    frame = requestAnimationFrame(focusWhenReady);
    return () => cancelAnimationFrame(frame);
  }, [focusSearch, navigate, location.pathname, location.search]);

  // Our story's "Find your school": back up to the hero with the search ready to type in.
  const jumpToSearch = () => {
    scrollPageTo(0, true);
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('.emerald-search-input')?.focus({ preventScroll: true });
    }, 450);
  };

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
  ].filter((tile) => isCategoryLive(tile.category));

  const { data: schools = [] } = useStoreSchools();

  const handleSelectSchool = useSelectSchool();

  return (
    <div className="home-page" id="main">
      {/* 1. EMERALD STAGE HERO (P1) */}
      <HomeHero onOpenBag={onOpenBag} onOpenLanguage={onOpenLanguage} />

      {/* 2. OUR STORY: the second screen, right under the hero */}
      <OurStorySection showTitle showSchools={false} onFindSchool={jumpToSearch} />

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
              Simplify uniform and shoe distribution for your student body with dedicated logistics.
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
