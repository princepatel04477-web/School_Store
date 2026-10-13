import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Search, Check, ArrowRight, ArrowLeft } from '../components/ui/icons';
import { motion } from 'motion/react';
import { seedClasses, type SeedClass } from '../data/seedData';
import { useStoreSchools, useStoreProducts, type StoreSchool } from '../data/catalog';
import type { CardProduct } from '../components/product/ProductCard';
import { useStoreState, storeState } from '../store/storeState';
import { SchoolCrest } from '../components/school/SchoolCrest';
import { ProductCard } from '../components/product/ProductCard';
import { ProductSheet } from '../components/product/ProductSheet';
import { IdCardPreview } from '../components/idcard/IdCardPreview';
import { StepTransition } from '../motion/StepTransition';
import { Thread } from '../motion/Thread';
import { Stagger, Reveal, Hairline } from '../motion';
import { EASING } from '../motion/motionConfig';
import { prefetchBagDrawer, prefetchCheckoutPage } from '../utils/prefetch';
import { formatINR } from '../utils/formatINR';
import { useLang, type MessageKey } from '../i18n';
import { categoryLabel, classLabel, genderLabel } from '../i18n/labels';
import { ListenButton } from '../components/ListenButton';
import { FullSetSheet } from '../components/product/FullSetSheet';
import { FitCheck, FitSummary } from '../components/fit/FitCheck';
import { fitKey, setFit, useFitAnswer, useSizeFit } from '../data/fit';
import './flow.css';

const GROUP_KEYS: Record<string, MessageKey> = {
  'Pre-primary': 'grp.preprimary',
  Primary: 'grp.primary',
  Middle: 'grp.middle',
  Secondary: 'grp.secondary',
};

