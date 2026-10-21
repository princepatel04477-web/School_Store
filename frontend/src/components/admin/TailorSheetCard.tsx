import { useEffect, useState } from 'react';
import { download, tailorSheets, type ExportJob, type TailorFilters } from '../../api';
import { CLASSES } from '../../data/classes';
import './sizeChartManager.css';

const STATUS_CHOICES = [
  { value: '', label: 'Not dispatched yet (placed to packed)' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'PACKED', label: 'Packed' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'DELIVERED', label: 'Delivered' },
];

/** Requests a tailor sheet, waits for the worker, and downloads it. */
function useTailorSheet() {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState('');
  const busy = Boolean(job && (job.status === 'QUEUED' || job.status === 'RUNNING'));

  useEffect(() => {
    if (!job || !busy) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        setJob(await tailorSheets.job(job.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not check the sheet');
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [job, busy]);

  useEffect(() => {
    if (job?.status === 'READY' && job.download_url) {
      download(job.download_url, job.filename).catch((e) => setError(e.message));
    }
    if (job?.status === 'FAILED') setError(job.error_message || 'The sheet could not be built.');
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const request = async (filters: TailorFilters) => {
    setError('');
    try {
      setJob(await tailorSheets.create(filters));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not request the sheet');
    }
  };
  return { job, busy, error, request };
}

/**
 * Tailor sheet for a filtered set of orders (Prompt 25): one worksheet per
 * school, grouped by class and section, with every child's measurement and
 * sizes. Admin and Boss only. Rows to check are highlighted in the file.
 */
export function TailorSheetCard({ schools }: { schools: { id: string; name: string; code: string }[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [grade, setGrade] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { job, busy, error, request } = useTailorSheet();

  return (
    <section className="card tailor-card">
      <div className="card-head">
        <h2>Tailor sheet</h2>
      </div>
      <p className="muted pad-tight">
        One sheet per school, children grouped by class and section, with height, weight, shoulder and every size in
        the order. Rows outside the size chart or with a shoulder changed by hand are highlighted. Default: paid or
        cash-on-delivery orders not yet dispatched.
      </p>
      <div className="filters">
        <fieldset className="tailor-schools">
          <legend>Schools (none ticked: all)</legend>
          {schools.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={picked.includes(s.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((id) => id !== s.id))}
              />
              {s.name}
            </label>
          ))}
        </fieldset>
        <label>
          <span>Class:</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">All classes</option>
            {CLASSES.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Status:</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>From:</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          <span>To:</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>
      <div className="pad row-gap wrap">
        <button
          className="primary"
          style={{ width: 'auto' }}
          disabled={busy}
          onClick={() =>
            void request({
              schools: picked,
              grade,
              statuses: status ? [status] : [],
              date_from: dateFrom,
              date_to: dateTo,
            })
          }
        >
          {busy ? 'Building the sheet…' : 'Download tailor sheet (.xlsx)'}
        </button>
        {job?.status === 'READY' && (
          <span className="muted">
            {job.row_count} rows{typeof job.result?.rows_to_check === 'number' ? `, ${job.result.rows_to_check} to check` : ''}.
          </span>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </section>
  );
}

/** "Tailor sheet" for one order, on its detail page. */
export function TailorSheetButton({ orderId }: { orderId: string }) {
  const { busy, error, request } = useTailorSheet();
  return (
    <>
      <button className="secondary" style={{ width: 'auto' }} disabled={busy} onClick={() => void request({ order: orderId })}>
        {busy ? 'Building…' : 'Tailor sheet'}
      </button>
      {error && <div className="error">{error}</div>}
    </>
  );
}
