import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  SIZE_CHART_COLUMNS,
  sizeCharts,
  type SizeChartItem,
  type SizeChartRowData,
  type SizeChartValues,
} from '../../api';
import { Skeleton } from '../ui/Skeleton';
import './sizeChartManager.css';

const LABELS: Record<(typeof SIZE_CHART_COLUMNS)[number], string> = {
  height_cm_min: 'Height min',
  height_cm_max: 'Height max',
  weight_kg_min: 'Weight min',
  weight_kg_max: 'Weight max',
  shoulder_cm_min: 'Shoulder min',
  shoulder_cm_max: 'Shoulder max',
  chest_cm_min: 'Chest min',
  chest_cm_max: 'Chest max',
  length_cm: 'Length',
};

type Draft = Record<(typeof SIZE_CHART_COLUMNS)[number], string>;

const toDraft = (row: SizeChartRowData): Draft =>
  Object.fromEntries(SIZE_CHART_COLUMNS.map((c) => [c, row[c] === null ? '' : String(row[c])])) as Draft;

const fromDraft = (draft: Draft): SizeChartValues =>
  Object.fromEntries(SIZE_CHART_COLUMNS.map((c) => [c, draft[c].trim() === '' ? null : Number(draft[c])])) as SizeChartValues;

function errorText(e: unknown): string {
  const data = (e as { data?: Record<string, unknown> })?.data;
  if (data && typeof data === 'object') {
    const parts = Object.values(data).flat().filter((v) => typeof v === 'string');
    if (parts.length) return parts.join(' ');
  }
  return e instanceof Error ? e.message : 'Could not save';
}

/**
 * Size charts for one school (or the shared items): every item that comes in
 * more than one size, with one row of cm and kg per size. Edit a size in
 * place, add a missing size, remove a chart, or copy one item's chart to
 * others (so one chart serves every shirt of the school). Panels: Boss,
 * Admin, School Admin.
 */
