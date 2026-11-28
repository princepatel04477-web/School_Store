import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { api, type ParentChild } from '../api';
import { useLang, type MessageKey } from '../i18n';
import { useStoreState } from '../store/storeState';
import { SHOP_LINK, siteConfig } from '../siteConfig';
import { BackButton } from '../components/BackButton';
import { ParentSignInSheet } from '../components/parent/ParentSignInSheet';
import { MeasureFlow } from '../components/fit/MeasureFlow';
import { Reveal, SplitReveal } from '../motion';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  MessageCircle,
  RefreshCw,
  Ruler,
  ShieldCheck,
  ShoppingBag,
} from '../components/ui/icons';
import { useParentOrderDetail, useParentOrders, type ParentOrder } from '../data/orders';
import { useStoreProducts } from '../data/catalog';
import {
  fitKey,
  formatMeasure,
  formatMeasuredOn,
  garmentKind,
  getFit,
  saveMeasurement,
  setFit,
  suggestedSizeIds,
  useLatestMeasurement,
  useSizeFit,
  type Fit,
} from '../data/fit';
import './accountPage.css';

export interface AccountPageProps {
  onOpenBag?: () => void;
  onOpenLanguage?: () => void;
}

const LOCALE_FOR_LANG = { en: 'en-IN', gu: 'gu-IN', hi: 'hi-IN' } as const;

function maskMobile(phone?: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 5) return '';
  return `••••• ${digits.slice(-5)}`;
}

