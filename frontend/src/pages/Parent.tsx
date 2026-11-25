import { useState } from 'react';
import { Check, Truck } from '../components/ui/icons';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from '../App';
import { ListenButton } from '../components/ListenButton';
import { SelectionFlow } from '../components/SelectionFlow';
import { Cart, Timeline, getOrderStatusLabel, type CartItem } from '../components/Store';
import { FitFeedbackPrompt } from '../components/orders/FitFeedbackPrompt';
import { api, deleteChildPhotos, Order, Page, Product } from '../api';
import { OrderCardsSkeleton, Skeleton } from '../components/ui/Skeleton';
import { OrderDetail } from './OrderDetail';
import { useLang } from '../i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStoreState } from '../store/storeState';
import '../components/photoConsent.css';
import type { Fit } from '../data/fit';
import { LIVE_CATEGORIES } from '../data/liveCategories';

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

export default function Parent() {
  return (
    <Shell title="A little easier today.">
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
      </Routes>
    </Shell>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const { selection } = useStoreState();
  const [confirmPhotoDelete, setConfirmPhotoDelete] = useState(false);
  const [photoDeleteState, setPhotoDeleteState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const { data: studentsData, isLoading, isError, refetch } = useQuery({
    queryKey: ['parent-students'],
    queryFn: () => api<{ results: any[] }>('/students/'),
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
      : [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveSelectedId = selectedId ?? (kids[0]?.id ?? null);
  const selected = kids.find((k) => k.id === effectiveSelectedId) || kids[0] || null;

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<'PT Uniform' | 'Uniform' | 'School Shoes' | 'Uniform Accessories' | 'Stationery' | 'ID Cards'>('Uniform');

  if (isLoading) {
    return (
      <div className="parent-loading-skeleton" role="status" aria-label="Loading your dashboard">
        <Skeleton className="parent-welcome-skeleton" height="180px" borderRadius={6} />
        <div className="student-picker">
          <div className="section-row">
            <h2>My children</h2>
          </div>
          <div className="kids-skeleton-grid">
            <Skeleton className="kid-card-skeleton" height="64px" borderRadius={6} />
            <Skeleton className="kid-card-skeleton" height="64px" borderRadius={6} />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="parent-error-state" role="alert">
        <p className="error-title">{t('orders.loadError')}</p>
        <p className="error-subtitle">{t('common.checkInternet')}</p>
        <button
          type="button"
          className="primary"
          onClick={() => refetch()}
        >
          {t('orders.retry')}
        </button>
      </div>
    );
  }

  // Zero children and no stored selection: redirect to flow step 1
  if (kids.length === 0 && !selection) {
    return <Navigate to="/flow?step=1" replace />;
  }

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

  const handleRemoveItem = (id: string) => {
    setCartItems((prev) => prev.filter((it) => it.id !== id));
  };

  const rawStudent = selected ? studentsData?.results?.find((s: any) => s.id === selected.id) : null;
  const studentProfile = rawStudent
    ? {
        id: rawStudent.id,
        school_id: rawStudent.school,
        school_name: rawStudent.school_name,
        city_id: rawStudent.city,
        grade_id: rawStudent.grade,
        grade_name: rawStudent.grade_name || rawStudent.class_name,
        gender: rawStudent.gender,
      }
    : null;

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
        {kids.length > 0 ? (
          <div className="kids">
            {kids.map((k) => (
              <button
                onClick={() => {
                  setSelectedId(k.id);
                  setCartItems([]);
                  setConfirmPhotoDelete(false);
                  setPhotoDeleteState('idle');
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
        ) : (
          <div className="parent-empty-children">
            <p>{t('parent.noChildren')}</p>
            <small>{t('parent.noChildrenSub')}</small>
          </div>
        )}
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

      {selected?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected.id) && (
        <section className="photo-delete">
          <ListenButton text={t('photo.delete.listen')} />
          <p>{t('photo.delete.listen')}</p>
          {photoDeleteState === 'done' && <p>{t('photo.delete.done')}</p>}
          {photoDeleteState === 'error' && <p className="photo-delete-error">{t('photo.delete.error')}</p>}
          <div className="photo-consent-actions">
            {!confirmPhotoDelete ? (
              <button
                type="button"
                className="photo-consent-btn danger"
                onClick={() => {
                  setConfirmPhotoDelete(true);
                  setPhotoDeleteState('idle');
                }}
              >
                {t('photo.delete.action')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="photo-consent-btn danger"
                  disabled={photoDeleteState === 'working'}
                  onClick={async () => {
                    setPhotoDeleteState('working');
                    try {
                      await deleteChildPhotos(selected.id);
                      setPhotoDeleteState('done');
                      setConfirmPhotoDelete(false);
                    } catch {
                      setPhotoDeleteState('error');
                    }
                  }}
                >
                  {t('photo.delete.confirm')}
                </button>
                <button
                  type="button"
                  className="photo-consent-btn"
                  disabled={photoDeleteState === 'working'}
                  onClick={() => setConfirmPhotoDelete(false)}
                >
                  {t('photo.delete.cancel')}
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* Category Tabs: Step-by-step Selection flow applies to Uniform, Shoes, Accessories */}
      <div className="section-row" style={{ marginTop: '2rem' }}>
        <div>
          <span className="eyebrow">STORE CATEGORIES</span>
          <h2>Shop Essentials</h2>
        </div>
      </div>
      <div className="chips">
        {LIVE_CATEGORIES.map((cat) => (
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
        key={selected?.id || 'none'}
        category={activeCategory}
        studentProfile={studentProfile}
        cartItemCount={cartItems.length}
        onClearCart={() => setCartItems([])}
        onOrder={handleAddItem}
        onNavigateCategory={(cat) => {
          const next = LIVE_CATEGORIES.find((live) => live === cat);
          if (next) setActiveCategory(next);
        }}
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

export function Orders() {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api<Page<Order>>('/orders/'),
    refetchOnWindowFocus: true,
  });
  const orders: Order[] = data?.results || (Array.isArray(data) ? (data as Order[]) : []);

  return (
    <>
      <div className="section-row">
        <div>
          <span className="eyebrow">YOUR PURCHASES</span>
          <h2>My orders</h2>
        </div>
        <Link className="text-button" to="/parent" style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
          Shop again
        </Link>
      </div>

      {isLoading ? (
        <OrderCardsSkeleton count={3} />
      ) : isError ? (
        <div
          className="orders-error-state"
          role="alert"
          style={{
            padding: '32px 20px',
            textAlign: 'center',
            background: 'var(--paper-raised)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-lg, 6px)',
            marginTop: '20px',
          }}
        >
          <p style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '15px', marginBottom: '8px' }}>
            {t('orders.loadError')}
          </p>
          <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '16px' }}>
            {t('common.checkInternet')}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => refetch()}
            style={{ minHeight: '44px', minWidth: '88px', padding: '10px 20px' }}
          >
            {t('orders.retry')}
          </button>
        </div>
      ) : orders.length ? (
        orders.map((o) => (
          <article className="order-card" key={o.id}>
            <div className="section-row">
              <div>
                <Link to={`/parent/orders/${o.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <b>{o.order_number}</b>
                </Link>
                <small>
                  {new Date(o.created_at).toLocaleDateString('en-IN')}
                </small>
              </div>
              <span className="status">{getOrderStatusLabel(o, t)}</span>
            </div>
            <p>
              {o.student_name} · <strong>₹{o.total}</strong>
            </p>
            <Timeline order={o} />
            <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
              <Link
                to={`/parent/orders/${o.id}`}
                className="secondary"
                style={{
                  minHeight: '44px',
                  width: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md, 4px)',
                }}
              >
                {t('orderDetail.viewDetails')} →
              </Link>
            </div>
            <FitFeedbackPrompt
              orderId={o.id}
              orderStatus={o.status}
              orderCreatedAt={o.created_at}
              onFeedbackSubmitted={() => queryClient.invalidateQueries({ queryKey: ['orders'] })}
            />
          </article>
        ))
      ) : (
        <div className="empty">
          <Truck width={40} height={40} strokeWidth={1.5} />
          <h3>No orders yet</h3>
          <p>Your orders and live delivery timeline will appear here.</p>
          <Link className="primary" to="/parent" style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
            Browse catalogue
          </Link>
        </div>
      )}
    </>
  );
}
