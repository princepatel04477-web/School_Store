import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Search, ArrowRight } from '../ui/icons';
import { Button } from '../ui/Button';
import { SchoolCrest } from './SchoolCrest';
import { EASING } from '../../motion/motionConfig';
import { prefetchFlowPage, prefetchSchoolData } from '../../utils/prefetch';
import { useLang } from '../../i18n';
import type { StoreSchool } from '../../data/catalog';
import './schoolSearch.css';

const DEBOUNCE_MS = 200;
const POPULAR_COUNT = 5;
const CONTACT_HREF = '/contact?reason=request-school';

export interface SchoolSearchProps {
  schools: StoreSchool[];
  onSelect: (school: StoreSchool) => void;
  /** hero: the bar on the home page. sheet: full screen, opened from the header on phones. */
  variant?: 'hero' | 'sheet';
  autoFocus?: boolean;
}

function matches(school: StoreSchool, q: string) {
  return school.name.toLowerCase().includes(q) || school.city.toLowerCase().includes(q);
}

function filterSchools(schools: StoreSchool[], query: string) {
  const q = query.trim().toLowerCase();
  return q ? schools.filter((s) => matches(s, q)) : schools.slice(0, POPULAR_COUNT);
}

/** Wraps every case-insensitive occurrence of the query in <mark>. */
function highlight(text: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>);
    from = at + q.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * School search with a results panel. All of its state lives here, so opening it or
 * typing re-renders only this component, never the page around it. One component at
 * every width; CSS does the sizing.
 */
export function SchoolSearch({ schools, onSelect, variant = 'hero', autoFocus = false }: SchoolSearchProps) {
  const { t } = useLang();
  const reduce = useReducedMotion();
  const isDesktop = useMedia('(min-width: 1024px)');
  const isTouch = useMedia('(pointer: coarse)');
  const listId = useId();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(variant === 'sheet');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [panelMax, setPanelMax] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickTimer = useRef<number>();

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);
  useEffect(() => () => window.clearTimeout(pickTimer.current), []);

  const results = useMemo(() => filterSchools(schools, debounced), [schools, debounced]);
  const hasText = query.trim().length > 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const pick = (school: StoreSchool) => {
    if (pickedId) return;
    setPickedId(school.id);
    // The row shows the highlight for a moment, then the panel closes
    pickTimer.current = window.setTimeout(() => {
      setOpen(variant === 'sheet');
      setPickedId(null);
      onSelect(school);
    }, reduce ? 0 : 180);
  };

  // Enter or the arrow: the highlighted row, else the first match for what is typed now
  const submit = () => {
    const now = filterSchools(schools, query);
    const choice = (debounced === query && results[activeIndex]) || now[0];
    if (choice) pick(choice);
    else setOpen(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (results.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => (i + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && variant === 'hero') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  // Close on a tap or click outside (not on blur, which loses taps on phones)
  useEffect(() => {
    if (!open || variant === 'sheet') return;
    const handlePointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, variant]);

  // Phones: keep the whole panel above the on-screen keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !isTouch || !vv || variant === 'sheet') {
      setPanelMax(null);
      return;
    }
    const fit = () => {
      const bar = barRef.current?.getBoundingClientRect();
      if (!bar) return;
      const visibleBottom = vv.offsetTop + vv.height;
      setPanelMax(Math.max(160, Math.min(420, visibleBottom - bar.bottom - 16)));
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, [open, isTouch, variant]);

  // Phones: bring the bar up to just under the sticky header so the list has room
  const scrollBarIntoView = () => {
    if (!isTouch || variant === 'sheet' || !barRef.current) return;
    const header = document.querySelector('.site-header');
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    const top = window.scrollY + barRef.current.getBoundingClientRect().top - headerBottom - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const showButton = isDesktop && variant === 'hero';
  const placeholder = isDesktop ? t('search.placeholderLong') : t('home.searchPlaceholder');
  const fast = { duration: reduce ? 0 : 0.2, ease: EASING };

  const footer = (
    <div className="ss-footer">
      {t('search.cantFind')}{' '}
      <Link to={CONTACT_HREF}>{t('search.contact')}</Link>
    </div>
  );

  const panelBody = (
    <>
      {results.length > 0 ? (
        <ul className="ss-list" id={listId} role="listbox" aria-label={t('home.schools')}>
          {results.map((school, idx) => (
            <motion.li
              key={school.id}
              id={optionId(idx)}
              role="option"
              aria-selected={idx === activeIndex}
              className={`ss-row ${idx === activeIndex ? 'is-active' : ''} ${pickedId === school.id ? 'is-picked' : ''}`}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: EASING, delay: reduce ? 0 : Math.min(idx, 8) * 0.06 }}
              onPointerEnter={(e) => {
                if (e.pointerType !== 'mouse') return;
                prefetchFlowPage();
                prefetchSchoolData(school.id);
              }}
              onClick={() => pick(school)}
            >
              <SchoolCrest id={school.id} color={school.color} name={school.name} code={school.code} size={isDesktop ? 32 : 36} />
              <span className="ss-row-text">
                <span className="ss-name">{highlight(school.name, debounced)}</span>
                {school.city && <span className="ss-city">{highlight(school.city, debounced)}</span>}
              </span>
            </motion.li>
          ))}
        </ul>
      ) : (
        <p className="ss-empty" role="status">
          {t('search.noMatch', { query: debounced.trim() })}
        </p>
      )}
      {footer}
    </>
  );

  return (
    <div ref={rootRef} className={`ss ss--${variant}`}>
      <div ref={barRef} className={`ss-bar ${showButton ? 'has-button' : ''}`}>
        <Search className="ss-lead-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label={t('home.searchPlaceholder')}
          placeholder={placeholder}
          className="ss-input hero-search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            setOpen(true);
            scrollBarIntoView();
          }}
          onKeyDown={handleKeyDown}
        />
        {showButton ? (
          <Button className="ss-find" arrow onClick={submit}>
            {t('home.findSchool')}
          </Button>
        ) : (
          <button type="button" className="ss-trail" aria-label={t('home.findSchool')} onClick={submit}>
            {/* Search icon until something is typed, then the arrow. Fades only; arrows never move. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={hasText ? 'go' : 'search'}
                className="ss-trail-icon"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fast}
              >
                {hasText ? <ArrowRight width={20} height={20} /> : <Search width={20} height={20} />}
              </motion.span>
            </AnimatePresence>
          </button>
        )}
      </div>

      {variant === 'sheet' ? (
        <div className="ss-panel ss-panel--sheet" onMouseDown={(e) => e.preventDefault()}>
          {panelBody}
        </div>
      ) : (
        <AnimatePresence>
          {open && (
            <motion.div
              className="ss-panel"
              style={panelMax ? { maxHeight: panelMax } : undefined}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scaleY: 0.96 }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.18, ease: EASING }}
              // Keep focus (and the phone keyboard) in the input while a row is tapped
              onMouseDown={(e) => e.preventDefault()}
            >
              {panelBody}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
