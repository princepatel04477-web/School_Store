import { useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { Shell } from '../App';
import { SelectionFlow } from '../components/SelectionFlow';
import { Cart, type CartItem } from '../components/Store';
import { api, type Product } from '../api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const demoStudents = [
  { id: '1', name: 'Anaya Patel', gr: 'DPS-1042', gr_number: 'DPS-1042', class_name: '6', grade_name: '6', section: 'A', gender: 'FEMALE', school_name: 'DPS Surat' },
  { id: '2', name: 'Kabir Shah', gr: 'DPS-1077', gr_number: 'DPS-1077', class_name: '6', grade_name: '6', section: 'A', gender: 'MALE', school_name: 'DPS Surat' },
  { id: '3', name: 'Meera Joshi', gr: 'DPS-0880', gr_number: 'DPS-0880', class_name: '4', grade_name: '4', section: 'B', gender: 'FEMALE', school_name: 'DPS Surat' },
];

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
  return (
    <>
      <div className="stat-grid">
        <div>
          <span>STUDENTS</span>
          <strong>248</strong>
          <small>+12 this term</small>
        </div>
        <div>
          <span>ORDERS THIS MONTH</span>
          <strong>86</strong>
          <small>₹42,380 total</small>
        </div>
      </div>
      <div className="action-list">
        <Link to="students">
          <div>
            <b>Find a student</b>
            <small>Order on behalf of a student</small>
          </div>
          <span>→</span>
        </Link>
        <Link to="students?import=1">
          <span className="action-icon yellow">↥</span>
          <div>
            <b>Import student list</b>
            <small>Excel · preview before confirming</small>
          </div>
          <span>→</span>
        </Link>
      </div>
      <div className="notice">
        <b>Tip for a smooth day</b>
        <p>Keep your student list updated before the uniform rush starts.</p>
      </div>
    </>
  );
}

function Students() {
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('All');
  const [show, setShow] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const { data } = useQuery({
    queryKey: ['students', q, cls],
    queryFn: () => api<any>(`/students/?search=${encodeURIComponent(q)}&class=${cls}`).catch(() => demoStudents),
  });

  const list = (data?.results || data || demoStudents).filter(
    (s: any) =>
      (s.name || '').toLowerCase().includes(q.toLowerCase()) &&
      (cls === 'All' || s.class_name === cls || s.grade_name === cls)
  );

  return (
    <>
      <div className="section-row">
        <div>
          <span className="eyebrow">STUDENT ROSTER</span>
          <h2>Students</h2>
        </div>
        <button className="text-button" onClick={() => setShow(!show)}>
          + Add
        </button>
      </div>
      <div className="search">
        <span>⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or GR number"
        />
      </div>
      <div className="chips">
        {['All', '6 A', '4 B'].map((x) => (
          <button
            className={cls === x ? 'chip active' : 'chip'}
            onClick={() => setCls(x)}
            key={x}
          >
            {x}
          </button>
        ))}
      </div>
      {show && (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            setShow(false);
          }}
        >
          <h3>Add a student</h3>
          <input placeholder="Student full name" required />
          <input placeholder="GR number" required />
          <div className="form-row">
            <input placeholder="Class / Grade" required />
            <input placeholder="Section" required />
          </div>
          <button className="primary full">Save student</button>
        </form>
      )}
      <div className="student-list">
        {list.map((s: any) => (
          <Link to={'/teacher/order/' + s.id} className="student-row" key={s.id}>
            <span className="kid-avatar">{s.name ? s.name[0] : 'S'}</span>
            <div>
              <b>{s.name}</b>
              <small>
                {s.gr || s.gr_number} · Grade {s.grade_name || s.class_name || '-'} {s.section ? `(${s.section})` : ''} · {s.gender || 'Unspecified'}
              </small>
            </div>
            <span style={{ fontSize: '13px', color: '#275b4c', fontWeight: 600 }}>Order on behalf →</span>
          </Link>
        ))}
      </div>
      <div className="import-card">
        <div>
          <b>Import from Excel</b>
          <small>
            {confirmed
              ? 'Import queued · job progress will appear here'
              : file
              ? `${file.name} · preview ready`
              : 'Upload, preview and confirm changes'}
          </small>
        </div>
        {!file && !confirmed ? (
          <label className="secondary">
            Choose file
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        ) : file && !confirmed ? (
          <button className="secondary" onClick={() => setConfirmed(true)}>
            Preview & confirm
          </button>
        ) : (
          <span className="status">Queued</span>
        )}
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
  const { data: studentData } = useQuery({
    queryKey: ['teacher-student', id],
    queryFn: async () => {
      if (!id) return null;
      return api<any>(`/students/${id}/`).catch(() => {
        return demoStudents.find((s) => s.id === id) || demoStudents[0];
      });
    },
    enabled: !!id,
  });

  const student = studentData || demoStudents.find((s) => s.id === id) || demoStudents[0];

  const studentProfile = student
    ? {
        school_id: student.school,
        school_name: student.school_name,
        city_id: student.city,
        grade_id: student.grade,
        grade_name: student.grade_name || student.class_name,
        gender: student.gender,
      }
    : null;

  const handleAddItem = (item: { product: Product; variantId: string; customisationData: Record<string, any> }) => {
    setCartItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        product: item.product,
        variantId: item.variantId,
        variantSize: item.product.variants.find((v) => v.id === item.variantId)?.size,
        quantity: 1,
        customisationData: item.customisationData,
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
            GR: {student.gr || student.gr_number || '-'} · Grade {student.grade_name || student.class_name || '-'} · {student.school_name || 'DPS Surat'} · {student.gender ? (student.gender.toUpperCase() === 'MALE' ? 'Boy' : 'Girl') : 'Student'}
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
