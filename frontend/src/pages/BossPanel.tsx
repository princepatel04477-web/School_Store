import { useMemo, useState } from 'react';
import { X, Overview, BarChart as BarChartIcon, Users, SchoolBuilding, Eye, Ruler, ShoppingBag, ShieldCheck, Package } from '../components/ui/icons';
import { PanelShell, type PanelNavItem } from '../components/admin/PanelShell';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bossPanel, cityAdmin, money, num, type CitySchool, type User } from '../api';
import {
  CHART_COLORS, ChartLegend, ChartSkeleton, Delta, KpiSkeleton, KpiTile, LIVE, ListSkeleton,
  LiveStamp, OrdersStrip, RankList, TrendChart,
} from '../components/admin/charts';
import { SizeChartImportCard } from '../components/admin/SizeChartImportCard';
import { SizeChartManager } from '../components/admin/SizeChartManager';
import { RetailersManager } from '../components/admin/retail/RetailersManager';
import { SchoolRequestsReview } from '../components/admin/retail/SchoolRequestsReview';

const NAV: PanelNavItem[] = [
  { to: '', label: 'Overview', icon: Overview, end: true },
  { to: 'analytics', label: 'Rankings', icon: BarChartIcon },
  { to: 'management', label: 'Staff & Cities', icon: Users },
  { to: 'schools', label: 'School Commissions', icon: SchoolBuilding },
  { to: 'view-as', label: 'View As (Audit)', icon: Eye },
  { to: 'size-charts', label: 'Size Charts', icon: Ruler },
  { to: 'school-requests', label: 'School Requests', icon: ShieldCheck },
  { to: 'retailers', label: 'Retailers', icon: ShoppingBag },
  { to: '/portal', label: 'Uniform Portal', icon: Package },
];

/** Each shop category keeps its own colour, whatever order the data comes in. */
const CATEGORY_ORDER = ['Uniform', 'School Shoes', 'Uniform Accessories', 'Stationery', 'ID Cards'];
const categoryColor = (name: string) => {
  const slot = CATEGORY_ORDER.indexOf(name);
  return CHART_COLORS[slot >= 0 ? slot : CHART_COLORS.length - 1];
};
const shareText = (part: number, total: number) => {
  if (!total || !part) return '0%';
  const pct = (part / total) * 100;
  return pct < 1 ? 'under 1%' : `${Math.round(pct)}%`;
};
const REVENUE = CHART_COLORS[0];
const PROFIT = CHART_COLORS[1];

export default function BossPanel() {
  return (
    <PanelShell base="/boss" role="Owner / Boss Executive" context="Global Business View" nav={NAV}>
      <Routes>
        <Route index element={<BossOverviewView />} />
        <Route path="analytics" element={<BossAnalyticsChartsView />} />
        <Route path="management" element={<BossStaffManagementView />} />
        <Route path="schools" element={<BossSchoolsCommissionView />} />
        <Route path="view-as" element={<BossViewAsView />} />
        <Route path="size-charts" element={<BossSizeChartsView />} />
        <Route path="school-requests" element={<SchoolRequestsReview />} />
        <Route path="retailers" element={<RetailersManager />} />
      </Routes>
    </PanelShell>
  );
}


/* ------------------------------------------------------------------ *
 * Filters shared by both Boss dashboards
 * ------------------------------------------------------------------ */
const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']] as const;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBack = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return isoDay(d);
};
const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000) + 1;

