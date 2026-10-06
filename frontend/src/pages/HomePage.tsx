import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Search, ArrowRight, ShieldCheck, RefreshCw, Truck, MessageCircle } from 'lucide-react';
import { seedSchools, type SeedSchool } from '../data/seedData';
import { useStoreState } from '../store/storeState';
import { SchoolCrest } from '../components/school/SchoolCrest';
import { FlatLayIllustration } from '../components/home/FlatLayIllustration';
import { Thread } from '../motion/Thread';
import { Reveal } from '../motion/Reveal';
import { Stagger } from '../motion/Stagger';
import { siteConfig } from '../siteConfig';
import './home.css';

export function HomePage() {
  const navigate = useNavigate();
  const { setSelection } = useStoreState();

  const [query, setQuery] = useState('');
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const comboboxRef = useRef<HTMLDivElement>(null);

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
      {/* 1. HERO SECTION (Static on first paint for fast LCP) */}
      <section className="hero-section container">
        <div className="hero-grid">
          {/* Left Column (7 cols) */}
          <div className="hero-left">
            <span className="label hero-label">
              Uniforms · Shoes · Stationery · ID cards
            </span>
            <h1 className="hero-heading">
              School essentials, <span className="word-with-thread">sorted.<Thread className="hero-thread" delay={0.2} /></span>
            </h1>
            <p className="hero-subtext">
              Pick your school and class to get the exact parent-approved list delivered directly to your door.
            </p>

            {/* School Search Combobox */}
            <div className="school-search-box" ref={comboboxRef}>
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
                    <div className="combobox-list">
                      {filteredSchools.map((school, idx) => (
                        <div
                          key={school.id}
                          role="option"
                          aria-selected={idx === activeIndex}
                          className={`combobox-option ${idx === activeIndex ? 'is-active' : ''}`}
                          onClick={() => handleSelectSchool(school)}
                        >
                          <SchoolCrest name={school.name} code={school.code} size={36} />
                          <div className="school-option-text">
                            <span className="school-option-name">{school.name}</span>
                            <span className="school-option-meta">
                              {school.city} · {school.board}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
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
            </div>
          </div>

          {/* Right Column (5 cols) Flat lay composition */}
          <div className="hero-right">
            <FlatLayIllustration />
          </div>
        </div>
      </section>

      {/* 2. HOW IT WORKS */}
      <section className="section-wrap container">
        <Reveal>
          <div className="section-head">
            <span className="label">Simple 3-step process</span>
            <h2>How it works</h2>
          </div>
        </Reveal>

        <div className="how-it-works-grid">
          <Reveal delay={0.1}>
            <div className="step-card">
              <span className="step-num">01</span>
              <h3 className="step-title">Choose your school</h3>
              <p className="step-desc">
                Select your school campus to view official uniform guidelines and approved colors.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <div className="step-card">
              <span className="step-num">02</span>
              <h3 className="step-title">Pick the class</h3>
              <p className="step-desc">
                Choose nursery through secondary to unlock curriculum-specific notebooks and attire.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.3}>
            <div className="step-card">
              <span className="step-num">03</span>
              <h3 className="step-title">Add the list to bag</h3>
              <p className="step-desc">
                Add the pre-bundled required uniform set in one tap, or tailor individual sizes.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 3. SHOP BY CATEGORY (Editorial Grid) */}
      <section className="section-wrap container">
        <Reveal>
          <div className="section-head">
            <span className="label">Approved Catalog</span>
            <h2>Shop by category</h2>
          </div>
        </Reveal>

        <div className="editorial-category-grid">
          {/* Main Tile: Uniform (Spans 2 rows) */}
          <Link to="/shop?cat=Uniform" className="cat-tile cat-tile-large">
            <div className="cat-tile-media">
              <div className="cat-placeholder-shirt">
                <span className="cat-monogram">UNIFORM</span>
              </div>
            </div>
            <div className="cat-tile-body">
              <span className="label">Full sets & separates</span>
              <h3 className="cat-title">Official Uniforms</h3>
              <p className="cat-desc">
                Preshrunk cotton blends, reinforced knees, pleated skirts, and certified daily attire.
              </p>
              <span className="cat-arrow">
                Explore collection <ArrowRight width={16} height={16} strokeWidth={1.5} />
              </span>
            </div>
          </Link>

          {/* Shoes */}
          <Link to="/shop?cat=School%20Shoes" className="cat-tile">
            <div className="cat-tile-body">
              <span className="label">Activity & Formal</span>
              <h3 className="cat-title">School Shoes</h3>
              <p className="cat-desc">Anti-scuff leather shoes and non-marking PE white trainers.</p>
              <span className="cat-arrow">
                Shop shoes <ArrowRight width={16} height={16} strokeWidth={1.5} />
              </span>
            </div>
          </Link>

          {/* Accessories */}
          <Link to="/shop?cat=Uniform%20Accessories" className="cat-tile">
            <div className="cat-tile-body">
              <span className="label">Ties, Belts, Socks</span>
              <h3 className="cat-title">Accessories</h3>
              <p className="cat-desc">Woven crest ties, brass buckle belts, and cushioned socks.</p>
              <span className="cat-arrow">
                View items <ArrowRight width={16} height={16} strokeWidth={1.5} />
              </span>
            </div>
          </Link>

          {/* Stationery */}
          <Link to="/shop?cat=Stationery" className="cat-tile">
            <div className="cat-tile-body">
              <span className="label">Syllabus notebooks</span>
              <h3 className="cat-title">Stationery</h3>
              <p className="cat-desc">Prescribed notebook bundles, geometry kits, and art books.</p>
              <span className="cat-arrow">
                Browse stationery <ArrowRight width={16} height={16} strokeWidth={1.5} />
              </span>
            </div>
          </Link>

          {/* ID Cards */}
          <Link to="/shop?cat=ID%20Cards" className="cat-tile">
            <div className="cat-tile-body">
              <span className="label">Security badges</span>
              <h3 className="cat-title">ID Cards & Lanyards</h3>
              <p className="cat-desc">RFID chip smart badges with breakaway child-safe lanyards.</p>
              <span className="cat-arrow">
                Configure card <ArrowRight width={16} height={16} strokeWidth={1.5} />
              </span>
            </div>
          </Link>
        </div>
      </section>

      {/* 4. FEATURED SCHOOLS */}
      <section className="section-wrap container">
        <Reveal>
          <div className="section-head-split">
            <div>
              <span className="label">Campuses onboard</span>
              <h2>Featured schools</h2>
            </div>
            <Link to="/flow?step=1" className="plain-link">
              View all schools <ArrowRight width={16} height={16} />
            </Link>
          </div>
        </Reveal>

        <Stagger className="schools-grid">
          {seedSchools.slice(0, 8).map((school) => (
            <div
              key={school.id}
              className="featured-school-card"
              onClick={() => handleSelectSchool(school)}
            >
              <SchoolCrest name={school.name} code={school.code} size={52} />
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
