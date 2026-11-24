import { useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { Shell } from '../App';
import { SelectionFlow } from '../components/SelectionFlow';
import { Cart, type CartItem } from '../components/Store';
import { api, money, num, panel, type Product } from '../api';
import { KpiSkeleton, LIVE, LiveStamp, OrdersStrip } from '../components/admin/charts';
import { Skeleton } from '../components/ui/Skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Fit } from '../data/fit';

export default function Teacher() {
  return (
    <Shell title="Your school, in sync.">
      <Routes>
        <Route index element={<TeacherHome />} />
        <Route path="students" element={<Students />} />
        <Route path="order/:id" element={<TeacherOrder />} />
      </Routes>
    </Shell>
  );
}

function TeacherHome() {
  const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['teacher-summary'],
    queryFn: () => panel.teacherSummary(),
    ...LIVE,
  });
  const month = data ? new Date(`${data.month.date_from}T00:00:00`).toLocaleDateString('en-IN', { month: 'long' }) : '';
  const trendHasSales = (data?.trend ?? []).some((p) => Number(p.gross_sales) > 0);

  return (
    <>
      {isError && <div className="notice"><b>Could not load your school's numbers</b><p>Check your connection and tap Refresh.</p></div>}
      <div className="stat-grid">
        {!data ? (
          isLoading ? <KpiSkeleton count={2} /> : null
        ) : (
          <>
            <div>
              <span>STUDENTS</span>
              <strong>{num(data.students.total)}</strong>
              <small>
                {data.students.pending
                  ? `${num(data.students.pending)} waiting for approval`
                  : `On the ${data.school.name} roster`}
              </small>
            </div>
            <div>
              <span>ORDERS IN {month.toUpperCase()}</span>
              <strong>{num(data.month.orders)}</strong>
              <small>{money(data.month.gross_sales)} total, {num(data.today.orders)} today</small>
            </div>
          </>
        )}
      </div>
      {data && (
        <div className="teacher-trend">
          <div className="teacher-trend-head">
            <b>School orders, last 30 days</b>
            <LiveStamp updatedAt={dataUpdatedAt} fetching={isFetching} onRefresh={() => refetch()} />
          </div>
          {trendHasSales ? (
            <OrdersStrip data={data.trend} height={140} />
          ) : (
            <p className="chart-empty">No orders in the last 30 days yet.</p>
          )}
        </div>
      )}
      <div className="action-list">
        <Link to="students">
          <div>
            <b>Find a student</b>
            <small>Order on behalf of a student</small>
          </div>
          <span>→</span>
        </Link>
      </div>
    </>
  );
}

function Students() {
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('All');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['students', q],
    queryFn: () => api<any>(`/students/?search=${encodeURIComponent(q)}`),
  });

  const all: any[] = data?.results || (Array.isArray(data) ? data : []);
  const classLabel = (s: any) => `${s.grade_name || s.class_name || ''}${s.section ? ` ${s.section}` : ''}`.trim();
  const classes = ['All', ...Array.from(new Set(all.map(classLabel).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))];
  const list = all.filter((s) => cls === 'All' || classLabel(s) === cls);

  return (
    <>
      <div className="section-row">
        <div>
          <span className="eyebrow">STUDENT ROSTER</span>
          <h2>Students</h2>
        </div>
      </div>
      <div className="search">
        <span>⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or GR number"
        />
      </div>
      {classes.length > 2 && (
        <div className="chips">
          {classes.map((x) => (
            <button
              className={cls === x ? 'chip active' : 'chip'}
              onClick={() => setCls(x)}
              key={x}
            >
              {x}
            </button>
          ))}
        </div>
      )}
      {isError && <div className="notice"><b>Could not load the roster</b><p>Check your connection and try again.</p></div>}
      {isLoading && (
        <div className="student-list" aria-label="Loading students">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height="64px" style={{ marginBottom: 8 }} />)}
        </div>
      )}
      {!isLoading && !isError && list.length === 0 && (
        <div className="notice">
          <b>{q ? 'No student matches that search' : 'No students on the roster yet'}</b>
          <p>{q ? 'Try the GR number or part of the name.' : 'The school admin adds students from the school panel.'}</p>
        </div>
      )}
      <div className="student-list">
        {list.map((s: any) => (
          <Link to={'/teacher/order/' + s.id} className="student-row" key={s.id}>
            <span className="kid-avatar">{s.name ? s.name[0] : 'S'}</span>
            <div>
              <b>{s.name}</b>
              <small>
                {s.gr || s.gr_number} · Grade {s.grade_name || s.class_name || '-'} {s.section ? `(${s.section})` : ''} · {s.gender === 'FEMALE' ? 'Girl' : s.gender === 'MALE' ? 'Boy' : '-'}
              </small>
            </div>
            <span style={{ fontSize: '13px', color: '#275b4c', fontWeight: 600 }}>Order on behalf →</span>
          </Link>
        ))}
      </div>
    </>
  );
}

