import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import {
  api, download, money, money2, num, panel, relative,
  type CategoryRow, type Commission, type Dashboard, type ExportJob, type FilterOptions,
  type ImportJob, type PanelOrder, type PanelSchool, type PanelStudent, type PanelTeacher,
  type StudentOrders,
} from '../api';

/* ------------------------------------------------------------------ *
 * School scope
 * ------------------------------------------------------------------ */
type ViewAs = { active: boolean; kind: 'city' | 'school' | null; name: string };
type SchoolCtx = {
  schoolId: string | null;
  setSchoolId: (id: string) => void;
  schools: PanelSchool[];
  /** Read-only "view as" mode — write UI is hidden while this is true. */
  readOnly: boolean;
  viewAs: ViewAs;
};
const SchoolContext = createContext<SchoolCtx>({
  schoolId: null, setSchoolId: () => {}, schools: [],
  readOnly: false, viewAs: { active: false, kind: null, name: '' },
});
const useSchool = () => useContext(SchoolContext);

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */
const NAV = [
  { to: '', label: 'Overview', icon: '▤', end: true },
  { to: 'orders', label: 'Orders', icon: '▣' },
  { to: 'students', label: 'Students', icon: '♙' },
  { to: 'teachers', label: 'Teachers', icon: '✎' },
  { to: 'exports', label: 'Exports', icon: '↧' },
];

export default function SchoolAdmin() {
  const { user, signOut } = useAuth();
  const [searchParams] = useSearchParams();
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['panel-schools'], queryFn: () => panel.schools() });
  const allSchools = data?.results ?? [];

  // --- "View as" mode (Boss only) ------------------------------------- //
  // /school?view_city=<id>  -> the City Admin view for one city
  // /school?view_school=<id> -> the School Admin view for one school
  // Read-only by default; the Boss may explicitly switch editing on.
  const viewCity = searchParams.get('view_city');
  const viewSchoolId = searchParams.get('view_school');
  const isBoss = user?.role === 'BOSS';
  const viewAs: ViewAs = {
    active: !!isBoss && !!(viewCity || viewSchoolId),
    kind: viewCity ? 'city' : viewSchoolId ? 'school' : null,
    name: '',
  };
  const schools = useMemo(() => {
    if (!viewAs.active) return allSchools;
    if (viewSchoolId) return allSchools.filter((s) => s.id === viewSchoolId);
    return allSchools.filter((s) => s.city_id === viewCity);
  }, [allSchools, viewAs.active, viewCity, viewSchoolId]);
  viewAs.name = viewSchoolId
    ? (schools[0]?.name ?? '')
    : (schools[0]?.city_name ?? '');

  const [editingOn, setEditingOn] = useState(false);
  const readOnly = viewAs.active && !editingOn;

  useEffect(() => {
    if (!schoolId && schools.length) setSchoolId(schools[0].id);
  }, [schools, schoolId]);
  useEffect(() => {
    // Keep the picked school inside the view-as scope.
    if (schoolId && schools.length && !schools.some((s) => s.id === schoolId)) {
      setSchoolId(schools[0].id);
    }
  }, [schools, schoolId]);

  return (
    <SchoolContext.Provider value={{ schoolId, setSchoolId, schools, readOnly, viewAs }}>
      <div className="admin">
        <header className="admin-top">
          <Link to={viewAs.active ? '/boss' : '/school'} className="brand">
            <span className="brand-mark">S</span>
            <span>School<span className="ink">Store</span></span>
          </Link>
          <span className="admin-role">
            {viewAs.active
              ? (viewAs.kind === 'city' ? 'City admin view' : 'School admin view')
              : (ROLE_LABEL[user?.role ?? 'SCHOOL_ADMIN'] ?? user?.role)}
          </span>
          {schools.length > 1 && schoolId && (
            <select className="school-switch" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.code}</option>
              ))}
            </select>
          )}
          {schools.length === 1 && <span className="school-tag">{schools[0]?.name}</span>}
          <div className="header-right">
            {viewAs.active && <Link to="/boss" className="link-button">Exit view-as</Link>}
            <span className="avatar">{user?.username?.slice(0, 1).toUpperCase()}</span>
            <button className="icon-btn" onClick={signOut} aria-label="Sign out">↗</button>
          </div>
        </header>
        {viewAs.active && (
          <div className="view-as-banner">
            <span>
              Viewing as <b>{viewAs.kind === 'city' ? 'City Admin' : 'School Admin'}</b>
              {viewAs.name ? <> — {viewAs.name}</> : null}
              {' '}· <b>{readOnly ? 'read-only' : 'editing enabled'}</b>
            </span>
            <label className="check">
              <input type="checkbox" checked={!readOnly} onChange={(e) => setEditingOn(e.target.checked)} />
              Enable editing
            </label>
          </div>
        )}
        <div className="admin-body">
          <nav className="admin-nav">
            {NAV.map((n) => (
              <AdminNavLink key={n.to} to={n.to} end={n.end}>{n.icon}<span>{n.label}</span></AdminNavLink>
            ))}
          </nav>
          <main className="admin-main">
            {schoolId ? (
              <Routes>
                <Route index element={<Overview />} />
                <Route path="orders" element={<Orders />} />
                <Route path="students" element={<Students />} />
                <Route path="students/:id" element={<StudentDetail />} />
                <Route path="teachers" element={<Teachers />} />
                <Route path="exports" element={<Exports />} />
              </Routes>
            ) : (
              <div className="empty"><h3>No school in your scope</h3><p>Ask an admin to link your account to a school.</p></div>
            )}
          </main>
        </div>
      </div>
    </SchoolContext.Provider>
  );
}

