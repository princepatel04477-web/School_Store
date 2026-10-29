import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, bossPanel, retail, schoolLogoUrl, type RequestStatus, type SchoolRequest } from '../../../api';
import { RequestSkeleton, SignedInLogo, StatusBadge, formatDate } from './RetailBits';
import './retail.css';

const TABS: { status: RequestStatus; label: string }[] = [
  { status: 'PENDING', label: 'Waiting' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'REJECTED', label: 'Rejected' },
];

/** Where the Boss looks a UDISE code up by hand (there is no open API for it yet). */
const UDISE_SEARCH = 'https://udiseplus.gov.in/';

/** Boss: retailers' school requests, to approve or reject. */
export function SchoolRequestsReview() {
  const [status, setStatus] = useState<RequestStatus>('PENDING');
  const requests = useQuery({
    queryKey: ['boss-school-requests', status],
    queryFn: () => retail.requests(status),
  });
  const rows = requests.data?.results ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">RETAIL SHOPS</div>
          <h1>School requests</h1>
          <p className="muted">Check each UDISE code on the UDISE+ website, then approve or reject. Approved schools stay hidden from parents until they have uniforms.</p>
        </div>
      </div>

      <div className="card">
        <div className="retail-tabs" role="tablist" aria-label="Request status">
          {TABS.map((tab) => (
            <button
              key={tab.status}
              type="button"
              role="tab"
              aria-selected={status === tab.status}
              className={`chip${status === tab.status ? ' active' : ''}`}
              onClick={() => setStatus(tab.status)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {requests.isLoading ? (
          <RequestSkeleton />
        ) : requests.isError ? (
          <div className="pad">
            <div className="error" role="alert">
              Could not load the requests.{' '}
              <button type="button" className="link-button" onClick={() => requests.refetch()}>Try again</button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="pad"><div className="empty slim">{status === 'PENDING' ? 'No requests waiting.' : 'Nothing here yet.'}</div></div>
        ) : (
          <div className="retail-requests">
            {rows.map((r) => (r.status === 'PENDING' ? <PendingRequest key={r.id} request={r} /> : <DecidedRequest key={r.id} request={r} />))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestDetails({ request }: { request: SchoolRequest }) {
  return (
    <div className="retail-request-head">
      <SignedInLogo path={retail.requestLogoPath(request.id)} alt={`${request.name} logo`} />
      <div className="retail-request-meta">
        <h3>{request.name}</h3>
        <span>
          UDISE <span className="mono">{request.udise_code}</span>{' '}
          <a className="link-button" href={UDISE_SEARCH} target="_blank" rel="noopener noreferrer">
            Check on UDISE+
          </a>
        </span>
        <span>{request.address}, {request.city_name} {request.pincode}</span>
        <span>{request.board_label}</span>
        <span className="muted">From {request.store_name} · {formatDate(request.created_at)}</span>
      </div>
    </div>
  );
}

function DecidedRequest({ request }: { request: SchoolRequest }) {
  return (
    <div className="retail-request">
      <RequestDetails request={request} />
      <div className="retail-actions">
        <StatusBadge status={request.status} />
        <span className="muted">
          {request.status === 'APPROVED' ? `School: ${request.school_name ?? '-'}` : `Reason: ${request.reject_reason}`}
          {' · '}by {request.reviewed_by_name ?? '-'} on {formatDate(request.reviewed_at)}
        </span>
      </div>
    </div>
  );
}

function PendingRequest({ request }: { request: SchoolRequest }) {
  const id = useId();
  const queryClient = useQueryClient();
  const existing = request.existing_school;
  const [useNewLogo, setUseNewLogo] = useState(!existing?.has_logo);
  const [linkSchool, setLinkSchool] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Older schools added before UDISE codes were asked, to link instead of making a duplicate.
  const schools = useQuery({
    queryKey: ['boss-filter-options'],
    queryFn: () => bossPanel.filters(),
    enabled: !existing,
    staleTime: 5 * 60_000,
  });
  const sameCity = (schools.data?.schools ?? []).filter((s) => s.city_id === request.city);

  const done = () => queryClient.invalidateQueries({ queryKey: ['boss-school-requests'] });
  const onError = (err: unknown) => {
    const data = err instanceof ApiError ? err.data : {};
    const firstField = Object.values(data).find((v) => Array.isArray(v)) as string[] | undefined;
    setError(firstField?.join(' ') ?? (err instanceof Error ? err.message : 'Something went wrong.'));
  };

  const approve = useMutation({
    mutationFn: () => retail.approve(request.id, { school: linkSchool || null, use_new_logo: useNewLogo }),
    onSuccess: done,
    onError,
  });
  const reject = useMutation({
    mutationFn: () => retail.reject(request.id, reason.trim()),
    onSuccess: done,
    onError,
  });
  const busy = approve.isPending || reject.isPending;

  return (
    <div className="retail-request">
      <RequestDetails request={request} />

      {existing ? (
        <div className="retail-compare">
          <span>
            <b>{existing.name}</b> is already on the store with this UDISE code. Approving gives this shop that school.
          </span>
          {existing.has_logo && (
            <fieldset className="retail-logo-choice">
              <legend className="muted">Which logo should the school use?</legend>
              <label>
                <input type="radio" name={`${id}-logo`} checked={!useNewLogo} onChange={() => setUseNewLogo(false)} />
                <img className="retail-logo small" src={schoolLogoUrl(existing.id)} alt="Current logo" />
                Keep current logo
              </label>
              <label>
                <input type="radio" name={`${id}-logo`} checked={useNewLogo} onChange={() => setUseNewLogo(true)} />
                <SignedInLogo path={retail.requestLogoPath(request.id)} alt="New logo" small />
                Use this new logo
              </label>
            </fieldset>
          )}
        </div>
      ) : (
        <label className="retail-reason">
          <span className="muted">Already on the store under another entry without a UDISE code? Link it instead of making a new school.</span>
          <select value={linkSchool} onChange={(e) => setLinkSchool(e.target.value)} disabled={schools.isLoading}>
            <option value="">No, create a new school</option>
            {sameCity.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </label>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {rejecting ? (
        <form
          className="retail-reason"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!reason.trim()) return setError('Tell the retailer why the request is rejected.');
            reject.mutate();
          }}
        >
          <label htmlFor={`${id}-reason`} className="muted">Reason (the retailer sees this)</label>
          <textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2} />
          <div className="retail-actions">
            <button type="submit" className="primary" disabled={busy}>{reject.isPending ? 'Rejecting…' : 'Reject request'}</button>
            <button type="button" className="secondary" onClick={() => setRejecting(false)} disabled={busy}>Back</button>
          </div>
        </form>
      ) : (
        <div className="retail-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              setError(null);
              approve.mutate();
            }}
          >
            {approve.isPending ? 'Approving…' : 'Approve'}
          </button>
          <button type="button" className="secondary" onClick={() => setRejecting(true)} disabled={busy}>Reject</button>
        </div>
      )}
    </div>
  );
}
