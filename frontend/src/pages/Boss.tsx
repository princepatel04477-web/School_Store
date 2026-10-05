import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useAuth } from '../auth';
import {
  boss, money, money2, num,
  type BossAdmin, type BossCityRow, type BossSchoolRow, type CategoryPoint,
  type CityPoint, type ProductPoint, type SchoolPoint, type StockPoint, type TrendPoint,
} from '../api';

/* ------------------------------------------------------------------ *
 * Palette + formatting helpers
 * ------------------------------------------------------------------ */
const C = {
  green: '#275b4c', mint: '#7fae97', orange: '#f4a261', ink: '#17221f',
  blue: '#4b7c9e', sand: '#c9a86a', muted: '#78817a',
};

const compact = (n: number) =>
  n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr`
  : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k`
  : `${Math.round(n)}`;

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
};

type Filters = { city: string; school: string; category: string; date_from: string; date_to: string };

/** One query-param map per endpoint call; empty values are dropped. */
const paramsOf = (f: Filters) => {
  const p: Record<string, string> = { date_from: f.date_from, date_to: f.date_to };
  if (f.city) p.city = f.city;
  if (f.school) p.school = f.school;
  if (f.category) p.category = f.category;
  return p;
};

/* ------------------------------------------------------------------ *
 * Page shell
 * ------------------------------------------------------------------ */
type Tab = 'overview' | 'management';