function useBossFilterState() {
  const { data: filterOpts } = useQuery({
    queryKey: ['boss', 'filter-options'],
    queryFn: () => bossPanel.filters(),
    staleTime: 5 * 60_000,
  });

  const [range, setRange] = useState<string>('30');
  const [dateFrom, setDateFrom] = useState<string>(() => daysBack(30));
  const [dateTo, setDateTo] = useState<string>(() => isoDay(new Date()));
  const [cityId, setCityId] = useState<string>('');
  const [schoolId, setSchoolId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');

  const pickRange = (days: string) => {
    setRange(days);
    setDateFrom(daysBack(Number(days)));
    setDateTo(isoDay(new Date()));
  };

  const queryParams = useMemo(() => {
    const p: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
    if (cityId) p.city = cityId;
    if (schoolId) p.school = schoolId;
    if (categoryId) p.category = categoryId;
    return p;
  }, [dateFrom, dateTo, cityId, schoolId, categoryId]);

  return {
    filterOpts,
    range, pickRange, setRange,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    cityId, setCityId,
    schoolId, setSchoolId,
    categoryId, setCategoryId,
    queryParams,
    days: spanDays(dateFrom, dateTo),
  };
}

function BossFilterBar({ state }: { state: ReturnType<typeof useBossFilterState> }) {
  const {
    filterOpts, range, pickRange, setRange,
    dateFrom, setDateFrom, dateTo, setDateTo,
    cityId, setCityId, schoolId, setSchoolId, categoryId, setCategoryId,
  } = state;

  const filteredSchools = useMemo(() => {
    if (!filterOpts) return [];
    if (!cityId) return filterOpts.schools;
    return filterOpts.schools.filter((s) => s.city_id === cityId);
  }, [filterOpts, cityId]);
  const activeCount = [cityId, schoolId, categoryId, range ? '' : 'dates'].filter(Boolean).length;

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="pad" style={{ paddingBottom: 'var(--space-3)' }}>
        <div className="dash-range" role="group" aria-label="Date range">
          {RANGES.map(([v, l]) => (
            <button key={v} type="button" className={range === v ? 'chip active' : 'chip'} onClick={() => pickRange(v)}>{l}</button>
          ))}
        </div>
      </div>
      <details className="dash-more">
        <summary>
          More filters{activeCount ? ` (${activeCount} on)` : ''}
          <small>City, school, category, exact dates</small>
        </summary>
      <div className="filters" style={{ borderBottom: 0 }}>
        <label>
          <span>City</span>
          <select value={cityId} onChange={(e) => { setCityId(e.target.value); setSchoolId(''); }}>
            <option value="">All cities</option>
            {filterOpts?.cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
        </label>
        <label>
          <span>School</span>
          <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            <option value="">All schools</option>
            {filteredSchools.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </label>
        <label>
          <span>Category</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {filterOpts?.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>From</span>
          <input type="date" value={dateFrom} max={dateTo} onChange={(e) => { setDateFrom(e.target.value); setRange(''); }} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={dateTo} min={dateFrom} onChange={(e) => { setDateTo(e.target.value); setRange(''); }} />
        </label>
        {(cityId || schoolId || categoryId) && (
          <button
            type="button"
            className="link-button"
            style={{ alignSelf: 'end', minHeight: 44 }}
            onClick={() => { setCityId(''); setSchoolId(''); setCategoryId(''); }}
          >
            Clear filters
          </button>
        )}
        </div>
      </details>
    </div>
  );
}

/** The live stamp for whichever Boss queries are on screen. */
function BossLive({ updatedAt }: { updatedAt: number }) {
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: ['boss'] }) > 0;
  return (
    <LiveStamp
      updatedAt={updatedAt}
      fetching={fetching}
      onRefresh={() => queryClient.invalidateQueries({ queryKey: ['boss'] })}
    />
  );
}

/* ------------------------------------------------------------------ *
 * 1. Boss overview: headline numbers, the sales trend, where it came from
 * ------------------------------------------------------------------ */
function BossOverviewView() {
  const filterState = useBossFilterState();
  const { queryParams, days } = filterState;

  const kpisQ = useQuery({ queryKey: ['boss', 'kpis', queryParams], queryFn: () => bossPanel.kpis(queryParams), ...LIVE });
  const trendQ = useQuery({ queryKey: ['boss', 'trend', queryParams], queryFn: () => bossPanel.revenueProfit(queryParams), ...LIVE });
  const catQ = useQuery({ queryKey: ['boss', 'categories', queryParams], queryFn: () => bossPanel.categories(queryParams), ...LIVE });
  const cityQ = useQuery({ queryKey: ['boss', 'cities', queryParams], queryFn: () => bossPanel.cities(queryParams), ...LIVE });

  const kpis = kpisQ.data;
  const trend = trendQ.data ?? [];
  const bucket = trend[0]?.bucket ?? 'day';
  const hasSales = trend.some((p) => Number(p.revenue) > 0);
  const catTotal = (catQ.data ?? []).reduce((sum, c) => sum + Number(c.revenue), 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">OWNER DASHBOARD</div>
          <h1>Business overview</h1>
          <p className="muted">Every school and city, from confirmed orders. Cancelled and refunded orders are left out.</p>
        </div>
        <BossLive updatedAt={kpisQ.dataUpdatedAt} />
      </div>

      <BossFilterBar state={filterState} />

      {kpisQ.isError && <div className="card pad error">Could not load the numbers. Tap Refresh to try again.</div>}

      <div className="stat-grid four">
        {!kpis ? <KpiSkeleton count={4} /> : (
          <>
            <KpiTile accent label="Revenue" value={money(kpis.revenue)} hint={<Delta now={kpis.revenue} before={kpis.previous.revenue} days={days} format={money} />} />
            <KpiTile
              label="Gross profit"
              value={money(kpis.gross_profit)}
              hint={<><small>{Number(kpis.revenue) > 0 ? `${kpis.gross_margin_pct}% margin` : 'Margin: -'}</small><Delta now={kpis.gross_profit} before={kpis.previous.gross_profit} days={days} format={money} /></>}
            />
            <KpiTile
              label="Orders"
              value={num(kpis.orders)}
              hint={<><small>{kpis.orders ? `${money(kpis.average_order_value)} average order` : 'Average order: -'}</small><Delta now={kpis.orders} before={kpis.previous.orders} days={days} /></>}
            />
            <KpiTile
              label="Units sold"
              value={num(kpis.units_sold)}
              hint={<><small>Stock on hand {money(kpis.current_stock_value)} at cost</small><Delta now={kpis.units_sold} before={kpis.previous.units} days={days} /></>}
            />
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Revenue and profit</h2>
          {hasSales && <ChartLegend items={[{ name: 'Revenue', color: REVENUE }, { name: 'Profit', color: PROFIT, line: true }]} />}
        </div>
        {trendQ.isLoading ? <ChartSkeleton height={300} /> : !hasSales ? (
          <p className="chart-empty">No sales in these dates yet. The chart fills in as orders come in.</p>
        ) : (
          <>
            <div className="chart-body">
              <TrendChart
                data={trend}
                bucket={bucket}
                height={280}
                series={[
                  { key: 'revenue', name: 'Revenue', color: REVENUE },
                  { key: 'profit', name: 'Profit', color: PROFIT, kind: 'line' },
                ]}
                extra={(p) => <span>Orders<em>{num(Number(p.orders))}</em></span>}
              />
            </div>
            <div className="chart-body">
              <p className="chart-sub">Orders {bucket === 'day' ? 'per day' : bucket === 'week' ? 'per week' : 'per month'}</p>
              <OrdersStrip data={trend} bucket={bucket} />
            </div>
          </>
        )}
      </div>

      <div className="panel-grid">
        <div className="card">
          <div className="card-head"><h2>Sales by category</h2></div>
          {catQ.isLoading ? <ListSkeleton rows={4} /> : (
            <RankList
              empty="No category sales in these dates."
              rows={(catQ.data ?? []).map((c) => ({
                key: c.category_id,
                label: c.name,
                sub: `${num(c.units)} units, ${shareText(Number(c.revenue), catTotal)} of sales`,
                value: Number(c.revenue),
                display: money(c.revenue),
                color: categoryColor(c.name),
              }))}
            />
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>Sales by city</h2></div>
          {cityQ.isLoading ? <ListSkeleton rows={3} /> : (
            <RankList
              empty="No city sales in these dates."
              rows={(cityQ.data ?? []).map((c) => ({
                key: c.city_id,
                label: c.name,
                sub: `${num(c.orders)} orders, ${money(c.profit)} profit`,
                value: Number(c.revenue),
                display: money(c.revenue),
              }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Rankings: top schools, top products, stock on hand
 * ------------------------------------------------------------------ */
function BossAnalyticsChartsView() {
  const filterState = useBossFilterState();
  const { queryParams } = filterState;

  const schoolsQ = useQuery({ queryKey: ['boss', 'top-schools', queryParams], queryFn: () => bossPanel.topSchools(queryParams), ...LIVE });
  const productsQ = useQuery({ queryKey: ['boss', 'top-products', queryParams], queryFn: () => bossPanel.topProducts(queryParams), ...LIVE });
  const stockQ = useQuery({ queryKey: ['boss', 'stock-cats', queryParams], queryFn: () => bossPanel.stockCategories(queryParams), ...LIVE });
  const stock = stockQ.data ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">RANKINGS</div>
          <h1>Top schools, products and stock</h1>
          <p className="muted">Best sellers for the dates you pick. Stock is what is on the shelves right now.</p>
        </div>
        <BossLive updatedAt={schoolsQ.dataUpdatedAt} />
      </div>

      <BossFilterBar state={filterState} />

      <div className="panel-grid">
        <div className="card">
          <div className="card-head"><h2>Top schools by revenue</h2></div>
          {schoolsQ.isLoading ? <ListSkeleton /> : (
            <RankList
              empty="No school sales in these dates."
              rows={(schoolsQ.data ?? []).map((s) => ({
                key: s.school_id,
                label: s.name,
                sub: `${s.code}, ${num(s.orders)} orders`,
                value: Number(s.revenue),
                display: money(s.revenue),
              }))}
            />
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>Top products by units</h2></div>
          {productsQ.isLoading ? <ListSkeleton /> : (
            <RankList
              empty="No products sold in these dates."
              rows={(productsQ.data ?? []).map((p) => ({
                key: p.product_id,
                label: p.name,
                sub: `${p.category}, ${money(p.revenue)}`,
                value: p.units,
                display: `${num(p.units)} units`,
                color: categoryColor(p.category),
              }))}
            />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Stock on hand by category</h2></div>
        {stockQ.isLoading ? <ListSkeleton rows={4} /> : stock.length === 0 ? (
          <p className="chart-empty">No stock recorded yet.</p>
        ) : (
          /* Units and rupees have different scales, so each gets its own list */
          <div className="chart-pair">
            <div className="chart-pair-item" style={{ padding: 0 }}>
              <p className="chart-sub" style={{ margin: '16px 16px 0' }}>Units</p>
              <RankList
                empty=""
                rows={[...stock].sort((a, b) => b.units - a.units).map((c) => ({
                  key: c.category_id, label: c.name, value: c.units, display: num(c.units), color: categoryColor(c.name),
                }))}
              />
            </div>
            <div className="chart-pair-item" style={{ padding: 0 }}>
              <p className="chart-sub" style={{ margin: '16px 16px 0' }}>Value at cost</p>
              <RankList
                empty=""
                rows={[...stock].sort((a, b) => Number(b.stock_value) - Number(a.stock_value)).map((c) => ({
                  key: c.category_id, label: c.name, value: Number(c.stock_value), display: money(c.stock_value), color: categoryColor(c.name),
                }))}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 3. Management (Requirement 8: Create Admins & Assign to City, Manage Cities)
 * ------------------------------------------------------------------ */
function BossStaffManagementView() {
  const queryClient = useQueryClient();
  const [createAdminModal, setCreateAdminModal] = useState<boolean>(false);
  const [createCityModal, setCreateCityModal] = useState<boolean>(false);

  // Load admins
  const { data: adminsData, refetch: refetchAdmins } = useQuery({
    queryKey: ['boss-admins-list'],
    queryFn: () => bossPanel.adminsList(),
  });
  const admins = adminsData?.results ?? [];

  // Load cities
  const { data: citiesData, refetch: refetchCities } = useQuery({
    queryKey: ['boss-cities-list'],
    queryFn: () => bossPanel.citiesList(),
  });
  const cities = citiesData?.results ?? [];

  const toggleCityActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      bossPanel.updateCity(id, { active }),
    onSuccess: () => {
      refetchCities();
      queryClient.invalidateQueries({ queryKey: ['boss-filter-options'] });
    },
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">ADMINISTRATION</div>
          <h1>Staff &amp; City Governance</h1>
          <p className="muted">Create and assign City Admins, add new operational cities, and manage staff access.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="primary" style={{ width: 'auto' }} onClick={() => setCreateAdminModal(true)}>
            + Create City Admin
          </button>
          <button className="secondary" style={{ width: 'auto' }} onClick={() => setCreateCityModal(true)}>
            + Add City
          </button>
        </div>
      </div>

      {/* City Admins Table */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-head">
          <h2>City Admins</h2>
          <span className="badge s-approved">{admins.length} Admins</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Username</th>
                <th>Assigned City</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {admins.length === 0 ? (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '24px' }}>No city admins configured yet.</td></tr>
              ) : (
                admins.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.username}</b>
                      <small className="muted">{[a.first_name, a.last_name].filter(Boolean).join(' ')}</small>
                    </td>
                    <td>
                      <span className="badge s-confirmed">{a.city_name || 'Unassigned'}</span>
                    </td>
                    <td>
                      <div>{a.email || '-'}</div>
                      <small className="muted">{a.phone || '-'}</small>
                    </td>
                    <td>
                      {a.is_active ? <span className="badge s-delivered">Active</span> : <span className="badge s-cancelled">Inactive</span>}
                    </td>
                    <td className="mono" style={{ fontSize: '12px' }}>
                      {a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN') : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cities Directory Table */}
      <div className="card">
        <div className="card-head">
          <h2>Operational Cities</h2>
          <span className="badge s-processing">{cities.length} Cities</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>City Name &amp; Code</th>
                <th>State</th>
                <th>Status</th>
                <th className="r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cities.map((c) => (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                    <small className="gr mono">{c.code}</small>
                  </td>
                  <td>{c.state || '-'}</td>
                  <td>
                    {c.active ? <span className="badge s-delivered">Active</span> : <span className="badge s-cancelled">Inactive</span>}
                  </td>
                  <td className="r actions">
                    <button
                      className="link-button"
                      onClick={() => toggleCityActive.mutate({ id: c.id, active: !c.active })}
                    >
                      {c.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Admin Modal */}
      {createAdminModal && (
        <CreateAdminModal
          cities={cities}
          onClose={() => setCreateAdminModal(false)}
          onSuccess={() => {
            setCreateAdminModal(false);
            refetchAdmins();
          }}
        />
      )}

      {/* Create City Modal */}
      {createCityModal && (
        <CreateCityModal
          onClose={() => setCreateCityModal(false)}
          onSuccess={() => {
            setCreateCityModal(false);
            refetchCities();
          }}
        />
      )}
    </div>
  );
}

function CreateAdminModal({
  cities,
  onClose,
  onSuccess,
}: {
  cities: { id: string; name: string; code: string }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('Pass@12345');
  const [cityId, setCityId] = useState<string>(cities[0]?.id || '');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      bossPanel.createAdmin({
        username,
        password,
        city: cityId,
        email,
        phone,
      }),
    onSuccess: () => onSuccess(),
    onError: (err: any) => setErrorMsg(err.message || 'Failed to create City Admin.'),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Create City Admin</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X width={18} height={18} /></button>
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
            <span>Assigned City:</span>
            <select value={cityId} onChange={(e) => setCityId(e.target.value)} required>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </label>

          <label>
            <span>Username:</span>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="e.g. surat_admin" />
          </label>

          <label>
            <span>Temporary Password:</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>

          <label>
            <span>Email:</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
          </label>

          <label>
            <span>Phone:</span>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </label>

          <div className="modal-actions" style={{ marginTop: '16px' }}>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create Admin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateCityModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => bossPanel.createCity({ name, code, state }),
    onSuccess: () => onSuccess(),
    onError: (err: any) => setErrorMsg(err.message || 'Failed to create City.'),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Add New City</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X width={18} height={18} /></button>
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
            <span>City Name:</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Ahmedabad" />
          </label>

          <label>
            <span>City Code (Unique, uppercase):</span>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="e.g. AMD" />
          </label>

          <label>
            <span>State:</span>
            <input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Gujarat" />
          </label>

          <div className="modal-actions" style={{ marginTop: '16px' }}>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Add City'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Size charts: any school, or the shared items no school owns
 * ------------------------------------------------------------------ */
function BossSizeChartsView() {
  const { data } = useQuery({ queryKey: ['boss-schools-commission'], queryFn: () => cityAdmin.schools() });
  const schools = data?.results ?? [];
  const [scope, setScope] = useState('generic');
  const scopeName = scope === 'generic' ? 'Shared items' : schools.find((s) => s.id === scope)?.code ?? 'School';

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">SIZE CHARTS</div>
          <h1>Size Charts</h1>
          <p className="muted">
            Body measurements for each size. Schools manage their own items; shared items (no school) are managed here.
          </p>
        </div>
        <select className="school-switch" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Whose items">
          <option value="generic">Shared items (every school)</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.code}</option>
          ))}
        </select>
      </div>
      <SizeChartImportCard key={scope} scope={scope} scopeName={scopeName} />
      <SizeChartManager key={`m-${scope}`} scope={scope} scopeName={scopeName} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 4. School Commissions Management (Requirement 8)
 * ------------------------------------------------------------------ */
function BossSchoolsCommissionView() {
  const [editingSchool, setEditingSchool] = useState<CitySchool | null>(null);

  const { data: schoolsData, refetch } = useQuery({
    queryKey: ['boss-schools-commission'],
    queryFn: () => cityAdmin.schools(),
  });
  const schools = schoolsData?.results ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">PARTNERSHIP TERMS</div>
          <h1>School Commission Rates</h1>
          <p className="muted">
            Set and update commission rates for each partner school. Rate is dynamically applied to gross sales.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Commission Schedule</h2>
          <span className="badge s-approved">{schools.length} Schools</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>School Name &amp; Code</th>
                <th>City</th>
                <th>Commission Rate</th>
                <th>Status</th>
                <th className="r">Action</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                    <small className="gr mono">{s.code}</small>
                  </td>
                  <td>{s.city_name}</td>
                  <td>
                    {s.commission_rate ? (
                      <span className="rate-badge">{s.commission_rate}%</span>
                    ) : (
                      <span className="rate-badge muted-badge">Not set</span>
                    )}
                  </td>
                  <td>
                    {s.active ? <span className="badge s-delivered">Active</span> : <span className="badge s-cancelled">Inactive</span>}
                  </td>
                  <td className="r actions">
                    <button className="link-button" onClick={() => setEditingSchool(s)}>
                      Set Commission →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingSchool && (
        <EditCommissionModal
          school={editingSchool}
          onClose={() => setEditingSchool(null)}
          onSuccess={() => {
            setEditingSchool(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function EditCommissionModal({
  school,
  onClose,
  onSuccess,
}: {
  school: CitySchool;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [rate, setRate] = useState<string>(school.commission_rate ?? '');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => bossPanel.updateSchoolCommission(school.id, rate.trim() ? rate.trim() : null),
    onSuccess: () => onSuccess(),
    onError: (err: any) => setErrorMsg(err.message || 'Failed to update commission rate.'),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Update Commission Rate</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X width={18} height={18} /></button>
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
            Setting contractual commission for <b>{school.name}</b> ({school.code}).
          </p>

          {errorMsg && <div className="error">{errorMsg}</div>}

          <label>
            <span>Commission Percentage (%):</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="e.g. 5.50 (leave blank for Not Set)"
            />
          </label>

          <div className="modal-actions" style={{ marginTop: '16px' }}>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save Rate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 5. "View As" Access (Requirement 9: Open Admin view for any city, School view for any school)
 * ------------------------------------------------------------------ */
function BossViewAsView() {
  const navigate = useNavigate();

  const { data: citiesData } = useQuery({
    queryKey: ['boss-viewas-cities'],
    queryFn: () => bossPanel.citiesList(),
  });
  const cities = citiesData?.results ?? [];

  const { data: schoolsData } = useQuery({
    queryKey: ['boss-viewas-schools'],
    queryFn: () => cityAdmin.schools(),
  });
  const schools = schoolsData?.results ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">AUDIT &amp; IMPERSONATION</div>
          <h1>"View As" Access</h1>
          <p className="muted">
            Boss accounts can open the Admin view for any city or the School view for any school (read-only by default).
          </p>
        </div>
      </div>

      <div className="panel-grid">
        {/* View City Admin Panel */}
        <div className="card">
          <div className="card-head">
            <h2>View as City Admin</h2>
            <span className="badge s-processing">City Scope</span>
          </div>
          <div className="pad">
            <p className="muted" style={{ fontSize: '13px', margin: '0 0 16px' }}>
              Jump into any city's operations to inspect local orders, variant inventory stock, and fulfillment queues.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {cities.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    border: '1px solid var(--line)',
                    borderRadius: '4px',
                    background: 'var(--paper)',
                  }}
                >
                  <div>
                    <b>{c.name}</b> <span className="mono muted">({c.code})</span>
                  </div>
                  <Link to={`/city?city=${c.id}`} className="secondary" style={{ width: 'auto', fontSize: '12px' }}>
                    Open City Panel ↗
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* View School Admin Panel */}
        <div className="card">
          <div className="card-head">
            <h2>View as School Admin</h2>
            <span className="badge s-confirmed">School Scope</span>
          </div>
          <div className="pad">
            <p className="muted" style={{ fontSize: '13px', margin: '0 0 16px' }}>
              Inspect the exact dashboard, student roster, order history, and commission reports visible to a school.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '420px', overflowY: 'auto' }}>
              {schools.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    border: '1px solid var(--line)',
                    borderRadius: '4px',
                    background: 'var(--paper)',
                  }}
                >
                  <div>
                    <b>{s.name}</b>
                    <small className="gr mono">{s.code} · {s.city_name}</small>
                  </div>
                  <Link to={`/school?school=${s.id}`} className="secondary" style={{ width: 'auto', fontSize: '12px' }}>
                    Open School Panel ↗
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
