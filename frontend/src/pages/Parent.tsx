import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ShoppingBag, User, RefreshCw } from '../components/ui/icons';
import { Skeleton } from '../components/ui/Skeleton';
import { Link, Route, Routes } from 'react-router-dom';
import { Shell } from '../App';
import { ListenButton } from '../components/ListenButton';
import { SelectionFlow } from '../components/SelectionFlow';
import { Cart, Timeline, type CartItem } from '../components/Store';
import { ParentSignInSheet } from '../components/parent/ParentSignInSheet';
import { AfterSalesModal } from '../components/parent/AfterSalesModal';
import { api, deleteChildPhotos, Order, Product, orderApi } from '../api';
import { loadRazorpay, openRazorpayCheckout } from '../services/paymentAdapter';
import { useLang } from '../i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
      </Routes>
    </Shell>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const [confirmPhotoDelete, setConfirmPhotoDelete] = useState(false);
  const [photoDeleteState, setPhotoDeleteState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [showAddChildSheet, setShowAddChildSheet] = useState(false);

  const {
    data: studentsData,
    isLoading: isStudentsLoading,
    isError: isStudentsError,
    refetch: refetchStudents,
  } = useQuery({
    queryKey: ['parent-students'],
    queryFn: () => api<{ results: any[] }>('/students/'),
  });

  const kids: StudentDetail[] = useMemo(() => {
    if (!studentsData?.results) return [];
    return studentsData.results.map((s: any) => ({
      id: String(s.id),
      name: s.name,
      gr_number: s.gr_number || '-',
      grade_name: s.grade_name || s.class_name || '-',
      class_name: s.class_name || '-',
      section: s.section || '-',
      gender: s.gender ? (s.gender === 'MALE' ? 'Male' : s.gender === 'FEMALE' ? 'Female' : s.gender) : '-',
      school_name: s.school_name || '-',
    }));
  }, [studentsData]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (kids.length > 0) {
      if (!selectedId || !kids.some((k) => k.id === selectedId)) {
        setSelectedId(kids[0].id);
      }
    } else {
      setSelectedId(null);
    }
  }, [kids, selectedId]);

  const selected = useMemo(() => {
    if (kids.length === 0) return null;
    return kids.find((k) => k.id === selectedId) || kids[0] || null;
  }, [kids, selectedId]);

  const [cartItems, setCartItems] = useState<CartItem[]>([]);

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

  const rawStudent = selected
    ? studentsData?.results?.find((s: any) => String(s.id) === selected.id)
    : null;
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

  const [activeCategory, setActiveCategory] = useState<'Uniform' | 'School Shoes' | 'Uniform Accessories' | 'Stationery' | 'ID Cards'>('Uniform');

  const welcomeCard = (
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
  );

  return (
    <>
      {/* Distinct State 1: Initial Loading */}
      {isStudentsLoading && !studentsData ? (
        <>
          {welcomeCard}
          <div className="student-picker" role="status" aria-busy="true" aria-label={t('parent.loadingStudents')}>
            <div className="section-row">
              <h2>{t('parent.myChildren')}</h2>
            </div>
            <div className="kids">
              <Skeleton height="70px" borderRadius="var(--radius-md)" />
              <Skeleton height="70px" borderRadius="var(--radius-md)" />
            </div>
          </div>
          <div style={{ marginTop: '1.5rem' }}>
            <Skeleton height="180px" borderRadius="var(--radius-md)" />
          </div>
        </>
      ) : isStudentsError && (!studentsData || !studentsData.results) ? (
        /* Distinct State 2: Initial Load Error / Outage */
        <>
          {welcomeCard}
          <div
            role="alert"
            style={{
              background: 'var(--paper-raised)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: '2.5rem 1.5rem',
              margin: '2rem 0',
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'inline-flex', marginBottom: '0.75rem', color: 'var(--danger)' }}>
              <AlertCircle width={32} height={32} strokeWidth={2} />
            </div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>
              {t('parent.studentsError')}
            </h3>
            <p style={{ margin: '0 0 1.25rem', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
              {t('common.checkInternet')}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void refetchStudents()}
            >
              {t('common.tryAgain')}
            </button>
          </div>
        </>
      ) : kids.length === 0 ? (
        /* Distinct State 3: Genuine Empty Account */
        <>
          {welcomeCard}
          <div
            className="empty"
            style={{ marginTop: '2rem', padding: '2.5rem 1.5rem' }}
          >
            <div style={{ display: 'inline-flex', marginBottom: '0.75rem', color: 'var(--brand)' }}>
              <User width={36} height={36} strokeWidth={1.75} />
            </div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>
              {t('parent.noChildren')}
            </h3>
            <p style={{ maxWidth: '440px', margin: '0 auto 1.5rem', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
              {t('parent.noChildrenLead')}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowAddChildSheet(true)}
              >
                {t('parent.addChild')}
              </button>
              <Link to="/shop" className="btn btn-outline" style={{ display: 'inline-flex', alignItems: 'center' }}>
                {t('parent.browseCatalogue')}
              </Link>
            </div>
            <div
              style={{
                marginTop: '2rem',
                background: 'var(--paper-sunk)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem 1rem',
                textAlign: 'left',
                fontSize: '0.825rem',
                color: 'var(--ink-soft)',
              }}
            >
              {t('parent.contactSchool')}
            </div>
          </div>
        </>
      ) : (
        /* Distinct State 4: Success with Data */
        <>
          {isStudentsError && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                background: 'var(--paper-sunk)',
                border: '1px solid var(--line)',
                borderLeft: '4px solid var(--danger)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem 1rem',
                margin: '1rem 0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <AlertCircle width={18} height={18} strokeWidth={2} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                <span>{t('parent.refreshError')}</span>
              </div>
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                onClick={() => void refetchStudents()}
              >
                {t('common.tryAgain')}
              </button>
            </div>
          )}

          {welcomeCard}

          <div className="student-picker">
            <div className="section-row">
              <h2>{t('parent.myChildren')}</h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setShowAddChildSheet(true)}
              >
                + {t('parent.addChild')}
              </button>
            </div>
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
                ℹ {t('parent.contactSchool')}
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
            key={selected?.id}
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
      )}

      {showAddChildSheet && (
        <ParentSignInSheet
          open={showAddChildSheet}
          initialStep="find"
          onClose={() => setShowAddChildSheet(false)}
          onDone={(child) => {
            setShowAddChildSheet(false);
            if (child) {
              void queryClient.invalidateQueries({ queryKey: ['parent-students'] });
            }
          }}
        />
      )}
    </>
  );
}

