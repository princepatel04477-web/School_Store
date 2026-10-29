import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { retail } from '../api';
import { PanelShell, type PanelNavItem } from '../components/admin/PanelShell';
import { SchoolBuilding } from '../components/ui/icons';
import { SchoolRequestForm } from '../components/admin/retail/SchoolRequestForm';
import { RequestSkeleton, SignedInLogo, StatusBadge, formatDate } from '../components/admin/retail/RetailBits';
import { Skeleton } from '../components/ui/Skeleton';

const NAV: PanelNavItem[] = [{ to: '', label: 'My schools', icon: SchoolBuilding, end: true }];

export default function Retailer() {
  const store = useQuery({ queryKey: ['retail-my-store'], queryFn: retail.myStore });
  return (
    <PanelShell base="/retailer" role="Retail Shop" context={store.data?.name} nav={NAV}>
      <Routes>
        <Route index element={<MySchoolsView />} />
      </Routes>
    </PanelShell>
  );
}

function MySchoolsView() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const store = useQuery({ queryKey: ['retail-my-store'], queryFn: retail.myStore });
  const requests = useQuery({ queryKey: ['retail-my-requests'], queryFn: () => retail.requests() });

  if (store.isError) {
    return (
      <div className="empty">
        <p>Your shop isn't set up yet, or it is switched off. Contact the store owner.</p>
      </div>
    );
  }

  const schools = store.data?.schools ?? [];
  const rows = requests.data?.results ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">YOUR SHOP</div>
          <h1>{store.data ? store.data.name : <Skeleton width={220} height={36} />}</h1>
          <p className="muted">Ask for each school you supply. After the store owner approves it, you can add its uniforms.</p>
        </div>
        <button type="button" className="primary" onClick={() => setFormOpen(true)} disabled={!store.data?.active}>
          Request a school
        </button>
      </div>

      {sent && (
        <div className="notice" role="status">
          Request sent. You'll see the answer here.
          <button type="button" className="link-button" onClick={() => setSent(false)}>Close</button>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Approved schools</h2>
          {store.data && <span className="badge s-approved">{schools.length}</span>}
        </div>
        {store.isLoading ? (
          <RequestSkeleton rows={1} />
        ) : schools.length === 0 ? (
          <div className="pad"><div className="empty slim">No approved schools yet. Send a request to get started.</div></div>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>School</th><th>UDISE code</th></tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.name}</b></td>
                    <td className="mono">{s.udise_code ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Your requests</h2>
        </div>
        {requests.isLoading ? (
          <RequestSkeleton />
        ) : requests.isError ? (
          <div className="pad">
            <div className="error" role="alert">
              Could not load your requests.{' '}
              <button type="button" className="link-button" onClick={() => requests.refetch()}>Try again</button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="pad"><div className="empty slim">You haven't sent any requests yet.</div></div>
        ) : (
          <div className="retail-requests">
            {rows.map((r) => (
              <div className="retail-request" key={r.id}>
                <div className="retail-request-head">
                  <SignedInLogo path={retail.requestLogoPath(r.id)} alt={`${r.name} logo`} />
                  <div className="retail-request-meta">
                    <h3>{r.name}</h3>
                    <span>UDISE <span className="mono">{r.udise_code}</span> · {r.board_label} · {r.city_name}</span>
                    <span className="muted">Sent {formatDate(r.created_at)}</span>
                    <span><StatusBadge status={r.status} /></span>
                    {r.status === 'REJECTED' && r.reject_reason && (
                      <span>Reason: {r.reject_reason}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && store.data && (
        <SchoolRequestForm
          defaultCity={store.data.city}
          onClose={() => setFormOpen(false)}
          onSent={() => {
            setFormOpen(false);
            setSent(true);
            queryClient.invalidateQueries({ queryKey: ['retail-my-requests'] });
          }}
        />
      )}
    </div>
  );
}
