import { useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shell } from '../App';
import { useAuth } from '../auth';
import { SelectionFlow } from '../components/SelectionFlow';
import { Cart, type CartItem } from '../components/Store';
import { api, money, portalApi, upload, type Order, type Product } from '../api';
import type { Fit } from '../data/fit';

const STANDARDS = [
  'Nursery', 'Junior KG', 'Senior KG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
];

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

const CATEGORIES = [
  'ID Cards',
  'Uniform',
  'School Shoes',
  'Uniform Accessories',
  'Stationery',
] as const;

type CategoryTab = (typeof CATEGORIES)[number];

type SchoolClassItem = {
  id: string;
  school: string;
  school_name: string;
  branch: string | null;
  branch_name: string | null;
  class_name: string;
  section: string;
  label: string;
};

function TeacherTabs() {
  const tabStyle = ({ isActive }: { isActive: boolean }) => ({
    padding: '8px 14px',
    borderRadius: '8px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '14px',
    border: isActive ? '1px solid #275b4c' : '1px solid #dfe5dd',
    background: isActive ? '#275b4c' : '#ffffff',
    color: isActive ? '#ffffff' : '#1f2a24',
  });

  return (
    <nav
      aria-label="Teacher sections"
      style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}
    >
      <NavLink to="/teacher" end style={tabStyle}>
        1. Classes
      </NavLink>
      <NavLink to="/teacher/students" style={tabStyle}>
        2. Students
      </NavLink>
      <NavLink to="/teacher/orders" style={tabStyle}>
        3. Orders (ID Card & Uniforms)
      </NavLink>
      <NavLink to="/teacher/history" style={tabStyle}>
        4. Order History
      </NavLink>
    </nav>
  );
}

export default function Teacher() {
  return (
    <Shell title="ID Card & School Store Portal">
      <TeacherTabs />
      <Routes>
        <Route index element={<ClassesView />} />
        <Route path="classes" element={<ClassesView />} />
        <Route path="students" element={<StudentsView />} />
        <Route path="orders" element={<TeacherOrder />} />
        <Route path="order/:id" element={<TeacherOrder />} />
        <Route path="history" element={<OrderHistoryView />} />
      </Routes>
    </Shell>
  );
}

function useTeacherSchoolContext() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const allAccess = Boolean(user?.all_schools_access);

  const userSchoolId = typeof user?.school === 'string' ? user.school : '';
  const defaultSchoolId = allAccess
    ? searchParams.get('school') || userSchoolId || ''
    : userSchoolId || '';
  const defaultCityId = allAccess
    ? searchParams.get('city') || user?.city || ''
    : user?.city || '';
  const defaultBranchId = allAccess
    ? searchParams.get('branch') || user?.branch || ''
    : user?.branch || '';

  const [stateFilter, setStateFilter] = useState('');
  const [cityId, setCityId] = useState(defaultCityId);
  const [schoolId, setSchoolId] = useState(defaultSchoolId);
  const [branchId, setBranchId] = useState(defaultBranchId);

  const { data: citiesData } = useQuery({
    queryKey: ['teacher-cities'],
    queryFn: () => portalApi.cities({ page_size: '200' }),
    enabled: allAccess,
  });
  const cities = citiesData?.results || [];

  const states = useMemo(() => {
    const s = new Set<string>();
    cities.forEach((c) => {
      if (c.state) s.add(c.state);
    });
    return Array.from(s).sort();
  }, [cities]);

  const filteredCities = useMemo(() => {
    if (!stateFilter) return cities;
    return cities.filter((c) => c.state.toLowerCase() === stateFilter.toLowerCase());
  }, [cities, stateFilter]);

  const { data: schoolsData } = useQuery({
    queryKey: ['teacher-schools'],
    queryFn: () => portalApi.schools({ page_size: '200' }),
    enabled: allAccess,
  });
  const schools = schoolsData?.results || [];

  const { data: branchesData } = useQuery({
    queryKey: ['teacher-branches', cityId, schoolId],
    queryFn: () => {
      const p: Record<string, string> = {};
      if (cityId) p.city = cityId;
      if (schoolId) p.school = schoolId;
      return portalApi.branches(p);
    },
    enabled: allAccess && Boolean(cityId || schoolId),
  });
  const branches = branchesData?.results || [];

  const syncParams = (nextSchool: string, nextCity: string, nextBranch: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextSchool) next.set('school', nextSchool);
    else next.delete('school');
    if (nextCity) next.set('city', nextCity);
    else next.delete('city');
    if (nextBranch) next.set('branch', nextBranch);
    else next.delete('branch');
    setSearchParams(next, { replace: true });
  };

  return {
    user,
    allAccess,
    states,
    stateFilter,
    setStateFilter,
    cities: filteredCities,
    cityId,
    setCityId: (v: string) => {
      setCityId(v);
      setBranchId('');
      syncParams(schoolId, v, '');
    },
    schools,
    schoolId,
    setSchoolId: (v: string) => {
      setSchoolId(v);
      setBranchId('');
      syncParams(v, cityId, '');
    },
    branches,
    branchId,
    setBranchId: (v: string) => {
      setBranchId(v);
      syncParams(schoolId, cityId, v);
    },
  };
}

