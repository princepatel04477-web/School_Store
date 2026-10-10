import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Product, StockStatus } from '../api';
import { CLASSES } from '../data/classes';
import { useStoreState } from '../store/storeState';
import { CustomisationForm } from './CustomisationForm';
import { Popup } from './Popup';

export interface SchoolItem {
  id: string;
  name: string;
  code: string;
}

export interface CityItem {
  id: string;
  name: string;
  code: string;
}

export interface GradeItem {
  id: string;
  name: string;
  sort_order: number;
}

export interface SelectionState {
  school: SchoolItem | null;
  city: CityItem | null;
  grade: GradeItem | null;
  gender: 'boy' | 'girl' | null;
}

interface SelectionFlowProps {
  category?: string; // Default: 'Uniform'
  studentProfile?: {
    school_id?: string;
    school_name?: string;
    city_id?: string;
    grade_id?: string;
    grade_name?: string;
    gender?: string;
  } | null;
  autoSelectStudentProfile?: boolean;
  cartItemCount?: number;
  onClearCart?: () => void;
  onOrder?: (x: { product: Product; variantId: string; customisationData: Record<string, any> }) => void;
  onNavigateCategory?: (category: string) => void;
  publicView?: boolean;
}

const SESSION_STORAGE_KEY = 'school_store_selection_flow';
const STATIONERY_PROMPT_SESSION_KEY = 'school_store_stationery_prompt_dismissed';