function getFulfilmentStatusLabel(status: string, fulfillmentType: string | undefined, t: (k: any) => string): string {
  const isPickup = fulfillmentType === 'SCHOOL_PICKUP';
  switch (status) {
    case 'PLACED':
    case 'PENDING':
      return t('status.placed');
    case 'CONFIRMED':
      return t('status.confirmed');
    case 'PROCESSING':
      return t('status.processing');
    case 'PACKED':
      return t('status.packed');
    case 'DISPATCHED':
    case 'SHIPPED':
      return isPickup ? t('status.readyForPickup') : t('status.dispatched');
    case 'READY_FOR_PICKUP':
      return t('status.readyForPickup');
    case 'DELIVERED':
      return isPickup ? t('status.collected') : t('status.delivered');
    case 'COLLECTED':
      return t('status.collected');
    case 'CANCELLED':
      return t('status.cancelled');
    case 'RETURNED':
      return t('status.returned');
    case 'REFUNDED':
      return t('status.refunded');
    default:
      return status;
  }
}

function getPaymentStatusLabel(order: Order, t: (k: any) => string): string {
  if (order.payment_method === 'COD') {
    if (order.payment_status === 'PAID') return t('payment.paidCash');
    return order.fulfillment_type === 'SCHOOL_PICKUP' ? t('payment.codPickup') : t('payment.cod');
  }
  switch (order.payment_status) {
    case 'PAID':
      return t('payment.paidOnline');
    case 'PENDING':
      return t('payment.pending');
    case 'AUTHORIZED':
      return t('payment.authorized');
    case 'FAILED':
      return t('payment.failed');
    case 'REFUNDED':
      return t('payment.refunded');
    default:
      return order.payment_status;
  }
}

