import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from '../components/ui/icons';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useAuth } from '../auth';
import {
  bossPanel, cityAdmin, money, num,
  type BossCategoryPoint, type BossCityPoint, type BossFilterOptions,
  type BossKpis, type BossProductPoint, type BossRevProfitPoint,
  type BossSchoolPoint, type BossStockCatPoint, type CitySchool, type User,
} from '../api';

const NAV = [
  { to: '', label: 'Executive Overview', end: true },
  { to: 'analytics', label: 'Detailed Charts' },
  { to: 'management', label: 'Staff & Cities' },
  { to: 'schools', label: 'School Commissions' },
  { to: 'view-as', label: 'View As (Audit)' },
];

const COLORS = ['#275b4c', '#f4a261', '#4b7c9e', '#9a7742', '#7fae97', '#e76f51', '#2a9d8f', '#e9c46a'];

export default function BossPanel() {
  const { user, signOut } = useAuth();

  return (
    <div className="admin">
      <header className="admin-top">
        <Link to="/boss" className="brand">
          <span className="brand-mark">S</span>
          <span>School<span className="ink">Store</span></span>
        </Link>
        <span className="admin-role" style={{ background: '#fdf1dd', color: '#8a6524', padding: '3px 8px', borderRadius: '4px' }}>
          Owner / Boss Executive
        </span>
        <span className="school-tag">Global Business View</span>
        <div className="header-right">
          <span className="avatar" style={{ background: '#275b4c', color: 'white' }}>
            {user?.username?.slice(0, 1).toUpperCase()}
          </span>
          <button className="icon-btn" onClick={signOut} aria-label="Sign out">↗</button>
        </div>
      </header>

      <div className="admin-body">
        <nav className="admin-nav">
          {NAV.map((n) => (
            <BossNavLink key={n.to} to={n.to} end={n.end}><span>{n.label}</span></BossNavLink>
          ))}
        </nav>
        <main className="admin-main">
          <Routes>
            <Route index element={<BossOverviewView />} />
            <Route path="analytics" element={<BossAnalyticsChartsView />} />
            <Route path="management" element={<BossStaffManagementView />} />
            <Route path="schools" element={<BossSchoolsCommissionView />} />
            <Route path="view-as" element={<BossViewAsView />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function BossNavLink({ to, end, children }: { to: string; end?: boolean; children: ReactNode }) {
  const { pathname } = useLocation();
  const base = '/boss';
  const current = end ? pathname === base || pathname === `${base}/` : pathname.startsWith(`${base}/${to}`);
  return (
    <Link to={to ? `${base}/${to}` : base} className={current ? 'active' : ''}>
      <i>{children}</i>
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * Reusable Filters Bar for Boss Panel
 * ------------------------------------------------------------------ */
function useBossFilterState() {
  const { data: filterOpts } = useQuery({
    queryKey: ['boss-filter-options'],
    queryFn: () => bossPanel.filters(),
  });

  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [cityId, setCityId] = useState<string>('');
  const [schoolId, setSchoolId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');

  useEffect(() => {
    if (filterOpts && !dateFrom && !dateTo) {
      setDateFrom(filterOpts.default_from);
      setDateTo(filterOpts.default_to);
    }
  }, [filterOpts, dateFrom, dateTo]);

  const queryParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (cityId) p.city = cityId;
    if (schoolId) p.school = schoolId;
    if (categoryId) p.category = categoryId;
    return p;
  }, [dateFrom, dateTo, cityId, schoolId, categoryId]);

  return {
    filterOpts,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    cityId, setCityId,
    schoolId, setSchoolId,
    categoryId, setCategoryId,
    queryParams,
  };
}

function BossFilterBar({
  state,
}: {
  state: ReturnType<typeof useBossFilterState>;
}) {
  const {
    filterOpts,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    cityId, setCityId,
    schoolId, setSchoolId,
    categoryId, setCategoryId,
  } = state;

  const filteredSchools = useMemo(() => {
    if (!filterOpts) return [];
    if (!cityId) return filterOpts.schools;
    return filterOpts.schools.filter((s) => s.city_id === cityId);
  }, [filterOpts, cityId]);

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div className="filters" style={{ borderBottom: 0 }}>
        <label>
          <span>City:</span>
          <select value={cityId} onChange={(e) => { setCityId(e.target.value); setSchoolId(''); }}>
            <option value="">All Cities</option>
            {filterOpts?.cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
        </label>

        <label>
          <span>School:</span>
          <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            <option value="">All Schools</option>
            {filteredSchools.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </label>

        <label>
          <span>Category:</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All Categories</option>
            {filterOpts?.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
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

        {(cityId || schoolId || categoryId) && (
          <button
            className="link-button"
            style={{ alignSelf: 'center', marginTop: '14px' }}
            onClick={() => {
              setCityId('');
              setSchoolId('');
              setCategoryId('');
            }}
          >
            Reset Filters
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 1. Boss Overview (KPIs + Primary Visualizations)
 * ------------------------------------------------------------------ */
function BossOverviewView() {
  const filterState = useBossFilterState();
  const { queryParams } = filterState;

  const { data: kpis, isLoading: kpiLoading } = useQuery({
    queryKey: ['boss-kpis', queryParams],
    queryFn: () => bossPanel.kpis(queryParams),
    enabled: !!queryParams.date_from,
  });

  const { data: trendData } = useQuery({
    queryKey: ['boss-chart-trend', queryParams],
    queryFn: () => bossPanel.revenueProfit(queryParams),
    enabled: !!queryParams.date_from,
  });

  const { data: catData } = useQuery({
    queryKey: ['boss-chart-cats', queryParams],
    queryFn: () => bossPanel.categories(queryParams),
    enabled: !!queryParams.date_from,
  });

  const { data: cityData } = useQuery({
    queryKey: ['boss-chart-cities', queryParams],
    queryFn: () => bossPanel.cities(queryParams),
    enabled: !!queryParams.date_from,
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">EXECUTIVE DASHBOARD</div>
          <h1>Business Performance Overview</h1>
          <p className="muted">
            All metrics computed from rollups. Profit = Revenue − Cost. Zero table scans on orders.
          </p>
        </div>
      </div>

      <BossFilterBar state={filterState} />

      {/* KPI Cards (Requirement 1, 4, 7) */}
      <div className="stat-grid four" style={{ marginBottom: '16px' }}>
        <div className="stat accent">
          <span>GROSS REVENUE</span>
          <strong>{money(kpis?.revenue)}</strong>
          <small>Total customer sales</small>
        </div>
        <div className="stat">
          <span>GROSS PROFIT</span>
          <strong style={{ color: '#275b4c' }}>{money(kpis?.gross_profit)}</strong>
          <small>Revenue − Cost</small>
        </div>
        <div className="stat">
          <span>GROSS MARGIN %</span>
          <strong>{kpis?.gross_margin_pct ?? '-'}%</strong>
          <small>Profit / Revenue</small>
        </div>
        <div className="stat">
          <span>TOTAL COST</span>
          <strong>{money(kpis?.cost)}</strong>
          <small>Inventory cost of sold goods</small>
        </div>
      </div>

      <div className="stat-grid three" style={{ marginBottom: '24px' }}>
        <div className="stat">
          <span>ORDERS PLACED</span>
          <strong>{num(kpis?.orders)}</strong>
          <small>Distinct order volume</small>
        </div>
        <div className="stat">
          <span>UNITS SOLD</span>
          <strong>{num(kpis?.units_sold)}</strong>
          <small>Total item quantity</small>
        </div>
        <div className="stat">
          <span>CURRENT STOCK VALUE</span>
          <strong>{money(kpis?.current_stock_value)}</strong>
          <small>Cached inventory valuation (stock × cost)</small>
        </div>
      </div>

      {/* Primary Charts (Requirement 2) */}
      <div className="panel-grid">
        {/* Revenue & Profit Over Time Area Chart */}
        <div className="card">
          <div className="card-head">
            <h2>Revenue &amp; Profit Over Time</h2>
            <span className="badge s-approved">Daily Timeline</span>
          </div>
          <div style={{ height: '320px', padding: '16px' }}>
            {trendData && trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#275b4c" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#275b4c" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f4a261" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#f4a261" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe5dd" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
                  <Tooltip formatter={(value: any) => [money(value), '']} />
                  <Legend />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#275b4c" fillOpacity={1} fill="url(#colorRev)" />
                  <Area type="monotone" dataKey="profit" name="Profit" stroke="#f4a261" fillOpacity={1} fill="url(#colorProfit)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty slim">No revenue data for this period.</div>
            )}
          </div>
        </div>

        {/* Sales by Category Donut Chart */}
        <div className="card">
          <div className="card-head">
            <h2>Sales by Category</h2>
            <span className="badge s-confirmed">Share</span>
          </div>
          <div style={{ height: '320px', padding: '16px' }}>
            {catData && catData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={catData}
                    dataKey="revenue"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={3}
                  >
                    {catData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: any) => [money(val), 'Revenue']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty slim">No category sales recorded.</div>
            )}
          </div>
        </div>
      </div>

      {/* Sales by City Bar Chart */}
      <div className="card" style={{ marginTop: '20px' }}>
        <div className="card-head">
          <h2>Sales by City</h2>
          <span className="badge s-processing">Regional Breakdown</span>
        </div>
        <div style={{ height: '260px', padding: '16px' }}>
          {cityData && cityData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cityData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe5dd" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
                <Tooltip formatter={(val: any) => [money(val), '']} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#275b4c" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" name="Profit" fill="#f4a261" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty slim">No city sales data found.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Detailed Analytics (Top Schools, Top Products, Stock by Category)
 * ------------------------------------------------------------------ */
function BossAnalyticsChartsView() {
  const filterState = useBossFilterState();
  const { queryParams } = filterState;

  const { data: topSchools } = useQuery({
    queryKey: ['boss-chart-top-schools', queryParams],
    queryFn: () => bossPanel.topSchools(queryParams),
    enabled: !!queryParams.date_from,
  });

  const { data: topProducts } = useQuery({
    queryKey: ['boss-chart-top-products', queryParams],
    queryFn: () => bossPanel.topProducts(queryParams),
    enabled: !!queryParams.date_from,
  });

  const { data: stockCats } = useQuery({
    queryKey: ['boss-chart-stock-cats', queryParams],
    queryFn: () => bossPanel.stockCategories(queryParams),
    enabled: !!queryParams.date_from,
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">DEEP DIVE ANALYTICS</div>
          <h1>Operational Rankings &amp; Stock Levels</h1>
          <p className="muted">Top performing schools, best-selling products, and on-hand inventory by category.</p>
        </div>
      </div>

      <BossFilterBar state={filterState} />

      <div className="panel-grid">
        {/* Top Schools by Revenue */}
        <div className="card">
          <div className="card-head">
            <h2>Top Schools by Revenue</h2>
            <span className="badge s-approved">Top 15</span>
          </div>
          <div style={{ height: '360px', padding: '16px' }}>
            {topSchools && topSchools.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topSchools} layout="vertical" margin={{ left: 40, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#dfe5dd" />
                  <XAxis type="number" tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip formatter={(v: any) => [money(v), 'Revenue']} />
                  <Bar dataKey="revenue" fill="#275b4c" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty slim">No school revenue data.</div>
            )}
          </div>
        </div>

        {/* Top Products by Units Sold (Requirement 5) */}
        <div className="card">
          <div className="card-head">
            <h2>Top Products by Units Sold</h2>
            <span className="badge s-processing">From DailyProductTotal</span>
          </div>
          <div style={{ height: '360px', padding: '16px' }}>
            {topProducts && topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts} layout="vertical" margin={{ left: 40, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#dfe5dd" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                  <Tooltip formatter={(v: any) => [num(v), 'Units Sold']} />
                  <Bar dataKey="units" fill="#4b7c9e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty slim">No product units data available.</div>
            )}
          </div>
        </div>
      </div>

      {/* Stock Level by Category Bar Chart (Requirement 2) */}
      <div className="card" style={{ marginTop: '20px' }}>
        <div className="card-head">
          <h2>Stock Level &amp; Valuation by Category</h2>
          <span className="badge s-delivered">On-hand Inventory</span>
        </div>
        <div style={{ height: '280px', padding: '16px' }}>
          {stockCats && stockCats.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stockCats}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe5dd" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
                <Tooltip formatter={(v: any, name: any) => [name === 'Stock Value' ? money(v) : num(v), name]} />
                <Legend />
                <Bar yAxisId="left" dataKey="units" name="Units on Hand" fill="#2a9d8f" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="stock_value" name="Stock Value" fill="#f4a261" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty slim">No stock records found.</div>
          )}
        </div>
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
                    background: '#fafbf8',
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
                    background: '#fafbf8',
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
