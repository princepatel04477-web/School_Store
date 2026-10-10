import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Search, Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { seedSchools, seedClasses, seedProducts, type SeedSchool, type SeedClass, type SeedProduct } from '../data/seedData';
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
import './flow.css';

export function SelectionFlowPage({ onOpenBag }: { onOpenBag?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { selection, setSelection, subtotalPaise, cart, clearCart } = useStoreState();

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

  const activeSchool = useMemo(
    () => seedSchools.find((s) => s.id === activeSchoolId) || null,
    [activeSchoolId]
  );
  const activeClass = useMemo(
    () => seedClasses.find((c) => c.id === activeClassId) || null,
    [activeClassId]
  );

  // Cart clear warning state
  const [showCartWarning, setShowCartWarning] = useState(false);
  const [pendingTargetStep, setPendingTargetStep] = useState<number | null>(null);

  // Active Category Tab on Step 4
  const [activeTab, setActiveTab] = useState<string>('Uniform');

  // Product Sheet Modal
  const [activeProductForSheet, setActiveProductForSheet] = useState<SeedProduct | null>(null);

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

  const handleSelectSchool = (school: SeedSchool) => {
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
    if (!q) return seedSchools;
    return seedSchools.filter(
      (s) => s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q)
    );
  }, [schoolQuery]);

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
    return seedProducts.filter((p) => {
      if (p.category !== activeTab) return false;
      if (!activeGender) return true;
      return p.gender === activeGender || p.gender === 'unisex';
    });
  }, [activeTab, activeGender]);

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
        <div className="flow-stepper" role="navigation" aria-label="Selection progress">
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
            <span className="step-node-label">School</span>
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
            <span className="step-node-label">Class</span>
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
            <span className="step-node-label">Boy / Girl</span>
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
            <span className="step-node-label">Items</span>
          </button>
        </div>

        {/* Mobile Stepper Header */}
        <div className="mobile-stepper-title">
          <span>
            Step {currentStep} of 4 ·{' '}
            {currentStep === 1
              ? 'Select School'
              : currentStep === 2
              ? 'Pick Class'
              : currentStep === 3
              ? 'Boy or Girl'
              : 'Prescribed Items'}
          </span>
        </div>
      </div>

      {/* Main Stepped Content with Directional Animation */}
      <StepTransition stepKey={currentStep} direction={stepDirection}>
        {/* ================= STEP 1: SCHOOL ================= */}
        {currentStep === 1 && (
          <div className="step-panel step-school-panel">
            <div className="step-title-row">
              <span className="label">Step 01</span>
              <h1 className="step-heading">Select your school</h1>
              <p className="step-subtitle">
                Choose your child’s educational campus to view authorized uniform patterns and book bundles.
              </p>
            </div>

            <div className="school-filter-search">
              <Search className="search-filter-icon" width={20} height={20} />
              <input
                type="text"
                placeholder="Search school name or city..."
                className="school-search-field"
                value={schoolQuery}
                onChange={(e) => setSchoolQuery(e.target.value)}
              />
            </div>

            {filteredSchools.length > 0 ? (
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
                        <span className="school-select-meta">{s.city} · {s.board}</span>
                      </div>
                      <ArrowRight className="school-select-arrow" width={18} height={18} />
                    </div>
                  );
                })}
              </Stagger>
            ) : (
              <div className="flow-empty-state">
                <h3>We couldn’t find that school</h3>
                <p>We are constantly onboarding new campuses across India.</p>
                <Link to="/contact?reason=request-school" className="plain-link">
                  Request your school on SchoolStore →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ================= STEP 2: CLASS ================= */}
        {currentStep === 2 && activeSchool && (
          <div className="step-panel step-class-panel">
            <button
              type="button"
              className="step-back-btn"
              onClick={() => goToStep(1)}
            >
              <ArrowLeft width={16} height={16} /> Change School
            </button>

            <div className="step-title-row">
              <span className="label">{activeSchool.name}</span>
              <h1 className="step-heading">Pick your child's class</h1>
              <p className="step-subtitle">
                Prescribed uniform fabrics and syllabus notebooks are configured per grade tier.
              </p>
            </div>

            <div className="class-groups-container">
              {Object.entries(groupedClasses).map(([groupTitle, classesInGroup]) => (
                <div key={groupTitle} className="class-group-block">
                  <span className="label class-group-label">{groupTitle}</span>
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
                          <span className="class-tile-name">{c.name}</span>
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
              <ArrowLeft width={16} height={16} /> Change Class ({activeClass.name})
            </button>

            <div className="step-title-row">
              <span className="label">{activeSchool.name} · {activeClass.name}</span>
              <h1 className="step-heading">Who are you shopping for?</h1>
              <p className="step-subtitle">
                Please choose Boy or Girl to view tailored uniforms and approved items. You cannot continue without choosing.
              </p>
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
                  borderRadius: '16px',
                  cursor: 'pointer',
                  minHeight: '140px',
                  transition: 'all 0.2s ease',
                }}
              >
                <strong className="gender-card-title">Boy</strong>
                <small style={{ color: 'var(--ink-soft)', fontSize: '13px', marginTop: '6px' }}>Boys' &amp; unisex essentials</small>
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
                  borderRadius: '16px',
                  cursor: 'pointer',
                  minHeight: '140px',
                  transition: 'all 0.2s ease',
                }}
              >
                <strong className="gender-card-title">Girl</strong>
                <small style={{ color: 'var(--ink-soft)', fontSize: '13px', marginTop: '6px' }}>Girls' &amp; unisex essentials</small>
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
                borderRadius: '12px',
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
                <span style={{ fontSize: '11px', color: 'var(--ink-soft)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Selection:
                </span>
                <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                  {activeSchool.name}
                </span>
                <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                  {activeSchool.city}
                </span>
                {activeClass && (
                  <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                    {activeClass.name}
                  </span>
                )}
                {activeGender && (
                  <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                    {activeGender === 'boy' ? 'Boy' : 'Girl'}
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
                  Change
                </button>
              </div>
            </div>

            <div className="step-3-layout">
              {/* Main Catalog Col */}
              <div className="items-main-col">
                <div className="step-title-row">
                  <span className="label">
                    {activeSchool.name} · {activeClass?.name || 'Class 5'} · {activeGender === 'boy' ? 'Boy' : 'Girl'}
                  </span>
                  <h1 className="step-heading">Approved Store Items</h1>
                </div>

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
                        <span className="cat-tab-label">{cat}</span>
                      </button>
                    )
                  )}
                </div>

                {/* ID card preview, filled from the parent's record when signed in */}
                {activeTab === 'ID Cards' && (
                  <IdCardPreview school={activeSchool} className={activeClass?.name} gender={activeGender} />
                )}

                {/* Empty State when no items match */}
                {step4Products.length === 0 ? (
                  <div className="flow-empty-state" style={{ padding: '48px 24px', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px', color: 'var(--ink)' }}>
                      {`No items listed yet for ${
                        activeClass?.name
                          ? activeClass.name.toLowerCase().startsWith('class') ||
                            activeClass.name.toLowerCase().includes('kg') ||
                            activeClass.name.toLowerCase().includes('nursery')
                            ? activeClass.name
                            : `Class ${activeClass.name}`
                          : 'Class'
                      } (${activeGender === 'boy' ? 'Boy' : 'Girl'})`}
                    </h3>
                    <p style={{ color: 'var(--ink-soft)', fontSize: '14px', margin: '0 0 20px' }}>
                      No approved {activeTab.toLowerCase()} items have been listed yet for this class and gender.
                    </p>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => requestStepChange(2)}
                      >
                        Change class
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => requestStepChange(3)}
                      >
                        Change boy / girl
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
                            <span className="label">Prescribed Checklist</span>
                            <h2 className="required-heading">Required Kit for {activeClass?.name || 'Class 5'}</h2>
                          </div>
                        </div>

                        <Stagger key={`req-${activeTab}`} className="products-grid">
                          {requiredProducts.map((p) => (
                            <ProductCard
                              key={p.id}
                              product={p}
                              onOpenDetails={(item) => setActiveProductForSheet(item)}
                            />
                          ))}
                        </Stagger>
                      </div>
                    )}

                    {/* Optional items */}
                    {optionalProducts.length > 0 && (
                      <div className="optional-section-block">
                        <h2 className="optional-heading">Additional Essentials & Spares</h2>
                        <Stagger key={`opt-${activeTab}`} className="products-grid">
                          {optionalProducts.map((p) => (
                            <ProductCard
                              key={p.id}
                              product={p}
                              onOpenDetails={(item) => setActiveProductForSheet(item)}
                            />
                          ))}
                        </Stagger>
                      </div>
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
                      <span className="summary-class-tag">{activeClass?.name || 'Class 5'} · {activeGender === 'boy' ? 'Boy' : 'Girl'}</span>
                    </div>
                  </div>

                  <div className="summary-stats-row">
                    <span>Items in Bag:</span>
                    <strong>{cart.length}</strong>
                  </div>

                  <div className="summary-total-row">
                    <span>Subtotal:</span>
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
                    View Bag · {formatINR(subtotalPaise)}
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
            <h3 style={{ margin: '0 0 10px', fontSize: '18px', color: '#b91c1c' }}>⚠️ Clear Bag Items?</h3>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--ink)' }}>
              You have {cart.length} item{cart.length > 1 ? 's' : ''} in your bag for {activeClass?.name} ({activeGender === 'boy' ? 'Boy' : 'Girl'}).
              Changing your school, class, or student gender will clear items from your bag.
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
                Keep Current
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', color: '#ffffff' }}
                onClick={handleConfirmCartClear}
              >
                Clear &amp; Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Details Sheet */}
      <ProductSheet
        product={activeProductForSheet}
        isOpen={!!activeProductForSheet}
        onClose={() => setActiveProductForSheet(null)}
        onOpenBag={onOpenBag}
      />
    </div>
  );
}
