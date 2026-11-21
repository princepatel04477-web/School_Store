import { useState } from 'react';
import { Check } from '../components/ui/icons';
import { Link, Route, Routes } from 'react-router-dom';
import { Shell } from '../App';
import { useAuth } from '../auth';
import { ListenButton } from '../components/ListenButton';
import { SelectionFlow } from '../components/SelectionFlow';
import { Cart, Timeline, type CartItem } from '../components/Store';
import { FitFeedbackPrompt } from '../components/orders/FitFeedbackPrompt';
import { Skeleton } from '../components/ui/Skeleton';
import { api, deleteChildPhotos, Order, Product, type ParentChild } from '../api';
import { useLang } from '../i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import '../components/photoConsent.css';
import './Parent.css';
import type { Fit } from '../data/fit';

/** The school roster row as the parent sees it, plus the ids the shop needs. */
type Child = ParentChild & { grade?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dash = (value?: string | null) => (value && String(value).trim()) || '-';
/** Grade names already read "Class 6", "LKG"; a bare number gets "Class" in front. */
const classLabel = (name?: string | null) => (name && /^\d+$/.test(name.trim()) ? `Class ${name.trim()}` : dash(name));
const genderLabel =(g?: string | null) => (g === 'MALE' ? 'Male' : g === 'FEMALE' ? 'Female' : dash(g));

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

/** My orders and Sign out, always on the parent's page (the app hides the web header). */
function AccountActions({ showOrders = true }: { showOrders?: boolean }) {
  const { t } = useLang();
  const { signOut } = useAuth();
  return (
    <div className="parent-actions">
      {showOrders && (
        <Link className="btn btn-md btn-outline" to="/parent/orders">
          {t('parent.myOrders')}
        </Link>
      )}
      <button type="button" className="btn btn-md btn-text" onClick={signOut}>
        {t('parent.signOut')}
      </button>
    </div>
  );
}

/** Could not load: say so and offer Try again. Never fill the page with made-up data. */
function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useLang();
  return (
    <div className="parent-panel" role="alert">
      <h3>{t('parent.errorTitle')}</h3>
      <p>{t('parent.loadError')}</p>
      <button type="button" className="btn btn-md btn-primary" onClick={onRetry}>
        {t('parent.retry')}
      </button>
    </div>
  );
}