function SchoolBranchPicker({ ctx }: { ctx: ReturnType<typeof useTeacherSchoolContext> }) {
  if (!ctx.allAccess) {
    return (
      <div className="notice" style={{ marginBottom: '16px' }}>
        <b>{ctx.user?.school_name || 'Assigned School'}</b>
        <p style={{ margin: '4px 0 0' }}>
          {ctx.user?.branch_name
            ? `Branch: ${ctx.user.branch_name} (branch-locked access)`
            : 'School-wide access · Classes & Students'}
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #dfe5dd',
        borderRadius: '8px',
        padding: '14px',
        marginBottom: '16px',
        display: 'grid',
        gap: '10px',
      }}
    >
      <strong style={{ fontSize: '14px', color: '#275b4c' }}>
        Select State, City, School & Branch
      </strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
        <select
          value={ctx.stateFilter}
          onChange={(e) => {
            ctx.setStateFilter(e.target.value);
            ctx.setCityId('');
          }}
          style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
        >
          <option value="">All States</option>
          {ctx.states.map((st) => (
            <option key={st} value={st}>{st}</option>
          ))}
        </select>

        <select
          value={ctx.cityId}
          onChange={(e) => ctx.setCityId(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
        >
          <option value="">All Cities</option>
          {ctx.cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={ctx.schoolId}
          onChange={(e) => ctx.setSchoolId(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
        >
          <option value="">All Schools</option>
          {ctx.schools.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.is_public_store === false ? ' (ID Card)' : ''}
            </option>
          ))}
        </select>

        <select
          value={ctx.branchId}
          onChange={(e) => ctx.setBranchId(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
        >
          <option value="">All Branches</option>
          {ctx.branches.map((b) => (
            <option key={b.id} value={b.id}>{b.display_name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ClassesView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ctx = useTeacherSchoolContext();

  const [showAdd, setShowAdd] = useState(false);
  const [newClass, setNewClass] = useState('1');
  const [newSection, setNewSection] = useState('A');
  const [classError, setClassError] = useState('');

  const { data: classesData, isLoading } = useQuery({
    queryKey: ['teacher-classes', ctx.schoolId, ctx.branchId],
    queryFn: () => {
      const p = new URLSearchParams({ page_size: '100' });
      if (ctx.schoolId) p.set('school', ctx.schoolId);
      if (ctx.branchId) p.set('branch', ctx.branchId);
      return api<{ results: SchoolClassItem[] }>(`/classes/?${p.toString()}`);
    },
  });
  const savedClasses = classesData?.results || [];

  const addClassMutation = useMutation({
    mutationFn: () =>
      api<SchoolClassItem>('/classes/', {
        method: 'POST',
        body: JSON.stringify({
          class_name: newClass,
          section: newSection.trim().toUpperCase() || 'A',
          ...(ctx.schoolId ? { school: ctx.schoolId } : {}),
          ...(ctx.branchId ? { branch: ctx.branchId } : {}),
        }),
      }),
    onSuccess: () => {
      setClassError('');
      setShowAdd(false);
      queryClient.invalidateQueries({ queryKey: ['teacher-classes'] });
    },
    onError: (err: any) => {
      setClassError(err?.data?.section || err?.message || 'Could not add class.');
    },
  });

  const openClass = (cls: string, sec?: string) => {
    const p = new URLSearchParams();
    p.set('class', cls);
    if (sec) p.set('section', sec);
    if (ctx.schoolId) p.set('school', ctx.schoolId);
    if (ctx.cityId) p.set('city', ctx.cityId);
    if (ctx.branchId) p.set('branch', ctx.branchId);
    navigate(`/teacher/students?${p.toString()}`);
  };

  return (
    <>
      <SchoolBranchPicker ctx={ctx} />
      <div className="section-row">
        <div>
          <span className="eyebrow">SCHOOL & BRANCH CLASSES</span>
          <h2>Classes ({savedClasses.length})</h2>
        </div>
        <button className="text-button" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Close' : '+ Add Class'}
        </button>
      </div>

      {showAdd && (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (ctx.allAccess && !ctx.schoolId) {
              setClassError('Please select a School above before adding a class.');
              return;
            }
            addClassMutation.mutate();
          }}
        >
          <h3>Add Class & Section (e.g. 1A, 1B)</h3>
          {classError && <div className="error">{classError}</div>}
          <div className="form-row">
            <select value={newClass} onChange={(e) => setNewClass(e.target.value)} required>
              {STANDARDS.map((c) => (
                <option key={c} value={c}>
                  {['Nursery', 'Junior KG', 'Senior KG'].includes(c) ? c : `Class ${c}`}
                </option>
              ))}
            </select>
            <input
              value={newSection}
              onChange={(e) => setNewSection(e.target.value.toUpperCase())}
              placeholder="Section (e.g. A, B, C)"
              maxLength={10}
              required
            />
          </div>
          <button className="primary full" disabled={addClassMutation.isPending}>
            {addClassMutation.isPending ? 'Adding...' : `Add Class ${newClass}${newSection.trim().toUpperCase()}`}
          </button>
        </form>
      )}

      {isLoading ? (
        <p className="muted">Loading classes...</p>
      ) : savedClasses.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: '10px',
            marginTop: '12px',
          }}
        >
          {savedClasses.map((sc) => (
            <button
              key={sc.id}
              type="button"
              onClick={() => openClass(sc.class_name, sc.section)}
              style={{
                padding: '16px 12px',
                borderRadius: '8px',
                border: '1px solid #dfe5dd',
                background: '#ffffff',
                cursor: 'pointer',
                textAlign: 'center',
                fontWeight: 700,
                color: '#1f2a24',
              }}
            >
              <div style={{ fontSize: '20px', color: '#275b4c' }}>{sc.label}</div>
              <small style={{ fontWeight: 500, color: '#55695d' }}>
                {sc.branch_name || sc.school_name}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <div className="notice" style={{ marginTop: '12px' }}>
          <b>No custom classes added yet</b>
          <p>Tap "+ Add Class" above to create sections like 1A, 1B, 2A for this branch, or jump straight to a standard below:</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))',
              gap: '8px',
              marginTop: '10px',
            }}
          >
            {STANDARDS.slice(3).map((cls) => (
              <button
                key={cls}
                type="button"
                onClick={() => openClass(cls)}
                style={{
                  padding: '10px 8px',
                  borderRadius: '6px',
                  border: '1px solid #dfe5dd',
                  background: '#ffffff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#275b4c',
                }}
              >
                Class {cls}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function StudentsView() {
  const queryClient = useQueryClient();
  const ctx = useTeacherSchoolContext();
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cls, setCls] = useState(searchParams.get('class') || 'All');
  const [secFilter, setSecFilter] = useState(searchParams.get('section') || '');
  const [showAdd, setShowAdd] = useState(false);

  // Full student details + photo form
  const [name, setName] = useState('');
  const [grNumber, setGrNumber] = useState('');
  const [className, setClassName] = useState(cls === 'All' ? '1' : cls);
  const [section, setSection] = useState(secFilter || 'A');
  const [gender, setGender] = useState<'MALE' | 'FEMALE'>('MALE');
  const [dob, setDob] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [rosterPhone, setRosterPhone] = useState('');
  const [address, setAddress] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [addError, setAddError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['teacher-students', q, cls, secFilter, ctx.schoolId, ctx.branchId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.trim()) p.set('search', q.trim());
      if (cls !== 'All') p.set('class', cls);
      if (secFilter.trim()) p.set('section', secFilter.trim().toUpperCase());
      if (ctx.schoolId) p.set('school', ctx.schoolId);
      if (ctx.branchId) p.set('branch', ctx.branchId);
      return api<{ results: any[] }>(`/students/?${p.toString()}`);
    },
  });

  const addMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('gr_number', grNumber.trim());
      fd.append('class_name', className);
      fd.append('section', section.trim().toUpperCase() || 'A');
      fd.append('gender', gender);
      if (dob) fd.append('date_of_birth', dob);
      if (bloodGroup) fd.append('blood_group', bloodGroup);
      if (guardianName.trim()) fd.append('father_or_guardian_name', guardianName.trim());
      if (rosterPhone.trim()) fd.append('roster_phone', rosterPhone.trim());
      if (address.trim()) fd.append('address', address.trim());
      if (ctx.schoolId) fd.append('school', ctx.schoolId);
      if (ctx.branchId) fd.append('branch', ctx.branchId);
      if (photoFile) fd.append('photo', photoFile);
      return upload<any>('/students/', fd);
    },
    onSuccess: () => {
      setAddError('');
      setName('');
      setGrNumber('');
      setDob('');
      setBloodGroup('');
      setGuardianName('');
      setRosterPhone('');
      setAddress('');
      setPhotoFile(null);
      setPhotoPreview('');
      setShowAdd(false);
      queryClient.invalidateQueries({ queryKey: ['teacher-students'] });
    },
    onError: (err: any) => {
      setAddError(err?.data?.gr_number || err?.message || 'Could not save student.');
    },
  });

  const list = data?.results || [];

  return (
    <>
      <SchoolBranchPicker ctx={ctx} />
      <div className="section-row">
        <div>
          <span className="eyebrow">STUDENT ROSTER & ID DETAILS</span>
          <h2>
            Students {cls !== 'All' ? `· Class ${cls}${secFilter}` : ''}
          </h2>
        </div>
        <button className="text-button" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Close' : '+ Add Student'}
        </button>
      </div>

      <div className="search">
        <span>⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by student name or GR number"
        />
      </div>

      <div className="chips" style={{ overflowX: 'auto' }}>
        {['All', ...STANDARDS.slice(3)].map((x) => (
          <button
            className={cls === x ? 'chip active' : 'chip'}
            onClick={() => {
              setCls(x);
              if (x === 'All') setSecFilter('');
            }}
            key={x}
          >
            {x === 'All' ? 'All Classes' : `Class ${x}`}
          </button>
        ))}
      </div>

      {showAdd && (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (ctx.allAccess && !ctx.schoolId) {
              setAddError('Please select a School above before adding a student.');
              return;
            }
            addMutation.mutate();
          }}
        >
          <h3>Add Student & ID Card Photo</h3>
          {addError && <div className="error">{addError}</div>}

          {/* Photo Capture / Upload */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #94a3b8' }}>
            {photoPreview ? (
              <img
                src={photoPreview}
                alt="Student preview"
                style={{ width: '64px', height: '64px', borderRadius: '8px', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ width: '64px', height: '64px', borderRadius: '8px', background: '#e2ece5', display: 'grid', placeItems: 'center', fontSize: '12px', color: '#275b4c', fontWeight: 700 }}>
                PHOTO
              </div>
            )}
            <div style={{ display: 'grid', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#275b4c', cursor: 'pointer' }}>
                Take / Upload Student Photo
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setPhotoFile(f);
                    setPhotoPreview(f ? URL.createObjectURL(f) : '');
                  }}
                  style={{ display: 'block', marginTop: '4px', fontSize: '12px' }}
                />
              </label>
            </div>
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Student full name *"
            required
          />
          <input
            value={grNumber}
            onChange={(e) => setGrNumber(e.target.value)}
            placeholder="GR / Roll number *"
            required
          />
          <div className="form-row">
            <select value={className} onChange={(e) => setClassName(e.target.value)} required>
              {STANDARDS.map((c) => (
                <option key={c} value={c}>
                  {['Nursery', 'Junior KG', 'Senior KG'].includes(c) ? c : `Class ${c}`}
                </option>
              ))}
            </select>
            <input
              value={section}
              onChange={(e) => setSection(e.target.value.toUpperCase())}
              placeholder="Section (e.g. A)"
              required
            />
          </div>
          <div className="form-row">
            <select value={gender} onChange={(e) => setGender(e.target.value as 'MALE' | 'FEMALE')}>
              <option value="MALE">Boy</option>
              <option value="FEMALE">Girl</option>
            </select>
            <select value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
              <option value="">Blood Group (Optional)</option>
              {BLOOD_GROUPS.map((bg) => (
                <option key={bg} value={bg}>{bg}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              title="Date of Birth"
            />
            <input
              value={rosterPhone}
              onChange={(e) => setRosterPhone(e.target.value)}
              placeholder="Parent phone (10 digits)"
            />
          </div>
          <input
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
            placeholder="Father / Guardian name"
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Home address"
          />
          <button className="primary full" disabled={addMutation.isPending}>
            {addMutation.isPending ? 'Saving...' : 'Save Student & Photo'}
          </button>
        </form>
      )}

      <div className="student-list">
        {isLoading ? (
          <p className="muted">Loading students...</p>
        ) : list.length === 0 ? (
          <div className="notice">
            <b>No students found</b>
            <p>Tap "+ Add Student" above to register a student with their photo and ID card details.</p>
          </div>
        ) : (
          list.map((s: any) => (
            <Link to={`/teacher/order/${s.id}`} className="student-row" key={s.id}>
              {s.photo_url ? (
                <img
                  src={s.photo_url}
                  alt={s.name}
                  style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <span className="kid-avatar">{s.name ? s.name[0] : 'S'}</span>
              )}
              <div>
                <b>{s.name}</b>
                <small>
                  {s.gr_number || '-'} · Class {s.grade_name || s.class_name || '-'} {s.section ? `(${s.section})` : ''} · {s.branch_name || s.school_name || ''}
                  {s.blood_group ? ` · ${s.blood_group}` : ''}
                </small>
              </div>
              <span style={{ fontSize: '13px', color: '#275b4c', fontWeight: 600 }}>
                ID Card & Order →
              </span>
            </Link>
          ))
        )}
      </div>
    </>
  );
}

function TeacherOrder() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<CategoryTab>('ID Cards');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  const { data: student, isLoading } = useQuery({
    queryKey: ['teacher-student', id],
    queryFn: () => api<any>(`/students/${id}/`),
    enabled: Boolean(id),
  });

  if (!id) {
    return (
      <div className="notice">
        <b>Pick a student first</b>
        <p>Choose a class and student so we can open their ID card photo & uniform options.</p>
        <Link to="/teacher/students" className="primary" style={{ display: 'inline-block', marginTop: '10px', textDecoration: 'none' }}>
          Go to Students →
        </Link>
      </div>
    );
  }

  if (isLoading || !student) {
    return <p className="muted">Loading student details...</p>;
  }

  const studentProfile = {
    id: student.id,
    school_id: student.school,
    school_name: student.school_name,
    city_id: student.city,
    grade_id: student.grade,
    grade_name: student.grade_name || student.class_name,
    gender: student.gender,
  };

  const handleAddItem = (item: {
    product: Product;
    variantId: string;
    customisationData: Record<string, any>;
    measurement?: Fit;
  }) => {
    setCartItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        product: item.product,
        variantId: item.variantId,
        variantSize: item.product.variants.find((v) => v.id === item.variantId)?.size,
        quantity: 1,
        customisationData: item.customisationData,
        measurement: item.measurement,
      },
    ]);
  };

  const handleRemoveItem = (itemId: string) => {
    setCartItems((prev) => prev.filter((it) => it.id !== itemId));
  };

  return (
    <>
      <Link to="/teacher/students" className="back">
        ← All students
      </Link>

      <div
        className="selected-student"
        style={{
          background: '#ffffff',
          borderRadius: '6px',
          padding: '16px 20px',
          border: '1px solid #dfe5dd',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          marginBottom: '20px',
        }}
      >
        {student.photo_url ? (
          <img
            src={student.photo_url}
            alt={student.name}
            style={{ width: '52px', height: '52px', borderRadius: '8px', objectFit: 'cover' }}
          />
        ) : (
          <span
            className="kid-avatar"
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '8px',
              background: '#275b4c',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: '18px',
            }}
          >
            {student.name ? student.name[0] : 'S'}
          </span>
        )}
        <div>
          <span className="eyebrow">ID CARD & SCHOOL STORE ORDER FOR</span>
          <h2 style={{ margin: '2px 0 4px', fontSize: '18px' }}>{student.name}</h2>
          <small style={{ color: '#55695d', display: 'block' }}>
            GR: {student.gr_number || '-'} · Class {student.grade_name || student.class_name || '-'} {student.section ? `(${student.section})` : ''} · {student.branch_name || student.school_name || '-'} · {student.gender?.toUpperCase() === 'MALE' ? 'Boy' : 'Girl'}
          </small>
          {(student.blood_group || student.father_or_guardian_name || student.roster_phone) && (
            <small style={{ color: '#55695d', display: 'block', marginTop: '2px' }}>
              {student.blood_group ? `Blood: ${student.blood_group} · ` : ''}
              {student.father_or_guardian_name ? `Guardian: ${student.father_or_guardian_name} · ` : ''}
              {student.roster_phone ? `Ph: ${student.roster_phone}` : ''}
            </small>
          )}
        </div>
      </div>

      <div className="section-row">
        <div>
          <span className="eyebrow">PRIORITY: ID CARD FIRST · UNIFORMS ALSO AVAILABLE</span>
          <h2>Select ID Card or Uniform</h2>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: '1rem' }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={activeCategory === cat ? 'chip active' : 'chip'}
            onClick={() => setActiveCategory(cat)}
          >
            {cat === 'ID Cards' ? '★ ID Cards' : cat}
          </button>
        ))}
      </div>

      <SelectionFlow
        key={`${student.id}-${activeCategory}`}
        category={activeCategory}
        studentProfile={studentProfile}
        autoSelectStudentProfile={true}
        cartItemCount={cartItems.length}
        onClearCart={() => setCartItems([])}
        onOrder={handleAddItem}
        onNavigateCategory={(cat) => setActiveCategory(cat as CategoryTab)}
      />

      <Cart
        items={cartItems}
        studentId={student.id}
        onClear={() => setCartItems([])}
        onRemoveItem={handleRemoveItem}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['teacher-orders'] });
        }}
      />
    </>
  );
}

