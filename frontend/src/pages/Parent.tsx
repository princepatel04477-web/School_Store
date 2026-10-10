import { useState } from 'react';
import { Check } from '../components/ui/icons';
import { Link, Route, Routes } from 'react-router-dom';
import { Shell } from '../App';
import { SelectionFlow } from '../components/SelectionFlow';
import { Cart, Timeline, type CartItem } from '../components/Store';
import { api, Order, Product } from '../api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface StudentDetail {
  id: string;
  name: string;
  gr_number?: string;
  grade_name?: string;
  class_name?: string;
  section?: string;
  gender?: string;
  school_name?: string;
}

const fallbackKids: StudentDetail[] = [
  {
    id: '1',
    name: 'Aarav Patel',
    gr_number: 'GR-1042',
    grade_name: '5',
    class_name: '5',
    section: 'A',
    gender: 'Male',
    school_name: 'DPS Surat',
  },
  {
    id: '2',
    name: 'Diya Patel',
    gr_number: 'GR-1043',
    grade_name: '8',
    class_name: '8',
    section: 'B',
    gender: 'Female',
    school_name: 'DPS Surat',
  },
];

export default function Parent() {
  return (
    <Shell title="A little easier today.">
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
      </Routes>
    </Shell>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const { data: studentsData } = useQuery({
    queryKey: ['parent-students'],
    queryFn: () => api<{ results: any[] }>('/students/').catch(() => null),
  });

  const kids: StudentDetail[] =
    studentsData?.results && studentsData.results.length > 0
      ? studentsData.results.map((s: any) => ({
          id: s.id,
          name: s.name,
          gr_number: s.gr_number || '-',
          grade_name: s.grade_name || s.class_name || '-',
          class_name: s.class_name || '-',
          section: s.section || '-',
          gender: s.gender ? (s.gender === 'MALE' ? 'Male' : s.gender === 'FEMALE' ? 'Female' : s.gender) : '-',
          school_name: s.school_name || '-',
        }))
      : fallbackKids;

  const [selectedId, setSelectedId] = useState<string>(kids[0]?.id || '1');
  const selected = kids.find((k) => k.id === selectedId) || kids[0] || fallbackKids[0];

  const [cartItems, setCartItems] = useState<CartItem[]>([]);

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

  const handleRemoveItem = (id: string) => {
    setCartItems((prev) => prev.filter((it) => it.id !== id));
  };

  const rawStudent = studentsData?.results?.find((s: any) => s.id === selectedId);
  const studentProfile = rawStudent
    ? {
        school_id: rawStudent.school,
        school_name: rawStudent.school_name,
        city_id: rawStudent.city,
        grade_id: rawStudent.grade,
        grade_name: rawStudent.grade_name || rawStudent.class_name,
        gender: rawStudent.gender,
      }
    : null;

  const [activeCategory, setActiveCategory] = useState<'Uniform' | 'School Shoes' | 'Uniform Accessories' | 'Stationery' | 'ID Cards'>('Uniform');

  return (
    <>
      <div className="welcome-card">
        <div>
          <span className="eyebrow">READY WHEN YOU ARE</span>
          <h2>
            School essentials,
            <br />
            <i>sorted.</i>
          </h2>
          <p>Choose a child or standard to find tailored essentials.</p>
        </div>
      </div>

      <div className="student-picker">
        <div className="section-row">
          <h2>My children</h2>
        </div>
        <div className="kids">
          {kids.map((k) => (
            <button
              onClick={() => {
                setSelectedId(k.id);
                setCartItems([]);
              }}
              className={selected?.id === k.id ? 'kid selected' : 'kid'}
              key={k.id}
            >
              <span className="kid-avatar">{k.name[0]}</span>
              <span>
                <b>{k.name}</b>
                <small>{k.grade_name ? `Grade ${k.grade_name}` : `Class ${k.class_name}`} {k.section ? `${k.section} · ` : ' · '}{k.school_name}</small>
              </span>
              <span className="radio">{selected?.id === k.id ? <Check width={14} height={14} strokeWidth={2.5} /> : null}</span>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div
          style={{
            background: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--line, #dfe5dd)',
            borderRadius: '6px',
            padding: '1.25rem',
            margin: '1.5rem 0',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--line, #dfe5dd)',
              paddingBottom: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <div>
              <span
                style={{
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#6b7280',
                  fontWeight: 600,
                }}
              >
                STUDENT PROFILE (VIEW ONLY)
              </span>
              <h3 style={{ margin: '0.25rem 0 0', fontSize: '1.2rem' }}>
                {selected.name}
              </h3>
            </div>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.25rem 0.6rem',
                borderRadius: '6px',
                background: '#f3f4f6',
                color: '#4b5563',
                fontWeight: 500,
              }}
            >
              Read-only
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '1rem',
              marginBottom: '1rem',
            }}
          >
            <div>
              <span style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block' }}>
                GR Number
              </span>
              <strong style={{ fontSize: '0.95rem' }}>{selected.gr_number || '-'}</strong>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block' }}>
                Grade / Class
              </span>
              <strong style={{ fontSize: '0.95rem' }}>
                {selected.grade_name || selected.class_name || '-'}
              </strong>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block' }}>
                Section
              </span>
              <strong style={{ fontSize: '0.95rem' }}>{selected.section || '-'}</strong>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block' }}>
                Gender
              </span>
              <strong style={{ fontSize: '0.95rem' }}>{selected.gender || '-'}</strong>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block' }}>
                School
              </span>
              <strong style={{ fontSize: '0.95rem' }}>{selected.school_name || '-'}</strong>
            </div>
          </div>

          <div
            style={{
              background: '#f8fafc',
              borderLeft: '4px solid #3b82f6',
              padding: '0.6rem 0.85rem',
              borderRadius: '4px',
              fontSize: '0.85rem',
              color: '#334155',
            }}
          >
            ℹ Contact your school to correct this. Only school staff can update student records.
          </div>
        </div>
      )}

      {/* Category Tabs: Step-by-step Selection flow applies to Uniform, Shoes, Accessories */}
      <div className="section-row" style={{ marginTop: '2rem' }}>
        <div>
          <span className="eyebrow">STORE CATEGORIES</span>
          <h2>Shop Essentials</h2>
        </div>
      </div>
      <div className="chips">
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

      <SelectionFlow
        key={selected?.id}
        category={activeCategory}
        studentProfile={studentProfile}
        cartItemCount={cartItems.length}
        onClearCart={() => setCartItems([])}
        onOrder={handleAddItem}
        onNavigateCategory={(cat) => setActiveCategory(cat as any)}
      />

      <Cart
        items={cartItems}
        studentId={selected?.id}
        onClear={() => setCartItems([])}
        onRemoveItem={handleRemoveItem}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        }}
      />
    </>
  );
}

function Orders() {
  const { data } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api<any>('/orders/').catch(() => []),
  });
  const orders: Order[] = (data?.results || data || []) as Order[];

  return (
    <>
      <div className="section-row">
        <div>
          <span className="eyebrow">YOUR PURCHASES</span>
          <h2>My orders</h2>
        </div>
        <Link className="text-button" to="/parent">
          Shop again
        </Link>
      </div>

      {orders.length ? (
        orders.map((o) => (
          <article className="order-card" key={o.id}>
            <div className="section-row">
              <div>
                <b>{o.order_number}</b>
                <small>
                  {new Date(o.created_at).toLocaleDateString('en-IN')}
                </small>
              </div>
              <span className="status">{o.status}</span>
            </div>
            <p>
              {o.student_name} · <strong>₹{o.total}</strong>
            </p>
            <Timeline order={o} />
          </article>
        ))
      ) : (
        <div className="empty">
          <span>⌁</span>
          <h3>No orders yet</h3>
          <p>Your orders and live delivery timeline will appear here.</p>
          <Link className="primary" to="/parent">
            Browse catalogue
          </Link>
        </div>
      )}
    </>
  );
}
