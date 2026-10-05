import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Product, StockStatus } from '../api';
import { CustomisationForm } from './CustomisationForm';

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
  onOrder?: (x: { product: Product; variantId: string; customisationData: Record<string, any> }) => void;
  publicView?: boolean;
}

const SESSION_STORAGE_KEY = 'school_store_selection_flow';

export function SelectionFlow({
  category = 'Uniform',
  studentProfile,
  onOrder,
  publicView = false,
}: SelectionFlowProps) {
  // Try restoring from sessionStorage
  const [selection, setSelection] = useState<SelectionState>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return { school: null, city: null, grade: null };
  });

  const [step, setStep] = useState<1 | 2 | 3 | 4>(() => {
    if (selection.school && selection.city && selection.grade) return 4;
    if (selection.school && selection.city) return 3;
    if (selection.school) return 2;
    return 1;
  });

  const [schoolSearch, setSchoolSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState<'ALL' | 'MALE' | 'FEMALE'>('ALL');
  const [showSizeGuide, setShowSizeGuide] = useState(false);

  // Product customisation modal state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [customValues, setCustomValues] = useState<Record<string, any>>({});
  const [formError, setFormError] = useState<string>('');

  const isShoeFlow = category.toLowerCase().includes('shoe');
  const isShoeProduct = selectedProduct?.category?.toLowerCase().includes('shoe') || isShoeFlow;

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

  // Query: Products (Only when school, city, grade are selected)
  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: [
      'selection-products',
      selection.school?.id,
      selection.city?.id,
      selection.grade?.id,
      category,
      genderFilter,
    ],
    queryFn: async () => {
      if (!selection.school?.id || !selection.city?.id || !selection.grade?.id) {
        return { results: [] };
      }
      let url = `/public/products/?school=${selection.school.id}&city=${selection.city.id}&grade=${selection.grade.id}`;
      if (category && category !== 'All') {
        url += `&category=${encodeURIComponent(category)}`;
      }
      if (genderFilter !== 'ALL') {
        url += `&gender=${genderFilter}`;
      }
      return api<{ results: Product[] }>(url);
    },
    enabled: !!(selection.school?.id && selection.city?.id && selection.grade?.id && step === 4),
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

    const matchedGrade = grades.find(
      (g) => g.id === studentProfile.grade_id || g.name === studentProfile.grade_name || g.name === `Grade ${studentProfile.grade_name}`
    ) || (studentProfile.grade_id ? { id: studentProfile.grade_id, name: studentProfile.grade_name || '', sort_order: 1 } : null);

    const cityObj = studentProfile.city_id
      ? { id: studentProfile.city_id, name: 'School City', code: '' }
      : null;

    if (matchedSchool && matchedGrade) {
      setSelection({
        school: matchedSchool,
        city: cityObj,
        grade: matchedGrade,
      });
      if (studentProfile.gender) {
        const g = studentProfile.gender.toUpperCase();
        if (g === 'MALE' || g === 'FEMALE') {
          setGenderFilter(g as 'MALE' | 'FEMALE');
        }
      }
      // If city is already available, jump straight to products; otherwise go to city step
      if (cityObj) {
        setStep(4);
      } else {
        setStep(2);
      }
    }
  };

  const handleReset = () => {
    setSelection({ school: null, city: null, grade: null });
    setStep(1);
    setSchoolSearch('');
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const handleBack = () => {
    if (step === 4) setStep(3);
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
    if (!selectedVariantId) {
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
      variantId: selectedVariantId,
      customisationData: customValues,
    });
    setSelectedProduct(null);
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
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
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
              <span className="eyebrow">STEP 2 OF 3</span>
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

      {/* STEP 3: Select Grade / Standard */}
      {step === 3 && (
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <span className="eyebrow">STEP 3 OF 3</span>
              <h2 style={{ margin: '4px 0 0', fontSize: '20px' }}>Select Grade / Standard</h2>
              <small style={{ color: '#78817a' }}>Choose your child's standard</small>
            </div>
            <button className="text-button" onClick={handleBack}>
              ← Back
            </button>
          </div>

          {loadingGrades ? (
            <div className="empty">
              <h3>Loading standards…</h3>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px' }}>
              {grades.map((grade) => (
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
                    padding: '14px 10px',
                    textAlign: 'center',
                    background: selection.grade?.id === grade.id ? '#edf6ef' : '#fafbf8',
                    border: selection.grade?.id === grade.id ? '2px solid var(--green, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                    borderRadius: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '18px', marginBottom: '4px' }}>🎓</span>
                  <strong style={{ fontSize: '13px', color: 'var(--ink, #17221f)' }}>
                    {grade.name}
                  </strong>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 4: Products Display with Male / Female Filter */}
      {step === 4 && (
        <div>
          <div className="section-row" style={{ marginTop: '0', marginBottom: '16px' }}>
            <div>
              <div className="eyebrow">{category.toUpperCase()} CATALOGUE</div>
              <h2 style={{ margin: '4px 0 0' }}>
                {category} for Grade {selection.grade?.name}
              </h2>
              <small style={{ color: '#78817a' }}>
                {selection.school?.name} · {selection.city?.name}
              </small>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
              <button className="text-button" onClick={handleReset} style={{ fontSize: '13px', fontWeight: 600 }}>
                Change ✎
              </button>
            </div>
          </div>

          {/* Gender Filter: Male, Female, All */}
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
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#4b5563', marginRight: '6px' }}>
              Gender Filter:
            </span>
            <button
              onClick={() => setGenderFilter('ALL')}
              className={genderFilter === 'ALL' ? 'chip active' : 'chip'}
              style={{ padding: '6px 14px', fontSize: '12px' }}
            >
              All Items
            </button>
            <button
              onClick={() => setGenderFilter('MALE')}
              className={genderFilter === 'MALE' ? 'chip active' : 'chip'}
              style={{ padding: '6px 14px', fontSize: '12px' }}
            >
              👦 Boys (Male)
            </button>
            <button
              onClick={() => setGenderFilter('FEMALE')}
              className={genderFilter === 'FEMALE' ? 'chip active' : 'chip'}
              style={{ padding: '6px 14px', fontSize: '12px' }}
            >
              👧 Girls (Female)
            </button>
          </div>

          {loadingProducts ? (
            <div className="empty">
              <h3>Loading matching products…</h3>
            </div>
          ) : productsList.length === 0 ? (
            <div className="empty">
              <span>⌁</span>
              <h3>No matching {category.toLowerCase()} products found</h3>
              <p>There are no products matching this school, grade, and gender filter.</p>
              <button className="text-button" onClick={() => setGenderFilter('ALL')}>
                Reset gender filter
              </button>
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
                      {p.category.toLowerCase().includes('shoe') ? '👞' : p.category === 'Stationery' ? '▤' : p.category === 'ID Cards' ? '▧' : '▥'}
                    </div>
                    <div className="product-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="tag">{p.category}</span>
                        {p.gender && p.gender !== 'BOTH' && (
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

            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#5c6b61', fontWeight: 600 }}>
                  {isShoeProduct ? 'Select Shoe Size (UK / India)' : 'Select Size / Variant'} <span style={{ color: '#a34235' }}>*</span>
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
                <option value="">{isShoeProduct ? '-- Choose shoe size (UK) --' : '-- Choose size --'}</option>
                {selectedProduct.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {isShoeProduct && !v.size.toLowerCase().includes('size') ? `Shoe Size ${v.size}` : `Size: ${v.size}`} ({v.stock_status || 'In stock'})
                  </option>
                ))}
              </select>
            </div>

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
    </div>
  );
}
