import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import {
  cityAdmin, money, num, relative,
  type CityDailySales, type CityOrderDetail, type CitySchool,
  type StockBalance, type StockMovement,
} from '../api';

/* ------------------------------------------------------------------ *
 * City Admin Navigation & Shell
 * ------------------------------------------------------------------ */
const NAV = [
  { to: '', label: 'Daily Sales', icon: '▤', end: true },
  { to: 'inventory', label: 'Inventory & Stock', icon: '▥' },
  { to: 'orders', label: 'Orders', icon: '▣' },
  { to: 'schools', label: 'Schools', icon: '🏛' },
];

export default function CityAdmin() {
  const { user, signOut } = useAuth();

  return (
    <div className="admin">
      <header className="admin-top">
        <Link to="/city" className="brand">
          <span className="brand-mark">S</span>
          <span>School<span className="ink">Store</span></span>
        </Link>
        <span className="admin-role">City Admin Panel</span>
        <span className="school-tag">{user?.city_name || 'My City'}</span>
        <div className="header-right">
          <span className="avatar">{user?.username?.slice(0, 1).toUpperCase()}</span>
          <button className="icon-btn" onClick={signOut} aria-label="Sign out">↗</button>
        </div>
      </header>
      <div className="admin-body">
        <nav className="admin-nav">
          {NAV.map((n) => (
            <CityNavLink key={n.to} to={n.to} end={n.end}>{n.icon}<span>{n.label}</span></CityNavLink>
          ))}
        </nav>
        <main className="admin-main">
          <Routes>
            <Route index element={<CityDailySalesViewComponent />} />
            <Route path="inventory" element={<CityInventoryView />} />
            <Route path="orders" element={<CityOrdersView />} />
            <Route path="schools" element={<CitySchoolsView />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function CityNavLink({ to, end, children }: { to: string; end?: boolean; children: ReactNode }) {
  const { pathname } = useLocation();
  const base = '/city';
  const current = end ? pathname === base || pathname === `${base}/` : pathname.startsWith(`${base}/${to}`);
  return (
    <Link to={to ? `${base}/${to}` : base} className={current ? 'active' : ''}>
      <i>{children}</i>
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * 1. Daily Sales View (Requirement 2 & 6: indexed by (date, city), no cost/margin)
 * ------------------------------------------------------------------ */
function CityDailySalesViewComponent() {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['city-daily-sales', selectedDate],
    queryFn: () => cityAdmin.dailySales(selectedDate),
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">DAILY ROLLUP · {data?.city?.name ?? 'CITY'}</div>
          <h1>Daily Sales Summary</h1>
          <p className="muted">Read from DailySalesSummary via (date, city) index. Gross sales only.</p>
        </div>
        <div className="range-picker">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px' }}>
            <span>Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </label>
          <button className="secondary" style={{ width: 'auto' }} onClick={() => setSelectedDate(todayStr)}>Today</button>
        </div>
      </div>

      {isLoading && <div className="card pad">Loading daily sales…</div>}
      {error && <div className="card pad error">Failed to load sales: {(error as Error).message}</div>}

      {data && (
        <>
          <div className="stat-grid three">
            <div className="stat accent">
              <span>ORDERS PLACED</span>
              <strong>{num(data.totals.orders)}</strong>
              <small>On {data.date}</small>
            </div>
            <div className="stat">
              <span>UNITS SOLD</span>
              <strong>{num(data.totals.units)}</strong>
              <small>Across all city schools</small>
            </div>
            <div className="stat">
              <span>GROSS SALES REVENUE</span>
              <strong>{money(data.totals.revenue)}</strong>
              <small>Gross revenue (excl. profit/cost)</small>
            </div>
          </div>

          <div className="panel-grid">
            <div className="card">
              <div className="card-head">
                <h2>Category Breakdown</h2>
                <span className="badge s-approved">{data.categories.length} Categories</span>
              </div>
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="r">Orders</th>
                      <th className="r">Units</th>
                      <th className="r">Gross Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.categories.length === 0 ? (
                      <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '24px' }}>No category sales recorded for this date.</td></tr>
                    ) : (
                      data.categories.map((c) => (
                        <tr key={c.category_id}>
                          <td><b>{c.category_name}</b></td>
                          <td className="r mono">{num(c.orders)}</td>
                          <td className="r mono">{num(c.units)}</td>
                          <td className="r mono"><b>{money(c.revenue)}</b></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>School Breakdown</h2>
                <span className="badge s-confirmed">{data.schools.length} Schools</span>
              </div>
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>School</th>
                      <th className="r">Orders</th>
                      <th className="r">Units</th>
                      <th className="r">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.schools.length === 0 ? (
                      <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '24px' }}>No school sales for this date.</td></tr>
                    ) : (
                      data.schools.map((s) => (
                        <tr key={s.school_id}>
                          <td>
                            <b>{s.school_name}</b>
                            <small className="gr">{s.school_code}</small>
                          </td>
                          <td className="r mono">{num(s.orders)}</td>
                          <td className="r mono">{num(s.units)}</td>
                          <td className="r mono"><b>{money(s.revenue)}</b></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Stock and Inventory View (Requirement 1: Products/variants, low stock, stock-in, manual adjustment, movement history)
 * ------------------------------------------------------------------ */
function CityInventoryView() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'ALL' | 'LOW'>('ALL');
  const [selectedVariant, setSelectedVariant] = useState<{ id: string; sku: string; product_name: string } | null>(null);
  const [stockModal, setStockModal] = useState<{ variant: StockBalance; mode: 'STOCK_IN' | 'ADJUST' } | null>(null);

  // Balances query
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch: refetchBalances,
  } = useInfiniteQuery({
    queryKey: ['city-stock-balances', activeTab],
    queryFn: ({ pageParam }) => {
      const p: Record<string, string> = {};
      if (pageParam) {
        const url = new URL(pageParam, window.location.origin);
        for (const [k, v] of url.searchParams.entries()) p[k] = v;
      }
      return activeTab === 'LOW' ? cityAdmin.lowStock(p) : cityAdmin.stockBalances(p);
    },
    getNextPageParam: (last) => relative(last.next),
    initialPageParam: null as string | null,
  });

  const balances = useMemo(() => data?.pages.flatMap((p) => p.results) ?? [], [data]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">INVENTORY CONTROL</div>
          <h1>City Stock &amp; Inventory</h1>
          <p className="muted">Current on-hand stock per variant, stock-in forms, and audit trail.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={activeTab === 'ALL' ? 'primary' : 'secondary'}
            style={{ width: 'auto' }}
            onClick={() => setActiveTab('ALL')}
          >
            All Stock
          </button>
          <button
            className={activeTab === 'LOW' ? 'primary' : 'secondary'}
            style={{ width: 'auto' }}
            onClick={() => setActiveTab('LOW')}
          >
            Low Stock Alerts
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{activeTab === 'LOW' ? 'Low Stock Alerts (Threshold met)' : 'Stock Balances by Variant'}</h2>
          <span className="badge s-approved">{balances.length} variants loaded</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Product &amp; SKU</th>
                <th className="r">Current Stock</th>
                <th className="r">Threshold</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th className="r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {balances.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '32px' }} className="muted">
                    {activeTab === 'LOW' ? 'No variants currently under low stock threshold! 👍' : 'No inventory records found.'}
                  </td>
                </tr>
              ) : (
                balances.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <b>{b.product_name}</b>
                        {b.product_category && (
                          <span className="badge" style={{ fontSize: '10px', background: '#f0f4f1', color: '#275b4c' }}>
                            {b.product_category}
                          </span>
                        )}
                        {b.product_type && (
                          <span className="badge" style={{ fontSize: '10px', background: '#e0ecf8', color: '#1d4ed8' }}>
                            {b.product_type}
                          </span>
                        )}
                      </div>
                      <small className="gr mono">
                        {b.variant_sku}
                        {b.variant_size ? ` · Size: ${b.variant_size}` : ''}
                      </small>
                    </td>
                    <td className="r mono" style={{ fontSize: '15px' }}>
                      <b style={{ color: b.is_low_stock ? '#a34235' : 'inherit' }}>{b.stock_quantity}</b>
                    </td>
                    <td className="r mono">{b.low_stock_threshold}</td>
                    <td>
                      {b.is_low_stock ? (
                        <span className="badge s-failed">Low Stock</span>
                      ) : (
                        <span className="badge s-delivered">In Stock</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: '12px' }}>
                      {new Date(b.updated_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="r actions">
                      <button
                        className="link-button"
                        onClick={() => setStockModal({ variant: b, mode: 'STOCK_IN' })}
                      >
                        + Stock In
                      </button>
                      <button
                        className="link-button"
                        onClick={() => setStockModal({ variant: b, mode: 'ADJUST' })}
                      >
                        Adjust
                      </button>
                      <button
                        className="link-button"
                        onClick={() => setSelectedVariant({ id: b.variant, sku: b.variant_sku, product_name: b.product_name })}
                      >
                        History
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {hasNextPage && (
          <div className="load-more">
            <button
              className="secondary"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? 'Loading more…' : 'Load more variants'}
            </button>
          </div>
        )}
      </div>

      {/* Stock In / Adjust Modal */}
      {stockModal && (
        <StockMovementModal
          balance={stockModal.variant}
          mode={stockModal.mode}
          onClose={() => setStockModal(null)}
          onSuccess={() => {
            setStockModal(null);
            refetchBalances();
            queryClient.invalidateQueries({ queryKey: ['variant-movements'] });
          }}
        />
      )}

      {/* Variant Movement History Drawer / Modal */}
      {selectedVariant && (
        <VariantMovementHistoryModal
          variant={selectedVariant}
          onClose={() => setSelectedVariant(null)}
        />
      )}
    </div>
  );
}

function StockMovementModal({
  balance,
  mode,
  onClose,
  onSuccess,
}: {
  balance: StockBalance;
  mode: 'STOCK_IN' | 'ADJUST';
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [quantity, setQuantity] = useState<number>(mode === 'STOCK_IN' ? 10 : 0);
  const [reason, setReason] = useState<string>(mode === 'STOCK_IN' ? 'RESTOCK' : 'ADJUSTMENT');
  const [customNote, setCustomNote] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: { variant: string; quantity_change: number; reason: string }) =>
      cityAdmin.addStockMovement(body),
    onSuccess: () => onSuccess(),
    onError: (err: any) => setErrorMsg(err.message || 'Failed to update stock.'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (quantity === 0) {
      setErrorMsg('Quantity change cannot be zero.');
      return;
    }
    mutation.mutate({
      variant: balance.variant,
      quantity_change: quantity,
      reason,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>{mode === 'STOCK_IN' ? 'Add Stock (Stock-In)' : 'Manual Stock Adjustment'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="form-card" style={{ padding: '20px' }}>
          <div>
            <b>{balance.product_name}</b>
            <div className="mono muted" style={{ fontSize: '12px' }}>SKU: {balance.variant_sku}</div>
            <div className="mono muted" style={{ fontSize: '12px' }}>Current stock: <b>{balance.stock_quantity}</b></div>
          </div>

          {errorMsg && <div className="error">{errorMsg}</div>}

          <label>
            <span>Quantity Change ({mode === 'STOCK_IN' ? 'Positive number' : 'Positive to add, negative to reduce'}):</span>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
              required
            />
          </label>

          <label>
            <span>Reason:</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {mode === 'STOCK_IN' ? (
                <>
                  <option value="RESTOCK">Restock</option>
                  <option value="INITIAL_STOCK">Initial Stock</option>
                  <option value="RETURN">Customer Return</option>
                </>
              ) : (
                <>
                  <option value="ADJUSTMENT">Manual Adjustment / Audit discrepancy</option>
                  <option value="DAMAGE">Damaged / Write-off</option>
                  <option value="RESTOCK">Restock</option>
                </>
              )}
            </select>
          </label>

          <div className="modal-actions" style={{ marginTop: '16px' }}>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Apply Movement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function VariantMovementHistoryModal({
  variant,
  onClose,
}: {
  variant: { id: string; sku: string; product_name: string };
  onClose: () => void;
}) {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['variant-movements', variant.id],
    queryFn: ({ pageParam }) => {
      const p: Record<string, string> = {};
      if (pageParam) {
        const url = new URL(pageParam, window.location.origin);
        for (const [k, v] of url.searchParams.entries()) p[k] = v;
      }
      return cityAdmin.stockMovements(variant.id, p);
    },
    getNextPageParam: (last) => relative(last.next),
    initialPageParam: null as string | null,
  });

  const movements = useMemo(() => data?.pages.flatMap((p) => p.results) ?? [], [data]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(750px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <div>
            <h2>Stock Movement History</h2>
            <div className="muted" style={{ fontSize: '12px' }}>{variant.product_name} · <span className="mono">{variant.sku}</span></div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="pad-tight" style={{ paddingTop: '12px' }}>
          <p className="muted" style={{ fontSize: '12px', margin: '0 0 12px' }}>
            Served via (variant, created_at) index (idx_invmov_variant_created).
          </p>
          <div className="table-scroll" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th className="r">Change</th>
                  <th>Reason</th>
                  <th>Order Reference</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 && !isLoading ? (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '24px' }}>No movements recorded for this variant.</td></tr>
                ) : (
                  movements.map((m) => (
                    <tr key={m.id}>
                      <td className="mono" style={{ fontSize: '12px' }}>
                        {new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })}
                      </td>
                      <td className="r mono" style={{ fontSize: '14px', fontWeight: 700 }}>
                        <span style={{ color: m.quantity_change > 0 ? '#347052' : '#a34235' }}>
                          {m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}
                        </span>
                      </td>
                      <td>
                        <span className="badge s-processing">{m.reason}</span>
                      </td>
                      <td className="mono" style={{ fontSize: '11px' }}>
                        {m.reference_order ? `Order ${m.reference_order.slice(0, 8)}…` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {hasNextPage && (
            <div className="load-more" style={{ padding: '12px 0' }}>
              <button className="secondary" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
                {isFetchingNextPage ? 'Loading more…' : 'Load more history'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 3. Orders View (Requirement 3, 4, 7: Filters, Polling every 30s, Cursor Pagination, Bulk status, Detail view)
 * ------------------------------------------------------------------ */
function CityOrdersView() {
  const queryClient = useQueryClient();
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Selected orders for bulk action
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkStatusModal, setBulkStatusModal] = useState<boolean>(false);
  const [activeOrderDetailId, setActiveOrderDetailId] = useState<string | null>(null);

  // Schools list for filter dropdown
  const { data: schoolsData } = useQuery({
    queryKey: ['city-schools-list'],
    queryFn: () => cityAdmin.schools(),
  });
  const schools = schoolsData?.results ?? [];

  // Track latest update timestamp for 30s polling
  const lastUpdatedRef = useRef<string>(new Date().toISOString());

  // Cursor paginated orders
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['city-orders', selectedSchool, selectedStatus, dateFrom, dateTo],
    queryFn: ({ pageParam }) => {
      const p: Record<string, string> = {};
      if (pageParam) {
        const url = new URL(pageParam, window.location.origin);
        for (const [k, v] of url.searchParams.entries()) p[k] = v;
      }
      if (selectedSchool) p.school = selectedSchool;
      if (selectedStatus) p.status = selectedStatus;
      if (dateFrom) p.date_from = dateFrom;
      if (dateTo) p.date_to = dateTo;
      return cityAdmin.orders(p);
    },
    getNextPageParam: (last) => relative(last.next),
    initialPageParam: null as string | null,
  });

  const orders = useMemo(() => data?.pages.flatMap((p) => p.results) ?? [], [data]);

  // Requirement 7: Poll every 30s with updated_since timestamp to fetch only changed rows
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const changed = await cityAdmin.orders({ updated_since: lastUpdatedRef.current });
        lastUpdatedRef.current = new Date().toISOString();
        if (changed.results && changed.results.length > 0) {
          // Changed rows found: invalidate and refresh order list query
          queryClient.invalidateQueries({ queryKey: ['city-orders'] });
        }
      } catch (e) {
        // Silent poll error handling
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [queryClient]);

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    if (selectedOrderIds.size === orders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(orders.map((o) => o.id)));
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">ORDERS &amp; FULFILLMENT</div>
          <h1>City Orders Management</h1>
          <p className="muted">Filtered by city's schools, status, date. Auto-refreshes changes every 30 seconds.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {selectedOrderIds.size > 0 && (
            <button
              className="primary"
              style={{ width: 'auto' }}
              onClick={() => setBulkStatusModal(true)}
            >
              Bulk Status Update ({selectedOrderIds.size})
            </button>
          )}
          <button className="secondary" style={{ width: 'auto' }} onClick={() => refetch()}>
            ↻ Refresh
          </button>
        </div>
      </div>

      <div className="card">
        {/* Filters */}
        <div className="filters">
          <label>
            <span>School:</span>
            <select value={selectedSchool} onChange={(e) => setSelectedSchool(e.target.value)}>
              <option value="">All Schools in City</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </label>

          <label>
            <span>Status:</span>
            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="PLACED">Placed</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="PROCESSING">Processing</option>
              <option value="PACKED">Packed</option>
              <option value="DISPATCHED">Dispatched</option>
              <option value="DELIVERED">Delivered</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="RETURNED">Returned</option>
            </select>
          </label>

          <label>
            <span>From Date:</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>

          <label>
            <span>To Date:</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>

          {(selectedSchool || selectedStatus || dateFrom || dateTo) && (
            <button
              className="link-button"
              style={{ alignSelf: 'center', marginTop: '14px' }}
              onClick={() => {
                setSelectedSchool('');
                setSelectedStatus('');
                setDateFrom('');
                setDateTo('');
              }}
            >
              Clear Filters
            </button>
          )}
        </div>

        {/* Orders Table */}
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: '30px' }}>
                  <input
                    type="checkbox"
                    checked={orders.length > 0 && selectedOrderIds.size === orders.length}
                    onChange={selectAllVisible}
                  />
                </th>
                <th>Order Number</th>
                <th>Student &amp; School</th>
                <th>Date</th>
                <th>Status</th>
                <th>Payment</th>
                <th className="r">Total</th>
                <th className="r">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '32px' }}>
                    No orders match your filter criteria.
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const isChecked = selectedOrderIds.has(o.id);
                  return (
                    <tr key={o.id} style={{ background: isChecked ? '#edf6ef' : 'transparent' }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectOrder(o.id)}
                        />
                      </td>
                      <td>
                        <a
                          className="cell-link mono"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setActiveOrderDetailId(o.id)}
                        >
                          {o.order_number}
                        </a>
                      </td>
                      <td>
                        <b>{o.student_name}</b>
                        <small className="gr">{o.school_name} ({o.school_code})</small>
                      </td>
                      <td className="mono" style={{ fontSize: '12px' }}>
                        {new Date(o.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td>
                        <span className={`badge s-${o.status.toLowerCase()}`}>{o.status}</span>
                      </td>
                      <td>
                        <span className={`badge s-${o.payment_status.toLowerCase()}`}>{o.payment_status}</span>
                      </td>
                      <td className="r mono"><b>{money(o.total)}</b></td>
                      <td className="r actions">
                        <button
                          className="link-button"
                          onClick={() => setActiveOrderDetailId(o.id)}
                        >
                          View Detail →
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {hasNextPage && (
          <div className="load-more">
            <button className="secondary" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {isFetchingNextPage ? 'Loading more…' : 'Load more orders'}
            </button>
          </div>
        )}
      </div>

      {/* Bulk Status Update Modal */}
      {bulkStatusModal && (
        <BulkStatusUpdateModal
          orderIds={Array.from(selectedOrderIds)}
          onClose={() => setBulkStatusModal(false)}
          onSuccess={() => {
            setBulkStatusModal(false);
            setSelectedOrderIds(new Set());
            refetch();
          }}
        />
      )}

      {/* Order Detail Modal */}
      {activeOrderDetailId && (
        <OrderDetailModal
          orderId={activeOrderDetailId}
          onClose={() => setActiveOrderDetailId(null)}
          onUpdated={() => {
            refetch();
          }}
        />
      )}
    </div>
  );
}

function BulkStatusUpdateModal({
  orderIds,
  onClose,
  onSuccess,
}: {
  orderIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [newStatus, setNewStatus] = useState<string>('DISPATCHED');
  const [note, setNote] = useState<string>('Dispatched from city fulfillment center');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => cityAdmin.bulkStatus(orderIds, newStatus, note),
    onSuccess: () => onSuccess(),
    onError: (err: any) => setErrorMsg(err.message || 'Bulk update failed.'),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Bulk Status Update ({orderIds.length} Orders)</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="form-card"
          style={{ padding: '20px' }}
        >
          <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
            Updates {orderIds.length} orders in a single bulk UPDATE query and generates status history events.
          </p>

          {errorMsg && <div className="error">{errorMsg}</div>}

          <label>
            <span>Target Status:</span>
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              <option value="PROCESSING">Processing</option>
              <option value="PACKED">Packed</option>
              <option value="DISPATCHED">Dispatched</option>
              <option value="DELIVERED">Delivered</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>

          <label>
            <span>Status Event Note:</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Courier dispatch docket assigned"
            />
          </label>

          <div className="modal-actions" style={{ marginTop: '16px' }}>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Updating…' : `Update ${orderIds.length} Orders`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrderDetailModal({
  orderId,
  onClose,
  onUpdated,
}: {
  orderId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { data: order, isLoading, refetch } = useQuery({
    queryKey: ['order-detail', orderId],
    queryFn: () => cityAdmin.orderDetail(orderId),
  });

  const nextStatusMap: Record<string, string> = {
    PLACED: 'CONFIRMED',
    CONFIRMED: 'PROCESSING',
    PROCESSING: 'PACKED',
    PACKED: 'DISPATCHED',
    DISPATCHED: 'DELIVERED',
  };

  const advanceMutation = useMutation({
    mutationFn: (nextSt: string) => cityAdmin.updateOrderStatus(orderId, nextSt),
    onSuccess: () => {
      refetch();
      onUpdated();
    },
  });

  if (isLoading || !order) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal pad"><p>Loading order details…</p></div>
      </div>
    );
  }

  const nextStatus = nextStatusMap[order.status];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(720px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <div>
            <h2>Order {order.order_number}</h2>
            <div className="muted" style={{ fontSize: '12px' }}>
              {order.school_name} · Student: {order.student_name} ({order.student_gr})
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="pad-tight" style={{ paddingTop: '16px' }}>
          {/* Header highlights */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className={`badge s-${order.status.toLowerCase()}`}>{order.status}</span>
              <span className={`badge s-${order.payment_status.toLowerCase()}`}>{order.payment_status}</span>
              <span className="mono" style={{ fontSize: '13px' }}>Total: <b>{money(order.total)}</b></span>
            </div>

            {nextStatus && (
              <button
                className="primary"
                style={{ width: 'auto' }}
                disabled={advanceMutation.isPending}
                onClick={() => advanceMutation.mutate(nextStatus)}
              >
                {advanceMutation.isPending ? 'Updating…' : `Mark as ${nextStatus} →`}
              </button>
            )}
          </div>

          {/* Items Table */}
          <h3>Order Items</h3>
          <table className="data" style={{ marginBottom: '20px' }}>
            <thead>
              <tr>
                <th>Product &amp; Size</th>
                <th>SKU</th>
                <th className="r">Quantity</th>
                <th className="r">Unit Price</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => {
                const cdisplay = it.customisation_display || {};
                const hasCustom = Object.keys(cdisplay).length > 0 || (it.customisation_data && Object.keys(it.customisation_data).length > 0);
                return (
                  <tr key={it.id}>
                    <td>
                      <b>{it.product_name}</b>
                      <small className="muted">Size: {it.variant_size || 'Standard'}</small>
                      {hasCustom && (
                        <div style={{ marginTop: '8px', padding: '8px 10px', background: '#f5f9f6', border: '1px solid #d4ded6', borderRadius: '6px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#2a6a4e', display: 'block', marginBottom: '4px' }}>
                            CUSTOMISATION DETAILS
                          </span>
                          {Object.keys(cdisplay).length > 0 ? (
                            Object.entries(cdisplay).map(([key, item]: [string, any]) => (
                              <div key={key} style={{ fontSize: '12px', margin: '4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="muted" style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}:</span>
                                {item.type === 'image' ? (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                    {item.url ? (
                                      <img
                                        src={item.url}
                                        alt="Customisation"
                                        style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #ccc' }}
                                      />
                                    ) : null}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                      {item.full_url && (
                                        <a href={item.full_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: '#2a6a4e', fontWeight: 600 }}>
                                          View Print-Ready (300 DPI) ↗
                                        </a>
                                      )}
                                      <small className="mono muted" style={{ fontSize: '10px' }}>
                                        Key: {item.file_key} ({item.status})
                                      </small>
                                    </div>
                                  </div>
                                ) : (
                                  <b>{String(item.value ?? '')}</b>
                                )}
                              </div>
                            ))
                          ) : (
                            Object.entries(it.customisation_data).map(([k, v]) => (
                              <div key={k} style={{ fontSize: '12px' }}>
                                <span className="muted">{k}:</span> <b>{String(v)}</b>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </td>
                    <td className="mono">{it.variant_sku}</td>
                    <td className="r mono">{it.quantity}</td>
                    <td className="r mono">{money(it.unit_price_snapshot)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Status Timeline */}
          <h3>Status Timeline</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {order.status_events.length === 0 ? (
              <p className="muted" style={{ fontSize: '13px' }}>No events recorded.</p>
            ) : (
              order.status_events.map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    background: '#fafbf8',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                >
                  <span className={`badge s-${ev.status.toLowerCase()}`}>{ev.status}</span>
                  <span style={{ flex: 1 }}>{ev.note || 'Status updated'}</span>
                  <span className="mono muted" style={{ fontSize: '11px' }}>
                    {new Date(ev.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 4. Schools & School Admin Logins (Requirement 5: Add school, create/reset admin login, toggle active)
 * ------------------------------------------------------------------ */
function CitySchoolsView() {
  const queryClient = useQueryClient();
  const [addSchoolModal, setAddSchoolModal] = useState<boolean>(false);
  const [createAdminModal, setCreateAdminModal] = useState<CitySchool | null>(null);
  const [resetPasswordModal, setResetPasswordModal] = useState<{ school: CitySchool } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['city-schools-management'],
    queryFn: () => cityAdmin.schools(),
  });
  const schools = data?.results ?? [];

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      cityAdmin.updateSchool(id, { active }),
    onSuccess: () => refetch(),
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">CITY DIRECTORY</div>
          <h1>City Schools Management</h1>
          <p className="muted">Manage schools in your city, activate/deactivate, and manage School Admin logins.</p>
        </div>
        <button className="primary" style={{ width: 'auto' }} onClick={() => setAddSchoolModal(true)}>
          + Add New School
        </button>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Registered Schools</h2>
          <span className="badge s-approved">{schools.length} Schools</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>School Name &amp; Code</th>
                <th>Status</th>
                <th>Delivery Modes</th>
                <th>Contact</th>
                <th className="r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schools.length === 0 && !isLoading ? (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '32px' }}>No schools found in this city.</td></tr>
              ) : (
                schools.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b>
                      <small className="gr mono">{s.code}</small>
                    </td>
                    <td>
                      {s.active ? (
                        <span className="badge s-delivered">Active</span>
                      ) : (
                        <span className="badge s-cancelled">Inactive</span>
                      )}
                    </td>
                    <td>
                      <small style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {[
                          s.home_delivery_enabled ? 'Home Delivery' : null,
                          s.school_pickup_enabled ? 'School Pickup' : null,
                        ].filter(Boolean).join(' · ')}
                      </small>
                    </td>
                    <td>
                      <div style={{ fontSize: '12px' }}>{s.contact_email || '—'}</div>
                      <small className="muted">{s.contact_phone || '—'}</small>
                    </td>
                    <td className="r actions">
                      <button
                        className="link-button"
                        onClick={() => toggleActiveMutation.mutate({ id: s.id, active: !s.active })}
                      >
                        {s.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        className="link-button"
                        onClick={() => setCreateAdminModal(s)}
                      >
                        Create Admin Login
                      </button>
                      <button
                        className="link-button"
                        onClick={() => setResetPasswordModal({ school: s })}
                      >
                        Reset Admin Password
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {addSchoolModal && (
        <AddSchoolModal
          onClose={() => setAddSchoolModal(false)}
          onSuccess={() => {
            setAddSchoolModal(false);
            refetch();
          }}
        />
      )}

      {createAdminModal && (
        <CreateSchoolAdminModal
          school={createAdminModal}
          onClose={() => setCreateAdminModal(null)}
        />
      )}

      {resetPasswordModal && (
        <ResetSchoolAdminPasswordModal
          school={resetPasswordModal.school}
          onClose={() => setResetPasswordModal(null)}
        />
      )}
    </div>
  );
}

function AddSchoolModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [contactEmail, setContactEmail] = useState<string>('');
  const [contactPhone, setContactPhone] = useState<string>('');
  const [homeDelivery, setHomeDelivery] = useState<boolean>(true);
  const [schoolPickup, setSchoolPickup] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      cityAdmin.addSchool({
        name,
        code,
        address,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        home_delivery_enabled: homeDelivery,
        school_pickup_enabled: schoolPickup,
      }),
    onSuccess: () => onSuccess(),
    onError: (err: any) => setErrorMsg(err.message || 'Failed to add school.'),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Add New School in City</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="form-card"
          style={{ padding: '20px' }}
        >
          {errorMsg && <div className="error">{errorMsg}</div>}

          <label>
            <span>School Name:</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. St. Xavier's High School" />
          </label>

          <label>
            <span>School Code (Unique):</span>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="e.g. XAV-SUR" />
          </label>

          <label>
            <span>Address:</span>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="School campus address" />
          </label>

          <div style={{ display: 'flex', gap: '8px' }}>
            <label style={{ flex: 1 }}>
              <span>Contact Email:</span>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              <span>Contact Phone:</span>
              <input type="text" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '16px', margin: '8px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={homeDelivery} onChange={(e) => setHomeDelivery(e.target.checked)} />
              <span>Home Delivery</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={schoolPickup} onChange={(e) => setSchoolPickup(e.target.checked)} />
              <span>School Pickup</span>
            </label>
          </div>

          <div className="modal-actions" style={{ marginTop: '16px' }}>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Add School'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateSchoolAdminModal({
  school,
  onClose,
}: {
  school: CitySchool;
  onClose: () => void;
}) {
  const [username, setUsername] = useState<string>(`${school.code.toLowerCase().replace(/[^a-z0-9]/g, '')}_admin`);
  const [password, setPassword] = useState<string>('Pass@12345');
  const [email, setEmail] = useState<string>(school.contact_email || '');
  const [phone, setPhone] = useState<string>(school.contact_phone || '');
  const [createdResult, setCreatedResult] = useState<{ username: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      cityAdmin.createSchoolAdmin({
        username,
        password,
        school: school.id,
        email,
        phone,
      }),
    onSuccess: (u) => setCreatedResult({ username: u.username }),
    onError: (err: any) => setErrorMsg(err.message || 'Failed to create School Admin login.'),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Create School Admin Login</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {createdResult ? (
          <div className="pad" style={{ textAlign: 'center' }}>
            <div className="badge s-delivered" style={{ fontSize: '13px', padding: '8px 12px', marginBottom: '12px' }}>
              ✓ Account Created!
            </div>
            <p>School Admin user <b>{createdResult.username}</b> is ready to login.</p>
            <button className="primary" style={{ width: 'auto', marginTop: '12px' }} onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            className="form-card"
            style={{ padding: '20px' }}
          >
            <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
              Creating admin login scoped to <b>{school.name}</b> ({school.code}).
            </p>

            {errorMsg && <div className="error">{errorMsg}</div>}

            <label>
              <span>Username:</span>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>

            <label>
              <span>Initial Password:</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </label>

            <label>
              <span>Email:</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>

            <label>
              <span>Phone:</span>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="primary" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creating…' : 'Create Login'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ResetSchoolAdminPasswordModal({
  school,
  onClose,
}: {
  school: CitySchool;
  onClose: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch school admins for this school
  const { data: usersData, isLoading } = useQuery({
    queryKey: ['school-admins', school.id],
    queryFn: () => cityAdmin.users({ school: school.id, role: 'SCHOOL_ADMIN' }),
  });
  const admins = usersData?.results ?? [];

  useEffect(() => {
    if (!selectedUserId && admins.length > 0) {
      setSelectedUserId(admins[0].id);
    }
  }, [admins, selectedUserId]);

  const mutation = useMutation({
    mutationFn: () => cityAdmin.resetPassword(selectedUserId, newPassword),
    onSuccess: (res) => setSuccessMsg(res.detail || 'Password reset successfully.'),
    onError: (err: any) => setErrorMsg(err.message || 'Failed to reset password.'),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Reset School Admin Password</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErrorMsg(null);
            setSuccessMsg(null);
            mutation.mutate();
          }}
          className="form-card"
          style={{ padding: '20px' }}
        >
          <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
            School: <b>{school.name}</b>
          </p>

          {successMsg && <div className="notice" style={{ background: '#e3f2e6' }}>{successMsg}</div>}
          {errorMsg && <div className="error">{errorMsg}</div>}

          {isLoading ? (
            <p>Loading admins…</p>
          ) : admins.length === 0 ? (
            <div className="empty slim">No School Admin accounts found for this school yet.</div>
          ) : (
            <>
              <label>
                <span>Select School Admin User:</span>
                <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.username} ({a.email || 'No email'})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>New Password:</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Min 6 characters"
                />
              </label>

              <div className="modal-actions" style={{ marginTop: '16px' }}>
                <button type="button" className="secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="primary" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Resetting…' : 'Reset Password'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