export function SizeChartManager({ scope, scopeName }: { scope: string; scopeName: string }) {
  const queryClient = useQueryClient();
  const key = ['size-charts', scope];
  const charts = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => sizeCharts.charts(scope, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
  const items = charts.data?.pages.flatMap((p) => p.results) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  return (
    <section className="card size-chart-manager">
      <div className="card-head">
        <h2>Charts: {scopeName}</h2>
      </div>
      <p className="muted pad-tight">
        Heights and widths in cm, weights in kg. Height min and max are needed for every size you fill in. Past orders
        keep the sizes they were given.
      </p>
      {charts.isLoading && (
        <div className="pad">
          <Skeleton height={44} style={{ marginBottom: 8 }} />
          <Skeleton height={44} style={{ marginBottom: 8 }} />
          <Skeleton height={44} />
        </div>
      )}
      {charts.isError && <div className="error">{errorText(charts.error)}</div>}
      {!charts.isLoading && items.length === 0 && (
        <p className="pad muted">No item here comes in more than one size.</p>
      )}
      {items.map((item) => (
        <ChartItem key={item.product_id} item={item} items={items} scope={scope} onChanged={refresh} />
      ))}
      {charts.hasNextPage && (
        <div className="pad">
          <button className="secondary" disabled={charts.isFetchingNextPage} onClick={() => void charts.fetchNextPage()}>
            {charts.isFetchingNextPage ? 'Loading…' : 'Load more items'}
          </button>
        </div>
      )}
    </section>
  );
}

function ChartItem({
  item,
  items,
  scope,
  onChanged,
}: {
  item: SizeChartItem;
  items: SizeChartItem[];
  scope: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const filled = item.rows.filter((r) => r.id).length;

  async function removeChart() {
    if (!window.confirm(`Remove the whole chart for ${item.product_name}?`)) return;
    setError('');
    try {
      await sizeCharts.removeChart(scope, item.product_id);
      setMessage('Chart removed.');
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="chart-item">
      <button type="button" className="chart-item-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <b>{item.product_name}</b>
          <small>{item.category}</small>
        </span>
        <span className={`badge ${item.has_chart ? 's-completed' : 's-pending'}`}>
          {item.has_chart ? `${filled} of ${item.rows.length} sizes` : 'No chart'}
        </span>
      </button>
      {open && (
        <div className="chart-item-body">
          <div className="table-scroll">
            <table className="data chart-table">
              <thead>
                <tr>
                  <th>Size</th>
                  {SIZE_CHART_COLUMNS.map((c) => (
                    <th key={c} className="r">{LABELS[c]}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {item.rows.map((row) => (
                  <ChartRow key={row.variant} row={row} onChanged={onChanged} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-gap wrap chart-actions">
            {item.has_chart && (
              <button className="secondary" onClick={() => setCopying(!copying)}>
                Use this chart for other items
              </button>
            )}
            {item.has_chart && (
              <button className="link-button danger-link" onClick={() => void removeChart()}>
                Remove chart
              </button>
            )}
          </div>
          {copying && (
            <CopyChart
              source={item}
              items={items}
              scope={scope}
              onDone={(text) => {
                setCopying(false);
                setMessage(text);
                onChanged();
              }}
            />
          )}
          {message && <p className="ok-line">{message}</p>}
          {error && <div className="error">{error}</div>}
        </div>
      )}
    </div>
  );
}

function ChartRow({ row, onChanged }: { row: SizeChartRowData; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const values = fromDraft(draft);
      if (row.id) await sizeCharts.editRow(row.id, values);
      else await sizeCharts.addRow({ variant: row.variant, ...values });
      setDraft(null);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!row.id) return;
    setBusy(true);
    setError('');
    try {
      await sizeCharts.removeRow(row.id);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <b>{row.size}</b>
          <small className="muted">{row.sku}</small>
        </td>
        {SIZE_CHART_COLUMNS.map((c) => (
          <td key={c} className="r">
            {draft ? (
              <input
                className="chart-input"
                inputMode="decimal"
                aria-label={`${row.size} ${LABELS[c]}`}
                value={draft[c]}
                onChange={(e) => setDraft({ ...draft, [c]: e.target.value })}
              />
            ) : row[c] === null ? (
              '-'
            ) : (
              row[c]
            )}
          </td>
        ))}
        <td className="chart-row-actions">
          {draft ? (
            <>
              <button className="link-button" disabled={busy} onClick={() => void save()}>Save</button>
              <button className="link-button" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
            </>
          ) : (
            <>
              <button className="link-button" onClick={() => setDraft(toDraft(row))}>{row.id ? 'Edit' : 'Add'}</button>
              {row.id && <button className="link-button danger-link" disabled={busy} onClick={() => void remove()}>Clear</button>}
            </>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={SIZE_CHART_COLUMNS.length + 2}>
            <div className="error">{error}</div>
          </td>
        </tr>
      )}
    </>
  );
}

function CopyChart({
  source,
  items,
  scope,
  onDone,
}: {
  source: SizeChartItem;
  items: SizeChartItem[];
  scope: string;
  onDone: (message: string) => void;
}) {
  const others = items.filter((i) => i.product_id !== source.product_id);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function copy() {
    setBusy(true);
    setError('');
    try {
      const res = await sizeCharts.copy(scope, source.product_id, picked);
      const lines = res.products.map(
        (p) =>
          `${p.product_name}: ${p.rows_written} sizes` +
          (p.sizes_not_in_source.length ? ` (not in the chart: ${p.sizes_not_in_source.join(', ')})` : ''),
      );
      onDone(`Copied. ${lines.join('. ')}.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (others.length === 0) return <p className="muted">There are no other sized items to copy to.</p>;

  return (
    <div className="copy-chart">
      <p className="muted">
        Sizes are matched by their label. Matching sizes on the items you pick are replaced; other sizes stay as they are.
      </p>
      <div className="copy-chart-list">
        {others.map((item) => (
          <label key={item.product_id} className="copy-chart-option">
            <input
              type="checkbox"
              checked={picked.includes(item.product_id)}
              onChange={(e) =>
                setPicked(e.target.checked ? [...picked, item.product_id] : picked.filter((id) => id !== item.product_id))
              }
            />
            <span>{item.product_name}</span>
          </label>
        ))}
      </div>
      <button className="primary" disabled={busy || picked.length === 0} onClick={() => void copy()}>
        {busy ? 'Copying…' : `Copy to ${picked.length} item${picked.length === 1 ? '' : 's'}`}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