function Orders() {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const [activeModalOrder, setActiveModalOrder] = useState<Order | null>(null);
  const [modalType, setModalType] = useState<'CANCEL' | 'EXCHANGE' | 'RETURN' | 'REPLACE'>('EXCHANGE');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api<any>('/orders/'),
    refetchInterval: (query) => {
      const ords: Order[] = (query.state.data?.results || query.state.data || []) as Order[];
      const hasActive = ords.some((o) =>
        !['DELIVERED', 'COLLECTED', 'CANCELLED', 'RETURNED'].includes(o.status) ||
        o.payment_status === 'PENDING'
      );
      return hasActive ? 30000 : false;
    },
  });
  const orders: Order[] = (data?.results || data || []) as Order[];

  const handlePayNow = async (order: Order) => {
    try {
      const paymentInfo = await orderApi.payment(order.id);
      const loaded = await loadRazorpay();
      if (!loaded) return;
      openRazorpayCheckout({
        key: paymentInfo.key_id,
        order_id: paymentInfo.razorpay_order_id,
        amount: paymentInfo.amount_paise,
        currency: paymentInfo.currency,
        name: 'School Store',
        description: `Order #${paymentInfo.store_order_number || order.order_number}`,
        prefill: paymentInfo.prefill,
        timeout: 840,
        modal: {
          ondismiss: async () => {
            await orderApi.reconcilePayment(order.id).catch(() => {});
            queryClient.invalidateQueries({ queryKey: ['orders'] });
          },
        },
        handler: async (response) => {
          await orderApi.verifyPayment(order.id, {
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        },
      });
    } catch {
      // Payment start failed
    }
  };

  return (
    <>
      <div className="section-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <span className="eyebrow">YOUR PURCHASES</span>
          <h2>{t('parent.myOrders')}</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            disabled={isFetching}
            onClick={() => void refetch()}
            aria-label={t('parent.refreshOrders')}
          >
            <RefreshCw width={14} height={14} strokeWidth={2} className={isFetching ? 'spin' : ''} />
            <span>{isFetching ? t('parent.refreshing') : t('parent.refreshOrders')}</span>
          </button>
          <Link className="text-button" to="/parent">
            {t('parent.shopAgain')}
          </Link>
        </div>
      </div>

      {isLoading && !data ? (
        <div role="status" aria-busy="true" aria-label={t('parent.loadingOrders')} style={{ display: 'grid', gap: '1rem' }}>
          <Skeleton height="140px" borderRadius="var(--radius-md)" />
          <Skeleton height="140px" borderRadius="var(--radius-md)" />
        </div>
      ) : isError && !data ? (
        <div
          role="alert"
          style={{
            background: 'var(--paper-raised)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: '2.5rem 1.5rem',
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'inline-flex', marginBottom: '0.75rem', color: 'var(--danger)' }}>
            <AlertCircle width={32} height={32} strokeWidth={2} />
          </div>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>
            {t('parent.ordersError')}
          </h3>
          <p style={{ margin: '0 0 1.25rem', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            {t('common.checkInternet')}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void refetch()}
          >
            {t('common.tryAgain')}
          </button>
        </div>
      ) : (
        <>
          {isError && data && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                background: 'var(--paper-sunk)',
                border: '1px solid var(--line)',
                borderLeft: '4px solid var(--danger)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <AlertCircle width={18} height={18} strokeWidth={2} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                <span>{t('parent.ordersRefreshError')}</span>
              </div>
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                onClick={() => void refetch()}
              >
                {t('common.tryAgain')}
              </button>
            </div>
          )}

          {orders.length ? (
            orders.map((o) => (
              <article className="order-card" key={o.id}>
                <div className="section-row" style={{ margin: '0 0 12px 0' }}>
                  <div>
                    <b>{o.order_number}</b>
                    <small>
                      {new Date(o.created_at).toLocaleDateString('en-IN')}
                    </small>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span
                      className="status"
                      style={{
                        background:
                          o.payment_status === 'PAID'
                            ? 'var(--brand-tint)'
                            : o.payment_status === 'FAILED'
                            ? 'var(--paper-sunk)'
                            : 'var(--paper-sunk)',
                        color:
                          o.payment_status === 'PAID'
                            ? 'var(--brand-deep)'
                            : o.payment_status === 'FAILED'
                            ? 'var(--danger)'
                            : 'var(--ink)',
                        fontSize: '11px',
                      }}
                    >
                      {getPaymentStatusLabel(o, t)}
                    </span>
                    <span
                      className="status"
                      style={{
                        background:
                          o.status === 'DELIVERED' || o.status === 'COLLECTED'
                            ? 'var(--brand-tint)'
                            : o.status === 'CANCELLED' || o.status === 'RETURNED'
                            ? 'var(--paper-sunk)'
                            : 'var(--paper-sunk)',
                        color:
                          o.status === 'DELIVERED' || o.status === 'COLLECTED'
                            ? 'var(--brand-deep)'
                            : o.status === 'CANCELLED' || o.status === 'RETURNED'
                            ? 'var(--danger)'
                            : 'var(--brand)',
                        fontSize: '11px',
                      }}
                    >
                      {getFulfilmentStatusLabel(o.status, o.fulfillment_type, t)}
                    </span>
                  </div>
                </div>
                <p>
                  {o.student_name} · <strong>₹{o.total}</strong>
                </p>

                {o.after_sales_summary?.has_active_request && (
                  <div
                    style={{
                      margin: 'var(--space-3) 0',
                      padding: 'var(--space-3)',
                      background: 'var(--paper-sunk)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                        {t('aftersales.activeRequest')}: {o.after_sales_summary.active_request_type_display || o.after_sales_summary.active_request_type}
                      </span>
                      <span className="status" style={{ background: 'var(--paper)', fontSize: '11px' }}>
                        {o.after_sales_summary.active_request_status_display || o.after_sales_summary.active_request_status}
                      </span>
                    </div>
                  </div>
                )}

                {o.status === 'CANCELLED' && (
                  <div style={{ margin: 'var(--space-3) 0', padding: 'var(--space-3)', background: 'var(--paper-sunk)', borderRadius: 'var(--radius-sm)' }}>
                    <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>
                      {t('co.orderReleased')}
                    </p>
                    <Link to="/parent" className="btn btn-outline" style={{ marginTop: 'var(--space-2)', display: 'inline-block' }}>
                      {t('co.placeOrderAgain')}
                    </Link>
                  </div>
                )}

                {o.has_in_progress_attempt && o.status !== 'CANCELLED' && (
                  <div style={{ margin: 'var(--space-3) 0', padding: 'var(--space-3)', background: 'var(--paper-sunk)', borderRadius: 'var(--radius-sm)' }}>
                    <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                      {t('co.paymentInProgress')}
                    </p>
                  </div>
                )}

                {/* Parent actions row */}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                  {(o.can_pay_now || o.parent_actions?.pay_now?.permitted) && o.status !== 'CANCELLED' && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handlePayNow(o)}
                    >
                      {t('co.payNow')}
                    </button>
                  )}

                  {o.parent_actions?.cancel?.permitted && !o.after_sales_summary?.has_active_request && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        setActiveModalOrder(o);
                        setModalType('CANCEL');
                        setIsModalOpen(true);
                      }}
                    >
                      {t('aftersales.cancelOrder')}
                    </button>
                  )}

                  {o.parent_actions?.exchange?.permitted && !o.after_sales_summary?.has_active_request && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        setActiveModalOrder(o);
                        setModalType('EXCHANGE');
                        setIsModalOpen(true);
                      }}
                    >
                      {t('aftersales.requestExchange')}
                    </button>
                  )}

                  {o.parent_actions?.return_or_report?.permitted && !o.after_sales_summary?.has_active_request && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        setActiveModalOrder(o);
                        setModalType('RETURN');
                        setIsModalOpen(true);
                      }}
                    >
                      {t('aftersales.reportIssue')}
                    </button>
                  )}
                </div>

                <Timeline order={o} />

                <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid var(--line)', fontSize: '11px', color: 'var(--ink-soft)' }}>
                  {t('parent.contactSchoolNotice')}
                </div>
              </article>
            ))
          ) : (
            <div className="empty">
              <div style={{ display: 'inline-flex', marginBottom: '0.75rem', color: 'var(--brand)' }}>
                <ShoppingBag width={36} height={36} strokeWidth={1.75} />
              </div>
              <h3>{t('parent.noOrders')}</h3>
              <p>{t('parent.noOrdersSub')}</p>
              <Link className="primary" to="/parent">
                {t('parent.browseCatalogue')}
              </Link>
            </div>
          )}
        </>
      )}

      {activeModalOrder && (
        <AfterSalesModal
          order={activeModalOrder}
          initialType={modalType}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setActiveModalOrder(null);
          }}
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ['orders'] });
          }}
        />
      )}
    </>
  );
}
