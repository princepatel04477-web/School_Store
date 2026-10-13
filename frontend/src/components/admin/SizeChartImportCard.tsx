import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { download, num, sizeCharts, type SizeChartPreview } from '../../api';

/**
 * Size chart import for the School Admin and Boss panels:
 * template -> fill in cm and kg -> upload -> dry run -> confirm.
 * `scope` is a school id, or 'generic' for the items every school shares.
 */
export function SizeChartImportCard({ scope, scopeName }: { scope: string; scopeName: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const job = useQuery({
    queryKey: ['size-chart-import', scope, jobId],
    queryFn: () => sizeCharts.job(scope, jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && ['PENDING', 'VALIDATING', 'IMPORTING'].includes(q.state.data.status) ? 1500 : false),
  });
  const confirm = useMutation({
    mutationFn: (id: string) => sizeCharts.confirm(scope, id),
    onSuccess: () => void job.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save'),
  });

  const data = job.data;
  const preview = (data?.preview ?? {}) as SizeChartPreview;
  const summary = preview.summary;
  const result = (data?.result ?? {}) as { products?: number; rows_written?: number; rows_removed?: number };
  const accepted = summary?.products_accepted ?? 0;
  const rejected = summary?.products_rejected ?? 0;

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(''); setJobId(null);
    try { const j = await sizeCharts.upload(scope, file); setJobId(j.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setBusy(false); }
  }

  const templateName = `size-chart-${scopeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;

  return (
    <section className="card import-panel">
      <div className="card-head">
        <h2>Size charts: {scopeName}</h2>
        <div className="row-gap">
          <button className="link-button" onClick={() => download(sizeCharts.templateUrl(scope), templateName).catch((e) => setError(e.message))}>
            Download template (.csv)
          </button>
        </div>
      </div>
      <p className="muted pad-tight">
        The template lists every item that comes in more than one size, one row per SKU. Fill in the cm and kg for <b>every size</b> of an
        item (height is required, the rest is optional) and leave other items blank. Each item in the file has its whole chart replaced;
        items not in the file keep theirs. Nothing changes until you confirm. Past orders are never changed.
      </p>
      <div className="row-gap wrap">
        <label className="secondary file">
          {busy ? 'Uploading…' : 'Choose file'}
          <input type="file" accept=".csv,.xlsx" hidden disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {data?.status === 'PREVIEW_READY' && (
          <button className="secondary" disabled={confirm.isPending || accepted === 0} onClick={() => confirm.mutate(data.id)}>
            Import {num(accepted)} item{accepted === 1 ? '' : 's'}{rejected ? `, skip ${num(rejected)}` : ''}
          </button>
        )}
        {data && (rejected > 0 || (summary?.unknown_rows ?? 0) > 0) && (
          <button className="link-button" onClick={() => download(sizeCharts.reportUrl(scope, data.id), `size-chart-import-${data.id}-report.csv`)}>
            Download rejected rows
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      {data && (
        <div className="import-status">
          <div className="job-line">
            <span className={`badge s-${data.status.toLowerCase()}`}>{data.status.replace('_', ' ').toLowerCase()}</span>
            <span className="progress"><i style={{ width: `${data.progress}%` }} /></span>
          </div>

          {data.status === 'FAILED' && <div className="error">{data.error_message}</div>}

          {summary && (
            <div className="stat-grid four">
              <div className="stat"><span>ITEMS TO IMPORT</span><strong>{num(accepted)}</strong></div>
              <div className="stat"><span>ITEMS REJECTED</span><strong>{num(rejected)}</strong></div>
              <div className="stat"><span>NEW ROWS</span><strong>{num(summary.adds)}</strong></div>
              <div className="stat"><span>CHANGED ROWS</span><strong>{num(summary.replaces)}</strong></div>
            </div>
          )}

          {data.status === 'COMPLETED' && (
            <p className="ok-line">
              Saved {num(result.products ?? 0)} item{result.products === 1 ? '' : 's'}: {num(result.rows_written ?? 0)} sizes written
              {result.rows_removed ? `, ${num(result.rows_removed)} old rows replaced` : ''}.
            </p>
          )}

          {data.status === 'PREVIEW_READY' && !!preview.products?.length && (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="r">Add</th>
                    <th className="r">Replace</th>
                    <th className="r">Unchanged</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.products.map((p) => (
                    <tr key={p.product_id}>
                      <td>{p.product_name}</td>
                      <td className="r">{num(p.adds)}</td>
                      <td className="r">{num(p.replaces)}</td>
                      <td className="r">{num(p.unchanged)}</td>
                      <td>{p.deletes.length ? p.deletes.join(', ') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!!preview.rejected?.length && (
            <div className="preview-list">
              <b>Items that will not be imported</b>
              {preview.rejected.map((p) => (
                <small key={p.product_id}>
                  {p.product_name}: {p.reasons.join(' ')}
                  {p.missing_skus.length > 0 && ` Missing: ${p.missing_skus.join(', ')}.`}
                  {p.row_errors.slice(0, 3).map((row) => ` Row ${row.row} (${row.sku}): ${Object.values(row.errors).join(', ')}.`).join('')}
                </small>
              ))}
            </div>
          )}

          {!!preview.errors?.length && (
            <div className="preview-list">
              <b>Rows that match no item</b>
              {preview.errors.slice(0, 5).map((row, i) => (
                <small key={i}>Row {row.row}{row.sku ? ` (${row.sku})` : ''}: {Object.values(row.errors).join(', ')}</small>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