export function SelectionFlowPage({ onOpenBag }: { onOpenBag?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { selection, setSelection, subtotalPaise, cart, clearCart } = useStoreState();
  const { t } = useLang();
  const [fullSetOpen, setFullSetOpen] = useState(false);

  // Read URL params or fallback to active stored selection
  const stepParam = parseInt(searchParams.get('step') || '1', 10);
  const [currentStep, setCurrentStep] = useState<number>(stepParam || 1);
  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>('forward');

  // School Search query
  const [schoolQuery, setSchoolQuery] = useState('');

  // Selected School, Class, and Gender State
  const activeSchoolId = searchParams.get('school') || selection?.schoolId || '';
  const activeClassId = searchParams.get('class') || selection?.gradeId || '';
  const activeGender = (searchParams.get('gender') as 'boy' | 'girl' | null) || selection?.gender || null;

  const schoolsQuery = useStoreSchools();
  const schools = useMemo(() => schoolsQuery.data ?? [], [schoolsQuery.data]);
  const activeSchool = useMemo(
    () => schools.find((s) => s.id === activeSchoolId) || null,
    [schools, activeSchoolId]
  );
  const activeClass = useMemo(
    () => seedClasses.find((c) => c.id === activeClassId) || null,
    [activeClassId]
  );
  const productsQuery = useStoreProducts(activeSchool?.id, activeClass?.name, activeGender);
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  // Size check: height and weight once, before any size is picked (only when
  // something here comes in sizes). Kept per school + class + boy/girl.
  const currentFitKey = fitKey(activeSchool?.id, activeClass?.id, activeGender);
  const fitAnswer = useFitAnswer(currentFitKey);
  const [editingFit, setEditingFit] = useState(false);
  const sizedProductIds = useMemo(
    () => products.filter((p) => p.sizes.length > 1).map((p) => p.id),
    [products]
  );
  const sizeFit = useSizeFit(sizedProductIds, fitAnswer, activeClass?.name);
  const fits = sizeFit.data?.products;
  const askFit = sizedProductIds.length > 0 && (fitAnswer === null || editingFit);

  // A link from the school (?school=…&class=…) counts as the parent's choice, so the
  // bag and checkout know which school and class the order is for.
  useEffect(() => {
    if (!activeSchool) return;
    if (
      selection?.schoolId === activeSchool.id &&
      selection?.gradeId === activeClass?.id &&
      (selection?.gender ?? null) === activeGender
    ) {
      return;
    }
    setSelection({
      schoolId: activeSchool.id,
      schoolName: activeSchool.name,
      schoolCode: activeSchool.code,
      cityName: activeSchool.city,
      gradeId: activeClass?.id,
      gradeName: activeClass?.name,
      gender: activeGender,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSchool, activeClass, activeGender]);

  // Cart clear warning state
  const [showCartWarning, setShowCartWarning] = useState(false);
  const [pendingTargetStep, setPendingTargetStep] = useState<number | null>(null);

  // Active Category Tab on Step 4
  const [activeTab, setActiveTab] = useState<string>('Uniform');

  // Product Sheet Modal
  const [activeProductForSheet, setActiveProductForSheet] = useState<CardProduct | null>(null);

  // Sync step param
  useEffect(() => {
    if (stepParam && stepParam !== currentStep) {
      setStepDirection(stepParam > currentStep ? 'forward' : 'backward');
      setCurrentStep(stepParam);
    }
  }, [stepParam]);

  const goToStep = (step: number) => {
    setStepDirection(step > currentStep ? 'forward' : 'backward');
    setCurrentStep(step);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', String(step));
      return next;
    });
  };

  const requestStepChange = (targetStep: number) => {
    if (cart.length > 0 && targetStep < 4) {
      setPendingTargetStep(targetStep);
      setShowCartWarning(true);
    } else {
      goToStep(targetStep);
    }
  };

  const handleConfirmCartClear = () => {
    storeState.clearCart();
    setShowCartWarning(false);
    if (pendingTargetStep) {
      goToStep(pendingTargetStep);
      setPendingTargetStep(null);
    }
  };

  const handleSelectSchool = (school: StoreSchool) => {
    setSelection({
      schoolId: school.id,
      schoolName: school.name,
      schoolCode: school.code,
      cityName: school.city,
      gradeId: undefined,
      gradeName: undefined,
      gender: null,
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('school', school.id);
      next.delete('class');
      next.delete('gender');
      next.set('step', '2');
      return next;
    });
  };

  const handleSelectClass = (cls: SeedClass) => {
    if (activeSchool) {
      setSelection({
        schoolId: activeSchool.id,
        schoolName: activeSchool.name,
        schoolCode: activeSchool.code,
        cityName: activeSchool.city,
        gradeId: cls.id,
        gradeName: cls.name,
        gender: null,
      });
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('class', cls.id);
      next.delete('gender');
      next.set('step', '3');
      return next;
    });
  };

  const handleSelectGender = (gender: 'boy' | 'girl') => {
    if (activeSchool && activeClass) {
      setSelection({
        schoolId: activeSchool.id,
        schoolName: activeSchool.name,
        schoolCode: activeSchool.code,
        cityName: activeSchool.city,
        gradeId: activeClass.id,
        gradeName: activeClass.name,
        gender,
      });
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('gender', gender);
      next.set('step', '4');
      return next;
    });
  };

  // Filtered Schools for Step 1
  const filteredSchools = useMemo(() => {
    const q = schoolQuery.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter(
      (s) => s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q)
    );
  }, [schoolQuery, schools]);

  // Grouped Classes for Step 2
  const groupedClasses = useMemo(() => {
    const groups: Record<string, SeedClass[]> = {
      'Pre-primary': [],
      Primary: [],
      Middle: [],
      Secondary: [],
    };
    seedClasses.forEach((cls) => {
      if (groups[cls.group]) {
        groups[cls.group].push(cls);
      }
    });
    return groups;
  }, []);

  // Filtered Products for Step 4 (Category + Gender filter)
  const step4Products = useMemo(() => {
    // The server already sends only this school, class and boy/girl's items.
    return products.filter((p) => p.category === activeTab);
  }, [products, activeTab]);

  // "Order full set": the items made for this school that can be ordered here.
  const fullSetProducts = useMemo(
    () => products.filter((p) => p.official && !p.needsDetails && p.sizes.some((size) => size.inStock)),
    [products]
  );

  const requiredProducts = useMemo(() => {
    return step4Products.filter((p) => p.required);
  }, [step4Products]);

  const optionalProducts = useMemo(() => {
    return step4Products.filter((p) => !p.required);
  }, [step4Products]);

  return (
    <div className="selection-flow-page container" id="main">
      {/* Top Stepper Nav */}
      <div className="flow-stepper-wrap">
        <div className="flow-stepper" role="navigation" aria-label={t('flow.progress')}>
          {/* Step 1 Node */}
          <button
            type="button"
            className={`step-node ${currentStep >= 1 ? 'is-active' : ''} ${currentStep > 1 ? 'is-complete' : ''}`}
            onClick={() => requestStepChange(1)}
            aria-current={currentStep === 1 ? 'step' : undefined}
          >
            <span className="step-node-bubble">
              {currentStep > 1 ? <Check width={14} height={14} /> : '1'}
            </span>
            <span className="step-node-label">{t('flow.school')}</span>
          </button>

          {/* Stepper Thread Connector */}
          <div className="stepper-connector">
            <Thread animate={currentStep >= 2} />
          </div>

          {/* Step 2 Node */}
          <button
            type="button"
            className={`step-node ${currentStep >= 2 ? 'is-active' : ''} ${currentStep > 2 ? 'is-complete' : ''}`}
            onClick={() => activeSchool && requestStepChange(2)}
            disabled={!activeSchool}
            aria-current={currentStep === 2 ? 'step' : undefined}
          >
            <span className="step-node-bubble">
              {currentStep > 2 ? <Check width={14} height={14} /> : '2'}
            </span>
            <span className="step-node-label">{t('flow.class')}</span>
          </button>

          {/* Stepper Thread Connector */}
          <div className="stepper-connector">
            <Thread animate={currentStep >= 3} />
          </div>

          {/* Step 3 Node: Boy / Girl */}
          <button
            type="button"
            className={`step-node ${currentStep >= 3 ? 'is-active' : ''} ${currentStep > 3 ? 'is-complete' : ''}`}
            onClick={() => activeSchool && activeClass && requestStepChange(3)}
            disabled={!activeSchool || !activeClass}
            aria-current={currentStep === 3 ? 'step' : undefined}
          >
            <span className="step-node-bubble">
              {currentStep > 3 ? <Check width={14} height={14} /> : '3'}
            </span>
            <span className="step-node-label">{t('flow.boyGirl')}</span>
          </button>

          {/* Stepper Thread Connector */}
          <div className="stepper-connector">
            <Thread animate={currentStep >= 4} />
          </div>

          {/* Step 4 Node: Items */}
          <button
            type="button"
            className={`step-node ${currentStep === 4 ? 'is-active' : ''}`}
            onClick={() => activeSchool && activeClass && activeGender && goToStep(4)}
            disabled={!activeSchool || !activeClass || !activeGender}
            aria-current={currentStep === 4 ? 'step' : undefined}
          >
            <span className="step-node-bubble">4</span>
            <span className="step-node-label">{t('flow.items')}</span>
          </button>
        </div>

        {/* Mobile Stepper Header */}
        <div className="mobile-stepper-title">
          <span>
            {t('flow.stepOf', { n: currentStep })} ·{' '}
            {currentStep === 1
              ? t('flow.school')
              : currentStep === 2
              ? t('flow.class')
              : currentStep === 3
              ? t('flow.boyGirl')
              : t('flow.items')}
          </span>
        </div>
      </div>

      {/* Main Stepped Content with Directional Animation */}
      <StepTransition stepKey={currentStep} direction={stepDirection}>
        {/* ================= STEP 1: SCHOOL ================= */}
        {currentStep === 1 && (
          <div className="step-panel step-school-panel">
            <div className="step-title-row">
              <h1 className="step-heading">{t('flow.s1.title')}</h1>
              <p className="step-subtitle">{t('flow.s1.sub')}</p>
              <ListenButton text={`${t('flow.s1.title')}. ${t('flow.s1.sub')}`} />
            </div>

            <div className="school-filter-search">
              <Search className="search-filter-icon" width={20} height={20} />
              <input
                type="text"
                placeholder={t('flow.s1.search')}
                aria-label={t('flow.s1.search')}
                className="school-search-field"
                value={schoolQuery}
                onChange={(e) => setSchoolQuery(e.target.value)}
              />
            </div>

            {schoolsQuery.isLoading ? (
              <div className="flow-empty-state" role="status">
                <p>{t('flow.loadingSchools')}</p>
              </div>
            ) : schoolsQuery.isError ? (
              <div className="flow-empty-state" role="alert">
                <h3>{t('flow.schoolsError')}</h3>
                <p>{t('common.checkInternet')}</p>
                <button type="button" className="btn btn-primary" onClick={() => schoolsQuery.refetch()}>
                  {t('common.tryAgain')}
                </button>
              </div>
            ) : filteredSchools.length > 0 ? (
              <Stagger className="schools-select-grid">
                {filteredSchools.map((s) => {
                  const isSelected = activeSchool?.id === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`school-select-card ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => handleSelectSchool(s)}
                    >
                      <SchoolCrest id={s.id} color={s.color} name={s.name} code={s.code} size={52} />
                      <div className="school-select-details">
                        <h3 className="school-select-name">{s.name}</h3>
                        <span className="school-select-meta">{[s.city, s.board].filter(Boolean).join(' · ')}</span>
                      </div>
                      <ArrowRight className="school-select-arrow" width={18} height={18} />
                    </div>
                  );
                })}
              </Stagger>
            ) : (
              <div className="flow-empty-state">
                <h3>{t('flow.noSchool')}</h3>
                <p>{t('flow.noSchoolSub')}</p>
                <Link to="/contact?reason=request-school" className="plain-link">
                  {t('home.requestSchool')} →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ================= STEP 2: CLASS ================= */}
        {currentStep > 1 && !activeSchool && (
          <div className="flow-empty-state" role={schoolsQuery.isLoading ? 'status' : 'alert'}>
            {schoolsQuery.isLoading ? (
              <p>{t('flow.loadingSchool')}</p>
            ) : schoolsQuery.isError ? (
              <>
                <h3>{t('flow.schoolError')}</h3>
                <p>{t('common.checkInternet')}</p>
                <button type="button" className="btn btn-primary" onClick={() => schoolsQuery.refetch()}>
                  {t('common.tryAgain')}
                </button>
              </>
            ) : (
              <>
                <h3>{t('flow.linkSchoolMissing')}</h3>
                <p>{t('flow.linkSchoolMissingSub')}</p>
                <button type="button" className="btn btn-primary" onClick={() => goToStep(1)}>
                  {t('flow.chooseSchool')}
                </button>
              </>
            )}
          </div>
        )}

        {currentStep === 2 && activeSchool && (
          <div className="step-panel step-class-panel">
            <button
              type="button"
              className="step-back-btn"
              onClick={() => goToStep(1)}
            >
              <ArrowLeft width={16} height={16} /> {t('home.changeSchool')}
            </button>

            <div className="step-title-row">
              <span className="label">{activeSchool.name}</span>
              <h1 className="step-heading">{t('flow.s2.title')}</h1>
              <ListenButton text={t('flow.s2.title')} />
            </div>

            <div className="class-groups-container">
              {Object.entries(groupedClasses).map(([groupTitle, classesInGroup]) => (
                <div key={groupTitle} className="class-group-block">
                  <span className="label class-group-label">{t(GROUP_KEYS[groupTitle] ?? 'grp.primary')}</span>
                  <div className="classes-tiles-grid">
                    {classesInGroup.map((c) => {
                      const isSelected = activeClass?.id === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={`class-tile ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => handleSelectClass(c)}
                        >
                          <span className="class-tile-name">{classLabel(c.name, t)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= STEP 3: BOY OR GIRL ================= */}
        {currentStep === 3 && activeSchool && activeClass && (
          <div className="step-panel step-gender-panel">
            <button
              type="button"
              className="step-back-btn"
              onClick={() => goToStep(2)}
            >
              <ArrowLeft width={16} height={16} /> {t('flow.changeClass')} ({classLabel(activeClass.name, t)})
            </button>

            <div className="step-title-row">
              <span className="label">{activeSchool.name} · {classLabel(activeClass.name, t)}</span>
              <h1 className="step-heading">{t('flow.s3.title')}</h1>
              <ListenButton text={t('flow.s3.title')} />
            </div>

            <div
              className="gender-cards-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '20px',
                maxWidth: '560px',
              }}
            >
              {/* Boy Card */}
              <button
                type="button"
                className={`gender-card ${activeGender === 'boy' ? 'is-selected' : ''}`}
                onClick={() => handleSelectGender('boy')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px 20px',
                  textAlign: 'center',
                  background: activeGender === 'boy' ? 'var(--brand-tint, #edf6ef)' : 'var(--paper-raised, #ffffff)',
                  border: activeGender === 'boy' ? '2px solid var(--brand, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  minHeight: '140px',
                  transition: 'all 0.2s ease',
                }}
              >
                <strong className="gender-card-title">{t('g.boy')}</strong>
              </button>

              {/* Girl Card */}
              <button
                type="button"
                className={`gender-card ${activeGender === 'girl' ? 'is-selected' : ''}`}
                onClick={() => handleSelectGender('girl')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px 20px',
                  textAlign: 'center',
                  background: activeGender === 'girl' ? 'var(--brand-tint, #edf6ef)' : 'var(--paper-raised, #ffffff)',
                  border: activeGender === 'girl' ? '2px solid var(--brand, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  minHeight: '140px',
                  transition: 'all 0.2s ease',
                }}
              >
                <strong className="gender-card-title">{t('g.girl')}</strong>
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 4: ITEMS ================= */}
        {currentStep === 4 && activeSchool && (
          <div className="step-panel step-items-panel">
            {/* Summary Bar above product list */}
            <div
              className="selection-summary-bar"
              style={{
                backgroundColor: 'var(--paper-raised, #ffffff)',
                border: '1px solid var(--line, #dfe5dd)',
                borderRadius: '6px',
                padding: '12px 18px',
                marginBottom: '1.5rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                  {activeSchool.name}
                </span>
                <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                  {activeSchool.city}
                </span>
                {activeClass && (
                  <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                    {classLabel(activeClass.name, t)}
                  </span>
                )}
                {activeGender && (
                  <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                    {genderLabel(activeGender, t)}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="step-back-btn"
                  style={{ margin: 0 }}
                  onClick={() => requestStepChange(3)}
                >
                  {t('nav.change')}
                </button>
              </div>
            </div>

            <div className="step-3-layout">
              {/* Main Catalog Col */}
              <div className="items-main-col">
                <div className="step-title-row">
                  <span className="label">
                    {activeSchool.name} · {classLabel(activeClass?.name, t)} · {genderLabel(activeGender, t)}
                  </span>
                  <h1 className="step-heading">{t('flow.s4.title')}</h1>
                  <ListenButton text={`${t('flow.s4.title')}. ${t('flow.s4.listen')}`} />
                </div>

                {askFit ? (
                  <FitCheck
                    initial={fitAnswer && fitAnswer !== 'skipped' ? fitAnswer : undefined}
                    onSubmit={(fit) => {
                      setFit(currentFitKey, fit);
                      setEditingFit(false);
                    }}
                    onSkip={() => {
                      setFit(currentFitKey, 'skipped');
                      setEditingFit(false);
                    }}
                  />
                ) : (
                <>
                {sizedProductIds.length > 0 && fitAnswer && (
                  <FitSummary
                    answer={fitAnswer}
                    warnings={sizeFit.data?.fit?.warnings}
                    className={activeClass?.name}
                    failed={sizeFit.isError}
                    onChange={() => setEditingFit(true)}
                    onRetry={() => sizeFit.refetch()}
                  />
                )}

                {fullSetProducts.length > 1 && (
                  <div className="fullset-banner">
                    <div>
                      <strong>{t('set.bannerTitle')}</strong>
                      <span>{t('set.bannerSub', { count: fullSetProducts.length, school: activeSchool.name })}</span>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={() => setFullSetOpen(true)}>
                      {t('set.open')}
                    </button>
                  </div>
                )}

                {/* Sticky Category Tabs */}
                <div className="category-tabs-sticky">
                  {(['Uniform', 'School Shoes', 'Uniform Accessories', 'Stationery', 'ID Cards'] as const).map(
                    (cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={`cat-tab ${activeTab === cat ? 'is-active' : ''}`}
                        onClick={() => setActiveTab(cat)}
                      >
                        {activeTab === cat && (
                          <motion.span
                            layoutId="cat-tab-indicator"
                            className="cat-tab-indicator"
                            transition={{ duration: 0.2, ease: EASING }}
                          />
                        )}
                        <span className="cat-tab-label">{categoryLabel(cat, t)}</span>
                      </button>
                    )
                  )}
                </div>

                {/* ID card preview, filled from the parent's record when signed in */}
                {activeTab === 'ID Cards' && (
                  <IdCardPreview school={activeSchool} className={activeClass?.name} gender={activeGender} />
                )}

                {/* Empty State when no items match */}
                {productsQuery.isLoading ? (
                  <div className="flow-empty-state" role="status" style={{ padding: '48px 24px', textAlign: 'center' }}>
                    <p>{t('flow.loadingItems')}</p>
                  </div>
                ) : productsQuery.isError ? (
                  <div className="flow-empty-state" role="alert" style={{ padding: '48px 24px', textAlign: 'center' }}>
                    <h3>{t('flow.itemsError')}</h3>
                    <p>{t('common.checkInternet')}</p>
                    <button type="button" className="btn btn-primary" onClick={() => productsQuery.refetch()}>
                      {t('common.tryAgain')}
                    </button>
                  </div>
                ) : step4Products.length === 0 ? (
                  <div className="flow-empty-state" style={{ padding: '48px 24px', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px', color: 'var(--ink)' }}>
                      {t('flow.noItems', { cat: categoryLabel(activeTab, t), cls: classLabel(activeClass?.name, t), g: genderLabel(activeGender, t) })}
                    </h3>
                    <p style={{ color: 'var(--ink-soft)', fontSize: '14px', margin: '0 0 20px' }}>
                      {t('flow.noItemsSub')}
                    </p>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => requestStepChange(2)}
                      >
                        {t('flow.changeClass')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => requestStepChange(3)}
                      >
                        {t('flow.changeBoyGirl')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Required List Section */}
                    {requiredProducts.length > 0 && (
                      <div className="required-section-block">
                        <div className="required-head-row">
                          <div>
                            <h2 className="required-heading">{t('flow.requiredFor', { cls: classLabel(activeClass?.name, t) })}</h2>
                          </div>
                        </div>

                        <Stagger key={`req-${activeTab}`} className="products-grid">
                          {requiredProducts.map((p) => (
                            <ProductCard
                              key={p.id}
                              product={p}
                              fit={fits?.[p.id]}
                              onOpenDetails={(item) => setActiveProductForSheet(item)}
                            />
                          ))}
                        </Stagger>
                      </div>
                    )}

                    {/* Optional items */}
                    {optionalProducts.length > 0 && (
                      <div className="optional-section-block">
                        <h2 className="optional-heading">
                          {requiredProducts.length > 0
                            ? t('flow.extras')
                            : t('flow.listFor', { cls: classLabel(activeClass?.name, t) })}
                        </h2>
                        <Stagger key={`opt-${activeTab}`} className="products-grid">
                          {optionalProducts.map((p) => (
                            <ProductCard
                              key={p.id}
                              product={p}
                              fit={fits?.[p.id]}
                              onOpenDetails={(item) => setActiveProductForSheet(item)}
                            />
                          ))}
                        </Stagger>
                      </div>
                    )}
                  </>
                )}
                </>
                )}
              </div>

              {/* Sticky Selection Summary Aside */}
              <aside className="selection-summary-aside">
                <div className="selection-summary-card">
                  <div className="summary-school-head">
                    <SchoolCrest id={activeSchool.id} color={activeSchool.color} name={activeSchool.name} code={activeSchool.code} size={40} />
                    <div>
                      <h3 className="summary-school-name">{activeSchool.name}</h3>
                      <span className="summary-class-tag">{classLabel(activeClass?.name, t)} · {genderLabel(activeGender, t)}</span>
                    </div>
                  </div>

                  <div className="summary-stats-row">
                    <span>{t('flow.itemsInBag')}</span>
                    <strong>{cart.length}</strong>
                  </div>

                  <div className="summary-total-row">
                    <span>{t('bag.total')}</span>
                    <span className="summary-total-val">{formatINR(subtotalPaise)}</span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary summary-bag-btn"
                    onMouseEnter={() => {
                      prefetchBagDrawer();
                      prefetchCheckoutPage();
                    }}
                    onClick={onOpenBag}
                  >
                    {t('flow.viewBag', { total: formatINR(subtotalPaise) })}
                  </button>
                </div>
              </aside>
            </div>
          </div>
        )}
      </StepTransition>

      {/* Cart Cleared Warning Modal */}
      {showCartWarning && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="modal-card" style={{ maxWidth: '440px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '18px', color: 'var(--danger)' }}>{t('flow.clearTitle')}</h3>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--ink)' }}>
              {t('flow.clearBody', { count: cart.length, cls: classLabel(activeClass?.name, t), g: genderLabel(activeGender, t) })}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowCartWarning(false);
                  setPendingTargetStep(null);
                }}
              >
                {t('flow.keepBag')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', color: '#ffffff' }}
                onClick={handleConfirmCartClear}
              >
                {t('flow.clearAndChange')}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSchool && (
        <FullSetSheet
          open={fullSetOpen}
          onClose={() => setFullSetOpen(false)}
          products={fullSetProducts}
          schoolName={activeSchool.name}
          className={activeClass?.name}
          onAdded={onOpenBag}
          fits={fits}
        />
      )}

      {/* Product Details Sheet */}
      <ProductSheet
        product={activeProductForSheet}
        isOpen={!!activeProductForSheet}
        onClose={() => setActiveProductForSheet(null)}
        onOpenBag={onOpenBag}
        fit={activeProductForSheet ? fits?.[activeProductForSheet.id] : undefined}
        fitLoading={sizeFit.isLoading}
      />
    </div>
  );
}
