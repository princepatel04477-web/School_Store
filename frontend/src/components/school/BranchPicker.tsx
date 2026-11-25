import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Search } from '../ui/icons';
import { SchoolPickerSkeleton } from '../ui/Skeleton';
import { SplitReveal, Stagger } from '../../motion';
import { ListenButton } from '../ListenButton';
import { SchoolCrest } from './SchoolCrest';
import { StateEmblem } from './StateEmblem';
import { useBackHandler } from '../BackButton';
import { useLang } from '../../i18n';
import {
  useStoreBranches,
  useStoreCities,
  useStoreStates,
  type StoreBranch,
  type StoreCity,
} from '../../data/catalog';

/** Lists longer than this get a filter box. */
const FILTER_FROM = 8;

export interface PickedBranch {
  branch: StoreBranch;
  city: StoreCity;
  state: string;
}

interface BranchPickerProps {
  /** Only this school's branches (a parent who picked "Kendriya Vidyalaya" on the home page). */
  schoolId?: string;
  schoolName?: string;
  onClearSchool?: () => void;
  selectedBranchId?: string;
  initialState?: string;
  initialCityId?: string;
  onSelect: (picked: PickedBranch) => void;
}

type Stage = 'state' | 'city' | 'branch';

/**
 * Shop step 1: the parent taps their state, then their city, then their
 * child's school branch. A level with a single choice is skipped.
 */
