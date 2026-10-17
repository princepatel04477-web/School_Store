import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Search, ArrowRight } from '../ui/icons';
import { SchoolCrest } from './SchoolCrest';
import { Stagger } from '../../motion';
import { EASING } from '../../motion/motionConfig';
import { prefetchFlowPage, prefetchSchoolData } from '../../utils/prefetch';
import { useLang } from '../../i18n';
import type { StoreSchool } from '../../data/catalog';

interface SchoolSearchBoxProps {
  schools: StoreSchool[];
  onSelect: (school: StoreSchool) => void;
}

/**
 * The home page school search. Its query and open state live here, not in the
 * page, so opening it or typing re-renders only this box. When that state sat in
 * HomePage, every tap re-rendered the hero and the reveal animations played again.
 */
export function SchoolSearchBox({ schools, onSelect }: SchoolSearchBoxProps) {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const filteredSchools = q
    ? schools.filter((s) => s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q))
    : schools.slice(0, 5); // Popular schools

  const select = (school: StoreSchool) => {
    setOpen(false);
    onSelect(school);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true);
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
      const pick = filteredSchools[activeIndex] ?? filteredSchools[0];
      if (pick) select(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Close when a tap or click lands outside the box
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: EASING }}
      className="school-search-box"
      ref={boxRef}
    >
      <div className="search-input-wrap">
        <Search className="search-box-icon" width={22} height={22} strokeWidth={1.5} />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="school-results-list"
          aria-label={t('home.searchPlaceholder')}
          placeholder={t('home.searchPlaceholder')}
          className="hero-search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="btn btn-primary hero-find-btn"
          onClick={() => {
            if (filteredSchools.length > 0) select(filteredSchools[0]);
          }}
        >
          {t('home.findSchool')}
        </button>
      </div>

      {open && (
        <div className="combobox-dropdown" id="school-results-list" role="listbox">
          <div className="combobox-header">
            <span className="label">{q ? t('home.matching') : t('home.schools')}</span>
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
                  onClick={() => select(school)}
                >
                  <SchoolCrest id={school.id} color={school.color} name={school.name} code={school.code} size={36} />
                  <div className="school-option-text">
                    <span className="school-option-name">{school.name}</span>
                    <span className="school-option-meta">{[school.city, school.board].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
              ))}
            </Stagger>
          ) : (
            <div className="combobox-empty">
              <p>{t('home.noSchool')}</p>
              <Link to="/contact?reason=request-school" className="request-link">
                {t('home.requestSchool')} <ArrowRight width={14} height={14} />
              </Link>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
