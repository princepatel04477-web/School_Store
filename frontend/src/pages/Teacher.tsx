import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { SelectionFlow } from '../components/SelectionFlow';
import { Cart, type CartItem } from '../components/Store';
import { api, ApiError, money, portalApi, type Order, type Product } from '../api';
import { StudentPhoto } from '../components/teacher/StudentPhoto';
import { TeacherIdCardPreview } from '../components/teacher/TeacherIdCardPreview';
import {
  STANDARDS,
  StudentForm,
  missingForIdCard,
  standardLabel,
  toStandard,
  type TeacherStudent,
} from '../components/teacher/StudentForm';
import { Skeleton } from '../components/ui/Skeleton';
import {
  ArrowLeft,
  ChevronRight,
  Receipt,
  SchoolBuilding,
  Search,
  ShoppingBag,
  SignOut,
  Users,
} from '../components/ui/icons';
import type { Fit } from '../data/fit';
import '../components/teacher/teacher.css';

const CATEGORIES = ['ID Cards', 'Uniform', 'School Shoes', 'Uniform Accessories', 'Stationery'] as const;
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
  student_count?: number;
  photo_count?: number;
};

type Page<T> = { results: T[]; next?: string | null; count?: number };

/** DRF gives an absolute `next` URL; api() wants the /api/... path. */
function nextPath(next?: string | null) {
  if (!next) return undefined;
  try {
    const u = new URL(next, window.location.origin);
    return `${u.pathname}${u.search}`;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Which school / branch the teacher is looking at                     */
/* ------------------------------------------------------------------ */

type Scope = { state: string; city: string; school: string; branch: string };
const SCOPE_KEY = 'tp-scope';

function readSavedScope(): Scope {
  try {
    const raw = sessionStorage.getItem(SCOPE_KEY);
    if (raw) return { state: '', city: '', school: '', branch: '', ...JSON.parse(raw) };
  } catch {
    /* storage blocked */
  }
  return { state: '', city: '', school: '', branch: '' };
}

function useScopeState() {
  const { user } = useAuth();
  const allAccess = Boolean(user?.all_schools_access);
  const userSchool = typeof user?.school === 'string' ? user.school : '';
  const [picked, setPicked] = useState<Scope>(readSavedScope);

  useEffect(() => {
    if (!allAccess) return;
    try {
      sessionStorage.setItem(SCOPE_KEY, JSON.stringify(picked));
    } catch {
      /* storage blocked */
    }
  }, [allAccess, picked]);

  const { data: citiesData } = useQuery({
    queryKey: ['teacher-cities'],
    queryFn: () => portalApi.cities({ page_size: '200' }),
    enabled: allAccess,
    staleTime: 10 * 60 * 1000,
  });
  const { data: schoolsData } = useQuery({
    queryKey: ['teacher-schools'],
    queryFn: () => portalApi.schools({ page_size: '200' }),
    enabled: allAccess,
    staleTime: 10 * 60 * 1000,
  });
  const { data: branchesData } = useQuery({
    queryKey: ['teacher-branches', picked.city, picked.school],
    queryFn: () => {
      const p: Record<string, string> = {};
      if (picked.city) p.city = picked.city;
      if (picked.school) p.school = picked.school;
      return portalApi.branches(p);
    },
    enabled: allAccess && Boolean(picked.school),
    staleTime: 10 * 60 * 1000,
  });

  const cities = citiesData?.results || [];
  const states = useMemo(
    () => Array.from(new Set(cities.map((c) => c.state).filter(Boolean))).sort(),
    [cities],
  );
  const schools = (schoolsData?.results || []) as Array<{ id: string; name: string; city?: string; is_public_store?: boolean }>;
  const branches = branchesData?.results || [];

  const schoolName = allAccess
    ? schools.find((s) => s.id === picked.school)?.name || ''
    : user?.school_name || '';
  const branchName = allAccess
    ? branches.find((b) => b.id === picked.branch)?.display_name || ''
    : user?.branch_name || '';

  return {
    user,
    allAccess,
    schoolId: allAccess ? picked.school : userSchool,
    branchId: allAccess ? picked.branch : user?.branch || '',
    cityId: allAccess ? picked.city : user?.city || '',
    schoolName,
    branchName,
    picked,
    setPicked,
    states,
    cities: picked.state ? cities.filter((c) => c.state.toLowerCase() === picked.state.toLowerCase()) : cities,
    schools: picked.city ? schools.filter((s) => !s.city || s.city === picked.city) : schools,
    branches,
  };
}

type ScopeCtx = ReturnType<typeof useScopeState>;
const ScopeContext = createContext<ScopeCtx | null>(null);

function useScope(): ScopeCtx {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScope outside the teacher portal');
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Page frame                                                          */
/* ------------------------------------------------------------------ */

const NAV = [
  { to: '/teacher', label: 'Classes', icon: SchoolBuilding, end: true },
  { to: '/teacher/students', label: 'Students', icon: Users, end: false },
  { to: '/teacher/orders', label: 'Order', icon: ShoppingBag, end: false },
  { to: '/teacher/history', label: 'History', icon: Receipt, end: false },
];

function TeacherShell({ children }: { children: ReactNode }) {
  const scope = useScope();
  const { signOut } = useAuth();
  const location = useLocation();
  const name =
    [scope.user?.first_name, scope.user?.last_name].filter(Boolean).join(' ') || 'Teacher';
  const where = scope.allAccess
    ? scope.schoolName
      ? `${scope.schoolName}${scope.branchName ? `, ${scope.branchName}` : ''}`
      : 'Every school'
    : `${scope.schoolName || 'Your school'}${scope.branchName ? `, ${scope.branchName}` : ''}`;
  const isStudentsArea = location.pathname.startsWith('/teacher/student');
  const isOrderArea = location.pathname.startsWith('/teacher/order');

  return (
    <div className="tp-app">
      <header className="tp-top">
        <Link to="/teacher" className="tp-top-brand" aria-label="Teacher portal home">
          <span className="brand-mark">S</span>
          <span className="tp-top-who">
            <b>{name}</b>
            <small>{where}</small>
          </span>
        </Link>
        <button type="button" className="tp-icon-btn" onClick={signOut}>
          <SignOut width={20} height={20} />
          <span>Sign out</span>
        </button>
      </header>
      <main className="tp-main">{children}</main>
      <nav className="tp-nav" aria-label="Teacher portal">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isActive ||
              (to === '/teacher/students' && isStudentsArea) ||
              (to === '/teacher/orders' && isOrderArea)
                ? 'tp-nav-item is-active'
                : 'tp-nav-item'
            }
          >
            <Icon width={22} height={22} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function Teacher() {
  const scope = useScopeState();
  return (
    <ScopeContext.Provider value={scope}>
      <TeacherShell>
        <Routes>
          <Route index element={<ClassesView />} />
          <Route path="classes" element={<ClassesView />} />
          <Route path="students" element={<StudentsView />} />
          <Route path="student/:id" element={<StudentFormPage />} />
          <Route path="orders" element={<OrderPickerView />} />
          <Route path="order/:id" element={<TeacherOrder />} />
          <Route path="history" element={<OrderHistoryView />} />
          <Route path="*" element={<ClassesView />} />
        </Routes>
      </TeacherShell>
    </ScopeContext.Provider>
  );
}

/** Teachers with every school choose which one to work on; others see nothing here. */
function ScopePicker() {
  const scope = useScope();
  const [open, setOpen] = useState(!scope.picked.school);
  if (!scope.allAccess) return null;
  const set = (patch: Partial<Scope>) => scope.setPicked((p) => ({ ...p, ...patch }));

  return (
    <section className="tp-scope">
      <div className="tp-scope-head">
        <div>
          <small>Working on</small>
          <b>
            {scope.schoolName
              ? `${scope.schoolName}${scope.branchName ? `, ${scope.branchName}` : ''}`
              : 'Every school (choose one to add classes or students)'}
          </b>
        </div>
        <button type="button" className="tp-btn tp-btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Done' : 'Change'}
        </button>
      </div>
      {open && (
        <div className="tp-scope-body">
          <div className="tp-row">
            <label className="tp-field">
              <span>State</span>
              <select value={scope.picked.state} onChange={(e) => set({ state: e.target.value, city: '', school: '', branch: '' })}>
                <option value="">Any</option>
                {scope.states.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="tp-field">
              <span>City</span>
              <select value={scope.picked.city} onChange={(e) => set({ city: e.target.value, school: '', branch: '' })}>
                <option value="">Any</option>
                {scope.cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="tp-field">
            <span>School</span>
            <select value={scope.picked.school} onChange={(e) => set({ school: e.target.value, branch: '' })}>
              <option value="">Every school</option>
              {scope.schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.is_public_store === false ? ' (ID card only)' : ''}
                </option>
              ))}
            </select>
          </label>
          {scope.picked.school && scope.branches.length > 0 && (
            <label className="tp-field">
              <span>Branch</span>
              <select value={scope.picked.branch} onChange={(e) => set({ branch: e.target.value })}>
                <option value="">Every branch</option>
                {scope.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.display_name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </section>
  );
}

function PageHead({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="tp-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {action}
    </div>
  );
}

function rosterQuery(cls: string, sec: string) {
  const p = new URLSearchParams();
  if (cls && cls !== 'All') p.set('class', cls);
  if (sec) p.set('section', sec);
  return p.toString();
}

function useClasses() {
  const scope = useScope();
  return useQuery({
    queryKey: ['teacher-classes', scope.schoolId, scope.branchId],
    queryFn: () => {
      const p = new URLSearchParams({ page_size: '50' });
      if (scope.schoolId) p.set('school', scope.schoolId);
      if (scope.branchId) p.set('branch', scope.branchId);
      return api<Page<SchoolClassItem>>(`/classes/?${p.toString()}`);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Classes                                                             */
/* ------------------------------------------------------------------ */

function ClassesView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scope = useScope();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newClass, setNewClass] = useState('1');
  const [newSection, setNewSection] = useState('A');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useClasses();
  const classes = data?.results || [];
  const needsSchool = scope.allAccess && !scope.schoolId;

  const addClass = useMutation({
    mutationFn: () =>
      api<SchoolClassItem>('/classes/', {
        method: 'POST',
        body: JSON.stringify({
          class_name: newClass,
          section: newSection.trim().toUpperCase() || 'A',
          ...(scope.schoolId ? { school: scope.schoolId } : {}),
          ...(scope.branchId ? { branch: scope.branchId } : {}),
        }),
      }),
    onSuccess: (created) => {
      setError('');
      setMessage(`Class ${created.label} added.`);
      // Next likely section: 1A then 1B.
      const next = String.fromCharCode(Math.min(90, (created.section || 'A').charCodeAt(0) + 1));
      setNewSection(next);
      queryClient.invalidateQueries({ queryKey: ['teacher-classes'] });
    },
    onError: (err: unknown) => {
      setMessage('');
      setError(err instanceof ApiError ? err.message : 'Could not add the class. Check the internet and try again.');
    },
  });

  const removeClass = useMutation({
    mutationFn: (id: string) => api(`/classes/${id}/`, { method: 'DELETE' }),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['teacher-classes'] });
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not remove the class.'),
  });

  const totals = classes.reduce(
    (acc, c) => ({ students: acc.students + (c.student_count || 0), photos: acc.photos + (c.photo_count || 0) }),
    { students: 0, photos: 0 },
  );

  return (
    <>
      <ScopePicker />
      <PageHead
        eyebrow="CLASSES"
        title="Your classes"
        action={
          <button
            type="button"
            className="tp-btn tp-btn-primary tp-btn-sm"
            onClick={() => {
              setShowAdd((v) => !v);
              setMessage('');
              setError('');
            }}
          >
            {showAdd ? 'Close' : '+ Add class'}
          </button>
        }
      />

      {classes.length > 0 && (
        <p className="tp-progress">
          {totals.students} students in {classes.length} classes, {totals.photos} with an ID card photo.
        </p>
      )}

      {showAdd && (
        <form
          className="tp-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (needsSchool) {
              setError('Choose a school at the top first.');
              return;
            }
            addClass.mutate();
          }}
        >
          <b>Add a class and section</b>
          <div className="tp-row">
            <label className="tp-field">
              <span>Class</span>
              <select value={newClass} onChange={(e) => setNewClass(e.target.value)}>
                {STANDARDS.map((c) => (
                  <option key={c} value={c}>{standardLabel(c)}</option>
                ))}
              </select>
            </label>
            <label className="tp-field">
              <span>Section</span>
              <input
                value={newSection}
                onChange={(e) => setNewSection(e.target.value.toUpperCase())}
                maxLength={10}
                required
              />
            </label>
          </div>
          {message && <p className="tp-ok" role="status">{message}</p>}
          {error && <p className="tp-error" role="alert">{error}</p>}
          <button type="submit" className="tp-btn tp-btn-primary tp-btn-full" disabled={addClass.isPending}>
            {addClass.isPending ? 'Adding...' : `Add ${standardLabel(newClass)} ${newSection.trim().toUpperCase()}`}
          </button>
        </form>
      )}
      {!showAdd && error && <p className="tp-error" role="alert">{error}</p>}

      {isLoading ? (
        <div className="tp-tiles" role="status" aria-label="Loading classes">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height="92px" />
          ))}
        </div>
      ) : classes.length > 0 ? (
        <>
          <div className="tp-tiles">
            {classes.map((c) => {
              const n = c.student_count || 0;
              const photos = c.photo_count || 0;
              return (
                <div key={c.id} className="tp-tile-wrap">
                  <button
                    type="button"
                    className="tp-tile"
                    onClick={() => navigate(`/teacher/students?${rosterQuery(c.class_name, c.section)}`)}
                  >
                    <b>{c.label}</b>
                    <small>{n === 1 ? '1 student' : `${n} students`}</small>
                    {n > 0 && (
                      <span className={photos === n ? 'tp-tag tp-tag-done' : 'tp-tag tp-tag-todo'}>
                        {photos === n ? 'All photos in' : n - photos === 1 ? '1 photo to take' : `${n - photos} photos to take`}
                      </span>
                    )}
                    {scope.allAccess && !scope.schoolId && <small>{c.branch_name || c.school_name}</small>}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className="tp-tile-remove"
                      disabled={n > 0 || removeClass.isPending}
                      title={n > 0 ? 'Move or remove its students first' : `Remove class ${c.label}`}
                      onClick={() => removeClass.mutate(c.id)}
                    >
                      {n > 0 ? 'Has students' : 'Remove'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" className="tp-link-btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done editing classes' : 'Edit classes'}
          </button>
        </>
      ) : (
        <div className="tp-empty">
          <b>No classes yet</b>
          <p>
            Tap "+ Add class" to make sections like 1A and 1B. You can also open a standard straight away:
          </p>
          <div className="tp-std-grid">
            {STANDARDS.map((s) => (
              <button key={s} type="button" className="tp-btn tp-btn-sm" onClick={() => navigate(`/teacher/students?${rosterQuery(s, '')}`)}>
                {standardLabel(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Students                                                            */
/* ------------------------------------------------------------------ */

function useStudentPages(cls: string, sec: string, q = '') {
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: ['teacher-students', q, cls, sec, scope.schoolId, scope.branchId],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      if (pageParam) return api<Page<TeacherStudent>>(pageParam);
      const p = new URLSearchParams();
      if (q.trim()) p.set('search', q.trim());
      if (cls && cls !== 'All') p.set('class', cls);
      if (sec.trim()) p.set('section', sec.trim().toUpperCase());
      if (scope.schoolId) p.set('school', scope.schoolId);
      if (scope.branchId) p.set('branch', scope.branchId);
      return api<Page<TeacherStudent>>(`/students/?${p.toString()}`);
    },
    getNextPageParam: (last) => nextPath(last.next),
  });
}

function ClassChips({ cls, sec, onChoose }: { cls: string; sec: string; onChoose: (c: string, s: string) => void }) {
  const { data } = useClasses();
  const saved = data?.results || [];
  const options = [
    { key: 'all', cls: 'All', sec: '', label: 'All' },
    ...(saved.length
      ? saved.map((c) => ({ key: c.id, cls: c.class_name, sec: c.section, label: c.label }))
      : STANDARDS.map((c) => ({ key: c, cls: c, sec: '', label: standardLabel(c) }))),
  ];
  return (
    <div className="tp-sections" role="group" aria-label="Class">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={toStandard(cls) === toStandard(o.cls) && sec === o.sec}
          onClick={() => onChoose(o.cls, o.sec)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="tp-search">
      <Search width={18} height={18} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" />
    </label>
  );
}

function StudentRows({
  pages,
  onOpen,
  emptyText,
  showMissing = true,
}: {
  pages: ReturnType<typeof useStudentPages>;
  onOpen: (s: TeacherStudent) => void;
  emptyText: string;
  showMissing?: boolean;
}) {
  const list = pages.data?.pages.flatMap((p) => p.results) || [];
  if (pages.isLoading) {
    return (
      <div className="tp-skeleton-list" role="status" aria-label="Loading students">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height="72px" />
        ))}
      </div>
    );
  }
  if (pages.isError) {
    return (
      <div className="tp-empty">
        <b>Could not load students</b>
        <p>Check the internet, then try again.</p>
        <button type="button" className="tp-btn tp-btn-sm" onClick={() => pages.refetch()}>Try again</button>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="tp-empty">
        <b>No students here yet</b>
        <p>{emptyText}</p>
      </div>
    );
  }
  return (
    <>
      <div className="tp-list">
        {list.map((s) => {
          const missing = missingForIdCard(s);
          return (
            <button type="button" className="tp-student" key={s.id} onClick={() => onOpen(s)}>
              <StudentPhoto url={s.photo_url} name={s.name} size={44} />
              <span className="tp-student-body">
                <b>{s.name}</b>
                <small>
                  GR {s.gr_number || '-'} · {standardLabel(s.grade_name || s.class_name)} {s.section}
                </small>
                {showMissing &&
                  (missing.length === 0 ? (
                    <span className="tp-tag tp-tag-done">Form complete</span>
                  ) : (
                    <span className="tp-tag tp-tag-todo">Missing: {missing.join(', ')}</span>
                  ))}
              </span>
              <ChevronRight width={18} height={18} className="tp-chevron" />
            </button>
          );
        })}
      </div>
      {pages.hasNextPage && (
        <button
          type="button"
          className="tp-btn tp-btn-full tp-more"
          disabled={pages.isFetchingNextPage}
          onClick={() => pages.fetchNextPage()}
        >
          {pages.isFetchingNextPage ? 'Loading...' : 'Show more students'}
        </button>
      )}
    </>
  );
}

function useRosterParams() {
  const [searchParams, setSearchParams] = useSearchParams();
  const cls = searchParams.get('class') || 'All';
  const sec = searchParams.get('section') || '';
  const choose = (nextCls: string, nextSec: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextCls === 'All') next.delete('class');
    else next.set('class', nextCls);
    if (nextSec) next.set('section', nextSec);
    else next.delete('section');
    setSearchParams(next, { replace: true });
  };
  return { cls, sec, choose };
}

function StudentsView() {
  const navigate = useNavigate();
  const { cls, sec, choose } = useRosterParams();
  const [q, setQ] = useState('');
  const pages = useStudentPages(cls, sec, q);
  const loaded = pages.data?.pages.flatMap((p) => p.results) || [];
  const total = pages.data?.pages[0]?.count ?? loaded.length;
  const complete = loaded.filter((s) => missingForIdCard(s).length === 0).length;

  return (
    <>
      <ScopePicker />
      <PageHead
        eyebrow="ID CARD FORMS"
        title={cls === 'All' ? 'All students' : `${standardLabel(cls)}${sec ? ` ${sec}` : ''}`}
        action={
          <Link className="tp-btn tp-btn-primary tp-btn-sm" to={`/teacher/student/new?${rosterQuery(cls, sec)}`}>
            + Add student
          </Link>
        }
      />
      <ClassChips cls={cls} sec={sec} onChoose={choose} />
      <SearchBox value={q} onChange={setQ} placeholder="Search name or GR number" />
      {loaded.length > 0 && (
        <p className="tp-progress">
          {total} {total === 1 ? 'student' : 'students'}
          {loaded.length === total ? `, ${complete} ${complete === 1 ? 'form' : 'forms'} complete` : ''}. Tap a student to fill their form.
        </p>
      )}
      <StudentRows
        pages={pages}
        onOpen={(s) => navigate(`/teacher/student/${s.id}?${rosterQuery(cls, sec)}`)}
        emptyText='Tap "+ Add student" to fill the first ID card form for this class.'
      />
    </>
  );
}

function StudentFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scope = useScope();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isNew = !id || id === 'new';
  const cls = toStandard(searchParams.get('class'));
  const sec = searchParams.get('section') || '';
  const [notice, setNotice] = useState<string>((location.state as { notice?: string } | null)?.notice || '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState('');

  const { data: student, isLoading, isError } = useQuery({
    queryKey: ['teacher-student', id],
    queryFn: () => api<TeacherStudent>(`/students/${id}/`),
    enabled: !isNew,
  });

  const rosterCls = cls || toStandard(student?.class_name);
  const rosterSec = sec || student?.section || '';
  const roster = useStudentPages(rosterCls, rosterSec);
  const others = roster.data?.pages.flatMap((p) => p.results) || [];
  const index = student ? others.findIndex((s) => s.id === student.id) : -1;
  const nextStudent = index >= 0 ? others[index + 1] : undefined;
  const back = `/teacher/students?${rosterQuery(rosterCls, rosterSec)}`;

  useEffect(() => {
    window.scrollTo(0, 0);
    setConfirmRemove(false);
    setRemoveError('');
  }, [id]);

  const remove = useMutation({
    mutationFn: () => api(`/students/${student!.id}/`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-students'] });
      queryClient.invalidateQueries({ queryKey: ['teacher-classes'] });
      navigate(back, { replace: true });
    },
    onError: (err: unknown) => setRemoveError(err instanceof ApiError ? err.message : 'Could not remove the student.'),
  });

  if (!isNew && isError) {
    return (
      <div className="tp-empty">
        <b>This student could not be opened</b>
        <p>They may have been removed, or belong to another school.</p>
        <Link className="tp-btn tp-btn-sm" to={back}>Back to the class</Link>
      </div>
    );
  }
  if (!isNew && (isLoading || !student)) {
    return (
      <div className="tp-skeleton-list" role="status" aria-label="Loading form">
        <Skeleton height="120px" />
        <Skeleton height="44px" />
        <Skeleton height="44px" />
        <Skeleton height="44px" />
      </div>
    );
  }

  return (
    <>
      <Link to={back} className="tp-back">
        <ArrowLeft width={18} height={18} /> Back to {rosterCls ? `${standardLabel(rosterCls)} ${rosterSec}`.trim() : 'students'}
      </Link>
      <PageHead eyebrow="ID CARD FORM" title={isNew ? 'Add a student' : student!.name} />

      {notice && <p className="tp-ok" role="status">{notice}</p>}

      {!isNew && <TeacherIdCardPreview student={student!} />}

      <StudentForm
        key={student?.id || 'new'}
        student={isNew ? null : student}
        defaults={{ class_name: cls || undefined, section: sec || undefined }}
        schoolId={scope.schoolId}
        branchId={scope.branchId}
        onSaved={(saved, warning) => {
          queryClient.setQueryData(['teacher-student', saved.id], saved);
          queryClient.invalidateQueries({ queryKey: ['teacher-students'] });
          queryClient.invalidateQueries({ queryKey: ['teacher-classes'] });
          const left = missingForIdCard(saved);
          const msg =
            warning || (left.length ? `Saved. Still missing: ${left.join(', ')}.` : 'Saved. This form is complete.');
          setNotice(msg);
          window.scrollTo(0, 0);
          if (isNew) {
            navigate(`/teacher/student/${saved.id}?${rosterQuery(toStandard(saved.class_name), saved.section)}`, {
              replace: true,
              state: { notice: msg },
            });
          }
        }}
      />

      {!isNew && (
        <div className="tp-actions">
          {nextStudent && (
            <Link
              className="tp-btn tp-btn-primary"
              onClick={() => setNotice('')}
              to={`/teacher/student/${nextStudent.id}?${rosterQuery(rosterCls, rosterSec)}`}
            >
              Next student: {nextStudent.name}
            </Link>
          )}
          <Link className="tp-btn" to={`/teacher/order/${student!.id}`}>
            Order ID card or uniform
          </Link>
          <Link
            className="tp-btn"
            onClick={() => setNotice('')}
            to={`/teacher/student/new?${rosterQuery(rosterCls, rosterSec)}`}
          >
            + Add another student to this class
          </Link>
          {!confirmRemove ? (
            <button type="button" className="tp-link-btn tp-danger" onClick={() => setConfirmRemove(true)}>
              Remove {student!.name} from the class list
            </button>
          ) : (
            <div className="tp-confirm">
              <p>
                Remove {student!.name}? They leave this class list. Their past orders stay.
              </p>
              <div className="tp-row">
                <button type="button" className="tp-btn" onClick={() => setConfirmRemove(false)}>Keep</button>
                <button
                  type="button"
                  className="tp-btn tp-btn-danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? 'Removing...' : 'Remove'}
                </button>
              </div>
              {removeError && <p className="tp-error" role="alert">{removeError}</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

function OrderPickerView() {
  const navigate = useNavigate();
  const { cls, sec, choose } = useRosterParams();
  const [q, setQ] = useState('');
  const pages = useStudentPages(cls, sec, q);
  return (
    <>
      <ScopePicker />
      <PageHead eyebrow="ORDER" title="Who is the order for?" />
      <p className="tp-progress">Pick a student to order their ID card, uniform, shoes or stationery.</p>
      <ClassChips cls={cls} sec={sec} onChoose={choose} />
      <SearchBox value={q} onChange={setQ} placeholder="Search name or GR number" />
      <StudentRows
        pages={pages}
        showMissing={false}
        onOpen={(s) => navigate(`/teacher/order/${s.id}`)}
        emptyText="Add students on the Students tab first."
      />
    </>
  );
}

function TeacherOrder() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<CategoryTab>('ID Cards');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [placed, setPlaced] = useState(false);

  const { data: student, isLoading, isError } = useQuery({
    queryKey: ['teacher-student', id],
    queryFn: () => api<TeacherStudent & { city_name?: string | null }>(`/students/${id}/`),
    enabled: Boolean(id),
  });

  if (isError) {
    return (
      <div className="tp-empty">
        <b>This student could not be opened</b>
        <p>They may have been removed, or belong to another school.</p>
        <Link className="tp-btn tp-btn-sm" to="/teacher/orders">Choose another student</Link>
      </div>
    );
  }
  if (isLoading || !student) {
    return (
      <div className="tp-skeleton-list" role="status" aria-label="Loading student">
        <Skeleton height="80px" />
        <Skeleton height="44px" />
        <Skeleton height="200px" />
      </div>
    );
  }

  const classLabel = `${standardLabel(student.grade_name || student.class_name)} ${student.section || ''}`.trim();
  const studentProfile = {
    id: student.id,
    school_id: student.school,
    school_name: student.school_name,
    city_id: student.city || undefined,
    city_name: student.city_name || undefined,
    grade_id: student.grade || undefined,
    grade_name: student.grade_name || student.class_name,
    gender: student.gender,
    photo_url: student.photo_url,
    photo_consent_at: student.photo_consent_at,
    prefill: {
      student_name: student.name,
      student_class: classLabel.slice(0, 20),
      blood_group: student.blood_group || '',
      emergency_phone: student.roster_phone || '',
    },
  };

  const handleAddItem = (item: {
    product: Product;
    variantId: string;
    customisationData: Record<string, any>;
    measurement?: Fit;
  }) => {
    setPlaced(false);
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

  return (
    <>
      <Link to={`/teacher/student/${student.id}`} className="tp-back">
        <ArrowLeft width={18} height={18} /> Back to {student.name}'s form
      </Link>

      <section className="tp-order-who">
        <StudentPhoto url={student.photo_url} name={student.name} size={52} />
        <div>
          <span className="eyebrow">ORDERING FOR</span>
          <b>{student.name}</b>
          <small>
            GR {student.gr_number || '-'} · {classLabel} · {student.gender?.toUpperCase() === 'FEMALE' ? 'Girl' : 'Boy'}
          </small>
          {missingForIdCard(student).length > 0 && (
            <Link to={`/teacher/student/${student.id}`} className="tp-tag tp-tag-todo">
              Form missing: {missingForIdCard(student).join(', ')}
            </Link>
          )}
        </div>
      </section>

      {placed && <p className="tp-ok" role="status">Order placed. You can see it on the History tab.</p>}

      <div className="tp-sections" role="group" aria-label="What to order">
        {CATEGORIES.map((cat) => (
          <button key={cat} type="button" aria-pressed={activeCategory === cat} onClick={() => setActiveCategory(cat)}>
            {cat}
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
        onRemoveItem={(itemId) => setCartItems((prev) => prev.filter((it) => it.id !== itemId))}
        onSuccess={() => {
          setPlaced(true);
          queryClient.invalidateQueries({ queryKey: ['teacher-orders'] });
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

const ORDER_STATUS: Record<string, string> = {
  PLACED: 'Placed',
  PENDING: 'Placed',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Being made',
  PACKED: 'Packed',
  DISPATCHED: 'On the way',
  SHIPPED: 'On the way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
  REFUNDED: 'Refunded',
};

const PAYMENT_STATUS: Record<string, string> = {
  PENDING: 'Not paid yet',
  AUTHORIZED: 'Payment checking',
  PAID: 'Paid',
  FAILED: 'Payment failed',
  REFUNDED: 'Refunded',
};

function OrderHistoryView() {
  const scope = useScope();
  const orders = useInfiniteQuery({
    queryKey: ['teacher-orders', scope.schoolId, scope.branchId],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      if (pageParam) return api<Page<Order>>(pageParam);
      const p = new URLSearchParams();
      if (scope.schoolId) p.set('school', scope.schoolId);
      if (scope.branchId) p.set('branch', scope.branchId);
      return api<Page<Order>>(`/orders/?${p.toString()}`);
    },
    getNextPageParam: (last) => nextPath(last.next),
  });
  const list = orders.data?.pages.flatMap((p) => p.results) || [];

  return (
    <>
      <ScopePicker />
      <PageHead eyebrow="HISTORY" title="Orders" />
      {orders.isLoading ? (
        <div className="tp-skeleton-list" role="status" aria-label="Loading orders">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height="76px" />
          ))}
        </div>
      ) : orders.isError ? (
        <div className="tp-empty">
          <b>Could not load orders</b>
          <p>Check the internet, then try again.</p>
          <button type="button" className="tp-btn tp-btn-sm" onClick={() => orders.refetch()}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <div className="tp-empty">
          <b>No orders yet</b>
          <p>Orders you place for students appear here.</p>
          <Link className="tp-btn tp-btn-sm" to="/teacher/orders">Place an order</Link>
        </div>
      ) : (
        <>
          <div className="tp-list">
            {list.map((o) => {
              const status = ORDER_STATUS[o.status] || o.status;
              const paid = PAYMENT_STATUS[o.payment_status] || o.payment_status;
              const done = o.status === 'DELIVERED';
              const stopped = ['CANCELLED', 'RETURNED', 'REFUNDED'].includes(o.status);
              return (
                <Link
                  key={o.id}
                  to={o.student ? `/teacher/student/${o.student}` : '/teacher/history'}
                  className="tp-student tp-order-row"
                >
                  <span className="tp-student-body">
                    <b>{o.student_name || 'Student'}</b>
                    <small>
                      {o.order_number} · {new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </small>
                    <span className={done ? 'tp-tag tp-tag-done' : stopped ? 'tp-tag tp-tag-stop' : 'tp-tag tp-tag-todo'}>
                      {status} · {paid}
                    </span>
                  </span>
                  <strong className="tp-amount">{money(o.total)}</strong>
                </Link>
              );
            })}
          </div>
          {orders.hasNextPage && (
            <button
              type="button"
              className="tp-btn tp-btn-full tp-more"
              disabled={orders.isFetchingNextPage}
              onClick={() => orders.fetchNextPage()}
            >
              {orders.isFetchingNextPage ? 'Loading...' : 'Show older orders'}
            </button>
          )}
        </>
      )}
    </>
  );
}