export function BranchPicker({
  schoolId,
  schoolName,
  onClearSchool,
  selectedBranchId,
  initialState,
  initialCityId,
  onSelect,
}: BranchPickerProps) {
  const { t } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // The state and city the parent tapped live in the address (?state=…&city=…), one
  // history entry per tap, so the phone's back button steps school > city > state
  // like the round back button does. An empty ?state= means "no state yet". Before
  // the address has either, the picker opens on the branch saved earlier.
  const fromAddress = params.has('state');
  const state = fromAddress ? params.get('state') || undefined : initialState;
  const cityId = fromAddress ? params.get('city') || undefined : initialState ? initialCityId : undefined;
  const [query, setQuery] = useState('');

  /** Moves the picker. A tap adds a history entry; an automatic move replaces this one. */
  const moveTo = (nextState: string | undefined, nextCityId: string | undefined, how: 'tap' | 'auto') => {
    // From the live address: the shop may have updated it in this same moment.
    const next = new URLSearchParams(window.location.search);
    next.set('state', nextState ?? '');
    if (nextState && nextCityId) next.set('city', nextCityId);
    else next.delete('city');
    navigate(
      { search: `?${next}` },
      how === 'tap' ? { state: { pickerStep: true } } : { replace: true, state: location.state }
    );
  };
  const setState = (name: string) => moveTo(name, undefined, 'tap');
  const setCityId = (id: string) => moveTo(state, id, 'tap');

  const statesQuery = useStoreStates(schoolId);
  const citiesQuery = useStoreCities(state, schoolId);
  const branchesQuery = useStoreBranches(cityId, schoolId);
  // States and cities always A to Z, whatever order the server sends.
  const states = useMemo(
    () => [...(statesQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [statesQuery.data]
  );
  const cities = useMemo(
    () => [...(citiesQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [citiesQuery.data]
  );
  const branches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);
  const city = cities.find((c) => c.id === cityId);

  const stage: Stage = !state ? 'state' : !cityId ? 'city' : 'branch';

  // Record where the picker opened in this history entry, so Back to it later shows
  // the same level instead of the branch saved since.
  useEffect(() => {
    if (!fromAddress) moveTo(state, cityId, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAddress]);

  // A level with a single choice is skipped without a history entry, so Back skips it too.
  const skipped = {
    state: statesQuery.isSuccess && states.length === 1,
    city: citiesQuery.isSuccess && cities.length === 1,
  };
  useEffect(() => {
    if (stage === 'state' && states.length === 1) moveTo(states[0].name, undefined, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, states]);
  useEffect(() => {
    if (stage === 'city' && cities.length === 1) moveTo(state, cities[0].id, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, cities]);
  // The saved state or city has no open branches any more: start that level again.
  useEffect(() => {
    if (state && statesQuery.isSuccess && !states.some((s) => s.name === state)) moveTo(undefined, undefined, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, states, statesQuery.isSuccess]);
  useEffect(() => {
    if (cityId && citiesQuery.isSuccess && !city) moveTo(state, undefined, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, city, citiesQuery.isSuccess]);

  useEffect(() => setQuery(''), [stage]);

  // A new level starts at its heading. Without this a parent who scrolled down the
  // state list landed halfway down the short city list, looking at the footer.
  const [lastStage, setLastStage] = useState(stage);
  useEffect(() => {
    if (stage === lastStage) return;
    setLastStage(stage);
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [stage, lastStage]);

  const q = query.trim().toLowerCase();
  const shownStates = q ? states.filter((s) => s.name.toLowerCase().includes(q)) : states;
  const shownCities = q ? cities.filter((c) => c.name.toLowerCase().includes(q)) : cities;
  const shownBranches = q
    ? branches.filter((b) =>
        [b.name, b.school.name, b.address, b.pincode, b.udise_code].some((v) => v.toLowerCase().includes(q))
      )
    : branches;

  const goBack = () => {
    // Reached by a tap: the earlier level is the previous history entry, exactly
    // where the phone's own back button goes.
    if ((location.state as { pickerStep?: boolean } | null)?.pickerStep) {
      navigate(-1);
    } else if (stage === 'branch' && !skipped.city) {
      moveTo(state, undefined, 'auto');
    } else if (stage !== 'state' && !skipped.state) {
      moveTo(undefined, undefined, 'auto');
    }
  };
  const canGoBack = (stage === 'branch' && !skipped.city) || (stage !== 'state' && !skipped.state);
  // The round back button in the top bar steps back here first (school > city > state)
  useBackHandler(goBack, canGoBack);

  const active =
    stage === 'state' ? statesQuery : stage === 'city' ? citiesQuery : branchesQuery;
  const count = stage === 'state' ? states.length : stage === 'city' ? cities.length : branches.length;
  const shownCount =
    stage === 'state' ? shownStates.length : stage === 'city' ? shownCities.length : shownBranches.length;

  const title =
    stage === 'state' ? t('flow.s1.stateTitle') : stage === 'city' ? t('flow.s1.cityTitle') : t('flow.s1.title');
  const sub =
    stage === 'state'
      ? t('flow.s1.stateSub')
      : stage === 'city'
      ? t('flow.s1.citySub', { state: state ?? '' })
      : [city?.name, state].filter(Boolean).join(', ');

  return (
    <div className="step-panel step-school-panel">
      {canGoBack && (
        <button type="button" className="step-back-btn" onClick={goBack}>
          <ArrowLeft width={16} height={16} /> {stage === 'branch' && !skipped.city ? t('flow.changeCity') : t('flow.changeState')}
        </button>
      )}

      <div className="step-title-row">
        {schoolName && <span className="label">{schoolName}</span>}
        <SplitReveal as="h1" immediate className="step-heading">{title}</SplitReveal>
        <p className="step-subtitle">{sub}</p>
        <ListenButton text={`${title}. ${sub}`} />
      </div>

      {schoolName && onClearSchool && (
        <p className="branch-picker-scope">
          {t('flow.s1.onlySchool', { school: schoolName })}{' '}
          <button type="button" className="plain-link" onClick={onClearSchool}>
            {t('flow.s1.allSchools')}
          </button>
        </p>
      )}

      {count > FILTER_FROM && (
        <div className="school-filter-search">
          <Search className="search-filter-icon" width={20} height={20} />
          <input
            type="text"
            placeholder={stage === 'branch' ? t('flow.s1.search') : t('flow.s1.searchPlace')}
            aria-label={stage === 'branch' ? t('flow.s1.search') : t('flow.s1.searchPlace')}
            className="school-search-field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {active.isLoading ? (
        <SchoolPickerSkeleton />
      ) : active.isError ? (
        <div className="flow-empty-state" role="alert">
          <h3>{t('flow.schoolsError')}</h3>
          <p>{t('common.checkInternet')}</p>
          <button type="button" className="btn btn-primary" onClick={() => active.refetch()}>
            {t('common.tryAgain')}
          </button>
        </div>
      ) : shownCount === 0 ? (
        <div className="flow-empty-state">
          <h3>{t('flow.noSchool')}</h3>
          <p>{t('flow.noSchoolSub')}</p>
          <Link to="/contact?reason=request-school" className="plain-link">
            {t('home.requestSchool')}
          </Link>
        </div>
      ) : stage === 'state' ? (
        /* States: a grid of landmarks with big names, A to Z */
        <Stagger key="state" className="state-grid" staggerDelay={0.02} maxAnimated={8}>
          {shownStates.map((s) => (
            <button
              type="button"
              key={s.name}
              className={`state-tile ${s.name === state ? 'is-selected' : ''}`}
              onClick={() => setState(s.name)}
            >
              <span className="state-tile-mark">
                {s.name === state ? (
                  <Check className="tile-check-icon state-tile-tick" width={36} height={36} strokeWidth={2.5} />
                ) : (
                  <StateEmblem name={s.name} size={96} />
                )}
              </span>
              <span className="state-tile-name">{s.name}</span>
              <span className="state-tile-meta">{s.cityCount === 1 ? t('flow.s1.oneCity') : t('flow.s1.cityCount', { n: s.cityCount })}</span>
            </button>
          ))}
        </Stagger>
      ) : stage === 'city' ? (
        /* Cities and schools: ruled lists, not a stack of boxes */
        <Stagger key={`city-${state}`} className="pick-rows" staggerDelay={0.02} maxAnimated={8}>
          {shownCities.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`pick-row ${c.id === cityId ? 'is-selected' : ''}`}
              onClick={() => setCityId(c.id)}
            >
              <span className="pick-row-text">
                <span className="pick-row-name">{c.name}</span>
                <span className="pick-row-meta">{c.branchCount === 1 ? t('flow.s1.oneBranch') : t('flow.s1.branchCount', { n: c.branchCount })}</span>
              </span>
              {c.id === cityId ? (
                <span className="pick-row-check" aria-hidden="true">
                  <Check className="tile-check-icon" width={20} height={20} strokeWidth={2.5} />
                </span>
              ) : (
                <ArrowRight className="pick-row-arrow" width={22} height={22} />
              )}
            </button>
          ))}
        </Stagger>
      ) : (
        <Stagger key={`branch-${cityId}`} className="pick-rows" staggerDelay={0.02} maxAnimated={8}>
          {shownBranches.map((b) => (
            <button
              type="button"
              key={b.id}
              className={`pick-row ${b.id === selectedBranchId ? 'is-selected' : ''}`}
              onClick={() => city && state && onSelect({ branch: b, city, state })}
            >
              {b.photo ? (
                <img className="branch-photo" src={b.photo} alt="" width={52} height={52} loading="lazy" />
              ) : (
                <SchoolCrest id={b.school.id} name={b.school.name} code={b.school.code} size={52} />
              )}
              <span className="pick-row-text">
                <span className="pick-row-name">{b.name}</span>
                {(b.address || b.school.name !== b.name) && (
                  <span className="pick-row-meta branch-address">{b.address || b.school.name}</span>
                )}
                {b.udise_code && (
                  <span className="pick-row-meta branch-udise">{t('flow.s1.udise', { code: b.udise_code })}</span>
                )}
              </span>
              {b.id === selectedBranchId ? (
                <span className="pick-row-check" aria-hidden="true">
                  <Check className="tile-check-icon" width={20} height={20} strokeWidth={2.5} />
                </span>
              ) : (
                <ArrowRight className="pick-row-arrow" width={22} height={22} />
              )}
            </button>
          ))}
        </Stagger>
      )}
    </div>
  );
}