function formatMoney(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return `₹${value}`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

type ProgressStepKey = 'PLACED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED';

/** Maps backend order status to the 4-step bar index (0..3), or -1 for cancelled/returned. */
function stepIndexForStatus(status: string): number {
  const upper = status.toUpperCase();
  if (upper === 'CANCELLED' || upper === 'RETURNED' || upper === 'REFUNDED') return -1;
  if (upper === 'DELIVERED') return 3;
  if (upper === 'DISPATCHED' || upper === 'SHIPPED') return 2;
  if (upper === 'PACKED') return 1;
  return 0; // PLACED, PENDING, CONFIRMED, PROCESSING
}

function eventDateForStep(
  order: ParentOrder,
  stepKey: ProgressStepKey,
  locale: string
): string {
  const events = order.status_events;
  if (!events || events.length === 0) return '';
  const aliases: Record<ProgressStepKey, string[]> = {
    PLACED: ['PLACED', 'PENDING', 'CONFIRMED', 'PROCESSING'],
    PACKED: ['PACKED'],
    DISPATCHED: ['DISPATCHED', 'SHIPPED'],
    DELIVERED: ['DELIVERED'],
  };
  const match = events.find((ev) => aliases[stepKey].includes(ev.status.toUpperCase()));
  return match ? formatDate(match.timestamp, locale) : '';
}

function statusBadgeLabel(status: string, t: ReturnType<typeof useLang>['t']): string {
  const upper = status.toUpperCase();
  if (upper === 'CANCELLED') return t('account.statusCancelled');
  if (upper === 'RETURNED' || upper === 'REFUNDED') return t('account.statusReturned');
  if (upper === 'DELIVERED') return t('account.stepDelivered');
  if (upper === 'DISPATCHED' || upper === 'SHIPPED') return t('account.stepOnTheWay');
  if (upper === 'PACKED') return t('account.stepPacked');
  return t('account.stepPlaced');
}

function OrderCard({
  order,
  expanded,
  onToggle,
  locale,
}: {
  order: ParentOrder;
  expanded: boolean;
  onToggle: () => void;
  locale: string;
}) {
  const { t } = useLang();
  const detailQuery = useParentOrderDetail(expanded ? order.id : null);
  const fullOrder = detailQuery.data ?? order;
  const items = fullOrder.items;

  const itemCount =
    items && items.length > 0
      ? items.reduce((sum, item) => sum + item.quantity, 0)
      : order.item_count;

  const stepIndex = stepIndexForStatus(order.status);
  const isDelivered = stepIndex === 3;
  const isTerminalNegative = stepIndex === -1;
  const deliveryLabel =
    order.fulfillment_type === 'SCHOOL_PICKUP'
      ? t('account.deliverySchool')
      : order.fulfillment_type === 'HOME_DELIVERY'
      ? t('account.deliveryHome')
      : '';

  const metaParts = [
    formatDate(order.created_at, locale),
    itemCount !== undefined
      ? itemCount === 1
        ? t('account.itemsCountOne')
        : t('account.itemsCount', { count: itemCount })
      : null,
    formatMoney(order.total),
    deliveryLabel || null,
  ].filter(Boolean);

  const steps: { key: ProgressStepKey; labelKey: MessageKey }[] = [
    { key: 'PLACED', labelKey: 'account.stepPlaced' },
    { key: 'PACKED', labelKey: 'account.stepPacked' },
    { key: 'DISPATCHED', labelKey: 'account.stepOnTheWay' },
    { key: 'DELIVERED', labelKey: 'account.stepDelivered' },
  ];

  const pillClass = isTerminalNegative
    ? 'acct-status-pill acct-status-pill--muted'
    : isDelivered
    ? 'acct-status-pill'
    : 'acct-status-pill acct-status-pill--active';

  return (
    <article className="acct-order-item">
      <div className="acct-order-top">
        <div>
          <h3 className="acct-order-num">
            {t('account.orderNumber', { number: order.order_number })}
          </h3>
          <p className="acct-order-meta">{metaParts.join(' · ')}</p>
        </div>
        <span className={pillClass}>{statusBadgeLabel(order.status, t)}</span>
      </div>

      {!isTerminalNegative && (
        <div className="acct-progress" role="list" aria-label={statusBadgeLabel(order.status, t)}>
          {steps.map((step, idx) => {
            const isDone = isDelivered || idx < stepIndex;
            const isCurrent = !isDelivered && idx === stepIndex;
            const stepClass = isDone
              ? 'acct-step is-done'
              : isCurrent
              ? 'acct-step is-current'
              : 'acct-step';
            const stepDate = eventDateForStep(fullOrder, step.key, locale);

            return (
              <div key={step.key} className={stepClass} role="listitem">
                <span className="acct-step-bar" aria-hidden="true" />
                <span className="acct-step-label">{t(step.labelKey)}</span>
                {stepDate && <span className="acct-step-date">{stepDate}</span>}
              </div>
            );
          })}
        </div>
      )}

      {order.payment_method === 'COD' && !isDelivered && !isTerminalNegative && (
        <div className="acct-mint-note">
          {t('account.codNote')} {t('co.exchange')}
        </div>
      )}

      <div className="acct-order-actions">
        <button
          type="button"
          className="acct-btn-outline"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? t('account.hideItems') : t('account.seeItems')}
        </button>

        {isDelivered && (
          <Link to="/help?topic=returns" className="acct-btn-outline">
            {t('account.exchangeSize')}
          </Link>
        )}
      </div>

      {expanded && (
        <div className="acct-items-panel">
          {detailQuery.isLoading && !items ? (
            <div className="acct-skeleton acct-skeleton--sm" aria-busy="true" />
          ) : detailQuery.isError && !items ? (
            <div className="acct-error-box">
              <div className="acct-error-row">
                <AlertCircle width={18} height={18} />
                <span>{t('common.checkInternet')}</span>
              </div>
              <button
                type="button"
                className="acct-btn-outline"
                onClick={() => void detailQuery.refetch()}
              >
                {t('common.tryAgain')}
              </button>
            </div>
          ) : items && items.length > 0 ? (
            <ul className="acct-items-list">
              {items.map((item) => (
                <li key={item.id} className="acct-items-row">
                  <div>
                    <span className="acct-items-name">{item.product_name}</span>
                    {item.variant_size && (
                      <span className="acct-items-sub">
                        {t('account.sizeLabel', { size: item.variant_size })}
                      </span>
                    )}
                    <span className="acct-items-sub">× {item.quantity}</span>
                  </div>
                  <span className="acct-items-price">
                    {formatMoney(Number(item.unit_price_snapshot) * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function AccountPage({ onOpenBag, onOpenLanguage }: AccountPageProps) {
  const { user, loading: authLoading, clearSession } = useAuth();
  const { lang, t } = useLang();
  const { totalCount, selection, setSelection } = useStoreState();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [signInOpen, setSignInOpen] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const freshLoginRef = useRef(false);

  useEffect(() => {
    try {
      if (
        sessionStorage.getItem('fresh_login') === '1' ||
        sessionStorage.getItem('schoolstore_fresh_login') === '1'
      ) {
        freshLoginRef.current = true;
        sessionStorage.removeItem('fresh_login');
        sessionStorage.removeItem('schoolstore_fresh_login');
      }
    } catch {
      freshLoginRef.current = false;
    }
  }, []);

  const locale = LOCALE_FOR_LANG[lang];
  const isSignedIn = Boolean(user);
  const fromPath = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    if (!authLoading && !user) {
      setSignInOpen(true);
    }
  }, [authLoading, user]);

  const ordersQuery = useParentOrders(isSignedIn);

  // Saved sizes: check linked student's latest measurement on the server first,
  // or fall back to any active session measurement in fit.ts.
  const studentsQuery = useQuery({
    queryKey: ['parent-students'],
    queryFn: () => api<{ results: ParentChild[] }>('/students/'),
    enabled: isSignedIn && user?.role === 'PARENT',
    staleTime: 5 * 60 * 1000,
  });

  const activeChildren = (studentsQuery.data?.results ?? []).filter((c) => c.active);
  const primaryChild = activeChildren[0] ?? null;
  const serverMeasurementQuery = useLatestMeasurement(primaryChild?.id);

  const isNewParent = Boolean(
    isSignedIn &&
      user?.role === 'PARENT' &&
      studentsQuery.isSuccess &&
      activeChildren.length === 0 &&
      !selection?.schoolId
  );

  useEffect(() => {
    if (authLoading || studentsQuery.isLoading) return;
    if (!freshLoginRef.current) return;
    if (isNewParent) {
      freshLoginRef.current = false;
      navigate('/flow?step=1', { replace: true });
    } else if (studentsQuery.isSuccess || studentsQuery.isError) {
      freshLoginRef.current = false;
    }
  }, [authLoading, studentsQuery.isLoading, studentsQuery.isSuccess, studentsQuery.isError, isNewParent, navigate]);

  const sessionFitKey = fitKey(selection?.schoolId, selection?.gradeName, selection?.gender);
  const sessionFitAnswer = getFit(sessionFitKey);
  const sessionFit = sessionFitAnswer && sessionFitAnswer !== 'skipped' ? sessionFitAnswer : null;

  const savedFit: Fit | null = serverMeasurementQuery.data ?? sessionFit;

  const childGender =
    primaryChild?.gender?.toUpperCase() === 'FEMALE'
      ? 'girl'
      : primaryChild?.gender?.toUpperCase() === 'MALE'
      ? 'boy'
      : selection?.gender ?? null;
  const childSchoolId = primaryChild?.school || selection?.schoolId;
  const childClassName = primaryChild?.grade_name || primaryChild?.class_name || selection?.gradeName;

  const productsQuery = useStoreProducts(
    savedFit ? childSchoolId : undefined,
    savedFit ? childClassName : undefined,
    savedFit ? childGender : undefined,
    selection?.cityId
  );

  const garmentProducts = useMemo(() => {
    const list = productsQuery.data ?? [];
    const top = list.find((p) => garmentKind(p.name) === 'top');
    const bottom = list.find((p) => garmentKind(p.name) === 'bottom');
    return { top, bottom, ids: [top?.id, bottom?.id].filter(Boolean) as string[] };
  }, [productsQuery.data]);

  const sizeFitQuery = useSizeFit(
    garmentProducts.ids,
    savedFit,
    childClassName,
    Boolean(savedFit && garmentProducts.ids.length > 0)
  );

  const suggestedShirt = useMemo(() => {
    const p = garmentProducts.top;
    if (!p || !sizeFitQuery.data) return '';
    const { primary } = suggestedSizeIds(p.sizes, sizeFitQuery.data.products[p.id]);
    return p.sizes.find((s) => s.id === primary)?.size ?? '';
  }, [garmentProducts.top, sizeFitQuery.data]);

  const suggestedTrouser = useMemo(() => {
    const p = garmentProducts.bottom;
    if (!p || !sizeFitQuery.data) return '';
    const { primary } = suggestedSizeIds(p.sizes, sizeFitQuery.data.products[p.id]);
    return p.sizes.find((s) => s.id === primary)?.size ?? '';
  }, [garmentProducts.bottom, sizeFitQuery.data]);

  const parentName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  const maskedMobile = maskMobile(user?.phone);
  // Accounts made by OTP get an automatic 'parent_<mobile>' ID and no password
  const ownUserId = user?.username && !user.username.startsWith('parent_') ? user.username : '';
  const langPillLabel = lang === 'gu' ? 'ગુજ' : lang === 'hi' ? 'हिं' : 'EN';

  const handleSignOut = () => {
    clearSession();
    setSelection(null);
    queryClient.clear();
    navigate('/');
  };

  const handleSignInDone = () => {
    setSignInOpen(false);
    if (fromPath && fromPath !== '/account') {
      navigate(fromPath, { replace: true });
    }
  };

  const handleSaveMeasure = async (nextFit: Fit): Promise<boolean> => {
    if (sessionFitKey) {
      setFit(sessionFitKey, nextFit);
    }
    if (primaryChild?.id) {
      try {
        await saveMeasurement(primaryChild.id, nextFit);
        await queryClient.invalidateQueries({ queryKey: ['measurement-latest', primaryChild.id] });
        return true;
      } catch {
        return false;
      }
    }
    return Boolean(sessionFitKey);
  };

  const orders = ordersQuery.data ?? [];
  const measuredDate = savedFit?.measuredAt ? formatMeasuredOn(savedFit.measuredAt, locale) : '';

  return (
    <div className="acct-page" id="main">
      {/* 1. Emerald Band */}
      <section className="acct-hero" aria-label={t('account.ordersTitle')}>
        <div className="acct-circle acct-circle--outer" aria-hidden="true" />
        <div className="acct-circle acct-circle--inner" aria-hidden="true" />

        <nav className="acct-topbar" aria-label={t('account.ordersTitle')}>
          <div className="acct-topbar-left">
            <BackButton className="acct-back-btn" />
            <Link to="/" className="acct-brand" aria-label={`${siteConfig.name} Home`}>
              <span className="acct-logo-sq" aria-hidden="true">
                <span className="acct-logo-letter">{siteConfig.mark}</span>
              </span>
              <span className="acct-brand-text">{siteConfig.logoText}</span>
            </Link>
          </div>

          <div className="acct-topbar-right">
            <Link to={SHOP_LINK} className="acct-nav-link">
              {t('account.shopNav')}
            </Link>
            <Link to="/help" className="acct-nav-link">
              {t('nav.help')}
            </Link>

            <button
              type="button"
              className="acct-lang-pill"
              onClick={onOpenLanguage}
              aria-label={t('nav.language')}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>{langPillLabel}</span>
            </button>

            <button
              type="button"
              className="acct-bag-btn"
              onClick={onOpenBag}
              aria-label={t('nav.bag', { count: totalCount })}
            >
              <ShoppingBag width={22} height={22} strokeWidth={2} />
              {totalCount > 0 && (
                <span className="acct-bag-badge" aria-hidden="true">
                  {totalCount}
                </span>
              )}
            </button>
          </div>
        </nav>

        <div className="acct-hero-inner">
          {isSignedIn && maskedMobile && (
            <div className="acct-signed-pill">
              <Check width={14} height={14} strokeWidth={2.5} />
              <span>
                {t('account.signedIn')} · {maskedMobile}
              </span>
            </div>
          )}

          <SplitReveal as="h1" className="acct-hero-title" immediate>
            {parentName ? (
              <>
                {t('account.namaste')},{' '}
                <span className="acct-hero-name">{parentName}</span>
              </>
            ) : (
              t('account.namaste')
            )}
          </SplitReveal>

          <p className="acct-hero-sub">{t('account.subtitle')}</p>
        </div>
      </section>

      {/* 2. White Sheet (straight top edge) */}
      <main className="acct-sheet">
        <div className="acct-sheet-inner">
          {!authLoading && !isSignedIn ? (
            <Reveal>
              <section className="acct-card acct-signedout-card">
                <h2 className="acct-card-title">{t('account.ordersTitle')}</h2>
                <p className="acct-state-body">{t('account.signInPrompt')}</p>
                <button
                  type="button"
                  className="acct-btn-saffron"
                  onClick={() => setSignInOpen(true)}
                >
                  {t('account.signInBtn')}
                  <ArrowRight width={18} height={18} strokeWidth={2} />
                </button>
              </section>
            </Reveal>
          ) : (
            <div className="acct-grid">
              {/* Left column: My orders */}
              <div className="acct-col-main">
                {isSignedIn && user?.role === 'PARENT' && !selection?.schoolId && (
                  <>
                    {authLoading || studentsQuery.isLoading ? (
                      <div className="acct-skeleton acct-school-skeleton" aria-busy="true" />
                    ) : studentsQuery.isError ? (
                      <div className="acct-error-box" role="alert">
                        <div className="acct-error-row">
                          <AlertCircle width={20} height={20} />
                          <span>{t('common.checkInternet')}</span>
                        </div>
                        <button
                          type="button"
                          className="acct-btn-outline"
                          onClick={() => void studentsQuery.refetch()}
                        >
                          {t('common.tryAgain')}
                        </button>
                      </div>
                    ) : activeChildren.length === 0 ? (
                      <Reveal>
                        <section className="acct-card acct-school-card" aria-labelledby="acct-school-heading">
                          <h2 id="acct-school-heading" className="acct-card-title">
                            {t('account.chooseSchoolTitle')}
                          </h2>
                          <p className="acct-state-body">{t('account.chooseSchoolBody')}</p>
                          <Link to="/flow?step=1" className="acct-btn-saffron">
                            {t('account.chooseSchoolBtn')}
                            <ArrowRight width={18} height={18} strokeWidth={2} />
                          </Link>
                        </section>
                      </Reveal>
                    ) : null}
                  </>
                )}

                <Reveal>
                  <section className="acct-card" aria-labelledby="acct-orders-heading">
                    <div className="acct-card-head">
                      <h2 id="acct-orders-heading" className="acct-card-title">
                        {t('account.ordersTitle')}
                      </h2>
                      {!ordersQuery.isLoading && !ordersQuery.isError && orders.length > 0 && (
                        <span className="acct-card-count">
                          {orders.length === 1
                            ? t('account.ordersCountOne')
                            : t('account.ordersCount', { count: orders.length })}
                        </span>
                      )}
                    </div>

                    {authLoading || ordersQuery.isLoading ? (
                      <div className="acct-orders-list" aria-busy="true">
                        <div className="acct-skeleton" />
                        <div className="acct-skeleton" />
                      </div>
                    ) : ordersQuery.isError ? (
                      <div className="acct-error-box" role="alert">
                        <div className="acct-error-row">
                          <AlertCircle width={20} height={20} />
                          <span>{t('common.checkInternet')}</span>
                        </div>
                        <button
                          type="button"
                          className="acct-btn-outline"
                          onClick={() => void ordersQuery.refetch()}
                        >
                          {t('common.tryAgain')}
                        </button>
                      </div>
                    ) : orders.length === 0 ? (
                      <div className="acct-state-box">
                        <h3 className="acct-state-title">{t('account.noOrders')}</h3>
                        <p className="acct-state-body">{t('account.noOrdersSub')}</p>
                        <Link to={SHOP_LINK} className="acct-btn-saffron">
                          {t('account.shopUniform')}
                          <ArrowRight width={18} height={18} strokeWidth={2} />
                        </Link>
                      </div>
                    ) : (
                      <>
                        <div className="acct-orders-list">
                          {orders.map((order) => (
                            <OrderCard
                              key={order.id}
                              order={order}
                              expanded={expandedOrderId === order.id}
                              onToggle={() =>
                                setExpandedOrderId((prev) => (prev === order.id ? null : order.id))
                              }
                              locale={locale}
                            />
                          ))}
                        </div>

                        <Link to="/parent/orders" className="acct-btn-outline acct-manage-orders">
                          {t('account.manageOrders')}
                        </Link>
                        <Link to={SHOP_LINK} className="acct-btn-saffron">
                          {t('account.shopUniform')}
                          <ArrowRight width={18} height={18} strokeWidth={2} />
                        </Link>
                      </>
                    )}
                  </section>
                </Reveal>
              </div>

              {/* Right column: Saved sizes (only when measurement exists) + Need something? */}
              <div className="acct-col-side">
                {savedFit && (
                  <Reveal delay={0.05}>
                    <section
                      className="acct-card acct-card--warm"
                      aria-labelledby="acct-sizes-heading"
                    >
                      <h2 id="acct-sizes-heading" className="acct-card-title">
                        {t('account.savedSizes')}
                      </h2>
                      {measuredDate && (
                        <p className="acct-sizes-date">
                          {t('size.card.on', { date: measuredDate })}
                        </p>
                      )}

                      <div className="acct-sizes-metrics">
                        <div className="acct-metric">
                          <span className="acct-metric-label">{t('mf.res.height')}</span>
                          <span className="acct-metric-val">
                            {formatMeasure(savedFit.heightCm)} cm
                          </span>
                        </div>

                        <div className="acct-metric">
                          <span className="acct-metric-label">{t('mf.res.weight')}</span>
                          <span className="acct-metric-val">
                            {formatMeasure(savedFit.weightKg)} kg
                          </span>
                        </div>

                        {savedFit.shoulderCm !== undefined && (
                          <div className="acct-metric">
                            <span className="acct-metric-label">{t('mf.res.shoulder')}</span>
                            <span className="acct-metric-val">
                              {formatMeasure(savedFit.shoulderCm)} cm
                            </span>
                          </div>
                        )}

                        {suggestedShirt && (
                          <div className="acct-metric">
                            <span className="acct-metric-label">{t('account.shirt')}</span>
                            <span className="acct-metric-val">{suggestedShirt}</span>
                          </div>
                        )}

                        {suggestedTrouser && (
                          <div className="acct-metric">
                            <span className="acct-metric-label">{t('account.trouser')}</span>
                            <span className="acct-metric-val">{suggestedTrouser}</span>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        className="acct-measure-btn"
                        onClick={() => setMeasureOpen(true)}
                      >
                        {t('size.again')}
                      </button>
                    </section>
                  </Reveal>
                )}

                {user?.role === 'PARENT' && (
                  <Reveal delay={0.02}>
                    <section className="acct-card" aria-labelledby="acct-kids-heading">
                      <h2 id="acct-kids-heading" className="acct-card-title">
                        {t('account.childrenTitle')}
                      </h2>
                      {studentsQuery.isLoading ? (
                        <div className="acct-skeleton acct-skeleton--short" aria-busy="true" />
                      ) : studentsQuery.isError ? (
                        <div className="acct-error-box" role="alert">
                          <div className="acct-error-row">
                            <AlertCircle width={20} height={20} />
                            <span>{t('common.checkInternet')}</span>
                          </div>
                          <button
                            type="button"
                            className="acct-btn-outline"
                            onClick={() => void studentsQuery.refetch()}
                          >
                            {t('common.tryAgain')}
                          </button>
                        </div>
                      ) : activeChildren.length === 0 ? (
                        <p className="acct-state-body">{t('account.noChildren')}</p>
                      ) : (
                        <ul className="acct-kids">
                          {activeChildren.map((child) => (
                            <li key={child.id} className="acct-kid">
                              <strong>{child.name}</strong>
                              <span>
                                {[child.grade_name || child.class_name, child.section].filter(Boolean).join(' ')}
                                {child.school_name ? ` · ${child.school_name}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="acct-card-actions">
                        <button type="button" className="acct-btn-outline" onClick={() => setAddChildOpen(true)}>
                          {t('account.addChild')}
                        </button>
                        <Link to="/parent" className="acct-text-link">
                          {t('account.manageChildren')}
                        </Link>
                      </div>
                    </section>
                  </Reveal>
                )}

                <Reveal delay={0.04}>
                  <section className="acct-card" aria-labelledby="acct-profile-heading">
                    <h2 id="acct-profile-heading" className="acct-card-title">
                      {t('account.profileTitle')}
                    </h2>
                    <dl className="acct-profile">
                      <div>
                        <dt>{t('account.profileName')}</dt>
                        <dd>{parentName || '-'}</dd>
                      </div>
                      <div>
                        <dt>{t('account.profileMobile')}</dt>
                        <dd>{user?.phone ? `+91 ${user.phone.slice(-10, -5)} ${user.phone.slice(-5)}` : '-'}</dd>
                      </div>
                      <div>
                        <dt>{t('account.profileUserId')}</dt>
                        <dd>{ownUserId || '-'}</dd>
                      </div>
                    </dl>
                    <p className="acct-profile-note">
                      {ownUserId ? t('account.signInWithId') : t('account.signInWithOtp')}
                    </p>
                  </section>
                </Reveal>

                <Reveal delay={0.1}>
                  <section className="acct-card" aria-labelledby="acct-help-heading">
                    <h2 id="acct-help-heading" className="acct-card-title">
                      {t('account.needSomething')}
                    </h2>

                    <ul className="acct-help-list">
                      <li className="acct-help-item">
                        <Link to="/help?topic=size-guide" className="acct-help-link">
                          <span className="acct-help-icon" aria-hidden="true">
                            <Ruler width={18} height={18} strokeWidth={1.75} />
                          </span>
                          <span className="acct-help-text">
                            <span className="acct-help-label">{t('product.sizeGuide')}</span>
                          </span>
                          <ChevronRight width={18} height={18} className="acct-help-chevron" />
                        </Link>
                      </li>

                      <li className="acct-help-item">
                        <Link to="/help?topic=returns" className="acct-help-link">
                          <span className="acct-help-icon" aria-hidden="true">
                            <RefreshCw width={18} height={18} strokeWidth={1.75} />
                          </span>
                          <span className="acct-help-text">
                            <span className="acct-help-label">{t('account.exchangeSize')}</span>
                            <span className="acct-help-sub">{t('product.exchange')}</span>
                          </span>
                          <ChevronRight width={18} height={18} className="acct-help-chevron" />
                        </Link>
                      </li>

                      {siteConfig.whatsappHref && (
                        <li className="acct-help-item">
                          <a
                            href={siteConfig.whatsappHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="acct-help-link"
                          >
                            <span className="acct-help-icon" aria-hidden="true">
                              <MessageCircle width={18} height={18} strokeWidth={1.75} />
                            </span>
                            <span className="acct-help-text">
                              <span className="acct-help-label">{t('account.helpWhatsapp')}</span>
                            </span>
                            <ChevronRight width={18} height={18} className="acct-help-chevron" />
                          </a>
                        </li>
                      )}

                      <li className="acct-help-item">
                        <div className="acct-help-link">
                          <span className="acct-help-icon" aria-hidden="true">
                            <ShieldCheck width={18} height={18} strokeWidth={1.75} />
                          </span>
                          <div className="acct-help-text">
                            <span className="acct-help-label">{t('account.legalLinks')}</span>
                            <div className="acct-legal-row">
                              <Link to="/terms" className="acct-legal-link">
                                {t('co.terms')}
                              </Link>
                              <Link to="/refunds" className="acct-legal-link">
                                {t('co.refunds')}
                              </Link>
                              <Link to="/privacy" className="acct-legal-link">
                                {t('co.privacy')}
                              </Link>
                            </div>
                          </div>
                        </div>
                      </li>
                    </ul>

                    {isSignedIn && (
                      <button type="button" className="acct-signout-btn" onClick={handleSignOut}>
                        {t('account.signOut')}
                      </button>
                    )}
                  </section>
                </Reveal>
              </div>
            </div>
          )}
        </div>
      </main>

      <ParentSignInSheet
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        onDone={handleSignInDone}
        schoolName={selection?.schoolName}
        skipChildPicker
      />

      {addChildOpen && (
        <ParentSignInSheet
          open
          onClose={() => setAddChildOpen(false)}
          onDone={() => {
            setAddChildOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['parent-students'] });
          }}
          schoolName={selection?.schoolName}
        />
      )}

      {measureOpen && (
        <MeasureFlow
          initial={savedFit}
          garments={[
            ...(garmentProducts.top ? [{ id: garmentProducts.top.id, name: garmentProducts.top.name }] : []),
            ...(garmentProducts.bottom
              ? [{ id: garmentProducts.bottom.id, name: garmentProducts.bottom.name }]
              : []),
          ]}
          onSave={handleSaveMeasure}
          onClose={() => setMeasureOpen(false)}
        />
      )}
    </div>
  );
}