export default function Boss() {
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const navigate = useNavigate();

  const { data: options } = useQuery({ queryKey: ['boss-filters'], queryFn: () => boss.filters() });
  const [filters, setFilters] = useState<Filters>({
    city: '', school: '', category: '',
    date_from: isoDaysAgo(30), date_to: new Date().toISOString().slice(0, 10),
  });

  const schoolsInScope = useMemo(() => {
    const all = options?.schools ?? [];
    return filters.city ? all.filter((s) => s.city_id === filters.city) : all;
  }, [options, filters.city]);

  return (
    <div className="admin">
      <header className="admin-top">
        <Link to="/boss" className="brand">
          <span className="brand-mark">S</span>
          <span>School<span className="ink">Store</span></span>
        </Link>
        <span className="admin-role">Boss · whole business</span>
        <ViewAsMenu />
        <div className="header-right">
          <span className="avatar">{user?.username?.slice(0, 1).toUpperCase()}</span>
          <button className="icon-btn" onClick={signOut} aria-label="Sign out">↗</button>
        </div>
      </header>

      <div className="admin-body">
        <nav className="admin-nav">
          {([['overview', '▤', 'Overview'], ['management', '⚙', 'Management']] as [Tab, string, string][]).map(([key, icon, label]) => (
            <a key={key} href="#" className={tab === key ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab(key); }}>
              <i>{icon}</i><span>{label}</span>
            </a>
          ))}
        </nav>

        <main className="admin-main">
          {tab === 'overview' ? (
            <Overview
              filters={filters}
              setFilters={setFilters}
              cities={options?.cities ?? []}
              schools={schoolsInScope}
              categories={options?.categories ?? []}
            />
          ) : (
            <Management />
          )}
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * View-as: open the Admin view for a city / the School view for a
 * school. Read-only is enforced by the panel itself (see SchoolAdmin).
 * ------------------------------------------------------------------ */
function ViewAsMenu() {
  const navigate = useNavigate();
  const { data: options } = useQuery({ queryKey: ['boss-filters'], queryFn: () => boss.filters() });
  const [city, setCity] = useState('');
  const [school, setSchool] = useState('');
  const cities = options?.cities ?? [];
  const schools = options?.schools ?? [];

  return (
    <div className="view-as">
      <label>View as city admin
        <select value={city} onChange={(e) => {
          setCity(e.target.value);
          if (e.target.value) navigate(`/school?view_city=${e.target.value}`);
        }}>
          <option value="">Choose city…</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>View as school
        <select value={school} onChange={(e) => {
          setSchool(e.target.value);
          if (e.target.value) navigate(`/school?view_school=${e.target.value}`);
        }}>
          <option value="">Choose school…</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}
        </select>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overview: KPI cards + six charts, all driven by the same filters
 * ------------------------------------------------------------------ */
function Overview({
  filters, setFilters, cities, schools, categories,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  cities: { id: string; name: string }[];
  schools: { id: string; name: string; code: string }[];
  categories: { id: string; name: string }[];
}) {
  const params = paramsOf(filters);
  const kpis = useQuery({ queryKey: ['boss-kpis', params], queryFn: () => boss.kpis(params) });
  const trend = useQuery({ queryKey: ['boss-trend', params], queryFn: () => boss.chart<TrendPoint>('revenue-trend', params) });
  const byCategory = useQuery({ queryKey: ['boss-by-category', params], queryFn: () => boss.chart<CategoryPoint>('category-sales', params) });
  const byCity = useQuery({ queryKey: ['boss-by-city', params], queryFn: () => boss.chart<CityPoint>('city-sales', params) });
  const topSchools = useQuery({ queryKey: ['boss-top-schools', params], queryFn: () => boss.chart<SchoolPoint>('top-schools', params) });
  const topProducts = useQuery({ queryKey: ['boss-top-products', params], queryFn: () => boss.chart<ProductPoint>('top-products', params) });
  const stock = useQuery({ queryKey: ['boss-stock', params], queryFn: () => boss.chart<StockPoint>('stock-by-category', params) });

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const k = kpis.data;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">BOSS DASHBOARD</div>
          <h1>The whole business</h1>
          <p className="muted">Every number below reads the daily rollups — never the orders table.</p>
        </div>
        <div className="range-picker">
          {[7, 30, 90].map((d) => (
            <button key={d}
              className={filters.date_from === isoDaysAgo(d) && filters.date_to === new Date().toISOString().slice(0, 10) ? 'chip active' : 'chip'}
              onClick={() => set({ date_from: isoDaysAgo(d), date_to: new Date().toISOString().slice(0, 10) })}>
              {d} days
            </button>
          ))}
          <input type="date" value={filters.date_from} onChange={(e) => set({ date_from: e.target.value })} />
          <input type="date" value={filters.date_to} onChange={(e) => set({ date_to: e.target.value })} />
        </div>
      </div>

      <section className="card">
        <div className="filters">
          <label>City
            <select value={filters.city} onChange={(e) => set({ city: e.target.value, school: '' })}>
              <option value="">All cities</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>School
            <select value={filters.school} onChange={(e) => set({ school: e.target.value })}>
              <option value="">All schools</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Category
            <select value={filters.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {(filters.city || filters.school || filters.category) && (
            <button className="link-button" onClick={() => set({ city: '', school: '', category: '' })}>Reset</button>
          )}
        </div>

        <section className="stat-grid four kpi-grid">
          <Kpi label="REVENUE" value={money(k?.revenue)} hint="gross sales in range" />
          <Kpi label="COST" value={money(k?.cost)} hint="cost of goods sold" />
          <Kpi label="GROSS PROFIT" value={money(k?.profit)} hint="revenue − cost" accent />
          <Kpi label="GROSS MARGIN" value={k ? `${Number(k.margin_pct).toFixed(1)}%` : '—'} hint="profit ÷ revenue" />
          <Kpi label="ORDERS" value={num(k?.orders)} hint="distinct orders" />
          <Kpi label="UNITS SOLD" value={num(k?.units)} hint="items across all orders" />
          <Kpi label="STOCK VALUE" value={money(k?.stock_value)} hint="on hand · stock × cost" />
        </section>
        <p className="fine">KPIs follow the date range and filters; stock value is a snapshot of today's stock.</p>
      </section>

      <ChartCard title="Revenue & profit over time" loading={trend.isLoading} empty={!trend.data?.points.length}>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={(trend.data?.points ?? []).map((p) => ({ ...p, revenue: Number(p.revenue), profit: Number(p.profit) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6ebe4" />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11 }} width={52} />
            <Tooltip formatter={(v) => money2(v as number)} labelFormatter={(l) => String(l)} />
            <Legend />
            <Area type="monotone" dataKey="revenue" name="Revenue" stroke={C.green} fill={C.green} fillOpacity={0.18} strokeWidth={2} />
            <Area type="monotone" dataKey="profit" name="Profit" stroke={C.orange} fill={C.orange} fillOpacity={0.22} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="panel-grid">
        <ChartCard title="Sales by category" loading={byCategory.isLoading} empty={!byCategory.data?.points.length}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={(byCategory.data?.points ?? []).map((p) => ({ ...p, revenue: Number(p.revenue) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6ebe4" vertical={false} />
              <XAxis dataKey="category" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v) => money2(v as number)} />
              <Bar dataKey="revenue" name="Revenue" fill={C.green} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Sales by city" loading={byCity.isLoading} empty={!byCity.data?.points.length}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={(byCity.data?.points ?? []).map((p) => ({ ...p, revenue: Number(p.revenue) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6ebe4" vertical={false} />
              <XAxis dataKey="city" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v) => money2(v as number)} />
              <Bar dataKey="revenue" name="Revenue" fill={C.blue} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="panel-grid">
        <ChartCard title="Top schools by revenue" loading={topSchools.isLoading} empty={!topSchools.data?.points.length}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart layout="vertical" data={(topSchools.data?.points ?? []).map((p) => ({ ...p, revenue: Number(p.revenue) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6ebe4" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => compact(v)} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="school" width={150} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => money2(v as number)} />
              <Bar dataKey="revenue" name="Revenue" fill={C.green} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top products by units" loading={topProducts.isLoading} empty={!topProducts.data?.points.length}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart layout="vertical" data={(topProducts.data?.points ?? []).map((p) => ({ ...p, units: Number(p.units) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6ebe4" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="product" width={150} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, name) => name === 'Revenue' ? money2(v as number) : num(v as number)} />
              <Bar dataKey="units" name="Units" fill={C.orange} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Stock level by category" loading={stock.isLoading} empty={!stock.data?.points.length}
        note="Current on-hand stock (a snapshot — the date range does not apply). School filters narrow to that school's city.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={(stock.data?.points ?? []).map((p) => ({ ...p, units: Number(p.units) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6ebe4" vertical={false} />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={44} allowDecimals={false} />
            <Tooltip formatter={(v, name) => name === 'Value' ? money2(v as number) : num(v as number)} />
            <Bar dataKey="units" name="Units in stock" fill={C.sand} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={accent ? 'stat accent' : 'stat'}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function ChartCard({ title, loading, empty, note, children }: {
  title: string; loading?: boolean; empty?: boolean; note?: string; children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head"><h2>{title}</h2></div>
      {loading && <div className="empty slim"><h3>Loading…</h3></div>}
      {!loading && empty && <div className="empty slim"><h3>No data for these filters</h3></div>}
      {!loading && !empty && <div className="chart-body">{children}</div>}
      {note && <p className="fine">{note}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Management: admins, cities, school commission
 * ------------------------------------------------------------------ */
function Management() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">MANAGEMENT</div>
          <h1>People, cities & commissions</h1>
          <p className="muted">Create Admins and assign them to cities, manage cities, and set each school's commission rate.</p>
        </div>
      </div>
      <AdminsCard />
      <CitiesCard />
      <SchoolsCard />
    </>
  );
}

function AdminsCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['boss-admins'], queryFn: () => boss.admins() });
  const { data: options } = useQuery({ queryKey: ['boss-filters'], queryFn: () => boss.filters() });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', password: '', first_name: '', last_name: '', email: '', city: '' });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['boss-admins'] });
  const create = useMutation({
    mutationFn: () => boss.createAdmin(form),
    onSuccess: () => { setAdding(false); setForm({ username: '', password: '', first_name: '', last_name: '', email: '', city: '' }); setError(''); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });
  const reassign = useMutation({
    mutationFn: ({ id, city }: { id: string; city: string }) => boss.editAdmin(id, { city }),
    onSuccess: invalidate,
  });
  const toggleActive = useMutation({
    mutationFn: ({ a }: { a: BossAdmin }) => boss.editAdmin(a.id, { is_active: !a.is_active }),
    onSuccess: invalidate,
  });

  const rows = data?.results ?? [];
  return (
    <section className="card">
      <div className="card-head">
        <h2>City admins</h2>
        <button className="primary" onClick={() => setAdding(true)}>+ Add admin</button>
      </div>
      {adding && (
        <form className="form-card boss-inline" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="form-row">
            <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
            <label>Password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></label>
          </div>
          <div className="form-row">
            <label>First name<input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></label>
            <label>Last name<input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label>
          </div>
          <div className="form-row">
            <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>City
              <select value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required>
                <option value="">Assign a city…</option>
                {(options?.cities ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
            <button className="primary" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create admin'}</button>
          </div>
        </form>
      )}
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr><th>Admin</th><th>Contact</th><th>City</th><th>Status</th><th className="r">Actions</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted pad">No admins yet — add one and assign them to a city.</td></tr>}
            {rows.map((a) => (
              <tr key={a.id} className={a.is_active ? '' : 'row-muted'}>
                <td><b>{[a.first_name, a.last_name].filter(Boolean).join(' ') || a.username}</b><small className="gr">{a.username}</small></td>
                <td>{a.email || '—'}<small className="gr">{a.phone}</small></td>
                <td>
                  <select value={a.city ?? ''} onChange={(e) => reassign.mutate({ id: a.id, city: e.target.value })}>
                    <option value="">No city</option>
                    {(options?.cities ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td>{a.is_active
                  ? <span className="badge s-approved">{a.must_change_password ? 'must set password' : 'active'}</span>
                  : <span className="badge s-failed">deactivated</span>}</td>
                <td className="r actions">
                  <button className="link-button" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate({ a })}>
                    {a.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CitiesCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['boss-cities'], queryFn: () => boss.cities() });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['boss-cities'] });
    queryClient.invalidateQueries({ queryKey: ['boss-filters'] });
  };
  const [form, setForm] = useState({ name: '', code: '', state: '' });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => boss.createCity(form),
    onSuccess: () => { setForm({ name: '', code: '', state: '' }); setError(''); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });
  const toggle = useMutation({
    mutationFn: ({ c }: { c: BossCityRow }) => boss.editCity(c.id, { active: !c.active }),
    onSuccess: invalidate,
  });

  const rows = data?.results ?? [];
  return (
    <section className="card">
      <div className="card-head"><h2>Cities</h2></div>
      <form className="form-card boss-inline" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="form-row">
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Vadodara" /></label>
          <label>Code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="VAD" /></label>
          <label>State<input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="Gujarat" /></label>
          <button className="primary" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add city'}</button>
        </div>
        {error && <div className="error">{error}</div>}
      </form>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>City</th><th>Code</th><th>State</th><th>Status</th><th className="r">Actions</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={c.active ? '' : 'row-muted'}>
                <td><b>{c.name}</b></td>
                <td className="mono">{c.code}</td>
                <td>{c.state || '—'}</td>
                <td>{c.active ? <span className="badge s-approved">active</span> : <span className="badge s-failed">inactive</span>}</td>
                <td className="r actions">
                  <button className="link-button" disabled={toggle.isPending} onClick={() => toggle.mutate({ c })}>
                    {c.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SchoolsCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['boss-schools'], queryFn: () => boss.schools() });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: ({ id, rate }: { id: string; rate: string }) =>
      boss.editSchool(id, { commission_rate: rate === '' ? null : Number(rate) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boss-schools'] });
      setDrafts({});
    },
  });

  const rows = data?.results ?? [];
  return (
    <section className="card">
      <div className="card-head"><h2>Schools & commission</h2></div>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>School</th><th>City</th><th>Code</th><th>Status</th><th>Commission rate (%)</th><th className="r" /></tr></thead>
          <tbody>
            {rows.map((s) => {
              const draft = drafts[s.id] ?? s.commission_rate ?? '';
              const dirty = draft !== (s.commission_rate ?? '');
              return (
                <tr key={s.id} className={s.active ? '' : 'row-muted'}>
                  <td><b>{s.name}</b></td>
                  <td>{s.city_name}</td>
                  <td className="mono">{s.code}</td>
                  <td>{s.active ? <span className="badge s-approved">active</span> : <span className="badge s-failed">inactive</span>}</td>
                  <td>
                    <input
                      type="number" min="0" max="100" step="0.01" value={draft} placeholder="not set"
                      onChange={(e) => setDrafts({ ...drafts, [s.id]: e.target.value })}
                    />
                  </td>
                  <td className="r actions">
                    {dirty && (
                      <button className="link-button" disabled={save.isPending}
                        onClick={() => save.mutate({ id: s.id, rate: draft })}>
                        {save.isPending ? 'Saving…' : 'Save'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fine">The commission rate is stored on the school record and drives the commission card in the School Admin panel.</p>
    </section>
  );
}
