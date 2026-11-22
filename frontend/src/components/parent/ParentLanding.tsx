import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, deleteChildPhotos, parentChildren, type Order, type ParentChild } from '../../api';
import { useStoreSchools } from '../../data/catalog';
import { useStoreState } from '../../store/storeState';
import { useLang } from '../../i18n';
import { mapRosterClassToSeedClass } from './classNormalizer';
import { ParentSignInSheet } from './ParentSignInSheet';
import { Skeleton } from '../ui/Skeleton';
import './ParentLanding.css';

/**
 * Orders whose status is finished or closed. Any other status counts as active/in-progress.
 * Exported constant reused by Prompt 4.
 */
export const INACTIVE_ORDER_STATUSES = ['DELIVERED', 'CANCELLED', 'RETURNED', 'REFUNDED'] as const;

export function ParentLanding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useLang();
  const { setSelection } = useStoreState();
  const { data: schools = [] } = useStoreSchools();

  // 1. Fetch children and orders
  const {
    data: studentsData,
    isLoading: loadingStudents,
    isError: studentsError,
    refetch: refetchStudents,
  } = useQuery({
    queryKey: ['parent-students'],
    queryFn: () => parentChildren.list(),
  });

  const {
    data: ordersData,
    isLoading: loadingOrders,
    isError: ordersError,
    refetch: refetchOrders,
  } = useQuery({
    queryKey: ['parent-orders-first-page'],
    queryFn: () => api<{ results: Order[] }>('/orders/'),
  });

  const children: ParentChild[] = useMemo(
    () => (studentsData?.results ?? []).filter((c) => c.active),
    [studentsData]
  );

  const orders: Order[] = useMemo(() => ordersData?.results ?? [], [ordersData]);

  // Find all active orders (newest first)
  const activeOrders = useMemo(
    () => orders.filter((order) => !INACTIVE_ORDER_STATUSES.some((status) => status === order.status)),
    [orders]
  );

  // 2. Child switcher state (memory only)
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [shopNote, setShopNote] = useState<string | null>(null);

  // Photo delete state
  const [photoDeleteState, setPhotoDeleteState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');

  // Initialize selected child: default to child with active order, else first child
  useEffect(() => {
    if (selectedChildId && children.some((c) => c.id === selectedChildId)) {
      return;
    }
    if (children.length === 0) {
      setSelectedChildId(null);
      return;
    }
    const orderWithChild = activeOrders.find((o) => children.some((c) => c.id === o.student));
    if (orderWithChild && orderWithChild.student) {
      setSelectedChildId(orderWithChild.student);
    } else {
      setSelectedChildId(children[0].id);
    }
  }, [children, activeOrders, selectedChildId]);

  const selectedChild = useMemo(
    () => children.find((c) => c.id === selectedChildId) || children[0] || null,
    [children, selectedChildId]
  );

  // Active order for the selected child (if any), otherwise any active order
  const activeOrderForChild = useMemo(() => {
    if (!selectedChild) return activeOrders[0] || null;
    return activeOrders.find((o) => o.student === selectedChild.id) || null;
  }, [activeOrders, selectedChild]);

  // Loading state
  if (loadingStudents || loadingOrders) {
    return (
      <div className="parent-landing" aria-busy="true">
        <div className="parent-landing-header">
          <Skeleton width="120px" height="14px" />
          <Skeleton width="220px" height="28px" />
        </div>
        <div className="parent-child-chips">
          <Skeleton width="100px" height="36px" borderRadius="var(--radius-lg)" />
          <Skeleton width="100px" height="36px" borderRadius="var(--radius-lg)" />
        </div>
        <div className="parent-card">
          <Skeleton width="60%" height="24px" />
          <Skeleton width="100%" height="80px" />
          <Skeleton width="100%" height="44px" borderRadius="var(--radius-md)" />
        </div>
      </div>
    );
  }

  // Error state with retry button: NEVER render invented children
  if (studentsError || ordersError) {
    return (
      <div className="parent-landing">
        <div className="parent-error-card" role="alert">
          <h2>{t('parent.errorTitle')}</h2>
          <p>{t('err.offline')}</p>
          <button
            type="button"
            className="parent-retry-btn"
            onClick={() => {
              void refetchStudents();
              void refetchOrders();
            }}
          >
            {t('parent.retry')}
          </button>
        </div>
      </div>
    );
  }

  function handleShopForChild(child: ParentChild) {
    setShopNote(null);
    const rawClass = child.grade_name || child.class_name;
    const matchedSeedClass = mapRosterClassToSeedClass(rawClass);
    const activeSchool = schools.find((s) => s.id === child.school);

    if (!activeSchool) {
      setShopNote(t('parent.schoolInactive'));
      navigate('/flow?step=1');
      return;
    }

    if (!matchedSeedClass) {
      setShopNote(t('parent.schoolInactive'));
      navigate(`/flow?school=${activeSchool.id}&step=2`);
      return;
    }

    const gender = child.gender === 'FEMALE' ? 'girl' : child.gender === 'MALE' ? 'boy' : null;

    setSelection({
      schoolId: activeSchool.id,
      schoolName: activeSchool.name,
      schoolCode: activeSchool.code,
      cityName: activeSchool.city,
      cityId: child.city || undefined,
      branchId: child.branch || undefined,
      branchName: child.branch_name || undefined,
      gradeId: matchedSeedClass.id,
      gradeName: matchedSeedClass.name,
      gender,
    });

    const genderQuery = gender ? `&gender=${gender}` : '';
    navigate(`/flow?school=${activeSchool.id}&class=${matchedSeedClass.id}${genderQuery}&step=3`);
  }

  async function handleDeletePhotos(childId: string) {
    setPhotoDeleteState('working');
    try {
      await deleteChildPhotos(childId);
      setPhotoDeleteState('done');
    } catch {
      setPhotoDeleteState('error');
    }
  }

  return (
    <div className="parent-landing">
      <div className="parent-landing-header">
        <span className="eyebrow">PARENT ACCOUNT</span>
        <h1>{selectedChild ? selectedChild.name : t('nav.myAccount')}</h1>
      </div>

      {/* Child switcher row when there are 2 or more children */}
      {children.length >= 2 && (
        <div className="parent-child-chips" role="tablist" aria-label="Children">
          {children.map((k) => {
            const isSelected = selectedChild?.id === k.id;
            return (
              <button
                key={k.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-pressed={isSelected}
                className={`parent-child-chip ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  setSelectedChildId(k.id);
                  setPhotoDeleteState('idle');
                  setShopNote(null);
                }}
              >
                {k.name}
              </button>
            );
          })}
        </div>
      )}

      {/* 1. Lead with active order if in progress */}
      {activeOrderForChild && (
        <div className="parent-card active-order-card">
          <div className="parent-card-header">
            <h2>{t('parent.activeOrder')}</h2>
            <span className="parent-badge badge-info">
              {t('parent.orderNumber', { number: activeOrderForChild.order_number })}
            </span>
          </div>

          <div className="active-order-details">
            <div className="order-detail-col">
              <span className="label">{t('parent.fulfilment')}</span>
              <span className="value">{activeOrderForChild.status}</span>
            </div>
            <div className="order-detail-col">
              <span className="label">{t('parent.payment')}</span>
              <span className="value">{activeOrderForChild.payment_status}</span>
            </div>
          </div>

          <Link to={'/parent/orders#order-' + activeOrderForChild.id} className="active-order-link">
            {t('parent.viewOrder')}
          </Link>
        </div>
      )}

      {/* 2. Shop for child CTA (if child linked) */}
      {selectedChild && (
        <div className="parent-card">
          <div className="parent-card-header">
            <h2>{selectedChild.school_name || t('parent.school')}</h2>
            {selectedChild.branch_name && (
              <span className="parent-badge">{selectedChild.branch_name}</span>
            )}
          </div>

          <button
            type="button"
            className="parent-shop-btn"
            onClick={() => handleShopForChild(selectedChild)}
          >
            {t('parent.shopFor', { name: selectedChild.name })}
          </button>
          {shopNote && <p className="parent-shop-note">{shopNote}</p>}
        </div>
      )}

      {/* 3. Empty state: no children linked */}
      {children.length === 0 && (
        <div className="parent-empty-card">
          <p>{t('parent.noChildren')}</p>
          <div className="parent-empty-actions">
            <Link to="/flow?step=1" className="parent-shop-btn">
              {t('parent.findSchool')}
            </Link>
            <button
              type="button"
              className="btn-secondary-link"
              onClick={() => setClaimOpen(true)}
            >
              {t('parent.addChild')}
            </button>
          </div>
        </div>
      )}

      {/* 4. Read-only child details & photo consent */}
      {selectedChild && (
        <div className="parent-card">
          <div className="parent-card-header">
            <h2>{t('parent.studentProfile')}</h2>
            <span className="parent-badge">Read-only</span>
          </div>

          <div className="child-details-grid">
            <div className="child-detail-item">
              <span className="label">{t('parent.grNumber')}</span>
              <span className="value">{selectedChild.gr_number || '—'}</span>
            </div>
            <div className="child-detail-item">
              <span className="label">{t('parent.class')}</span>
              <span className="value">{selectedChild.grade_name || selectedChild.class_name || '—'}</span>
            </div>
            <div className="child-detail-item">
              <span className="label">{t('parent.section')}</span>
              <span className="value">{selectedChild.section || '—'}</span>
            </div>
            <div className="child-detail-item">
              <span className="label">{t('parent.gender')}</span>
              <span className="value">
                {selectedChild.gender === 'MALE'
                  ? 'Boy'
                  : selectedChild.gender === 'FEMALE'
                  ? 'Girl'
                  : selectedChild.gender || '—'}
              </span>
            </div>
            <div className="child-detail-item">
              <span className="label">{t('parent.school')}</span>
              <span className="value">{selectedChild.school_name || '—'}</span>
            </div>
            {selectedChild.branch_name && (
              <div className="child-detail-item">
                <span className="label">{t('parent.branch')}</span>
                <span className="value">{selectedChild.branch_name}</span>
              </div>
            )}
          </div>

          {/* Photo delete section */}
          <div className="parent-photo-section">
            <h3 className="parent-photo-title">Measurement & ID Photos</h3>
            <p className="parent-photo-lead">
              Photos uploaded for sizing or ID cards are stored securely. You can delete stored photos at any time.
            </p>
            {photoDeleteState === 'done' ? (
              <p className="parent-badge badge-success">Photos deleted successfully.</p>
            ) : photoDeleteState === 'error' ? (
              <p className="parent-badge" style={{ color: 'var(--danger)' }}>
                Could not delete photos. Please try again.
              </p>
            ) : (
              <button
                type="button"
                className="parent-photo-delete-btn"
                disabled={photoDeleteState === 'working'}
                onClick={() => handleDeletePhotos(selectedChild.id)}
              >
                {photoDeleteState === 'working' ? 'Deleting…' : 'Delete stored photos'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Claim modal if opened */}
      {claimOpen && (
        <ParentSignInSheet
          open={claimOpen}
          mode="order"
          onClose={() => setClaimOpen(false)}
          onDone={(child) => {
            setClaimOpen(false);
            if (child) {
              void queryClient.invalidateQueries({ queryKey: ['parent-students'] });
              setSelectedChildId(child.id);
            }
          }}
        />
      )}
    </div>
  );
}