export function SelectionFlow({
  category = 'Uniform',
  studentProfile,
  autoSelectStudentProfile = false,
  cartItemCount,
  onClearCart,
  onOrder,
  onNavigateCategory,
  publicView = false,
}: SelectionFlowProps) {
  const { cart: storeCart, clearCart: clearStoreCart } = useStoreState();
  const activeCartCount = cartItemCount !== undefined ? cartItemCount : storeCart.length;

  // Try restoring from sessionStorage
  const [selection, setSelection] = useState<SelectionState>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          school: parsed.school || null,
          city: parsed.city || null,
          grade: parsed.grade || null,
          gender: parsed.gender === 'boy' || parsed.gender === 'girl' ? parsed.gender : null,
        };
      }
    } catch {
      // ignore
    }
    return { school: null, city: null, grade: null, gender: null };
  });

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(() => {
    if (selection.school && selection.city && selection.grade && selection.gender) return 5;
    if (selection.school && selection.city && selection.grade) return 4;
    if (selection.school && selection.city) return 3;
    if (selection.school) return 2;
    return 1;
  });

  const [schoolSearch, setSchoolSearch] = useState('');
  const [showCartWarning, setShowCartWarning] = useState(false);
  const [showChangeMenu, setShowChangeMenu] = useState(false);
  const [pendingTargetStep, setPendingTargetStep] = useState<1 | 3 | 4 | null>(null);
  const [genderFilter, setGenderFilter] = useState<'ALL' | 'MALE' | 'FEMALE'>('ALL');
  const [productTypeFilter, setProductTypeFilter] = useState<'ALL' | 'SOCKS' | 'BELT' | 'TIE'>('ALL');
  const [showSizeGuide, setShowSizeGuide] = useState(false);

  // Requirement 1 & 4: Stationery prompt once per session
  const [showStationeryPrompt, setShowStationeryPrompt] = useState<boolean>(false);
  const endOfPageSentinelRef = useRef<HTMLDivElement | null>(null);

  // Product customisation modal state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [customValues, setCustomValues] = useState<Record<string, any>>({});
  const [formError, setFormError] = useState<string>('');

  const isShoeFlow = category.toLowerCase().includes('shoe');
  const isShoeProduct = selectedProduct?.category?.toLowerCase().includes('shoe') || isShoeFlow;
  const isAccessoriesFlow = category.toLowerCase().includes('accessories');

  const triggerStationeryPrompt = useCallback(() => {
    if (!isAccessoriesFlow) return;
    try {
      if (sessionStorage.getItem(STATIONERY_PROMPT_SESSION_KEY) === '1') {
        return;
      }
    } catch {
      // ignore
    }
    setShowStationeryPrompt(true);
  }, [isAccessoriesFlow]);

  const handleStationeryConfirm = () => {
    try {
      sessionStorage.setItem(STATIONERY_PROMPT_SESSION_KEY, '1');
    } catch {
      // ignore
    }
    setShowStationeryPrompt(false);
    onNavigateCategory?.('Stationery');
  };

  const handleStationeryDismiss = () => {
    try {
      sessionStorage.setItem(STATIONERY_PROMPT_SESSION_KEY, '1');
    } catch {
      // ignore
    }
    setShowStationeryPrompt(false);
  };

  const isTie = selectedProduct?.product_type === 'TIE' || (selectedProduct?.name?.toLowerCase().includes('tie') ?? false);
  const isSocks = selectedProduct?.product_type === 'SOCKS' || (selectedProduct?.name?.toLowerCase().includes('sock') ?? false);
  const isBelt = selectedProduct?.product_type === 'BELT' || (selectedProduct?.name?.toLowerCase().includes('belt') ?? false);

  const tieHasNoSpecificSize = isTie && (
    !selectedProduct?.variants?.length ||
    selectedProduct.variants.length <= 1 ||
    selectedProduct.variants.every((v) => !v.size || ['standard', 'one size', 'free size', 'no size', ''].includes(v.size.trim().toLowerCase()))
  );

  // Persist selection to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(selection));
    } catch {
      // ignore
    }
  }, [selection]);

  // Query: Step 1 Schools (Sorted A-Z by DB, search query supported)
  const { data: schools = [], isLoading: loadingSchools } = useQuery({
    queryKey: ['selection-schools', schoolSearch],
    queryFn: async () => {
      const q = schoolSearch.trim() ? `?search=${encodeURIComponent(schoolSearch.trim())}` : '';
      return api<SchoolItem[]>(`/public/schools/${q}`);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Query: Step 2 Cities for selected school
  const { data: schoolCities = [], isLoading: loadingCities } = useQuery({
    queryKey: ['selection-cities', selection.school?.id],
    queryFn: async () => {
      if (!selection.school?.id) return [];
      return api<CityItem[]>(`/public/schools/${selection.school.id}/cities/`);
    },
    enabled: !!selection.school?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Query: Step 3 Grades (15 grades in fixed order)
  const { data: grades = [], isLoading: loadingGrades } = useQuery({
    queryKey: ['selection-grades'],
    queryFn: () => api<GradeItem[]>('/public/grades/'),
    staleTime: 10 * 60 * 1000,
  });

  // Exactly 15 options from the single source of truth (CLASSES)
  const availableGrades: GradeItem[] = useMemo(() => {
    return CLASSES.map((c) => {
      const match = grades.find(
        (g) => g.name.toLowerCase() === c.name.toLowerCase() || g.sort_order === c.sortOrder
      );
      return {
        id: match ? match.id : c.id,
        name: c.name,
        sort_order: c.sortOrder,
      };
    });
  }, [grades]);

  // Query: Products (Only when school, city, grade, and gender are selected at step 5)
  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: [
      'selection-products',
      selection.school?.id,
      selection.city?.id,
      selection.grade?.id,
      selection.gender,
      category,
      productTypeFilter,
    ],
    queryFn: async () => {
      if (!selection.school?.id || !selection.city?.id || !selection.grade?.id || !selection.gender) {
        return { results: [] };
      }
      let url = `/public/products/?school=${selection.school.id}&city=${selection.city.id}&grade=${selection.grade.id}&gender=${selection.gender}`;
      if (category && category !== 'All') {
        url += `&category=${encodeURIComponent(category)}`;
      }
      if (isAccessoriesFlow && productTypeFilter !== 'ALL') {
        url += `&product_type=${productTypeFilter}`;
      }
      return api<{ results: Product[] }>(url);
    },
    enabled: !!(selection.school?.id && selection.city?.id && selection.grade?.id && selection.gender && step === 5),
  });

  const productsList = productsData?.results || [];

  // Auto-skip logic for Step 2 if school has only 1 city
  useEffect(() => {
    if (step === 2 && selection.school && schoolCities.length === 1 && !loadingCities) {
      const onlyCity = schoolCities[0];
      setSelection((prev) => ({ ...prev, city: onlyCity }));
      setStep(3);
    }
  }, [step, selection.school, schoolCities, loadingCities]);

  // Requirement 8: Pre-fill if parent has a linked child
  const canPreFill = Boolean(
    studentProfile &&
    (studentProfile.school_id || studentProfile.school_name) &&
    studentProfile.grade_name
  );

  const handlePreFillConfirm = () => {
    if (!studentProfile) return;
    const matchedSchool = schools.find(
      (s) => s.id === studentProfile.school_id || s.name === studentProfile.school_name
    ) || (studentProfile.school_id ? { id: studentProfile.school_id, name: studentProfile.school_name || 'My School', code: '' } : null);

    const matchedGrade = availableGrades.find(
      (g) =>
        g.id === studentProfile.grade_id ||
        g.name === studentProfile.grade_name ||
        g.name === `Grade ${studentProfile.grade_name}` ||
        g.name === `Class ${studentProfile.grade_name}`
    ) || (studentProfile.grade_id ? { id: studentProfile.grade_id, name: studentProfile.grade_name || '', sort_order: 1 } : null);

    const cityObj = studentProfile.city_id
      ? { id: studentProfile.city_id, name: 'School City', code: '' }
      : null;

    if (matchedSchool && matchedGrade) {
      setSelection({
        school: matchedSchool,
        city: cityObj,
        grade: matchedGrade,
        gender: null, // NO DEFAULT SELECTED per requirement - user/teacher must choose!
      });
      // Land directly on Step 4: Boy or Girl
      setStep(4);
    }
  };

  // Auto-select when requested (e.g. Teacher ordering on behalf of student)
  useEffect(() => {
    if (!autoSelectStudentProfile || !studentProfile || schools.length === 0) return;
    if (step === 1 && !selection.school) {
      handlePreFillConfirm();
    }
  }, [autoSelectStudentProfile, studentProfile, schools, step, selection.school]);

  // Requirement 1: Trigger stationery prompt when reaching end of Uniform Accessories page
  useEffect(() => {
    if (!isAccessoriesFlow || step !== 5) return;
    const sentinel = endOfPageSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          triggerStationeryPrompt();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isAccessoriesFlow, step, triggerStationeryPrompt, productsList.length]);

  const performStepChange = (targetStep: 1 | 3 | 4) => {
    if (targetStep === 3) {
      setSelection((prev) => ({ ...prev, grade: null, gender: null }));
      setStep(3);
    } else if (targetStep === 4) {
      setSelection((prev) => ({ ...prev, gender: null }));
      setStep(4);
    } else {
      setSelection({ school: null, city: null, grade: null, gender: null });
      setStep(1);
      setSchoolSearch('');
    }
    setShowChangeMenu(false);
    setShowCartWarning(false);
  };

  const requestStepChange = (targetStep: 1 | 3 | 4) => {
    if (activeCartCount > 0) {
      setPendingTargetStep(targetStep);
      setShowCartWarning(true);
      setShowChangeMenu(false);
    } else {
      performStepChange(targetStep);
    }
  };

  const handleConfirmCartClear = () => {
    onClearCart?.();
    clearStoreCart();
    if (pendingTargetStep) {
      performStepChange(pendingTargetStep);
    }
    setShowCartWarning(false);
    setPendingTargetStep(null);
  };

  const handleCancelCartClear = () => {
    setShowCartWarning(false);
    setPendingTargetStep(null);
  };

  const handleReset = () => {
    requestStepChange(1);
  };

  const handleBack = () => {
    if (step === 5) setStep(4);
    else if (step === 4) setStep(3);
    else if (step === 3) {
      // If school had only 1 city, back goes directly to step 1
      if (schoolCities.length === 1) {
        setStep(1);
      } else {
        setStep(2);
      }
    } else if (step === 2) setStep(1);
  };

  // Add to cart helper
  const openProductCustomisation = (p: Product, variantId?: string) => {
    setSelectedProduct(p);
    setSelectedVariantId(variantId || p.variants[0]?.id || '');
    setCustomValues({});
    setFormError('');
  };

  const schemaList = useMemo(() => {
    if (!selectedProduct?.customisation_schema) return [];
    if (Array.isArray(selectedProduct.customisation_schema)) {
      return selectedProduct.customisation_schema;
    }
    if (typeof selectedProduct.customisation_schema === 'object' && selectedProduct.customisation_schema.fields) {
      return selectedProduct.customisation_schema.fields;
    }
    return [];
  }, [selectedProduct]);

  const handleAddToCart = () => {
    if (!selectedProduct) return;
    const finalVariantId = selectedVariantId || (tieHasNoSpecificSize ? selectedProduct.variants[0]?.id : '');
    if (!finalVariantId && !tieHasNoSpecificSize && selectedProduct.variants.length > 0) {
      setFormError('Please select a size/variant.');
      return;
    }
    for (const f of schemaList) {
      if (f.required && !customValues[f.key]) {
        setFormError(`Please fill in required customisation: ${f.label}`);
        return;
      }
    }
    onOrder?.({
      product: selectedProduct,
      variantId: finalVariantId || selectedProduct.variants[0]?.id || '',
      customisationData: customValues,
    });
    setSelectedProduct(null);
    if (isAccessoriesFlow) {
      triggerStationeryPrompt();
    }
  };

  return (
    <div className="selection-flow" style={{ marginTop: '1.5rem' }}>
      {/* Selection bar at top */}
      {(selection.school || selection.city || selection.grade) && (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--line, #dfe5dd)',
            borderRadius: '12px',
            padding: '12px 18px',
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>
              Current Selection:
            </span>
            {selection.school && (
              <span className="pill" style={{ background: '#eef3ef', color: '#275b4c', fontWeight: 600 }}>
                🏫 {selection.school.name}
              </span>
            )}
            {selection.city && (
              <span className="pill" style={{ background: '#eef3ef', color: '#275b4c', fontWeight: 600 }}>
                📍 {selection.city.name}
              </span>
            )}
            {selection.grade && (
              <span className="pill" style={{ background: '#eef3ef', color: '#275b4c', fontWeight: 600 }}>
                🎓 {selection.grade.name}
              </span>
            )}
          </div>
          <button
            onClick={handleReset}
            className="text-button"
            style={{ fontSize: '12px', padding: '4px 8px' }}
          >
            Change selection
          </button>
        </div>
      )}

      {/* Pre-fill suggestion card for linked child */}
      {canPreFill && step < 4 && !selection.school && (
        <div
          style={{
            background: '#edf6ef',
            border: '1px solid #c8e1cf',
            borderRadius: '12px',
            padding: '14px 18px',
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#275b4c' }}>
              Shopping for {studentProfile?.grade_name ? `${studentProfile.grade_name} · ` : ''}{studentProfile?.school_name}?
            </div>
            <div style={{ fontSize: '12px', color: '#4a6b57' }}>
              We can pre-fill your school, city, and grade from your linked child profile.
            </div>
          </div>
          <button
            className="primary"
            onClick={handlePreFillConfirm}
            style={{ fontSize: '12px', padding: '8px 16px', borderRadius: '8px' }}
          >
            Pre-fill in 1 tap ✓
          </button>
        </div>
      )}

      {/* STEP 1: Select School */}
      {step === 1 && (
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <span className="eyebrow">STEP 1 OF 3</span>
              <h2 style={{ margin: '4px 0 0', fontSize: '20px' }}>Select your School</h2>
            </div>
          </div>

          <div className="search" style={{ marginBottom: '16px' }}>
            <span>🔍</span>
            <input
              type="text"
              placeholder="Search active schools..."
              value={schoolSearch}
              onChange={(e) => setSchoolSearch(e.target.value)}
            />
          </div>

          {loadingSchools ? (
            <div className="empty">
              <h3>Loading schools…</h3>
            </div>
          ) : schools.length === 0 ? (
            <div className="empty">
              <h3>No schools found</h3>
              <p>Try a different search term.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
              {schools.map((school) => (
                <button
                  key={school.id}
                  onClick={() => {
                    setSelection((prev) => ({ ...prev, school, city: null, grade: null }));
                    setStep(2);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    textAlign: 'left',
                    background: selection.school?.id === school.id ? '#edf6ef' : '#fafbf8',
                    border: selection.school?.id === school.id ? '2px solid var(--green, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                    borderRadius: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '20px' }}>🏫</span>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '13px', display: 'block', color: 'var(--ink, #17221f)' }}>
                      {school.name}
                    </strong>
                    <small style={{ color: '#78817a', fontSize: '11px' }}>{school.code}</small>
                  </div>
                  <span style={{ color: 'var(--green, #275b4c)', fontWeight: 700 }}>→</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Select City */}
      {step === 2 && (
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <span className="eyebrow">STEP 2 OF 4</span>
              <h2 style={{ margin: '4px 0 0', fontSize: '20px' }}>Select Branch City</h2>
              <small style={{ color: '#78817a' }}>Branches for {selection.school?.name}</small>
            </div>
            <button className="text-button" onClick={handleBack}>
              ← Back
            </button>
          </div>

          {loadingCities ? (
            <div className="empty">
              <h3>Loading branches…</h3>
            </div>
          ) : schoolCities.length === 0 ? (
            <div className="empty">
              <h3>No cities available for this school</h3>
              <button className="text-button" onClick={() => setStep(1)}>
                Choose another school
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
              {schoolCities.map((city) => (
                <button
                  key={city.id}
                  onClick={() => {
                    setSelection((prev) => ({ ...prev, city }));
                    setStep(3);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    textAlign: 'left',
                    background: selection.city?.id === city.id ? '#edf6ef' : '#fafbf8',
                    border: selection.city?.id === city.id ? '2px solid var(--green, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                    borderRadius: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '20px' }}>📍</span>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '14px', display: 'block', color: 'var(--ink, #17221f)' }}>
                      {city.name}
                    </strong>
                    <small style={{ color: '#78817a', fontSize: '11px' }}>{city.code}</small>
                  </div>
                  <span style={{ color: 'var(--green, #275b4c)', fontWeight: 700 }}>→</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 3: Select Class (All 15 options from single source of truth) */}
      {step === 3 && (
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <span className="eyebrow">STEP 3 OF 4</span>
              <h2 style={{ margin: '4px 0 0', fontSize: '20px' }}>Select Class</h2>
              <small style={{ color: '#78817a' }}>Choose your child's class</small>
            </div>
            <button className="text-button" onClick={handleBack}>
              ← Back
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))',
              gap: '10px',
            }}
          >
            {availableGrades.map((grade) => (
              <button
                key={grade.id}
                onClick={() => {
                  setSelection((prev) => ({ ...prev, grade }));
                  setStep(4);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '14px 8px',
                  textAlign: 'center',
                  background: selection.grade?.id === grade.id ? '#edf6ef' : '#fafbf8',
                  border: selection.grade?.id === grade.id ? '2px solid var(--green, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  minHeight: '68px',
                }}
              >
                <span style={{ fontSize: '16px', marginBottom: '4px' }}>🎓</span>
                <strong style={{ fontSize: '13px', color: 'var(--ink, #17221f)' }}>
                  {grade.name}
                </strong>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 4: Select Boy or Girl (Two large tappable cards, no default selected) */}
      {step === 4 && (
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <span className="eyebrow">STEP 4 OF 4</span>
              <h2 style={{ margin: '4px 0 0', fontSize: '20px' }}>Who are you shopping for?</h2>
              <small style={{ color: '#78817a' }}>
                {selection.grade?.name} at {selection.school?.name}
              </small>
            </div>
            <button className="text-button" onClick={handleBack}>
              ← Back
            </button>
          </div>

          <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '0 0 20px' }}>
            Please choose Boy or Girl to view tailored uniforms and approved items. You cannot continue without choosing.
          </p>

          <div
            className="gender-cards-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '16px',
            }}
          >
            {/* Boy Card */}
            <button
              type="button"
              className={`gender-card ${selection.gender === 'boy' ? 'selected' : ''}`}
              onClick={() => {
                setSelection((prev) => ({ ...prev, gender: 'boy' }));
                setStep(5);
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '28px 16px',
                textAlign: 'center',
                background: selection.gender === 'boy' ? '#edf6ef' : '#fafbf8',
                border: selection.gender === 'boy' ? '2px solid var(--green, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                borderRadius: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                minHeight: '140px',
              }}
            >
              <span style={{ fontSize: '48px', display: 'block', marginBottom: '10px' }}>👦</span>
              <strong style={{ fontSize: '19px', display: 'block', color: 'var(--ink, #17221f)' }}>
                Boy
              </strong>
              <small style={{ color: '#78817a', fontSize: '12px', marginTop: '6px' }}>
                Boys' &amp; unisex essentials
              </small>
            </button>

            {/* Girl Card */}
            <button
              type="button"
              className={`gender-card ${selection.gender === 'girl' ? 'selected' : ''}`}
              onClick={() => {
                setSelection((prev) => ({ ...prev, gender: 'girl' }));
                setStep(5);
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '28px 16px',
                textAlign: 'center',
                background: selection.gender === 'girl' ? '#edf6ef' : '#fafbf8',
                border: selection.gender === 'girl' ? '2px solid var(--green, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                borderRadius: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                minHeight: '140px',
              }}
            >
              <span style={{ fontSize: '48px', display: 'block', marginBottom: '10px' }}>👧</span>
              <strong style={{ fontSize: '19px', display: 'block', color: 'var(--ink, #17221f)' }}>
                Girl
              </strong>
              <small style={{ color: '#78817a', fontSize: '12px', marginTop: '6px' }}>
                Girls' &amp; unisex essentials
              </small>
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Products Display with Summary Bar & Clear Cart Warning */}
      {step === 5 && (
        <div>
          {/* Summary Bar above product list with Change action */}
          <div
            className="selection-summary-bar"
            style={{
              background: '#ffffff',
              border: '1px solid var(--line, #dfe5dd)',
              borderRadius: '12px',
              padding: '12px 18px',
              marginBottom: '1.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>
                Current Selection:
              </span>
              {selection.school && (
                <span className="pill" style={{ background: '#eef3ef', color: '#275b4c', fontWeight: 600 }}>
                  🏫 {selection.school.name}
                </span>
              )}
              {selection.city && (
                <span className="pill" style={{ background: '#eef3ef', color: '#275b4c', fontWeight: 600 }}>
                  📍 {selection.city.name}
                </span>
              )}
              {selection.grade && (
                <span className="pill" style={{ background: '#eef3ef', color: '#275b4c', fontWeight: 600 }}>
                  🎓 {selection.grade.name}
                </span>
              )}
              {selection.gender && (
                <span className="pill" style={{ background: '#eef3ef', color: '#275b4c', fontWeight: 600 }}>
                  {selection.gender === 'boy' ? '👦 Boy' : '👧 Girl'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isShoeFlow && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowSizeGuide(true)}
                  style={{
                    fontSize: '13px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    textDecoration: 'underline',
                    color: '#275b4c',
                    fontWeight: 600,
                  }}
                >
                  📏 Shoe Size Guide
                </button>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => setShowChangeMenu(true)}
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line, #dfe5dd)',
                  background: '#fafbf8',
                  cursor: 'pointer',
                }}
              >
                Change ✎
              </button>
            </div>
          </div>

          <div className="section-row" style={{ marginTop: '0', marginBottom: '16px' }}>
            <div>
              <div className="eyebrow">{category.toUpperCase()} CATALOGUE</div>
              <h2 style={{ margin: '4px 0 0' }}>
                {category} for {selection.grade?.name} ({selection.gender === 'boy' ? 'Boy' : 'Girl'})
              </h2>
              <small style={{ color: '#78817a' }}>
                {selection.school?.name} · {selection.city?.name}
              </small>
            </div>
          </div>

          {/* Requirement 3: Uniform Accessories Product Type Filter: Socks, Belt, Tie, All */}
          {isAccessoriesFlow && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '20px',
                padding: '8px 12px',
                background: '#ffffff',
                borderRadius: '10px',
                border: '1px solid var(--line, #dfe5dd)',
                width: 'fit-content',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#4b5563', marginRight: '4px' }}>
                Accessory Type:
              </span>
              <button
                type="button"
                onClick={() => setProductTypeFilter('ALL')}
                className={productTypeFilter === 'ALL' ? 'chip active' : 'chip'}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setProductTypeFilter('SOCKS')}
                className={productTypeFilter === 'SOCKS' ? 'chip active' : 'chip'}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                🧦 Socks
              </button>
              <button
                type="button"
                onClick={() => setProductTypeFilter('BELT')}
                className={productTypeFilter === 'BELT' ? 'chip active' : 'chip'}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                🏷️ Belt
              </button>
              <button
                type="button"
                onClick={() => setProductTypeFilter('TIE')}
                className={productTypeFilter === 'TIE' ? 'chip active' : 'chip'}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                👔 Tie
              </button>
            </div>
          )}

          {loadingProducts ? (
            <div className="empty">
              <h3>Loading matching products…</h3>
            </div>
          ) : productsList.length === 0 ? (
            <div className="empty" style={{ padding: '48px 20px', textAlign: 'center' }}>
              <span style={{ fontSize: '36px', display: 'block', marginBottom: '12px' }}>📦</span>
              <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px', color: 'var(--ink)' }}>
                {`No items listed yet for ${
                  selection.grade?.name
                    ? selection.grade.name.toLowerCase().startsWith('class') ||
                      selection.grade.name.toLowerCase().includes('kg') ||
                      selection.grade.name.toLowerCase().includes('nursery')
                      ? selection.grade.name
                      : `Class ${selection.grade.name}`
                    : 'Class'
                } (${selection.gender === 'boy' ? 'Boy' : 'Girl'})`}
              </h3>
              <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '0 0 18px', maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto' }}>
                No approved {category.toLowerCase()} items have been listed yet for this class and gender. Please check back later or modify your selection.
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => requestStepChange(3)}
                  style={{ fontSize: '13px', padding: '10px 18px', borderRadius: '8px' }}
                >
                  Change Class 🎓
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => requestStepChange(4)}
                  style={{ fontSize: '13px', padding: '10px 18px', borderRadius: '8px', width: 'auto' }}
                >
                  Change Boy / Girl 👤
                </button>
              </div>
            </div>
          ) : (
            <div className="product-grid">
              {productsList.map((p) => {
                const hasCustom =
                  p.customisation_schema &&
                  ((Array.isArray(p.customisation_schema) && p.customisation_schema.length > 0) ||
                    (typeof p.customisation_schema === 'object' &&
                      (p.customisation_schema as any).fields?.length > 0));

                return (
                  <article className="product" key={p.id}>
                    <div className={'product-image ' + p.category.toLowerCase().replace(' ', '-')}>
                      {p.category.toLowerCase().includes('shoe')
                        ? '👞'
                        : p.product_type === 'SOCKS'
                        ? '🧦'
                        : p.product_type === 'BELT'
                        ? '🏷️'
                        : p.product_type === 'TIE'
                        ? '👔'
                        : p.category.toLowerCase().includes('accessories')
                        ? '🎀'
                        : p.category === 'Stationery'
                        ? '▤'
                        : p.category === 'ID Cards'
                        ? '▧'
                        : '▥'}
                    </div>
                    <div className="product-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span className="tag">{p.category}</span>
                          {p.product_type && (
                            <span
                              className="pill"
                              style={{
                                fontSize: '9px',
                                padding: '2px 6px',
                                background: '#edf6ef',
                                color: '#275b4c',
                                fontWeight: 600,
                              }}
                            >
                              {p.product_type}
                            </span>
                          )}
                        </div>
                        {p.gender && p.gender !== 'unisex' && (
                          <span className="pill" style={{ fontSize: '9px', padding: '2px 6px' }}>
                            {p.gender}
                          </span>
                        )}
                        {hasCustom && (
                          <span className="badge s-confirmed" style={{ fontSize: '10px' }}>
                            ✦ Personalised
                          </span>
                        )}
                      </div>
                      <h3>{p.name}</h3>
                      <strong>₹{p.price.toLocaleString('en-IN')}</strong>

                      {p.category.toLowerCase().includes('shoe') && (
                        <div style={{ marginTop: '4px' }}>
                          <button
                            type="button"
                            className="text-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowSizeGuide(true);
                            }}
                            style={{ fontSize: '11px', color: '#275b4c', padding: 0, textDecoration: 'underline' }}
                          >
                            📏 Shoe Size Guide
                          </button>
                        </div>
                      )}

                      {publicView ? (
                        <button
                          className="secondary"
                          style={{ marginTop: '10px' }}
                          onClick={() => openProductCustomisation(p)}
                        >
                          {hasCustom ? 'Personalise & Order ✦' : 'Select Size & Order →'}
                        </button>
                      ) : (
                        <button
                          className="secondary"
                          style={{ marginTop: '10px' }}
                          onClick={() => openProductCustomisation(p)}
                        >
                          {hasCustom ? 'Personalise & Add ✦' : 'Add to cart +'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {/* Requirement 1: Sentinel to detect reaching end of accessories page */}
          {isAccessoriesFlow && (
            <div ref={endOfPageSentinelRef} style={{ height: '1px', marginTop: '20px' }} />
          )}
        </div>
      )}

      {/* Product Customisation / Size Modal */}
      {selectedProduct && (
        <div className="modal-backdrop" onClick={() => setSelectedProduct(null)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(580px, 100%)', padding: '24px' }}
          >
            <div className="card-head" style={{ marginBottom: '16px' }}>
              <div>
                <h2>{selectedProduct.name}</h2>
                <div className="muted" style={{ fontSize: '12px' }}>
                  {selectedProduct.category} · ₹{selectedProduct.price.toLocaleString('en-IN')}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setSelectedProduct(null)}>
                ✕
              </button>
            </div>

            {tieHasNoSpecificSize ? (
              <div
                style={{
                  background: '#f4f6f4',
                  border: '1px dashed #c9d4c9',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '16px',
                  fontSize: '13px',
                  color: '#275b4c',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>👔</span>
                <span><strong>Standard School Tie</strong> · One Size (No size selection required)</span>
              </div>
            ) : (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', color: '#5c6b61', fontWeight: 600 }}>
                    {isShoeProduct
                      ? 'Select Shoe Size (UK / India)'
                      : isSocks
                      ? 'Select Sock Size'
                      : isBelt
                      ? 'Select Belt Length / Size'
                      : 'Select Size / Variant'}{' '}
                    <span style={{ color: '#a34235' }}>*</span>
                  </span>
                  {isShoeProduct && (
                    <button
                      type="button"
                      onClick={() => setShowSizeGuide(true)}
                      className="text-button"
                      style={{ fontSize: '11px', textDecoration: 'underline', color: '#275b4c', padding: 0 }}
                    >
                      📏 View Size Guide
                    </button>
                  )}
                </div>
                <select
                  value={selectedVariantId}
                  onChange={(e) => setSelectedVariantId(e.target.value)}
                  style={{
                    width: '100%',
                    border: '1px solid #c9d4c9',
                    borderRadius: '8px',
                    padding: '10px',
                    fontSize: '13px',
                    background: '#fff',
                  }}
                >
                  <option value="">
                    {isShoeProduct
                      ? '-- Choose shoe size (UK) --'
                      : isSocks
                      ? '-- Choose sock size --'
                      : isBelt
                      ? '-- Choose belt length / size --'
                      : '-- Choose size --'}
                  </option>
                  {selectedProduct.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {isShoeProduct && !v.size.toLowerCase().includes('size')
                        ? `Shoe Size ${v.size}`
                        : isBelt && !v.size.toLowerCase().includes('size') && !v.size.includes('"')
                        ? `Belt Size ${v.size}`
                        : `Size: ${v.size}`}{' '}
                      ({v.stock_status || 'In stock'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {schemaList.length > 0 && (
              <CustomisationForm
                schema={schemaList}
                values={customValues}
                onChange={setCustomValues}
              />
            )}

            {formError && (
              <div
                style={{
                  color: '#a34235',
                  fontSize: '12px',
                  background: '#fae4df',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  margin: '12px 0',
                }}
              >
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                className="secondary"
                style={{ width: 'auto' }}
                onClick={() => setSelectedProduct(null)}
              >
                Cancel
              </button>
              <button className="primary" onClick={handleAddToCart}>
                Confirm & Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shoe Size Guide Modal */}
      {showSizeGuide && (
        <div className="modal-backdrop" onClick={() => setShowSizeGuide(false)} style={{ zIndex: 1100 }}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(640px, 95vw)', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div className="card-head" style={{ marginBottom: '16px' }}>
              <div>
                <span className="eyebrow">FIT & SIZING</span>
                <h2 style={{ margin: '4px 0 0' }}>School Shoe Size Guide (UK / India)</h2>
                <div className="muted" style={{ fontSize: '12px' }}>
                  Standard Indian School Shoe Sizing (Bata, Action, Liberty, Campus standards)
                </div>
              </div>
              <button className="icon-btn" onClick={() => setShowSizeGuide(false)}>
                ✕
              </button>
            </div>

            <div
              style={{
                background: '#f4f8f5',
                border: '1px solid #d2e4d8',
                borderRadius: '8px',
                padding: '12px 14px',
                fontSize: '12px',
                color: '#275b4c',
                lineHeight: 1.5,
                marginBottom: '16px',
              }}
            >
              <strong>💡 How to measure your child's feet:</strong>
              <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                <li>Place a sheet of paper on the floor against a flat wall.</li>
                <li>Have your child stand on the paper wearing their normal school socks with their heel against the wall.</li>
                <li>Mark the longest toe on the paper and measure the distance from the heel in centimetres.</li>
                <li><strong>Add 5mm to 10mm (approx. half a size)</strong> for growth room and comfortable movement.</li>
              </ol>
            </div>

            <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
              <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f8faf9', borderBottom: '2px solid #dfe5dd' }}>
                    <th style={{ padding: '8px 10px', color: '#17221f' }}>UK / India Size</th>
                    <th style={{ padding: '8px 10px', color: '#17221f' }}>Foot Length</th>
                    <th style={{ padding: '8px 10px', color: '#17221f' }}>Euro (EU)</th>
                    <th style={{ padding: '8px 10px', color: '#17221f' }}>Recommended Grades</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { uk: 'UK 9 (Kids)', len: '16.5 cm', eu: '27', grades: 'Nursery' },
                    { uk: 'UK 10 (Kids)', len: '17.3 cm', eu: '28', grades: 'Junior KG' },
                    { uk: 'UK 11 (Kids)', len: '18.1 cm', eu: '29', grades: 'Senior KG' },
                    { uk: 'UK 12 (Kids)', len: '18.9 cm', eu: '31', grades: 'Grade 1' },
                    { uk: 'UK 13 (Kids)', len: '19.7 cm', eu: '32', grades: 'Grade 2' },
                    { uk: 'UK 1', len: '20.5 cm', eu: '33', grades: 'Grade 3' },
                    { uk: 'UK 2', len: '21.4 cm', eu: '34', grades: 'Grade 4' },
                    { uk: 'UK 3', len: '22.2 cm', eu: '35', grades: 'Grade 5' },
                    { uk: 'UK 4', len: '23.0 cm', eu: '37', grades: 'Grade 6' },
                    { uk: 'UK 5', len: '23.8 cm', eu: '38', grades: 'Grade 7' },
                    { uk: 'UK 6', len: '24.6 cm', eu: '39', grades: 'Grade 8 - 9' },
                    { uk: 'UK 7', len: '25.4 cm', eu: '40', grades: 'Grade 9 - 10' },
                    { uk: 'UK 8', len: '26.2 cm', eu: '42', grades: 'Grade 11' },
                    { uk: 'UK 9', len: '27.0 cm', eu: '43', grades: 'Grade 12' },
                    { uk: 'UK 10', len: '27.8 cm', eu: '44', grades: 'Senior / High School' },
                  ].map((row, i) => (
                    <tr
                      key={row.uk}
                      style={{
                        borderBottom: '1px solid #edf1ee',
                        background: i % 2 === 0 ? '#ffffff' : '#fafbf8',
                      }}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#275b4c' }}>{row.uk}</td>
                      <td style={{ padding: '8px 10px', color: '#4b5563' }}>{row.len}</td>
                      <td style={{ padding: '8px 10px', color: '#4b5563' }}>{row.eu}</td>
                      <td style={{ padding: '8px 10px', color: '#6b7280' }}>{row.grades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="primary" onClick={() => setShowSizeGuide(false)} style={{ padding: '8px 18px', fontSize: '13px' }}>
                Close Size Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Requirement 1, 2, 3, 4: Shared Stationery Prompt Popup */}
      <Popup
        isOpen={showStationeryPrompt}
        onClose={handleStationeryDismiss}
        title="Looking for Stationery?"
        message="Would you like to buy Stationery items?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={handleStationeryConfirm}
        onCancel={handleStationeryDismiss}
      />

      {/* Change Selection Options Modal */}
      {showChangeMenu && (
        <div className="modal-backdrop" onClick={() => setShowChangeMenu(false)} style={{ zIndex: 1100 }}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(420px, 92vw)', padding: '24px', borderRadius: '16px', background: '#fff' }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: '18px', color: 'var(--ink)' }}>
              Change Selection
            </h3>
            <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '0 0 18px' }}>
              Select what you would like to change:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => requestStepChange(3)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  textAlign: 'left',
                }}
              >
                <div>
                  <strong style={{ display: 'block', fontSize: '14px', color: 'var(--green)' }}>
                    🎓 Change Class
                  </strong>
                  <small style={{ color: '#6b7280', fontSize: '11px' }}>
                    Currently: {selection.grade?.name || 'Not set'}
                  </small>
                </div>
                <span>→</span>
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() => requestStepChange(4)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  textAlign: 'left',
                }}
              >
                <div>
                  <strong style={{ display: 'block', fontSize: '14px', color: 'var(--green)' }}>
                    👤 Change Boy / Girl
                  </strong>
                  <small style={{ color: '#6b7280', fontSize: '11px' }}>
                    Currently: {selection.gender === 'boy' ? 'Boy' : selection.gender === 'girl' ? 'Girl' : 'Not set'}
                  </small>
                </div>
                <span>→</span>
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() => requestStepChange(1)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  textAlign: 'left',
                }}
              >
                <div>
                  <strong style={{ display: 'block', fontSize: '14px', color: 'var(--green)' }}>
                    🏫 Change School &amp; City
                  </strong>
                  <small style={{ color: '#6b7280', fontSize: '11px' }}>
                    Currently: {selection.school?.name} · {selection.city?.name}
                  </small>
                </div>
                <span>→</span>
              </button>
            </div>

            <div style={{ marginTop: '18px', textAlign: 'right' }}>
              <button
                type="button"
                className="text-button"
                onClick={() => setShowChangeMenu(false)}
                style={{ fontSize: '13px', color: '#6b7280' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cart Cleared Warning Modal */}
      {showCartWarning && (
        <div className="modal-backdrop" onClick={handleCancelCartClear} style={{ zIndex: 1200 }}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(400px, 92vw)',
              padding: '24px',
              borderRadius: '16px',
              background: '#fff',
            }}
          >
            <div style={{ fontSize: '36px', textAlign: 'center', marginBottom: '8px' }}>⚠️</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', textAlign: 'center', color: 'var(--ink)' }}>
              Cart will be cleared
            </h3>
            <p style={{ color: '#4b5563', fontSize: '13px', textAlign: 'center', lineHeight: '1.5', margin: '0 0 20px' }}>
              You have <strong>{activeCartCount} {activeCartCount === 1 ? 'item' : 'items'}</strong> in your cart from your current selection.
              <br /><br />
              Changing class or gender will clear your cart so you do not receive mismatched uniforms or school essentials.
            </p>

            <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
              <button
                type="button"
                className="primary"
                onClick={handleConfirmCartClear}
                style={{
                  background: '#a34235',
                  borderColor: '#a34235',
                  padding: '12px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#fff',
                  width: '100%',
                }}
              >
                Clear Cart &amp; Continue →
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleCancelCartClear}
                style={{
                  padding: '10px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  width: '100%',
                  justifyContent: 'center',
                }}
              >
                Keep Cart (Cancel)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
