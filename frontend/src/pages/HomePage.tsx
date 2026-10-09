import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Search, ArrowRight, ShieldCheck, RefreshCw, Truck, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { seedSchools, type SeedSchool } from '../data/seedData';
import { useStoreState } from '../store/storeState';
import { SchoolCrest } from '../components/school/SchoolCrest';
import { KitIllustration, type KitKind } from '../components/home/KitIllustration';
import { KitListHero } from '../components/home/KitListHero';
import { EASING } from '../motion/motionConfig';
import { prefetchFlowPage, prefetchSchoolData } from '../utils/prefetch';
import {
  Reveal,
  Stagger,
  Thread,
  TextReveal,
  Magnetic,
  Hairline,
} from '../motion';
import { siteConfig } from '../siteConfig';
import './home.css';

export function HomePage() {
  const navigate = useNavigate();
  const { selection, setSelection } = useStoreState();

  const [query, setQuery] = useState('');
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const comboboxRef = useRef<HTMLDivElement>(null);

  const categoryTiles = [
    {
      title: 'Uniform',
      kind: 'uniform' as KitKind,
      href: '/shop?cat=Uniform',
    },
    {
      title: 'Shoes',
      kind: 'shoes' as KitKind,
      href: '/shop?cat=School%20Shoes',
    },
    {
      title: 'Accessories',
      kind: 'accessories' as KitKind,
      href: '/shop?cat=Uniform%20Accessories',
    },
    {
      title: 'Stationery',
      kind: 'stationery' as KitKind,
      href: '/shop?cat=Stationery',
    },
    {
      title: 'ID Cards',
      kind: 'idcard' as KitKind,
      href: '/shop?cat=ID%20Cards',
    },
  ];

  // Filtered schools
  const filteredSchools = query.trim()
    ? seedSchools.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.city.toLowerCase().includes(query.toLowerCase())
      )
    : seedSchools.slice(0, 5); // Popular schools

  const handleSelectSchool = (school: SeedSchool) => {
    setSelection({
      schoolId: school.id,
      schoolName: school.name,
      schoolCode: school.code,
      cityName: school.city,
    });
    setComboboxOpen(false);
    navigate(`/flow?school=${encodeURIComponent(school.id)}&step=2`);
  };

  // Keyboard navigation for combobox
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!comboboxOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setComboboxOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < filteredSchools.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredSchools.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filteredSchools.length) {
        handleSelectSchool(filteredSchools[activeIndex]);
      } else if (filteredSchools.length > 0) {
        handleSelectSchool(filteredSchools[0]);
      }
    } else if (e.key === 'Escape') {
      setComboboxOpen(false);
    }
  };

  // Click outside listener for combobox
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setComboboxOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="home-page" id="main">
      <div className="house-stripe" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>

      {/* 1. HERO SECTION */}
      <section className="hero-section container">
        <div className="hero-grid">
          {/* Left Column (7 cols) */}
          <div className="hero-left">
            <span className="label hero-label">
              Uniforms · Shoes · Stationery · ID cards
            </span>
            <TextReveal
              lines={['School essentials,', 'sorted.']}
              className="hero-heading"
            />
            <Reveal delay={0.15}>
              <p className="hero-subtext">
                Pick your school and class to get the exact parent-approved list delivered directly to your door.
              </p>
            </Reveal>

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
                        <span className="hero-selected-label">Current Campus</span>
                        <h2 className="hero-selected-school">Shopping for {selection.schoolName}</h2>
                        <span className="hero-selected-grade">
                          {selection.cityName ? `${selection.cityName} ` : ''}
                          {selection.gradeName ? `· ${selection.gradeName}` : ''}
                          {selection.gender ? ` · ${selection.gender === 'boy' ? 'Boy' : 'Girl'}` : ''}
                        </span>
                      </div>
                    </div>

                    <div className="hero-selected-actions">
                      <Magnetic>
                        <button
                          type="button"
                          className="btn btn-primary hero-continue-btn"
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
                          Continue shopping <ArrowRight width={16} height={16} />
                        </button>
                      </Magnetic>
                      <button
                        type="button"
                        className="hero-change-school-link"
                        onClick={() => {
                          setSelection(null);
                          setQuery('');
                          setTimeout(() => {
                            const input = document.querySelector('.hero-search-input') as HTMLInputElement;
                            if (input) input.focus();
                          }, 50);
                        }}
                      >
                        Change school
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
                    className="school-search-box"
                    ref={comboboxRef}
                  >
                    <div className="search-input-wrap">
                      <Search className="search-box-icon" width={22} height={22} strokeWidth={1.5} />
                      <input
                        type="text"
                        role="combobox"
                        aria-expanded={comboboxOpen}
                        aria-haspopup="listbox"
                        aria-controls="school-results-list"
                        aria-label="Search your school"
                        placeholder="Search your school (e.g. DPS, Cathedral, NPS)..."
                        className="hero-search-input"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setComboboxOpen(true);
                          setActiveIndex(-1);
                        }}
                        onFocus={() => setComboboxOpen(true)}
                        onKeyDown={handleKeyDown}
                      />
                      <Magnetic>
                        <button
                          type="button"
                          className="btn btn-primary hero-find-btn"
                          onClick={() => {
                            if (filteredSchools.length > 0) {
                              handleSelectSchool(filteredSchools[0]);
                            }
                          }}
                        >
                          Find my school
                        </button>
                      </Magnetic>
                    </div>

                    {/* Dropdown Results */}
                    {comboboxOpen && (
                      <div className="combobox-dropdown" id="school-results-list" role="listbox">
                        <div className="combobox-header">
                          <span className="label">
                            {query.trim() ? 'Matching Schools' : 'Popular Schools'}
                          </span>
                        </div>

                        {filteredSchools.length > 0 ? (
                          <Stagger className="combobox-list">
                            {filteredSchools.map((school, idx) => (
                              <div
                                key={school.id}
                                role="option"
                                aria-selected={idx === activeIndex}
                                className={`combobox-option ${idx === activeIndex ? 'is-active' : ''}`}
                                onMouseEnter={() => {
                                  prefetchFlowPage();
                                  prefetchSchoolData(school.id);
                                }}
                                onClick={() => handleSelectSchool(school)}
                              >
                                <SchoolCrest id={school.id} color={school.color} name={school.name} code={school.code} size={36} />
                                <div className="school-option-text">
                                  <span className="school-option-name">{school.name}</span>
                                  <span className="school-option-meta">
                                    {school.city} · {school.board}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </Stagger>
                        ) : (
                          <div className="combobox-empty">
                            <p>We don't have that school yet.</p>
                            <Link to="/contact?reason=request-school" className="request-link">
                              Request your school <ArrowRight width={14} height={14} />
                            </Link>
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </Reveal>
          </div>

          {/* Right Column: an example class list instead of a photo */}
          <div className="hero-right">
            <Reveal delay={0.2}>
              <KitListHero schoolName={selection?.schoolName} />
            </Reveal>
          </div>
        </div>
      </section>

      {/* 2. HOW IT WORKS */}
      <section className="section-wrap container">
        <Reveal>
          <div className="section-head">
            <span className="label">Simple 3-step process</span>
            <h2>How it works</h2>
            <Hairline />
          </div>
        </Reveal>

        <Stagger className="how-it-works-grid">
          <div className="step-card house-0">
            <span className="step-num">01</span>
            <h3 className="step-title">Choose your school</h3>
            <p className="step-desc">
              Select your school campus to view official uniform guidelines and approved colors.
            </p>
          </div>

          <div className="step-card house-1">
            <span className="step-num">02</span>
            <h3 className="step-title">Pick the class</h3>
            <p className="step-desc">
              Choose nursery through secondary to unlock curriculum-specific notebooks and attire.
            </p>
          </div>

          <div className="step-card house-2">
            <span className="step-num">03</span>
            <h3 className="step-title">Add the list to bag</h3>
            <p className="step-desc">
              Add the pre-bundled required uniform set in one tap, or tailor individual sizes.
            </p>
          </div>
        </Stagger>
      </section>

      {/* 3. SHOP BY CATEGORY (Editorial Grid) */}
      <section className="section-wrap container">
        <Reveal>
          <div className="section-head">
            <span className="label">Approved Catalog</span>
            <h2>Shop by category</h2>
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
                <KitIllustration kind={cat.kind} color="var(--tile)" />
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

      {/* 4. FEATURED SCHOOLS */}
      <section className="section-wrap container">
        <Reveal>
          <div className="section-head-split">
            <div>
              <span className="label">Campuses onboard</span>
              <h2>Featured schools</h2>
            </div>
            <Link
              to="/flow?step=1"
              className="plain-link"
              onMouseEnter={prefetchFlowPage}
            >
              View all schools <ArrowRight width={16} height={16} />
            </Link>
          </div>
        </Reveal>

        <Stagger className="schools-grid">
          {seedSchools.slice(0, 8).map((school) => (
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
                  {school.city} · {school.board}
                </span>
              </div>
            </div>
          ))}
        </Stagger>
      </section>

      {/* 5. REASSURANCE (Calm row of 3 plain-text points) */}
      <section className="section-wrap container">
        <Reveal>
          <div className="reassurance-row">
            <div className="reassurance-item">
              <ShieldCheck width={24} height={24} strokeWidth={1.5} className="reassurance-icon" />
              <div>
                <h4 className="reassurance-title">School-approved items</h4>
                <p className="reassurance-text">
                  Direct partnership with school boards ensures strict adherence to color, fabric, and crest specs.
                </p>
              </div>
            </div>

            <div className="reassurance-item">
              <RefreshCw width={24} height={24} strokeWidth={1.5} className="reassurance-icon" />
              <div>
                <h4 className="reassurance-title">Easy size exchange</h4>
                <p className="reassurance-text">
                  Hassle-free size replacement at home or via the campus school counter within 7 days.
                </p>
              </div>
            </div>

            <div className="reassurance-item">
              <Truck width={24} height={24} strokeWidth={1.5} className="reassurance-icon" />
              <div>
                <h4 className="reassurance-title">Home or school collection</h4>
                <p className="reassurance-text">
                  Choose doorstep delivery or pick up directly from the school collection counter before term starts.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* 6. FOR SCHOOLS (Partner invitation band) */}
      <section className="container section-wrap">
        <Reveal>
          <div className="for-schools-band">
            <div className="for-schools-text">
              <span className="label">Institutional Partnership</span>
              <h3 className="for-schools-title">Partner your school with SchoolStore</h3>
              <p className="for-schools-sub">
                Simplify uniform distribution, custom stationery, and RFID cards for your student body with dedicated logistics.
              </p>
            </div>
            <Link to="/for-schools" className="btn btn-outline">
              Talk to us
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
