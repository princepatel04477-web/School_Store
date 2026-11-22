import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  exchangeService,
  type SizeExchangeRequestItem,
  type StaffActionPayload,
} from '../../services/exchange';
import './ExchangeQueue.css';

interface ExchangeQueueProps {
  readOnly?: boolean;
  schoolId?: string | null;
  cityId?: string | null;
}

type FilterCategory = 'ALL' | 'NEEDS_REVIEW' | 'AWAITING_RETURN' | 'RECEIVED' | 'COMPLETED' | 'CLOSED';

export function ExchangeQueue({ readOnly = false, schoolId, cityId }: ExchangeQueueProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterCategory>('ALL');
  const [search, setSearch] = useState<string>('');

  // Modal action state
  const [activeModalRequest, setActiveModalRequest] = useState<SizeExchangeRequestItem | null>(null);
  const [modalAction, setModalAction] = useState<StaffActionPayload['action'] | null>(null);
  const [modalNote, setModalNote] = useState<string>('');
  const [inspectionResult, setInspectionResult] = useState<'RESTOCKABLE' | 'DAMAGED'>('RESTOCKABLE');
  const [windowStart, setWindowStart] = useState<string>('');
  const [windowEnd, setWindowEnd] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['exchange-queue', filter, search, schoolId, cityId],
    queryFn: () => {
      let statusParam: string | undefined;
      if (filter === 'NEEDS_REVIEW') statusParam = 'SUBMITTED';
      else if (filter === 'AWAITING_RETURN') statusParam = 'APPROVED,AWAITING_RETURN,WINDOW_CONFIRMED,HANDOVER_SCHEDULED';
      else if (filter === 'RECEIVED') statusParam = 'RECEIVED';
      else if (filter === 'COMPLETED') statusParam = 'COMPLETED';
      else if (filter === 'CLOSED') statusParam = 'REJECTED,WITHDRAWN,CANCELLED';

      return exchangeService.listQueue({
        status: statusParam,
        search: search || undefined,
        school: schoolId || undefined,
        city: cityId || undefined,
      });
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({
      requestId,
      payload,
    }: {
      requestId: string;
      payload: StaffActionPayload;
    }) => exchangeService.executeAction(requestId, payload),
    onSuccess: () => {
      closeModal();
      void queryClient.invalidateQueries({ queryKey: ['exchange-queue'] });
    },
    onError: (err: any) => {
      setActionError(err.message || 'Action failed.');
    },
  });

  const openActionModal = (
    req: SizeExchangeRequestItem,
    action: StaffActionPayload['action']
  ) => {
    setActiveModalRequest(req);
    setModalAction(action);
    setModalNote('');
    setInspectionResult('RESTOCKABLE');
    setWindowStart('');
    setWindowEnd('');
    setActionError(null);
  };

  const closeModal = () => {
    setActiveModalRequest(null);
    setModalAction(null);
    setActionError(null);
  };

  const submitModalAction = () => {
    if (!activeModalRequest || !modalAction) return;

    const payload: StaffActionPayload = {
      action: modalAction,
      note: modalNote || undefined,
    };

    if (modalAction === 'RECEIVE') {
      payload.inspection_result = inspectionResult;
    }
    if (modalAction === 'CONFIRM_WINDOW' || modalAction === 'SET_HANDOVER') {
      payload.window_mode = 'DATE_RANGE';
      if (windowStart) payload.window_start = new Date(windowStart).toISOString();
      if (windowEnd) payload.window_end = new Date(windowEnd).toISOString();
    }

    actionMutation.mutate({ requestId: activeModalRequest.id, payload });
  };

  const requests = data?.results || [];

  return (
    <div className="exchange-queue-container">
      <div className="exchange-queue-header">
        <div>
          <span className="eyebrow">ORDER MANAGEMENT</span>
          <h2>Size Exchange Queue</h2>
          {readOnly && (
            <p className="exchange-readonly-tag">
              Viewing in read-only mode (Action reserved for City Admin / Boss)
            </p>
          )}
        </div>

        <div className="exchange-queue-filters">
          <input
            type="search"
            placeholder="Search order, student, garment..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '220px', padding: '0.4rem 0.6rem', fontSize: '0.8125rem' }}
          />
        </div>
      </div>

      <div className="exchange-filter-chips">
        {(
          [
            ['ALL', 'All'],
            ['NEEDS_REVIEW', 'Needs Review'],
            ['AWAITING_RETURN', 'Awaiting Return / Scheduled'],
            ['RECEIVED', 'Received (Inspecting)'],
            ['COMPLETED', 'Completed'],
            ['CLOSED', 'Closed / Rejected'],
          ] as [FilterCategory, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? 'chip active' : 'chip'}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="card pad">Loading size exchanges…</div>
      ) : isError ? (
        <div className="card pad error">
          Failed to load exchange requests: {(error as Error)?.message}
        </div>
      ) : requests.length === 0 ? (
        <div className="empty">
          <p>No size exchange requests match your filter.</p>
        </div>
      ) : (
        <div className="exchange-queue-table-wrapper">
          <table className="exchange-queue-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Student / School</th>
                <th>Garment</th>
                <th>Exchange</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Reservation</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id}>
                  <td>
                    <strong>{req.order_number}</strong>
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      {new Date(req.created_at).toLocaleDateString('en-IN')}
                    </div>
                  </td>
                  <td>
                    <div>{req.student_name || 'Student'}</div>
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      {req.school_name || ''} {req.city_name ? `· ${req.city_name}` : ''}
                    </div>
                  </td>
                  <td>
                    <strong>{req.garment_name}</strong>
                  </td>
                  <td>
                    <span>
                      Size <strong>{req.from_size}</strong> &rarr; Size <strong>{req.to_size}</strong>
                    </span>
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      Qty: {req.quantity}
                    </div>
                  </td>
                  <td>
                    <div>{req.reason}</div>
                    {req.parent_note && (
                      <div className="muted" style={{ fontSize: '0.75rem', maxWidth: '160px' }}>
                        &ldquo;{req.parent_note}&rdquo;
                      </div>
                    )}
                    {req.review_reason && req.review_reason !== 'NONE' && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          background: '#fff3cd',
                          padding: '0.1rem 0.3rem',
                          borderRadius: '2px',
                          display: 'inline-block',
                          marginTop: '0.2rem',
                        }}
                      >
                        {req.review_reason}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`exchange-badge ${req.status.toLowerCase()}`}>
                      {req.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                      {req.reservation_state}
                    </span>
                    {req.inspection_result !== 'PENDING' && (
                      <div style={{ fontSize: '0.7rem', color: req.inspection_result === 'RESTOCKABLE' ? 'green' : 'red' }}>
                        Inspection: {req.inspection_result}
                      </div>
                    )}
                  </td>
                  <td>
                    {readOnly ? (
                      <span
                        className="exchange-readonly-tag"
                        title="Action reserved for City Admin / Boss"
                      >
                        Action reserved for City Admin / Boss
                      </span>
                    ) : (
                      <div className="exchange-actions-cell">
                        {req.can_approve && (
                          <button
                            type="button"
                            className="exchange-action-btn primary"
                            onClick={() => openActionModal(req, 'APPROVE')}
                          >
                            Approve
                          </button>
                        )}
                        {req.can_confirm_window && (
                          <button
                            type="button"
                            className="exchange-action-btn"
                            onClick={() => openActionModal(req, 'CONFIRM_WINDOW')}
                          >
                            Set Window
                          </button>
                        )}
                        {req.can_receive && (
                          <button
                            type="button"
                            className="exchange-action-btn primary"
                            onClick={() => openActionModal(req, 'RECEIVE')}
                          >
                            Receive & Inspect
                          </button>
                        )}
                        {req.can_complete && (
                          <button
                            type="button"
                            className="exchange-action-btn primary"
                            onClick={() => openActionModal(req, 'COMPLETE')}
                          >
                            Complete
                          </button>
                        )}
                        {req.can_return_original && (
                          <button
                            type="button"
                            className="exchange-action-btn danger"
                            onClick={() => openActionModal(req, 'RETURN_ORIGINAL')}
                          >
                            Return Original
                          </button>
                        )}
                        {req.can_reject && (
                          <button
                            type="button"
                            className="exchange-action-btn danger"
                            onClick={() => openActionModal(req, 'REJECT')}
                          >
                            Reject
                          </button>
                        )}
                        {req.can_reverse_receipt && (
                          <button
                            type="button"
                            className="exchange-action-btn danger"
                            title="Reverses receipt within 48h (Boss only)"
                            onClick={() => openActionModal(req, 'REVERSE_RECEIPT')}
                          >
                            Reverse Receipt
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Staff Action Modal */}
      {activeModalRequest && modalAction && (
        <div className="exchange-modal-backdrop" onClick={closeModal}>
          <div className="exchange-modal" onClick={(e) => e.stopPropagation()}>
            <div className="section-row">
              <h3>
                {modalAction.replace(/_/g, ' ')}: Order {activeModalRequest.order_number}
              </h3>
              <button type="button" className="text-button" onClick={closeModal}>
                &times;
              </button>
            </div>

            <p style={{ fontSize: '0.8125rem' }}>
              Garment: <strong>{activeModalRequest.garment_name}</strong> (Size{' '}
              {activeModalRequest.from_size} &rarr; {activeModalRequest.to_size}, Qty:{' '}
              {activeModalRequest.quantity})
            </p>

            {modalAction === 'RECEIVE' && (
              <div className="exchange-field">
                <label>Inspection Outcome</label>
                <select
                  value={inspectionResult}
                  onChange={(e) =>
                    setInspectionResult(e.target.value as 'RESTOCKABLE' | 'DAMAGED')
                  }
                >
                  <option value="RESTOCKABLE">Restockable (Good condition, restock item)</option>
                  <option value="DAMAGED">Damaged / Worn (Cannot restock item)</option>
                </select>
                <span className="muted" style={{ fontSize: '0.75rem' }}>
                  If restockable, the returned size variant is restocked. If damaged, parent item is
                  returned and reservation released.
                </span>
              </div>
            )}

            {(modalAction === 'CONFIRM_WINDOW' || modalAction === 'SET_HANDOVER') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="exchange-field">
                  <label>Window Start</label>
                  <input
                    type="date"
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                  />
                </div>
                <div className="exchange-field">
                  <label>Window End</label>
                  <input
                    type="date"
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="exchange-field">
              <label>Staff Note / Reason</label>
              <textarea
                rows={3}
                value={modalNote}
                onChange={(e) => setModalNote(e.target.value)}
                placeholder="Optional review or inspection details..."
              />
            </div>

            {actionError && (
              <p role="alert" className="error" style={{ fontSize: '0.8125rem' }}>
                {actionError}
              </p>
            )}

            <div className="exchange-btn-row">
              <button
                type="button"
                className="text-button"
                onClick={closeModal}
                disabled={actionMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={
                  modalAction === 'REJECT' || modalAction === 'REVERSE_RECEIPT'
                    ? 'exchange-action-btn danger'
                    : 'primary'
                }
                onClick={submitModalAction}
                disabled={actionMutation.isPending}
              >
                {actionMutation.isPending ? 'Processing...' : `Confirm ${modalAction}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
