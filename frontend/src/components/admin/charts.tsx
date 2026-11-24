import type { ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { money, num, type Money, type TrendBucket } from '../../api';
import { Skeleton } from '../ui/Skeleton';
import './charts.css';

/**
 * Shared dashboard pieces for the Boss, City, School and Teacher screens.
 *
 * Every trend arrives from the server with one point per day (or week / month),
 * zero on quiet days, so the lines here rise and fall with real sales.
 * Chart colours are the house colours in the order the dataviz validator passed:
 * slot 1 is always revenue / sales, slot 2 profit.
 */
export const CHART_COLORS = ['#2E5EAA', '#E0A100', '#D7263D', '#13896F', '#E0703A', '#5C88D6'];
const GRID = '#DCE0E5';
const TICK = { fontSize: 11, fill: '#545C66' };

const compactInr = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
export const moneyShort = (v: number) => (v === 0 ? '₹0' : `₹${compactInr.format(v)}`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parseDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Axis label: "24 Nov" for days and weeks, "Nov 26" for months. */
export function tickDate(iso: string, bucket: TrendBucket = 'day') {
  const d = parseDay(iso);
  if (bucket === 'month') return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Tooltip heading: "Tue 24 Nov", "Week of 3 Nov", "November 2026". */
export function longDate(iso: string, bucket: TrendBucket = 'day') {
  const d = parseDay(iso);
  if (bucket === 'month') return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  if (bucket === 'week') return `Week of ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export type TrendSeries = {
  key: string;
  name: string;
  color: string;
  /** 'area' is the main measure, 'line' a second one in the same unit. */
  kind?: 'area' | 'line';
};

type Point = Record<string, string | number>;

/**
 * Change over time. Money and counts never share an axis: pass one unit per chart
 * (`unit`), and give orders their own small bar chart with `OrdersStrip`.
 */
export function TrendChart({
  data, series, bucket = 'day', unit = 'money', height = 260, extra,
}: {
  data: Point[];
  series: TrendSeries[];
  bucket?: TrendBucket;
  unit?: 'money' | 'count';
  height?: number;
  /** Extra tooltip lines, e.g. the orders on that day. */
  extra?: (p: Point) => ReactNode;
}) {
  const rows = data.map((p) => {
    const row: Point = { ...p };
    for (const s of series) row[s.key] = Number(p[s.key] ?? 0);
    return row;
  });
  const fmt = unit === 'money' ? (v: number) => money(v) : (v: number) => num(v);
  return (
    <div className="trend-chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="date"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            tickFormatter={(v) => tickDate(String(v), bucket)}
            minTickGap={24}
          />
          <YAxis
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={unit === 'money' ? 52 : 32}
            allowDecimals={false}
            tickFormatter={(v) => (unit === 'money' ? moneyShort(Number(v)) : num(Number(v)))}
          />
          <Tooltip
            cursor={{ stroke: '#8C939C', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Point;
              return (
                <div className="chart-tip">
                  <b>{longDate(String(p.date), bucket)}</b>
                  {series.map((s) => (
                    <span key={s.key}>
                      <i style={{ background: s.color }} />
                      {s.name}
                      <em>{fmt(Number(p[s.key]))}</em>
                    </span>
                  ))}
                  {extra?.(p)}
                </div>
              );
            }}
          />
          {series.map((s) =>
            s.kind === 'line' ? (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#FFFFFF' }}
                isAnimationActive={false}
              />
            ) : (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.12}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#FFFFFF' }}
                isAnimationActive={false}
              />
            ),
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Orders per day as thin columns, under a money trend (own axis, own chart). */
export function OrdersStrip({
  data, dataKey = 'orders', bucket = 'day', height = 120, color = CHART_COLORS[3], label = 'Orders', yWidth = 52,
}: {
  /** Match the money chart above (52) so both x-axes line up. */
  yWidth?: number;
  data: Point[];
  dataKey?: string;
  bucket?: TrendBucket;
  height?: number;
  color?: string;
  label?: string;
}) {
  const rows = data.map((p) => ({ ...p, [dataKey]: Number(p[dataKey] ?? 0) }));
  return (
    <div className="trend-chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="date"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            tickFormatter={(v) => tickDate(String(v), bucket)}
            minTickGap={24}
          />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={yWidth} allowDecimals={false} tickCount={3} />
          <Tooltip
            cursor={{ fill: '#F1F3F5' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Point;
              return (
                <div className="chart-tip">
                  <b>{longDate(String(p.date), bucket)}</b>
                  <span><i style={{ background: color }} />{label}<em>{num(Number(p[dataKey]))}</em></span>
                </div>
              );
            }}
          />
          <Bar dataKey={dataKey} name={label} fill={color} radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Legend row for charts with two series; one series is named by the card title. */
export function ChartLegend({ items }: { items: { name: string; color: string; line?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.name}><i className={it.line ? 'line' : ''} style={{ background: it.color }} />{it.name}</span>
      ))}
    </div>
  );
}

export type RankRow = { key: string; label: string; sub?: string; value: number; display: string; color?: string };

/**
 * Ranked horizontal bars as plain rows: on a phone a long school or product
 * name gets the full width instead of being cut to fit beside a chart axis.
 */
export function RankList({ rows, color = CHART_COLORS[0], empty }: { rows: RankRow[]; color?: string; empty: string }) {
  if (!rows.length) return <p className="chart-empty">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="rank-list">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="rank-text">
            <span className="rank-label">{r.label}{r.sub && <small>{r.sub}</small>}</span>
            <b>{r.display}</b>
          </div>
          <span className="rank-track">
            <i style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: r.color ?? color }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Up / down against the period before, in words (never colour alone). */
export function Delta({
  now, before, days, format = num,
}: {
  now: Money | number;
  before: Money | number;
  days: number;
  /** How to show the earlier figure when the change is too large for a percent. */
  format?: (v: number) => string;
}) {
  const a = Number(now);
  const b = Number(before);
  const span = `previous ${days} day${days === 1 ? '' : 's'}`;
  if (b === 0 && a === 0) return <small className="delta flat">No sales in the {span} either</small>;
  if (b === 0) return <small className="delta up">New this period, none in the {span}</small>;
  const pct = ((a - b) / b) * 100;
  const rounded = Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.round(Math.abs(pct) * 10) / 10;
  if (rounded === 0) return <small className="delta flat">Same as the {span}</small>;
  if (Math.abs(pct) >= 1000) {
    return <small className={pct > 0 ? 'delta up' : 'delta down'}>{pct > 0 ? 'Up' : 'Down'} from {format(b)} in the {span}</small>;
  }
  return (
    <small className={pct > 0 ? 'delta up' : 'delta down'}>
      {pct > 0 ? 'Up' : 'Down'} {rounded}% on the {span}
    </small>
  );
}

export function KpiTile({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={accent ? 'stat accent' : 'stat'}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint}
    </div>
  );
}

export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="stat" aria-hidden="true">
          <Skeleton width="55%" height="11px" />
          <Skeleton width="70%" height="30px" style={{ marginTop: 10 }} />
          <Skeleton width="80%" height="11px" style={{ marginTop: 6 }} />
        </div>
      ))}
    </>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="chart-skeleton" style={{ height }} role="status" aria-label="Loading chart">
      {Array.from({ length: 14 }).map((_, i) => (
        <Skeleton key={i} height={`${25 + ((i * 37) % 60)}%`} />
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rank-list" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rank-skeleton">
          <Skeleton width={`${70 - i * 8}%`} height="12px" />
          <Skeleton width={`${90 - i * 12}%`} height="8px" />
        </div>
      ))}
    </div>
  );
}

/** "Live, updated 14:32" with a refresh button: the screens poll every minute. */
export function LiveStamp({ updatedAt, fetching, onRefresh }: { updatedAt: number; fetching: boolean; onRefresh: () => void }) {
  const time = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '-';
  return (
    <div className="live-stamp">
      <span className={fetching ? 'dot busy' : 'dot'} aria-hidden="true" />
      <span>{fetching ? 'Updating' : `Live, updated ${time}`}</span>
      <button type="button" className="link-button" onClick={onRefresh} disabled={fetching}>Refresh</button>
    </div>
  );
}

/** Refresh every minute while the screen is open (the server caches for 60 s). */
export const LIVE = { refetchInterval: 60_000, refetchOnWindowFocus: true } as const;