function TeacherOrder() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<
    'Uniform' | 'School Shoes' | 'Uniform Accessories' | 'Stationery' | 'ID Cards'
  >('Uniform');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Fetch target student details for accurate school, grade, and gender resolution
  const { data: student, isLoading, isError } = useQuery({
    queryKey: ['teacher-student', id],
    queryFn: () => api<any>(`/students/${id}/`),
    enabled: !!id,
  });

  const studentProfile = student
    ? {
        id: student.id,
        school_id: student.school,
        school_name: student.school_name,
        city_id: student.city,
        grade_id: student.grade,
        grade_name: student.grade_name || student.class_name,
        gender: student.gender,
      }
    : null;

  const handleAddItem = (item: { product: Product; variantId: string; customisationData: Record<string, any>; measurement?: Fit }) => {
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

  if (isLoading || isError || !student) {
    return (
      <>
        <Link to="/teacher/students" className="back">← All students</Link>
        {isLoading ? <Skeleton height="76px" /> : (
          <div className="notice"><b>Could not find this student</b><p>Go back to the roster and pick the student again.</p></div>
        )}
      </>
    );
  }

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
        <span
          className="kid-avatar"
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '6%',
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
        <div>
          <span className="eyebrow">ORDERING ON BEHALF OF</span>
          <h2 style={{ margin: '2px 0 4px', fontSize: '18px' }}>{student.name}</h2>
          <small style={{ color: '#55695d' }}>
            GR: {student.gr || student.gr_number || '-'} · Grade {student.grade_name || student.class_name || '-'} · {student.school_name || '-'} · {student.gender ? (student.gender.toUpperCase() === 'MALE' ? 'Boy' : 'Girl') : 'Student'}
          </small>
        </div>
      </div>

      <div className="section-row">
        <div>
          <span className="eyebrow">STORE CATEGORIES</span>
          <h2>Select Essentials</h2>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: '1rem' }}>
        {(['Uniform', 'School Shoes', 'Uniform Accessories', 'Stationery', 'ID Cards'] as const).map((cat) => (
          <button
            key={cat}
            className={activeCategory === cat ? 'chip active' : 'chip'}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Reused SelectionFlow with autoSelectStudentProfile landing on Boy/Girl step */}
      <SelectionFlow
        key={student.id}
        category={activeCategory}
        studentProfile={studentProfile}
        autoSelectStudentProfile={true}
        cartItemCount={cartItems.length}
        onClearCart={() => setCartItems([])}
        onOrder={handleAddItem}
        onNavigateCategory={(cat) => setActiveCategory(cat as any)}
      />

      <Cart
        items={cartItems}
        studentId={student.id}
        onClear={() => setCartItems([])}
        onRemoveItem={handleRemoveItem}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        }}
      />
    </>
  );
}