const ROLE_LABEL: Record<string, string> = {
  BOSS: 'Boss', ADMIN: 'City admin', SCHOOL_ADMIN: 'School admin', TEACHER: 'Teacher', PARENT: 'Parent',
};

function AdminNavLink({ to, end, children }: { to: string; end?: boolean; children: ReactNode }) {
  const { pathname } = useLocation();
  const base = '/school';
  const current = end ? pathname === base || pathname === `${base}/` : pathname.startsWith(`${base}/${to}`);
  return (
    <Link to={to ? `${base}/${to}` : base} className={current ? 'active' : ''}>
      <i>{children}</i>
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * 1 + 7. Overview / dashboard
 * ------------------------------------------------------------------ */
function Overview() {
  const { schoolId } = useSchool();
  const [range, setRange] = useState('30');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);

  const dates = useMemo(() => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (custom) return custom;
    const days = Number(range);
    const from = new Date(today);
    from.setDate(from.getDate() - (days - 1));
    return { from: iso(from), to: iso(today) };
  }, [range, custom]);

  const { data: filters } = useQuery({
    queryKey: ['panel-filters', schoolId],
    queryFn: () => panel.filters(schoolId!),
    enabled: !!schoolId,
  });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['panel-dashboard', schoolId, dates.from, dates.to],
    queryFn: () => panel.dashboard(schoolId!, dates.from, dates.to),
    enabled: !!schoolId,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">SCHOOL DASHBOARD</div>
          <h1>{data?.school.name ?? 'Overview'}</h1>
          <p className="muted">
            {data ? `${data.school.code} · ${data.school.city_name} · ${data.days} day${data.days === 1 ? '' : 's'}` : ' '}
          </p>
        </div>
        <div className="range-picker">
          {[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']].map(([v, l]) => (
            <button key={v} className={!custom && range === v ? 'chip active' : 'chip'} onClick={() => { setRange(v); setCustom(null); }}>{l}</button>
          ))}
          <input type="date" value={dates.from} onChange={(e) => setCustom({ from: e.target.value, to: dates.to })} />
          <input type="date" value={dates.to} onChange={(e) => setCustom({ from: dates.from, to: e.target.value })} />
        </div>
      </div>

      {isError && <div className="empty"><h3>Could not load the dashboard</h3><p>Please refresh and try again.</p></div>}
      {isLoading && !data && <div className="empty"><h3>Loading the dashboard…</h3></div>}
      {data && <DashboardBody data={data} />}
    </>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  const hasSales = Number(data.totals.gross_sales) > 0;
  const bars = data.daily.slice(-60);
  const max = Math.max(1, ...bars.map((d) => Number(d.gross_sales)));
  return (
    <>
      <section className="stat-grid three">
        <StatCard label="TOTAL ORDERS" value={num(data.totals.orders)} hint={`${num(data.totals.average_order_value)} average order`} />
        <StatCard label="UNITS SOLD" value={num(data.totals.units)} hint="items shipped across the school" />
        <StatCard label="GROSS SALES" value={money(data.totals.gross_sales)} hint={`${money(data.totals.margin)} margin on ${money(data.totals.cost)} cost`} accent />
      </section>

      <div className="panel-grid">
        <section className="card">
          <div className="card-head">
            <h2>Sales by category</h2>
            <span className="pill">{data.categories.length} categories</span>
          </div>
          {hasSales ? (
            <table className="data">
              <thead>
                <tr><th>Category</th><th className="r">Orders</th><th className="r">Units</th><th className="r">Gross sales</th><th className="r">Share</th></tr>
              </thead>
              <tbody>
                {data.categories.map((c) => <CategoryRowView key={c.category_id} row={c} />)}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="r">{num(data.totals.orders)}</th>
                  <th className="r">{num(data.totals.units)}</th>
                  <th className="r">{money(data.totals.gross_sales)}</th>
                  <th className="r">100%</th>
                </tr>
              </tfoot>
            </table>
          ) : (
            <p className="muted pad">No sales recorded in this range.</p>
          )}
          <p className="fine">{data.notes?.[1]}</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>Commission</h2></div>
          <CommissionCard commission={data.commission} />
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Daily gross sales</h2>
          <span className="pill">{data.daily.length} day{data.daily.length === 1 ? '' : 's'} with sales</span>
        </div>
        {bars.length ? (
          <div className="bars" role="img" aria-label="Daily gross sales">
            {bars.map((d) => (
              <div key={d.date} className="bar" style={{ height: `${Math.max(3, (Number(d.gross_sales) / max) * 100)}%` }}
                title={`${d.date} · ${money(d.gross_sales)} · ${num(d.orders)} orders`} />
            ))}
          </div>
        ) : (
          <p className="muted pad">Nothing sold in this range yet.</p>
        )}
        <div className="bars-axis"><span>{bars[0]?.date ?? data.date_from}</span><span>{bars[bars.length - 1]?.date ?? data.date_to}</span></div>
      </section>

      <section className="notice-row">
        <div className="notice">
          <b>{data.pending_students}</b> student{data.pending_students === 1 ? '' : 's'} waiting for approval
          <Link to="/school/students?pending=1" className="link-button">Review →</Link>
        </div>
        <p className="fine">{data.notes?.[0]}</p>
      </section>
    </>
  );
}

function StatCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={accent ? 'stat accent' : 'stat'}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function CategoryRowView({ row }: { row: CategoryRow }) {
  return (
    <tr>
      <td>{row.category}</td>
      <td className="r">{num(row.orders)}</td>
      <td className="r">{num(row.units)}</td>
      <td className="r">{money(row.gross_sales)}</td>
      <td className="r">
        <span className="share"><i style={{ width: `${Number(row.share_pct)}%` }} /></span>
        {Number(row.share_pct).toFixed(1)}%
      </td>
    </tr>
  );
}

function CommissionCard({ commission }: { commission: Commission }) {
  if (!commission.rate_set) {
    return (
      <div className="commission empty-rate">
        <div className="rate-badge muted-badge">Rate not set</div>
        <dl>
          <div><dt>Gross sales (basis)</dt><dd>{money2(commission.gross_sales)}</dd></div>
          <div><dt>Commission rate</dt><dd className="muted">Not set on this school</dd></div>
          <div><dt>Commission</dt><dd className="muted">—</dd></div>
        </dl>
        <p className="fine">{commission.note}</p>
      </div>
    );
  }
  return (
    <div className="commission">
      <div className="rate-badge">{commission.rate_display}</div>
      <dl>
        <div><dt>Gross sales (basis)</dt><dd>{money2(commission.gross_sales)}</dd></div>
        <div><dt>Commission rate</dt><dd>{commission.rate_display}</dd></div>
        <div><dt>Commission ({commission.currency})</dt><dd className="big">{money2(commission.commission_amount)}</dd></div>
      </dl>
      <p className="fine">Rate is read from the school record, never hard-coded.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Orders table
 * ------------------------------------------------------------------ */
function Orders() {
  const { schoolId, readOnly } = useSchool();
  const { data: filters } = useQuery({ queryKey: ['panel-filters', schoolId], queryFn: () => panel.filters(schoolId!), enabled: !!schoolId });
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const path = `/panel/orders/?${new URLSearchParams({ school: schoolId!, ...clean(f) })}`;
  const orders = useInfiniteQuery({
    queryKey: ['panel-orders', schoolId, f],
    queryFn: ({ pageParam }) => api<{ next: string | null; previous: string | null; results: PanelOrder[] }>(pageParam ?? path),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => relative(last.next),
    enabled: !!schoolId,
  });
  const rows = orders.data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">ORDERS</div>
          <h1>Every order for this school</h1>
          <p className="muted">50 rows at a time, newest first — load more to keep going.</p>
        </div>
        {!readOnly && <ExportButton filters={f} />}
      </div>

      <section className="card">
        <div className="filters">
          <label>Class
            <select value={f.class_name ?? ''} onChange={(e) => set('class_name', e.target.value)}>
              <option value="">All classes</option>
              {(filters?.classes ?? []).map((c) => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </label>
          <label>Category
            <select value={f.category ?? ''} onChange={(e) => set('category', e.target.value)}>
              <option value="">All categories</option>
              {(filters?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Placed by
            <select value={f.placed_by_role ?? ''} onChange={(e) => set('placed_by_role', e.target.value)}>
              <option value="">Anyone</option>
              {(filters?.placed_by_roles ?? []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label>Status
            <select value={f.status ?? ''} onChange={(e) => set('status', e.target.value)}>
              <option value="">Any status</option>
              {(filters?.statuses ?? []).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label>From<input type="date" value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></label>
          <label>To<input type="date" value={f.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></label>
          <button className="link-button" onClick={() => setF({})}>Reset</button>
        </div>

        {orders.isLoading && <div className="empty slim"><h3>Loading orders…</h3></div>}
        {orders.isError && <div className="empty slim"><h3>Could not load orders</h3></div>}
        {!orders.isLoading && rows.length === 0 && <div className="empty slim"><h3>No orders match these filters</h3><p>Try widening the date range.</p></div>}

        {rows.length > 0 && (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Order</th><th>Date</th><th>Student</th><th>Class</th>
                  <th>Items</th><th className="r">Units</th><th className="r">Amount</th>
                  <th>Status</th><th>Placed by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => <OrderRow key={o.id} order={o} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="load-more">
        {orders.hasNextPage ? (
          <button className="secondary" disabled={orders.isFetchingNextPage} onClick={() => orders.fetchNextPage()}>
            {orders.isFetchingNextPage ? 'Loading…' : 'Load more orders'}
          </button>
        ) : (
          rows.length > 0 && <span className="fine">Showing all {rows.length} loaded row{rows.length === 1 ? '' : 's'} for these filters.</span>
        )}
      </div>
    </>
  );
}

function OrderRow({ order }: { order: PanelOrder }) {
  const extra = order.item_count - order.items.length;
  return (
    <tr>
      <td className="mono">{order.order_number}</td>
      <td>{new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td>
        <Link to={`/school/students/${order.student}`} className="cell-link">{order.student_name}</Link>
        <small className="gr">{order.student_gr}</small>
      </td>
      <td>{order.student_class}{order.student_section ? ` ${order.student_section}` : ''}</td>
      <td className="items-cell">
        {order.items.map((it, i) => (
          <span key={i} className="item-line">{it.quantity}× {it.product}{it.variant ? ` · ${it.variant}` : ''}</span>
        ))}
        {extra > 0 && <small className="gr">+{extra} more</small>}
      </td>
      <td className="r">{num(order.units)}</td>
      <td className="r">{money2(order.amount)}</td>
      <td><span className={`badge s-${order.status.toLowerCase()}`}>{order.status.replace('_', ' ').toLowerCase()}</span></td>
      <td>
        {order.placed_by_name || '—'}
        <small className="gr">{order.placed_by_role_label}</small>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ *
 * 4. Export button + background job polling
 * ------------------------------------------------------------------ */
function ExportButton({ filters }: { filters: Record<string, string> }) {
  const { schoolId } = useSchool();
  const [jobId, setJobId] = useState<string | null>(null);
  const navigate = useNavigate();
  const request = useMutation({ mutationFn: () => panel.requestExport(schoolId!, 'ORDERS', clean(filters)), onSuccess: (j) => setJobId(j.id) });

  const job = useQuery({
    queryKey: ['panel-export', jobId],
    queryFn: () => panel.exportJob(schoolId!, jobId!),
    enabled: !!jobId && !!schoolId,
    refetchInterval: (q) => (q.state.data && ['QUEUED', 'RUNNING'].includes(q.state.data.status) ? 1500 : false),
  });

  const status = job.data?.status;
  return (
    <div className="export-cta">
      <button className="primary" disabled={request.isPending} onClick={() => request.mutate()}>
        {request.isPending ? 'Queueing…' : 'Export to Excel'}
      </button>
      {job.data && (
        <div className="job-line">
          {status === 'READY' && job.data.download_url ? (
            <>
              <span className="badge s-ready">ready</span>
              <button className="link-button" onClick={() => download(job.data!.download_url!, job.data!.filename)}>
                Download {num(job.data.row_count)} rows ⤓
              </button>
              <button className="link-button" onClick={() => navigate('/school/exports')}>All exports</button>
            </>
          ) : status === 'FAILED' ? (
            <span className="badge s-failed">{job.data.error_message || 'Export failed'}</span>
          ) : (
            <>
              <span className="progress"><i style={{ width: `${job.data.progress}%` }} /></span>
              <span className="fine">{job.data.status_display}… we will email nothing — just wait here.</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 5. Students
 * ------------------------------------------------------------------ */
function Students() {
  const { schoolId, readOnly } = useSchool();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const { search: locationSearch } = useLocation();
  const [pending, setPending] = useState(locationSearch.includes('pending=1'));
  const [editing, setEditing] = useState<PanelStudent | null>(null);
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setTerm(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: filters } = useQuery({ queryKey: ['panel-filters', schoolId], queryFn: () => panel.filters(schoolId!), enabled: !!schoolId });
  const params: Record<string, string> = {};
  if (term) params.search = term;
  if (classFilter) params.class_name = classFilter;
  if (pending) params.pending = '1';
  const path = `/panel/students/?${new URLSearchParams({ school: schoolId!, ...params })}`;

  const students = useInfiniteQuery({
    queryKey: ['panel-students', schoolId, params],
    queryFn: ({ pageParam }) => api<{ next: string | null; previous: string | null; results: PanelStudent[] }>(pageParam ?? path),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => relative(last.next),
    enabled: !!schoolId,
  });
  const rows = students.data?.pages.flatMap((p) => p.results) ?? [];
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ['panel-students'] }); queryClient.invalidateQueries({ queryKey: ['panel-dashboard'] }); };

  const approve = useMutation({ mutationFn: (s: PanelStudent) => panel.approveStudent(schoolId!, s.id), onSuccess: invalidate });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">STUDENTS</div>
          <h1>Roster</h1>
          <p className="muted">Search, edit, approve parent-added children and bulk import.</p>
        </div>
        {!readOnly && <button className="primary" onClick={() => setAdding(true)}>+ Add student</button>}
      </div>

      {!readOnly && <StudentImportCard schoolId={schoolId} onDone={invalidate} />}

      <section className="card">
        <div className="filters">
          <div className="search">
            <span>⌕</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or GR number" />
          </div>
          <label>Class
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="">All classes</option>
              {(filters?.classes ?? []).map((c) => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} />
            Pending approval only
          </label>
        </div>

        {students.isLoading && <div className="empty slim"><h3>Loading students…</h3></div>}
        {students.isError && <div className="empty slim"><h3>Could not load the roster</h3></div>}
        {!students.isLoading && rows.length === 0 && <div className="empty slim"><h3>No students match</h3></div>}

        {rows.length > 0 && (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Student</th><th>GR number</th><th>Class</th><th>Parent</th><th>Status</th><th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`/school/students/${s.id}`} className="cell-link">{s.name}</Link></td>
                    <td className="mono">{s.gr_number}</td>
                    <td>{s.class_name}{s.section ? ` ${s.section}` : ''}</td>
                    <td>{s.parent_name || <span className="muted">No parent linked</span>}<small className="gr">{s.parent_phone || ''}</small></td>
                    <td>{s.approval_status === 'PENDING'
                      ? <span className="badge s-pending">pending approval</span>
                      : <span className="badge s-approved">approved</span>}</td>
                    <td className="r actions">
                      {s.approval_status === 'PENDING' && !readOnly && (
                        <button className="link-button" disabled={approve.isPending} onClick={() => approve.mutate(s)}>Approve</button>
                      )}
                      <Link className="link-button" to={`/school/students/${s.id}`}>Orders</Link>
                      {!readOnly && <button className="link-button" onClick={() => setEditing(s)}>Edit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="load-more">
        {students.hasNextPage ? (
          <button className="secondary" disabled={students.isFetchingNextPage} onClick={() => students.fetchNextPage()}>
            {students.isFetchingNextPage ? 'Loading…' : 'Load more students'}
          </button>
        ) : (
          rows.length > 0 && <span className="fine">End of the list — {rows.length} loaded.</span>
        )}
      </div>

      {(adding || editing) && (
        <StudentForm
          schoolId={schoolId!}
          student={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); invalidate(); }}
        />
      )}
    </>
  );
}

function StudentForm({ schoolId, student, onClose, onSaved }: { schoolId: string; student: PanelStudent | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: student?.name ?? '',
    gr_number: student?.gr_number ?? '',
    class_name: student?.class_name ?? '',
    section: student?.section ?? '',
    gender: student?.gender ?? 'MALE',
    date_of_birth: student?.date_of_birth ?? '',
  });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => (student
      ? panel.editStudent(schoolId, student.id, { ...form, school: schoolId })
      : panel.addStudent(schoolId, { ...form, school: schoolId })),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Modal title={student ? `Edit ${student.name}` : 'Add a student'} onClose={onClose}>
      <form className="form-card" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label>Full name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>GR number<input value={form.gr_number} onChange={(e) => setForm({ ...form, gr_number: e.target.value })} required /></label>
        <div className="form-row">
          <label>Class<input value={form.class_name} onChange={(e) => setForm({ ...form, class_name: e.target.value })} required /></label>
          <label>Section<input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} required /></label>
        </div>
        <label>Gender
          <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
          </select>
        </label>
        <label>Date of birth<input type="date" value={form.date_of_birth ?? ''} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></label>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save student'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * 5b. Bulk import (upload -> preview -> confirm)
 * ------------------------------------------------------------------ */
function StudentImportCard({ schoolId, onDone }: { schoolId: string | null; onDone: () => void }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = useMutation({ mutationFn: (id: string) => panel.confirmImport(schoolId!, id) });

  const job = useQuery({
    queryKey: ['panel-import', jobId],
    queryFn: () => panel.importJob(schoolId!, jobId!),
    enabled: !!jobId && !!schoolId,
    refetchInterval: (q) => (q.state.data && ['PENDING', 'VALIDATING', 'IMPORTING'].includes(q.state.data.status) ? 1500 : false),
  });
  const data = job.data;
  const preview = (data?.preview ?? {}) as { errors?: { row: number; name?: string; errors?: Record<string, string> }[]; duplicates?: { row: number; name?: string; gr_number?: string }[]; valid?: unknown[] };
  const announced = useRef(false);
  useEffect(() => {
    if (data?.status === 'COMPLETED' && !announced.current) {
      announced.current = true;
      onDone();
    }
  }, [data?.status, onDone]);

  async function pick(file: File | undefined) {
    if (!file || !schoolId) return;
    setBusy(true); setError(''); setJobId(null);
    try { const j = await panel.uploadImport(schoolId, file); setJobId(j.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setBusy(false); }
  }

  return (
    <section className="card import-panel">
      <div className="card-head">
        <h2>Bulk import from Excel</h2>
        <div className="row-gap">
          {schoolId && <button className="link-button" onClick={() => download(panel.importTemplateUrl(schoolId, 'xlsx'), 'student-import-template.xlsx')}>Template (.xlsx)</button>}
          {schoolId && <button className="link-button" onClick={() => download(panel.importTemplateUrl(schoolId, 'csv'), 'student-import-template.csv')}>Template (.csv)</button>}
        </div>
      </div>
      <p className="muted pad-tight">Upload the roster, check the preview, then confirm. Nothing is inserted until you confirm — and both steps run as background jobs.</p>
      <div className="row-gap wrap">
        <label className="secondary file">
          {busy ? 'Uploading…' : 'Choose file'}
          <input type="file" accept=".xlsx,.xls,.csv" hidden disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {data && data.status === 'PREVIEW_READY' && (
          <button className="secondary" disabled={confirm.isPending} onClick={() => confirm.mutateAsync(data.id).then(() => { onDone?.(); })}>
            Import {data.valid_count} student{data.valid_count === 1 ? '' : 's'}
          </button>
        )}
        {data && (data.error_count > 0 || data.duplicate_count > 0) && (
          <button className="link-button" onClick={() => download(panel.importReportUrl(schoolId!, data.id), `import-${data.id}-report.csv`)}>Download rejected rows</button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {data && (
        <div className="import-status">
          <div className="job-line">
            <span className={`badge s-${data.status.toLowerCase()}`}>{data.status.replace('_', ' ').toLowerCase()}</span>
            <span className="progress"><i style={{ width: `${data.progress}%` }} /></span>
          </div>
          <div className="stat-grid four">
            <StatCard label="ROWS" value={num(data.total_rows)} />
            <StatCard label="VALID" value={num(data.valid_count)} />
            <StatCard label="DUPLICATES" value={num(data.duplicate_count)} />
            <StatCard label="ERRORS" value={num(data.error_count)} />
          </div>
          {data.status === 'COMPLETED' && (
            <p className="ok-line">✓ Imported {(data.result as { inserted?: number })?.inserted ?? 0} students.</p>
          )}
          {!!preview.errors?.length && (
            <div className="preview-list">
              <b>Rows with problems</b>
              {preview.errors.slice(0, 5).map((row, i) => (
                <small key={i}>Row {row.row}: {Object.values(row.errors ?? {}).join(', ') || 'invalid row'}</small>
              ))}
            </div>
          )}
          {!!preview.duplicates?.length && (
            <div className="preview-list">
              <b>Duplicate GR numbers (skipped)</b>
              {preview.duplicates.slice(0, 5).map((row, i) => <small key={i}>Row {row.row}: {row.name} · {row.gr_number}</small>)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
/* ------------------------------------------------------------------ *
 * 3. Per-student view
 * ------------------------------------------------------------------ */
function StudentDetail() {
  const { id = '' } = useParams();
  const { schoolId } = useSchool();
  const [year, setYear] = useState(String(currentAcademicYear()));

  // Cursor pagination: the first page also carries the child's totals.
  const path = `/panel/students/${id}/orders/?${new URLSearchParams({ school: schoolId!, year })}`;
  const query = useInfiniteQuery({
    queryKey: ['panel-student-orders', schoolId, id, year],
    queryFn: ({ pageParam }) => api<StudentOrders>(pageParam ?? path),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => relative(last.next),
    enabled: !!schoolId && !!id,
  });
  const data = query.data?.pages[0];
  const rows = query.data?.pages.flatMap((page) => page.results) ?? [];

  return (
    <>
      <Link to="/school/students" className="back">← Roster</Link>
      {query.isError && <div className="empty"><h3>Could not load this student</h3></div>}
      {query.isLoading && !data && <div className="empty"><h3>Loading orders…</h3></div>}
      {data && (
        <>
          <div className="page-head">
            <div>
              <div className="eyebrow">PER-STUDENT VIEW</div>
              <h1>{data.student.name}</h1>
              <p className="muted">
                {data.student.gr_number} · Class {data.student.class_name}
                {data.student.section ? ` ${data.student.section}` : ''} · {data.date_from} → {data.date_to}
              </p>
            </div>
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {[0, 1, 2].map((offset) => {
                const y = currentAcademicYear() - offset;
                return <option key={y} value={String(y)}>{y}–{String(y + 1).slice(2)}</option>;
              })}
            </select>
          </div>
          <section className="stat-grid three">
            <StatCard label="ORDERS" value={num(data.totals.orders)} hint={`academic year ${year}`} />
            <StatCard label="UNITS" value={num(data.totals.units)} hint="items bought" />
            <StatCard label="GROSS SALES" value={money(data.totals.gross_sales)} accent />
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Orders</h2>
              <span className="pill">{rows.length} of {num(data.totals.orders)}</span>
            </div>
            {rows.length === 0 ? (
              <div className="empty slim"><h3>No orders in this year</h3></div>
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr><th>Order</th><th>Date</th><th>Items</th><th className="r">Units</th><th className="r">Amount</th><th>Status</th><th>Placed by</th></tr>
                  </thead>
                  <tbody>{rows.map((o) => <OrderRow key={o.id} order={o} />)}</tbody>
                </table>
              </div>
            )}
          </section>
          <div className="load-more">
            {query.hasNextPage ? (
              <button className="secondary" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                {query.isFetchingNextPage ? 'Loading…' : 'Load more orders'}
              </button>
            ) : (
              rows.length > 0 && <span className="fine">All {num(data.totals.orders)} orders for this child are loaded.</span>
            )}
          </div>
        </>
      )}
    </>
  );
}

function currentAcademicYear() {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

/* ------------------------------------------------------------------ *
 * 6. Teachers
 * ------------------------------------------------------------------ */
function Teachers() {
  const { schoolId, readOnly } = useSchool();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<PanelTeacher | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['panel-teachers', schoolId], queryFn: () => panel.teachers(schoolId!), enabled: !!schoolId });
  const toggle = useMutation({
    mutationFn: ({ t, active }: { t: PanelTeacher; active: boolean }) => panel.setTeacherActive(schoolId!, t.id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['panel-teachers'] }),
  });
  const rows = data?.results ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">STAFF</div>
          <h1>Teacher logins</h1>
          <p className="muted">Create accounts for your school and deactivate leavers without losing their order history.</p>
        </div>
        {!readOnly && <button className="primary" onClick={() => setAdding(true)}>+ Add teacher</button>}
      </div>

      {created && (
        <div className="notice credentials">
          <b>{created.username} created.</b> Temporary password <code>{created.temporary_password}</code> — share it once; it is not shown again.
          <button className="link-button" onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}

      <section className="card">
        {isLoading && <div className="empty slim"><h3>Loading teachers…</h3></div>}
        {!isLoading && rows.length === 0 && <div className="empty slim"><h3>No teacher accounts yet</h3><p>Add one so teachers can order on behalf of students.</p></div>}
        {rows.length > 0 && (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>Name</th><th>Username</th><th>Contact</th><th>Status</th><th className="r">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className={t.is_active ? '' : 'row-muted'}>
                    <td>{[t.first_name, t.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td className="mono">{t.username}</td>
                    <td>{t.email || '—'}<small className="gr">{t.phone || ''}</small></td>
                    <td>{t.is_active
                      ? <span className="badge s-approved">{t.must_change_password ? 'must set password' : 'active'}</span>
                      : <span className="badge s-failed">deactivated</span>}</td>
                    <td className="r actions">
                      {!readOnly && (
                        <button className="link-button" disabled={toggle.isPending} onClick={() => toggle.mutate({ t, active: !t.is_active })}>
                          {t.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adding && (
        <Modal title="Add a teacher" onClose={() => setAdding(false)}>
          <TeacherForm
            schoolId={schoolId!}
            onCreated={(t) => { setCreated(t); setAdding(false); queryClient.invalidateQueries({ queryKey: ['panel-teachers'] }); }}
          />
        </Modal>
      )}
    </>
  );
}

function TeacherForm({ schoolId, onCreated }: { schoolId: string; onCreated: (t: PanelTeacher) => void }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => panel.addTeacher(schoolId, form),
    onSuccess: onCreated,
    onError: (e: Error) => setError(e.message),
  });
  return (
    <form className="form-card" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <div className="form-row">
        <label>First name<input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required /></label>
        <label>Last name<input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label>
      </div>
      <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
      <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
      <label>Password (optional — we generate one)
        <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min 8 characters" />
      </label>
      {error && <div className="error">{error}</div>}
      <button className="primary full" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create teacher login'}</button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * 4b. Exports list
 * ------------------------------------------------------------------ */
function Exports() {
  const { schoolId } = useSchool();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['panel-exports', schoolId],
    queryFn: () => panel.exports(schoolId!),
    enabled: !!schoolId,
    refetchInterval: (q) => (q.state.data?.results.some((j) => ['QUEUED', 'RUNNING'].includes(j.status)) ? 2000 : false),
  });
  const remove = useMutation({
    mutationFn: (id: string) => panel.deleteExport(schoolId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['panel-exports'] }),
  });
  const jobs = data?.results ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">EXPORTS</div>
          <h1>Excel exports</h1>
          <p className="muted">Files are built by a background worker in streaming mode. Nothing is generated inside a page request.</p>
        </div>
        <button className="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['panel-exports'] })}>Refresh</button>
      </div>

      <section className="card">
        {isLoading && <div className="empty slim"><h3>Loading exports…</h3></div>}
        {!isLoading && jobs.length === 0 && <div className="empty slim"><h3>No exports yet</h3><p>Use “Export to Excel” on the Orders page.</p></div>}
        {jobs.length > 0 && (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>File</th><th>Report</th><th>Status</th><th className="r">Rows</th><th>Requested</th><th className="r">Actions</th></tr>
              </thead>
              <tbody>
                {jobs.map((j) => <ExportRow key={j.id} job={j} onDelete={() => remove.mutate(j.id)} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ExportRow({ job, onDelete }: { job: ExportJob; onDelete: () => void }) {
  const { readOnly } = useSchool();
  const running = ['QUEUED', 'RUNNING'].includes(job.status);
  return (
    <tr>
      <td className="mono">{job.filename}</td>
      <td>{job.job_type_display}</td>
      <td>
        {running
          ? <span className="progress wide"><i style={{ width: `${job.progress}%` }} /></span>
          : <span className={`badge s-${job.status.toLowerCase()}`}>{job.status_display.toLowerCase()}</span>}
        {job.status === 'FAILED' && <small className="gr">{job.error_message}</small>}
      </td>
      <td className="r">{job.row_count ? num(job.row_count) : '—'}</td>
      <td>{new Date(job.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        <small className="gr">{job.requested_by_name ?? ''}</small>
      </td>
      <td className="r actions">
        {job.download_url
          ? <button className="link-button" onClick={() => download(job.download_url!, job.filename)}>Download ⤓</button>
          : <span className="fine">{running ? 'building…' : '—'}</span>}
        {!readOnly && <button className="link-button" onClick={onDelete}>Delete</button>}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ *
 * Small shared bits
 * ------------------------------------------------------------------ */
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>
  );
}

function clean(params: Record<string, string>) {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v));
}