function ChildrenSkeleton() {
  return (
    <div className="kids" aria-busy="true">
      {[0, 1].map((i) => (
        <div className="kid parent-kid-skeleton" key={i}>
          <Skeleton width={40} height={40} />
          <span className="parent-kid-skeleton-lines">
            <Skeleton width="60%" height="0.9rem" />
            <Skeleton width="80%" height="0.75rem" />
          </span>
        </div>
      ))}
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const [confirmPhotoDelete, setConfirmPhotoDelete] = useState(false);
  const [photoDeleteState, setPhotoDeleteState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const students = useQuery({
    queryKey: ['parent-students'],
    queryFn: () => api<{ results: Child[] }>('/students/'),
  });

  const kids: Child[] = students.data?.results ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = kids.find((k) => k.id === selectedId) ?? kids[0] ?? null;

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

  const studentProfile = selected
    ? {
        id: selected.id,
        school_id: selected.school,
        school_name: selected.school_name,
        city_id: selected.city ?? undefined,
        grade_id: selected.grade ?? undefined,
        grade_name: selected.grade_name || selected.class_name,
        gender: selected.gender,
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

      <AccountActions />

      <div className="student-picker">
        <div className="section-row">
          <h2>{t('parent.myChildren')}</h2>
        </div>
        {students.isPending ? (
          <ChildrenSkeleton />
        ) : students.isError ? (
          <LoadError onRetry={() => void students.refetch()} />
        ) : kids.length === 0 ? (
          <div className="parent-panel">
            <h3>{t('parent.noChildren')}</h3>
            <p>{t('parent.noChildrenHint')}</p>
          </div>
        ) : (
          <div className="kids">
            {kids.map((k) => (
              <button
                type="button"
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
                  <small>
                    {classLabel(k.grade_name || k.class_name)}
                    {k.section ? ` ${k.section}` : ''} · {dash(k.school_name)}
                  </small>
                </span>
                <span className="radio">{selected?.id === k.id ? <Check width={14} height={14} strokeWidth={2.5} /> : null}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <section className="child-profile" aria-label={t('parent.studentProfile')}>
          <div className="child-profile-head">
            <span className="eyebrow">{t('parent.studentProfile')}</span>
            <h3>{selected.name}</h3>
          </div>
          <dl className="child-profile-grid">
            <div>
              <dt>{t('parent.grNumber')}</dt>
              <dd>{dash(selected.gr_number)}</dd>
            </div>
            <div>
              <dt>{t('parent.class')}</dt>
              <dd>{dash(selected.grade_name || selected.class_name)}</dd>
            </div>
            <div>
              <dt>{t('parent.section')}</dt>
              <dd>{dash(selected.section)}</dd>
            </div>
            <div>
              <dt>{t('parent.gender')}</dt>
              <dd>{genderLabel(selected.gender)}</dd>
            </div>
            <div>
              <dt>{t('parent.school')}</dt>
              <dd>{dash(selected.school_name)}</dd>
            </div>
            <div>
              <dt>{t('parent.city')}</dt>
              <dd>{dash(selected.city_name)}</dd>
            </div>
          </dl>
          <p className="child-profile-note">{t('parent.readOnlyNote')}</p>
        </section>
      )}

      {selected && UUID.test(selected.id) && (
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

      {/* Shopping needs a real child: orders are placed for a child on the school roster. */}
      {selected && (
        <>
          <div className="section-row parent-shop-head">
            <div>
              <span className="eyebrow">STORE CATEGORIES</span>
              <h2>Shop Essentials</h2>
            </div>
          </div>
          <div className="chips">
            {(['Uniform', 'School Shoes', 'Uniform Accessories', 'Stationery', 'ID Cards'] as const).map((cat) => (
              <button
                type="button"
                key={cat}
                className={activeCategory === cat ? 'chip active' : 'chip'}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <SelectionFlow
            key={selected.id}
            category={activeCategory}
            studentProfile={studentProfile}
            cartItemCount={cartItems.length}
            onClearCart={() => setCartItems([])}
            onOrder={handleAddItem}
            onNavigateCategory={(cat) => setActiveCategory(cat as any)}
          />

          <Cart
            items={cartItems}
            studentId={selected.id}
            onClear={() => setCartItems([])}
            onRemoveItem={handleRemoveItem}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['orders'] });
            }}
          />
        </>
      )}
    </>
  );
}

function Orders() {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const ordersQuery = useQuery({
    queryKey: ['orders'],
    queryFn: () => api<{ results?: Order[] } | Order[]>('/orders/'),
  });
  const data = ordersQuery.data;
  const orders: Order[] = Array.isArray(data) ? data : data?.results ?? [];

  return (
    <>
      <div className="section-row">
        <div>
          <span className="eyebrow">YOUR PURCHASES</span>
          <h2>{t('parent.myOrders')}</h2>
        </div>
        <Link className="text-button" to="/parent">
          Shop again
        </Link>
      </div>

      {ordersQuery.isPending ? (
        <div aria-busy="true">
          {[0, 1].map((i) => (
            <article className="order-card" key={i}>
              <Skeleton width="40%" height="1rem" />
              <Skeleton width="70%" height="0.8rem" style={{ marginTop: 8 }} />
            </article>
          ))}
        </div>
      ) : ordersQuery.isError ? (
        <LoadError onRetry={() => void ordersQuery.refetch()} />
      ) : orders.length ? (
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
          <h3>No orders yet</h3>
          <p>Your orders and live delivery timeline will appear here.</p>
          <Link className="primary" to="/parent">
            Browse catalogue
          </Link>
        </div>
      )}

      <AccountActions showOrders={false} />
    </>
  );
}
