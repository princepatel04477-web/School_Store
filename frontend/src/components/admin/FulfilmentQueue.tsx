import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  cityAdmin,
  type FulfilmentQueueOrder,
  type CitySchool,
  type Page,
  type PackingListResponse,
} from '../../api';
import { Skeleton } from '../ui/Skeleton';
import { TailorSheetButton } from './TailorSheetCard';

export type QueueStage = 'to_pack' | 'to_dispatch' | 'dispatched';

export interface FulfilmentQueueProps {
  initialNotice?: string | null;
}

export function FulfilmentQueue({ initialNotice = null }: FulfilmentQueueProps = {}) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<QueueStage>('to_pack');
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [selectedFulfillmentType, setSelectedFulfillmentType] = useState<string>('');

  // Active packing order (modal)
  const [activePackingOrderId, setActivePackingOrderId] = useState<string | null>(null);
  const [confirmedLineIds, setConfirmedLineIds] = useState<Set<string>>(new Set());
  const [packNote, setPackNote] = useState<string>('');
  const [issueNoteInput, setIssueNoteInput] = useState<string>('');
  const [showIssueInput, setShowIssueInput] = useState<boolean>(false);
  const [packingModalError, setPackingModalError] = useState<string | null>(null);

  // Active correction order (modal)
  const [correctingOrderId, setCorrectingOrderId] = useState<string | null>(null);
  const [correctionNewNumber, setCorrectionNewNumber] = useState<string>('');
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  // Dispatch state per order: { [orderId]: { step: 1 | 2; number: string; receiptConfirmed: boolean; error?: string } }
  const [dispatchStates, setDispatchStates] = useState<
    Record<string, { step: 1 | 2; number: string; receiptConfirmed: boolean; error?: string }>
  >({});

  // Global feedback banner
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Global 503 notice when packing rule is not merged
  const [ruleNotWiredNotice, setRuleNotWiredNotice] = useState<string | null>(initialNotice);

  // Fetch schools for filter dropdown
  const { data: schoolsData } = useQuery<Page<CitySchool>>({
    queryKey: ['city-schools-list'],
    queryFn: () => cityAdmin.schools({ page_size: '100' }),
  });

  const queryParams = useMemo(() => {
    const p: Record<string, string> = { stage };
    if (selectedSchool) p.school = selectedSchool;
    if (selectedFulfillmentType) p.fulfillment_type = selectedFulfillmentType;
    return p;
  }, [stage, selectedSchool, selectedFulfillmentType]);

  const {
    data: queueData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Page<FulfilmentQueueOrder>>({
    queryKey: ['fulfilment-queue', queryParams],
    queryFn: () => cityAdmin.fulfilmentQueue(queryParams),
  });

  // Packing list query for active packing modal
  const {
    data: packingListData,
    isLoading: isPackingListLoading,
    refetch: refetchPackingList,
  } = useQuery<PackingListResponse>({
    queryKey: ['packing-list', activePackingOrderId],
    queryFn: () => cityAdmin.packingList(activePackingOrderId!),
    enabled: Boolean(activePackingOrderId),
  });

  const queryError = error as { status?: number; code?: string; detail?: string; message?: string } | null;
  const isRuleNotWired =
    Boolean(ruleNotWiredNotice) ||
    queryError?.status === 503 ||
    queryError?.code === 'PACKING_RULE_NOT_WIRED';
  const effectiveRuleNotice =
    ruleNotWiredNotice ||
    (isRuleNotWired ? (queryError?.detail || 'Packing is not available yet. Payment checks are not connected.') : null);

  // Claim mutation
  const claimMutation = useMutation({
    mutationFn: (orderId: string) => cityAdmin.claimOrder(orderId),
    onSuccess: (_, orderId) => {
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
      // Open packing modal automatically on claim
      openPackingModal(orderId);
    },
    onError: (err: unknown) => {
      const errorObj = err as { status?: number; code?: string; detail?: string; message?: string };
      if (errorObj?.status === 503 || errorObj?.code === 'PACKING_RULE_NOT_WIRED') {
        setRuleNotWiredNotice(
          errorObj.detail || 'Packing is not available yet. Payment checks are not connected.'
        );
      } else {
        setFeedbackBanner({
          type: 'error',
          message: errorObj.detail || errorObj.message || 'Failed to claim order.',
        });
      }
    },
  });

  // Release claim mutation
  const releaseClaimMutation = useMutation({
    mutationFn: (orderId: string) => cityAdmin.releaseClaim(orderId),
    onSuccess: () => {
      closePackingModal();
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
      setFeedbackBanner({
        type: 'success',
        message: 'Order claim released.',
      });
    },
    onError: (err: unknown) => {
      const errorObj = err as { detail?: string; message?: string };
      setPackingModalError(errorObj.detail || errorObj.message || 'Failed to release claim.');
    },
  });

  // Report issue mutation
  const reportIssueMutation = useMutation({
    mutationFn: ({ orderId, note }: { orderId: string; note: string }) =>
      cityAdmin.reportIssue(orderId, note),
    onSuccess: () => {
      setShowIssueInput(false);
      setIssueNoteInput('');
      setPackingModalError(null);
      refetchPackingList();
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
    },
    onError: (err: unknown) => {
      const errorObj = err as { detail?: string; message?: string };
      setPackingModalError(errorObj.detail || errorObj.message || 'Failed to report issue.');
    },
  });

  // Clear issue mutation
  const clearIssueMutation = useMutation({
    mutationFn: (orderId: string) => cityAdmin.clearIssue(orderId),
    onSuccess: () => {
      setPackingModalError(null);
      refetchPackingList();
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
    },
    onError: (err: unknown) => {
      const errorObj = err as { detail?: string; message?: string };
      setPackingModalError(errorObj.detail || errorObj.message || 'Failed to clear issue.');
    },
  });

  // Pack order mutation
  const packMutation = useMutation({
    mutationFn: ({ orderId, itemIds, note }: { orderId: string; itemIds: string[]; note?: string }) =>
      cityAdmin.packOrder(orderId, itemIds, note),
    onSuccess: () => {
      closePackingModal();
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
      setFeedbackBanner({
        type: 'success',
        message: 'Order successfully packed and readied for dispatch.',
      });
    },
    onError: (err: unknown) => {
      const errorObj = err as { detail?: string; message?: string; reason?: string };
      setPackingModalError(errorObj.detail || errorObj.message || 'Failed to pack order.');
    },
  });

  // Dispatch mutation
  const dispatchMutation = useMutation({
    mutationFn: ({ orderId, articleNumber, receiptConfirmed }: { orderId: string; articleNumber: string; receiptConfirmed: boolean }) =>
      cityAdmin.dispatch(orderId, articleNumber, receiptConfirmed),
    onSuccess: (_, vars) => {
      setDispatchStates((prev) => {
        const next = { ...prev };
        delete next[vars.orderId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
      setFeedbackBanner({
        type: 'success',
        message: 'Order dispatched via India Post.',
      });
    },
    onError: (err: unknown, vars) => {
      const errorObj = err as { detail?: string; message?: string; code?: string };
      const msg = errorObj.detail || errorObj.message || 'Dispatch failed.';
      setDispatchStates((prev) => ({
        ...prev,
        [vars.orderId]: {
          ...(prev[vars.orderId] || { step: 2, number: vars.articleNumber, receiptConfirmed: vars.receiptConfirmed }),
          error: msg,
        },
      }));
    },
  });

  // Correct article number mutation
  const correctNumberMutation = useMutation({
    mutationFn: ({ orderId, articleNumber, reason }: { orderId: string; articleNumber: string; reason?: string }) =>
      cityAdmin.correctArticleNumber(orderId, articleNumber, reason),
    onSuccess: () => {
      setCorrectingOrderId(null);
      setCorrectionNewNumber('');
      setCorrectionReason('');
      setCorrectionError(null);
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
      setFeedbackBanner({
        type: 'success',
        message: 'Article number corrected.',
      });
    },
    onError: (err: unknown) => {
      const errorObj = err as { detail?: string; message?: string; data?: { detail?: string; message?: string } };
      const serverMessage = errorObj.data?.detail || errorObj.detail || errorObj.message || 'Failed to correct article number.';
      setCorrectionError(serverMessage);
    },
  });

  // Ready for pickup mutation
  const readyPickupMutation = useMutation({
    mutationFn: (orderId: string) => cityAdmin.readyForPickup([orderId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
      setFeedbackBanner({
        type: 'success',
        message: 'Order marked ready at the school counter.',
      });
    },
  });

  // Mark delivered mutation
  const deliveredMutation = useMutation({
    mutationFn: (orderId: string) => cityAdmin.markDelivered([orderId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
      setFeedbackBanner({
        type: 'success',
        message: 'Order marked delivered.',
      });
    },
  });

  const orders = queueData?.results || [];

  const openPackingModal = (orderId: string) => {
    setActivePackingOrderId(orderId);
    setConfirmedLineIds(new Set());
    setPackNote('');
    setIssueNoteInput('');
    setShowIssueInput(false);
    setPackingModalError(null);
  };

  const closePackingModal = () => {
    setActivePackingOrderId(null);
    setConfirmedLineIds(new Set());
    setPackingModalError(null);
  };

  const handleToggleLineConfirm = (lineId: string) => {
    setConfirmedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  };

  const getDispatchState = (orderId: string) => {
    return (
      dispatchStates[orderId] || {
        step: 1,
        number: '',
        receiptConfirmed: false,
      }
    );
  };

  const setDispatchField = (
    orderId: string,
    field: Partial<{ step: 1 | 2; number: string; receiptConfirmed: boolean; error?: string }>
  ) => {
    setDispatchStates((prev) => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] || { step: 1, number: '', receiptConfirmed: false }),
        ...field,
      },
    }));
  };

  return (
    <div className="fulfilment-queue">
      <div className="page-head">
        <div>
          <div className="eyebrow">ORDER FULFILMENT</div>
          <h1>Staff Claim, Pack &amp; Handover</h1>
          <p className="muted">
            Claim and pack verified orders, then record India Post postal handover.
          </p>
        </div>

        {/* Tab switch */}
        <div className="tab-group" role="tablist" aria-label="Fulfilment stages">
          <button
            role="tab"
            aria-selected={stage === 'to_pack'}
            className={stage === 'to_pack' ? 'primary' : 'secondary'}
            onClick={() => {
              setStage('to_pack');
              setFeedbackBanner(null);
            }}
          >
            To pack
          </button>
          <button
            role="tab"
            aria-selected={stage === 'to_dispatch'}
            className={stage === 'to_dispatch' ? 'primary' : 'secondary'}
            onClick={() => {
              setStage('to_dispatch');
              setFeedbackBanner(null);
            }}
          >
            To dispatch
          </button>
          <button
            role="tab"
            aria-selected={stage === 'dispatched'}
            className={stage === 'dispatched' ? 'primary' : 'secondary'}
            onClick={() => {
              setStage('dispatched');
              setFeedbackBanner(null);
            }}
          >
            Sent
          </button>
        </div>
      </div>

      {/* 503 Notice if Day 2 packing rule is missing */}
      {effectiveRuleNotice && (
        <div className="notice" role="alert" style={{ marginBottom: '16px', padding: '16px' }}>
          <b>Packing rule not connected</b>
          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
            {effectiveRuleNotice}
          </p>
        </div>
      )}

      {/* Feedback banner */}
      {feedbackBanner && (
        <div
          className={`feedback-banner ${feedbackBanner.type === 'success' ? 'notice' : 'error'}`}
          style={{ marginBottom: '16px', padding: '12px 16px' }}
        >
          {feedbackBanner.message}
        </div>
      )}

      {/* Filter bar */}
      <div className="card filters" style={{ marginBottom: '16px' }}>
        <label>
          <span>School</span>
          <select
            value={selectedSchool}
            onChange={(e) => setSelectedSchool(e.target.value)}
            className="filter-select"
          >
            <option value="">All Schools</option>
            {schoolsData?.results?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Delivery Type</span>
          <select
            value={selectedFulfillmentType}
            onChange={(e) => setSelectedFulfillmentType(e.target.value)}
            className="filter-select"
          >
            <option value="">All Types</option>
            <option value="HOME_DELIVERY">Home Delivery</option>
            <option value="SCHOOL_PICKUP">School Pickup</option>
          </select>
        </label>
      </div>

      {/* Loading state: Skeleton rows */}
      {isLoading && !effectiveRuleNotice && (
        <div className="card pad" data-testid="queue-skeleton">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Skeleton height="36px" borderRadius="4px" />
            <Skeleton height="36px" borderRadius="4px" />
            <Skeleton height="36px" borderRadius="4px" />
            <Skeleton height="36px" borderRadius="4px" />
          </div>
        </div>
      )}

      {/* Error state with retry */}
      {isError && !isLoading && !effectiveRuleNotice && (
        <div className="card pad error" style={{ textAlign: 'center' }}>
          <p>{(error as Error)?.message || 'Failed to load fulfilment queue.'}</p>
          <button className="secondary" onClick={() => refetch()} style={{ marginTop: '8px' }}>
            Retry
          </button>
        </div>
      )}

      {/* Empty state per tab */}
      {!isLoading && !isError && orders.length === 0 && (
        <div className="card pad empty" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <h3>
            {stage === 'to_pack'
              ? 'No orders waiting to pack'
              : stage === 'to_dispatch'
              ? 'No orders waiting for dispatch'
              : 'No dispatched orders'}
          </h3>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            {stage === 'to_pack'
              ? 'Confirmed orders ready to be claimed and packed will appear here.'
              : stage === 'to_dispatch'
              ? 'Packed orders awaiting India Post postal handover or counter pickup.'
              : 'Orders dispatched with tracking numbers or marked ready.'}
          </p>
        </div>
      )}

      {/* Content: Orders list (Desktop table + Mobile cards) */}
      {!isLoading && !isError && orders.length > 0 && (
        <div className="card">
          {/* Desktop table */}
          <div className="table-scroll fulfilment-table">
            <table className="data">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>School</th>
                  <th>Student</th>
                  <th className="r">Items</th>
                  <th>Payment</th>
                  <th>Delivery</th>
                  {stage === 'to_pack' && <th>Eligibility / Claim</th>}
                  {stage === 'to_dispatch' && <th>Handover Action</th>}
                  {stage === 'dispatched' && <th>Tracking &amp; Actions</th>}
                  <th>Tailor Sheet</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const isBlocked = stage === 'to_pack' && order.can_pack === false;
                  const isHome = order.fulfillment_type === 'HOME_DELIVERY';
                  const dState = getDispatchState(order.id);

                  return (
                    <tr
                      key={order.id}
                      className={isBlocked ? 'row-blocked' : ''}
                      data-testid={`queue-row-${order.id}`}
                    >
                      <td className="mono">
                        <b>{order.order_number}</b>
                      </td>
                      <td>
                        {order.school_name}
                        <small className="muted d-block">{order.school_code}</small>
                      </td>
                      <td>
                        {order.student_name}
                        <small className="muted d-block">GR: {order.student_gr}</small>
                      </td>
                      <td className="r mono">{order.items_count}</td>
                      <td>
                        <span className={`badge s-${order.payment_status.toLowerCase()}`}>
                          {order.payment_status}
                        </span>
                      </td>
                      <td>
                        <span className="fulfillment-badge">
                          {isHome ? 'Home Delivery' : 'School Pickup'}
                        </span>
                      </td>

                      {/* To Pack: Eligibility & Claim */}
                      {stage === 'to_pack' && (
                        <td>
                          {isBlocked ? (
                            <div className="gate-blocked" title={order.blocked_reason || ''}>
                              <span className="badge s-cancelled">Blocked</span>
                              <span className="blocked-message">{order.blocked_message}</span>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {order.claimed_by_name ? (
                                <div>
                                  {order.claimed_by_me ? (
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                      <span className="badge s-approved">Claimed by you</span>
                                      <button
                                        type="button"
                                        className="primary"
                                        style={{ minHeight: '36px' }}
                                        onClick={() => openPackingModal(order.id)}
                                      >
                                        Pack order
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="muted" style={{ fontSize: '13px' }}>
                                      Claimed by {order.claimed_by_name}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={Boolean(effectiveRuleNotice) || isBlocked}
                                  onClick={() => claimMutation.mutate(order.id)}
                                  style={{ minHeight: '36px' }}
                                >
                                  Claim
                                </button>
                              )}
                              {order.issue_note && (
                                <span className="field-error" style={{ fontSize: '12px' }}>
                                  Issue: {order.issue_note}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      )}

                      {/* To Dispatch: India Post handover or pickup */}
                      {stage === 'to_dispatch' && (
                        <td>
                          {isHome ? (
                            <div className="dispatch-action-cell">
                              {dState.step === 1 ? (
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  <label className="consignment-label" style={{ margin: 0 }}>
                                    <span className="sr-only">Article number</span>
                                    <input
                                      type="text"
                                      autoComplete="off"
                                      spellCheck={false}
                                      placeholder="Article number"
                                      value={dState.number}
                                      onChange={(e) =>
                                        setDispatchField(order.id, {
                                          number: e.target.value,
                                          error: undefined,
                                        })
                                      }
                                      className={`consignment-input ${dState.error ? 'has-error' : ''}`}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="primary"
                                    style={{ minHeight: '38px' }}
                                    disabled={!dState.number.trim()}
                                    onClick={() => {
                                      if (!dState.number.trim()) {
                                        setDispatchField(order.id, {
                                          error: 'Article number cannot be blank.',
                                        });
                                        return;
                                      }
                                      setDispatchField(order.id, { step: 2 });
                                    }}
                                  >
                                    Review
                                  </button>
                                </div>
                              ) : (
                                <div className="handover-review-box">
                                  <div style={{ fontSize: '13px' }}>
                                    Article number: <b className="mono">{dState.number}</b>
                                  </div>
                                  <label className="receipt-checkbox-label">
                                    <input
                                      type="checkbox"
                                      checked={dState.receiptConfirmed}
                                      onChange={(e) =>
                                        setDispatchField(order.id, {
                                          receiptConfirmed: e.target.checked,
                                        })
                                      }
                                    />
                                    <span>I checked this against the India Post receipt</span>
                                  </label>
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button
                                      type="button"
                                      className="primary touch-btn"
                                      disabled={!dState.receiptConfirmed || dispatchMutation.isPending}
                                      onClick={() =>
                                        dispatchMutation.mutate({
                                          orderId: order.id,
                                          articleNumber: dState.number,
                                          receiptConfirmed: dState.receiptConfirmed,
                                        })
                                      }
                                    >
                                      Confirm handover
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={() =>
                                        setDispatchField(order.id, {
                                          step: 1,
                                          receiptConfirmed: false,
                                        })
                                      }
                                    >
                                      Edit
                                    </button>
                                  </div>
                                </div>
                              )}
                              {dState.error && (
                                <div className="field-error">{dState.error}</div>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="secondary pickup-btn"
                              style={{ minHeight: '44px' }}
                              onClick={() => readyPickupMutation.mutate(order.id)}
                              disabled={readyPickupMutation.isPending}
                            >
                              Ready for pickup
                            </button>
                          )}
                        </td>
                      )}

                      {/* Sent: Tracking number, Handover info, Correction & Deliver button */}
                      {stage === 'dispatched' && (
                        <td>
                          <div className="sent-cell">
                            {order.consignment_number ? (
                              <div className="tracking-info mono" style={{ fontSize: '13px' }}>
                                <b>{order.consignment_number}</b>
                                {order.dispatched_at && (
                                  <small className="muted d-block">
                                    {new Date(order.dispatched_at).toLocaleString()}
                                  </small>
                                )}
                              </div>
                            ) : (
                              <span className="muted" style={{ fontSize: '13px' }}>Counter Pickup</span>
                            )}
                            <div style={{ display: 'flex', gap: '6px' }}>
                              {order.consignment_number && (
                                <button
                                  type="button"
                                  className="secondary"
                                  style={{ minHeight: '36px' }}
                                  onClick={() => {
                                    setCorrectingOrderId(order.id);
                                    setCorrectionNewNumber(order.consignment_number || '');
                                    setCorrectionReason('');
                                    setCorrectionError(null);
                                  }}
                                >
                                  Correct number
                                </button>
                              )}
                              <button
                                type="button"
                                className="secondary deliver-btn"
                                style={{ minHeight: '36px' }}
                                onClick={() => deliveredMutation.mutate(order.id)}
                                disabled={deliveredMutation.isPending}
                              >
                                Mark delivered
                              </button>
                            </div>
                          </div>
                        </td>
                      )}

                      <td>
                        <TailorSheetButton orderId={order.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards view (<640px) */}
          <div className="fulfilment-cards">
            {orders.map((order) => {
              const isBlocked = stage === 'to_pack' && order.can_pack === false;
              const isHome = order.fulfillment_type === 'HOME_DELIVERY';
              const dState = getDispatchState(order.id);

              return (
                <div
                  key={order.id}
                  className={`fulfilment-card ${isBlocked ? 'card-blocked' : ''}`}
                  data-testid={`queue-card-${order.id}`}
                >
                  <div className="card-top">
                    <span className="mono bold">{order.order_number}</span>
                    <span className={`badge s-${order.payment_status.toLowerCase()}`}>
                      {order.payment_status}
                    </span>
                    <span className="fulfillment-badge">
                      {isHome ? 'Home' : 'Pickup'}
                    </span>
                  </div>

                  <div className="card-body">
                    <div><b>School:</b> {order.school_name} ({order.school_code})</div>
                    <div><b>Student:</b> {order.student_name} (GR: {order.student_gr})</div>
                    <div><b>Items:</b> {order.items_count}</div>

                    {stage === 'to_pack' && isBlocked && (
                      <div className="blocked-notice">
                        <span className="badge s-cancelled">Blocked</span>{' '}
                        <span>{order.blocked_message}</span>
                      </div>
                    )}

                    {stage === 'to_pack' && !isBlocked && (
                      <div style={{ marginTop: '8px' }}>
                        {order.claimed_by_name ? (
                          order.claimed_by_me ? (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <span className="badge s-approved">Claimed by you</span>
                              <button
                                type="button"
                                className="primary touch-btn"
                                onClick={() => openPackingModal(order.id)}
                              >
                                Pack order
                              </button>
                            </div>
                          ) : (
                            <span className="muted" style={{ fontSize: '13px' }}>
                              Claimed by {order.claimed_by_name}
                            </span>
                          )
                        ) : (
                          <button
                            type="button"
                            className="secondary touch-btn"
                            disabled={Boolean(effectiveRuleNotice) || isBlocked}
                            onClick={() => claimMutation.mutate(order.id)}
                          >
                            Claim
                          </button>
                        )}
                        {order.issue_note && (
                          <div className="field-error" style={{ marginTop: '4px' }}>
                            Issue: {order.issue_note}
                          </div>
                        )}
                      </div>
                    )}

                    {stage === 'to_dispatch' && (
                      <div className="card-dispatch-actions">
                        {isHome ? (
                          dState.step === 1 ? (
                            <>
                              <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="Article number"
                                maxLength={40}
                                value={dState.number}
                                onChange={(e) =>
                                  setDispatchField(order.id, {
                                    number: e.target.value,
                                    error: undefined,
                                  })
                                }
                                className={`consignment-input ${dState.error ? 'has-error' : ''}`}
                              />
                              <button
                                type="button"
                                className="primary touch-btn"
                                disabled={!dState.number.trim()}
                                onClick={() => {
                                  if (!dState.number.trim()) {
                                    setDispatchField(order.id, {
                                      error: 'Article number cannot be blank.',
                                    });
                                    return;
                                  }
                                  setDispatchField(order.id, { step: 2 });
                                }}
                              >
                                Review handover
                              </button>
                            </>
                          ) : (
                            <div className="handover-review-box">
                              <div style={{ fontSize: '13px' }}>
                                Article number: <b className="mono">{dState.number}</b>
                              </div>
                              <label className="receipt-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={dState.receiptConfirmed}
                                  onChange={(e) =>
                                    setDispatchField(order.id, {
                                      receiptConfirmed: e.target.checked,
                                    })
                                  }
                                />
                                <span>I checked this against the India Post receipt</span>
                              </label>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button
                                  type="button"
                                  className="primary touch-btn"
                                  disabled={!dState.receiptConfirmed || dispatchMutation.isPending}
                                  onClick={() =>
                                    dispatchMutation.mutate({
                                      orderId: order.id,
                                      articleNumber: dState.number,
                                      receiptConfirmed: dState.receiptConfirmed,
                                    })
                                  }
                                >
                                  Confirm handover
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() =>
                                    setDispatchField(order.id, {
                                      step: 1,
                                      receiptConfirmed: false,
                                    })
                                  }
                                >
                                  Edit
                                </button>
                              </div>
                            </div>
                          )
                        ) : (
                          <button
                            type="button"
                            className="secondary touch-btn"
                            onClick={() => readyPickupMutation.mutate(order.id)}
                            disabled={readyPickupMutation.isPending}
                          >
                            Ready for pickup
                          </button>
                        )}
                        {dState.error && (
                          <div className="field-error">{dState.error}</div>
                        )}
                      </div>
                    )}

                    {stage === 'dispatched' && (
                      <div className="card-sent-actions">
                        {order.consignment_number ? (
                          <div className="mono" style={{ fontSize: '13px' }}>
                            Article: <b>{order.consignment_number}</b>
                          </div>
                        ) : (
                          <span className="muted" style={{ fontSize: '13px' }}>Counter Pickup</span>
                        )}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {order.consignment_number && (
                            <button
                              type="button"
                              className="secondary touch-btn"
                              onClick={() => {
                                setCorrectingOrderId(order.id);
                                setCorrectionNewNumber(order.consignment_number || '');
                                setCorrectionReason('');
                                setCorrectionError(null);
                              }}
                            >
                              Correct number
                            </button>
                          )}
                          <button
                            type="button"
                            className="secondary touch-btn"
                            onClick={() => deliveredMutation.mutate(order.id)}
                            disabled={deliveredMutation.isPending}
                          >
                            Mark delivered
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="card-footer" style={{ marginTop: '8px' }}>
                    <TailorSheetButton orderId={order.id} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Packing Modal */}
      {activePackingOrderId && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Packing screen">
          <div className="modal-panel">
            <div className="modal-header">
              <h2>Packing Order {packingListData?.order_number || ''}</h2>
              <button
                type="button"
                className="secondary"
                onClick={closePackingModal}
                style={{ minHeight: '36px' }}
              >
                Close
              </button>
            </div>

            <div className="modal-body">
              {packingModalError && (
                <div className="field-error" role="alert" style={{ padding: '8px', background: 'var(--bad-tint)', borderRadius: '4px' }}>
                  {packingModalError}
                </div>
              )}

              {packingListData?.issue_note && (
                <div className="notice" role="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <b>Open problem:</b> {packingListData.issue_note}
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    style={{ minHeight: '36px' }}
                    onClick={() => clearIssueMutation.mutate(activePackingOrderId)}
                  >
                    Clear problem
                  </button>
                </div>
              )}

              {isPackingListLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Skeleton height="40px" borderRadius="4px" />
                  <Skeleton height="40px" borderRadius="4px" />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p style={{ fontSize: '13px', margin: 0 }} className="muted">
                    Tick every item line to confirm packed goods.
                  </p>
                  {packingListData?.lines?.map((line, idx) => {
                    const isChecked = confirmedLineIds.has(line.id);
                    return (
                      <div
                        key={line.id}
                        className={`packing-line ${isChecked ? 'confirmed' : ''}`}
                      >
                        <div className="packing-line-check">
                          <input
                            type="checkbox"
                            aria-label={`Confirm line ${idx + 1}`}
                            checked={isChecked}
                            onChange={() => handleToggleLineConfirm(line.id)}
                          />
                        </div>
                        <div className="packing-line-info">
                          <div className="packing-line-title">
                            {line.product_name}
                          </div>
                          <div className="packing-line-meta">
                            SKU: {line.sku} | Size: <b>{line.size}</b>
                          </div>
                          {line.personalisation && Object.keys(line.personalisation).length > 0 && (
                            <div className="packing-line-personalisation">
                              Customised
                            </div>
                          )}
                        </div>
                        <div>
                          <span
                            className={`quantity-tag ${line.multiple ? 'multiple' : ''}`}
                          >
                            x{line.quantity}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Optional Pack Note */}
              <div style={{ marginTop: '8px' }}>
                <label>
                  <span>Packing note (optional)</span>
                  <input
                    type="text"
                    placeholder="e.g. Packed in standard polybag"
                    value={packNote}
                    onChange={(e) => setPackNote(e.target.value)}
                    style={{ minHeight: '38px', width: '100%' }}
                  />
                </label>
              </div>

              {/* Report Problem Section */}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px', marginTop: '8px' }}>
                {!showIssueInput ? (
                  <button
                    type="button"
                    className="secondary"
                    style={{ minHeight: '38px' }}
                    onClick={() => setShowIssueInput(true)}
                  >
                    Report a problem
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label>
                      <span>Describe problem (missing item, damaged size)</span>
                      <input
                        type="text"
                        placeholder="e.g. Size M missing in rack"
                        value={issueNoteInput}
                        onChange={(e) => setIssueNoteInput(e.target.value)}
                        style={{ minHeight: '38px', width: '100%' }}
                      />
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="primary"
                        style={{ minHeight: '38px' }}
                        disabled={!issueNoteInput.trim() || reportIssueMutation.isPending}
                        onClick={() =>
                          reportIssueMutation.mutate({
                            orderId: activePackingOrderId,
                            note: issueNoteInput.trim(),
                          })
                        }
                      >
                        Submit problem
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        style={{ minHeight: '38px' }}
                        onClick={() => setShowIssueInput(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="secondary"
                style={{ minHeight: '44px', marginRight: 'auto' }}
                onClick={() => releaseClaimMutation.mutate(activePackingOrderId)}
                disabled={releaseClaimMutation.isPending}
              >
                Release claim
              </button>
              <button
                type="button"
                className="primary"
                style={{ minHeight: '44px' }}
                disabled={
                  !packingListData?.lines?.length ||
                  confirmedLineIds.size !== packingListData.lines.length ||
                  Boolean(packingListData?.issue_note) ||
                  packMutation.isPending
                }
                onClick={() =>
                  packMutation.mutate({
                    orderId: activePackingOrderId,
                    itemIds: Array.from(confirmedLineIds),
                    note: packNote,
                  })
                }
              >
                {packMutation.isPending ? 'Packing…' : 'Mark packed'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Correct Article Number Modal */}
      {correctingOrderId && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Correct article number">
          <div className="modal-panel" style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h2>Correct Article Number</h2>
              <button
                type="button"
                className="secondary"
                onClick={() => setCorrectingOrderId(null)}
                style={{ minHeight: '36px' }}
              >
                Close
              </button>
            </div>

            <div className="modal-body">
              {correctionError && (
                <div className="field-error" role="alert" style={{ padding: '8px', background: 'var(--bad-tint)', borderRadius: '4px' }}>
                  {correctionError}
                </div>
              )}
              <label>
                <span>New India Post article number</span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={40}
                  value={correctionNewNumber}
                  onChange={(e) => setCorrectionNewNumber(e.target.value)}
                  style={{ minHeight: '40px', width: '100%', fontFamily: 'var(--font-mono)' }}
                />
              </label>

              <label>
                <span>Reason for change</span>
                <input
                  type="text"
                  placeholder="e.g. Typo in receipt number"
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  style={{ minHeight: '40px', width: '100%' }}
                />
              </label>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="secondary"
                style={{ minHeight: '44px' }}
                onClick={() => setCorrectingOrderId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                style={{ minHeight: '44px' }}
                disabled={!correctionNewNumber.trim() || correctNumberMutation.isPending}
                onClick={() =>
                  correctNumberMutation.mutate({
                    orderId: correctingOrderId,
                    articleNumber: correctionNewNumber.trim(),
                    reason: correctionReason,
                  })
                }
              >
                Save correction
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
