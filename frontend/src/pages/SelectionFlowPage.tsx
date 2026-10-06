import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Search, Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { seedSchools, seedClasses, seedProducts, type SeedSchool, type SeedClass, type SeedProduct } from '../data/seedData';
import { useStoreState } from '../store/storeState';
import { SchoolCrest } from '../components/school/SchoolCrest';
import { ProductCard } from '../components/product/ProductCard';
import { ProductSheet } from '../components/product/ProductSheet';
import { StepTransition } from '../motion/StepTransition';
import { Thread } from '../motion/Thread';
import { formatINR } from '../utils/formatINR';
import './flow.css';

export function SelectionFlowPage({ onOpenBag }: { onOpenBag?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { selection, setSelection, subtotalPaise, cart } = useStoreState();

  // Read URL params or fallback to active stored selection
  const stepParam = parseInt(searchParams.get('step') || '1', 10);
  const [currentStep, setCurrentStep] = useState<number>(stepParam || 1);
  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>('forward');

  // School Search query
  const [schoolQuery, setSchoolQuery] = useState('');

  // Selected School and Class State
  const activeSchoolId = searchParams.get('school') || selection?.schoolId || '';
  const activeClassId = searchParams.get('class') || selection?.gradeId || '';

  const activeSchool = useMemo(
    () => seedSchools.find((s) => s.id === activeSchoolId) || null,
    [activeSchoolId]
  );
  const activeClass = useMemo(
    () => seedClasses.find((c) => c.id === activeClassId) || null,
    [activeClassId]
  );

  // Active Category Tab on Step 3
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

  const handleSelectSchool = (school: SeedSchool) => {
    setSelection({
      schoolId: school.id,
      schoolName: school.name,
      schoolCode: school.code,
      cityName: school.city,
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('school', school.id);
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
      });
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('class', cls.id);
      next.set('step', '3');
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

  // Filtered Products for Step 3
  const step3Products = useMemo(() => {
    return seedProducts.filter((p) => p.category === activeTab);
  }, [activeTab]);

  const requiredProducts = useMemo(() => {
    return step3Products.filter((p) => p.required);
  }, [step3Products]);

  const optionalProducts = useMemo(() => {
    return step3Products.filter((p) => !p.required);
  }, [step3Products]);

  return (
    <div className="selection-flow-page container" id="main">
      {/* Top Stepper Nav */}
      <div className="flow-stepper-wrap">
        <div className="flow-stepper" role="navigation" aria-label="Selection progress">
          {/* Step 1 Node */}
          <button
            type="button"
            className={`step-node ${currentStep >= 1 ? 'is-active' : ''} ${currentStep > 1 ? 'is-complete' : ''}`}
            onClick={() => goToStep(1)}
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
            onClick={() => activeSchool && goToStep(2)}
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

          {/* Step 3 Node */}
          <button
            type="button"
            className={`step-node ${currentStep === 3 ? 'is-active' : ''}`}
            onClick={() => activeSchool && activeClass && goToStep(3)}
            disabled={!activeSchool || !activeClass}
            aria-current={currentStep === 3 ? 'step' : undefined}
          >
            <span className="step-node-bubble">3</span>
            <span className="step-node-label">Items</span>
          </button>
        </div>

        {/* Mobile Stepper Header */}
        <div className="mobile-stepper-title">
          <span>
            Step {currentStep} of 3 ·{' '}
            {currentStep === 1 ? 'Select School' : currentStep === 2 ? 'Pick Class' : 'Prescribed Items'}
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
              <div className="schools-select-grid">
                {filteredSchools.map((s) => {
                  const isSelected = activeSchool?.id === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`school-select-card ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => handleSelectSchool(s)}
                    >
                      <SchoolCrest name={s.name} code={s.code} size={52} />
                      <div className="school-select-details">
                        <h3 className="school-select-name">{s.name}</h3>
                        <span className="school-select-meta">{s.city} · {s.board}</span>
                      </div>
                      <ArrowRight className="school-select-arrow" width={18} height={18} />
                    </div>
                  );
                })}
              </div>
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

        {/* ================= STEP 3: ITEMS ================= */}
        {currentStep === 3 && activeSchool && (
          <div className="step-panel step-items-panel">
            <div className="step-3-layout">
              {/* Main Catalog Col */}
              <div className="items-main-col">
                <button
                  type="button"
                  className="step-back-btn"
                  onClick={() => goToStep(2)}
                >
                  <ArrowLeft width={16} height={16} /> Change Class ({activeClass?.name || 'Class 5'})
                </button>

                <div className="step-title-row">
                  <span className="label">
                    {activeSchool.name} · {activeClass?.name || 'Class 5'}
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
                        {cat}
                      </button>
                    )
                  )}
                </div>

                {/* Required List Section */}
                {requiredProducts.length > 0 && (
                  <div className="required-section-block">
                    <div className="required-head-row">
                      <div>
                        <span className="label">Prescribed Checklist</span>
                        <h2 className="required-heading">Required Kit for {activeClass?.name || 'Class 5'}</h2>
                      </div>
                    </div>

                    <div className="products-grid">
                      {requiredProducts.map((p) => (
                        <ProductCard
                          key={p.id}
                          product={p}
                          onOpenDetails={(item) => setActiveProductForSheet(item)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Optional items */}
                {optionalProducts.length > 0 && (
                  <div className="optional-section-block">
                    <h2 className="optional-heading">Additional Essentials & Spares</h2>
                    <div className="products-grid">
                      {optionalProducts.map((p) => (
                        <ProductCard
                          key={p.id}
                          product={p}
                          onOpenDetails={(item) => setActiveProductForSheet(item)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sticky Selection Summary Aside */}
              <aside className="selection-summary-aside">
                <div className="selection-summary-card">
                  <div className="summary-school-head">
                    <SchoolCrest name={activeSchool.name} code={activeSchool.code} size={40} />
                    <div>
                      <h3 className="summary-school-name">{activeSchool.name}</h3>
                      <span className="summary-class-tag">{activeClass?.name || 'Class 5'}</span>
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