function OrderHistoryView() {
  const ctx = useTeacherSchoolContext();
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-orders', ctx.schoolId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (ctx.schoolId) p.set('school', ctx.schoolId);
      return api<{ results: Order[] }>(`/orders/?${p.toString()}`);
    },
  });
  const orders = data?.results || [];

  return (
    <>
      <SchoolBranchPicker ctx={ctx} />
      <div className="section-row">
        <div>
          <span className="eyebrow">RECENT ACTIVITY</span>
          <h2>Order History</h2>
        </div>
      </div>

      {isLoading ? (
        <p className="muted">Loading order history...</p>
      ) : orders.length === 0 ? (
        <div className="notice">
          <b>No orders yet</b>
          <p>Orders placed for ID cards and uniforms will appear here.</p>
        </div>
      ) : (
        <div className="student-list">
          {orders.map((o) => (
            <div className="student-row" key={o.id} style={{ justifyContent: 'space-between' }}>
              <div>
                <b>{o.order_number}</b>
                <small style={{ display: 'block', color: '#55695d' }}>
                  {o.student_name} · {new Date(o.created_at).toLocaleDateString()}
                </small>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ display: 'block' }}>{money(o.total)}</strong>
                <small style={{ color: '#275b4c', fontWeight: 600 }}>
                  {o.status} · {o.payment_status}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
