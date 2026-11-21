import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  cityAdmin,
  type FulfilmentQueueOrder,
  type CitySchool,
  type Page,
} from '../../api';
import { Skeleton } from '../ui/Skeleton';
import { TailorSheetButton } from './TailorSheetCard';

/**
 * Validates an India Post S10 format consignment number (pure helper for client check & Vitest).
 * Format: 2 letters, 8 serial digits, 1 check digit, 2 letters (e.g. EE123456785IN).
 * Weights: 8, 6, 4, 2, 3, 5, 9, 7.
 * Remainder: 11 - (sum % 11); 10 becomes 0, 11 becomes 5.
 */
export function validateConsignmentFormat(val: string): boolean {
  if (!val) return false;
  const clean = val.trim().toUpperCase();
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(clean)) {
    return false;
  }
  const serial = clean.slice(2, 10);
  const checkDigit = parseInt(clean[10], 10);
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(serial[i], 10) * weights[i];
  }
  const rem = sum % 11;
  let expected = 11 - rem;
  if (expected === 10) expected = 0;
  else if (expected === 11) expected = 5;
  return checkDigit === expected;
}

export type QueueStage = 'to_pack' | 'to_dispatch' | 'dispatched';

export interface FulfilmentQueueProps {
  initialNotice?: string | null;
}

export function FulfilmentQueue({ initialNotice = null }: FulfilmentQueueProps = {}) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<QueueStage>('to_pack');
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [selectedFulfillmentType, setSelectedFulfillmentType] = useState<string>('');

  // Selected orders for bulk packing
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [packNote, setPackNote] = useState<string>('');
  const [packFeedback, setPackFeedback] = useState<{
    packed: number;
    blocked: number;
    message?: string;
  } | null>(null);

  // Per-order dispatch consignment inputs: { [orderId]: string }
  const [consignmentInputs, setConsignmentInputs] = useState<Record<string, string>>({});
  const [dispatchErrors, setDispatchErrors] = useState<Record<string, string>>({});

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

  const queryError = error as { status?: number; code?: string; detail?: string; message?: string } | null;
  const isRuleNotWired =
    Boolean(ruleNotWiredNotice) ||
    queryError?.status === 503 ||
    queryError?.code === 'PACKING_RULE_NOT_WIRED';
  const effectiveRuleNotice =
    ruleNotWiredNotice ||
    (isRuleNotWired ? (queryError?.detail || 'Packing is not available yet. Payment checks are not connected.') : null);

  // Pack mutation
  const packMutation = useMutation({
    mutationFn: () => cityAdmin.pack(selectedIds, packNote),
    onSuccess: (data) => {
      const packedCount = data.packed_ids?.length || 0;
      const blockedCount = data.blocked?.length || 0;
      setPackFeedback({
        packed: packedCount,
        blocked: blockedCount,
        message: `Successfully packed ${packedCount} order(s). ${blockedCount > 0 ? `${blockedCount} blocked.` : ''}`,
      });
      setSelectedIds([]);
      setPackNote('');
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
    },
    onError: (err: unknown) => {
      const errorObj = err as { status?: number; code?: string; detail?: string; message?: string };
      if (errorObj?.status === 503 || errorObj?.code === 'PACKING_RULE_NOT_WIRED') {
        setRuleNotWiredNotice(
          errorObj.detail || 'Packing is not available yet. Payment checks are not connected.'
        );
      } else {
        setPackFeedback({
          packed: 0,
          blocked: 0,
          message: errorObj.detail || errorObj.message || 'Packing failed. Please try again.',
        });
      }
    },
  });

  // Dispatch mutation
  const dispatchMutation = useMutation({
    mutationFn: ({ orderId, consignment }: { orderId: string; consignment: string }) =>
      cityAdmin.dispatch(orderId, consignment),
    onSuccess: (_, vars) => {
      setDispatchErrors((prev) => {
        const next = { ...prev };
        delete next[vars.orderId];
        return next;
      });
      setConsignmentInputs((prev) => {
        const next = { ...prev };
        delete next[vars.orderId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
    },
    onError: (err: unknown, vars) => {
      const errorObj = err as { consignment_number?: string[]; detail?: string; message?: string };
      const msg =
        (Array.isArray(errorObj?.consignment_number)
          ? errorObj.consignment_number[0]
          : null) ||
        errorObj?.detail ||
        errorObj?.message ||
        'Dispatch failed. Please check the consignment number.';
      setDispatchErrors((prev) => ({ ...prev, [vars.orderId]: msg }));
    },
  });

  // Ready for pickup mutation
  const readyPickupMutation = useMutation({
    mutationFn: (orderId: string) => cityAdmin.readyForPickup([orderId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
    },
  });

  // Mark delivered mutation
  const deliveredMutation = useMutation({
    mutationFn: (orderId: string) => cityAdmin.markDelivered([orderId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fulfilment-queue'] });
    },
  });

  const orders = queueData?.results || [];

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const selectable = orders
        .filter((o) => o.can_pack !== false)
        .map((o) => o.id);
      setSelectedIds(selectable);
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [...prev, id]);
    } else {
      setSelectedIds((prev) => prev.filter((i) => i !== id));
    }
  };

  const handleDispatchSubmit = (orderId: string) => {
    const rawVal = consignmentInputs[orderId] || '';
    const clean = rawVal.trim().toUpperCase();
    if (!clean) {
      setDispatchErrors((prev) => ({
        ...prev,
        [orderId]: 'Enter a consignment number.',
      }));
      return;
    }
    if (!validateConsignmentFormat(clean)) {
      setDispatchErrors((prev) => ({
        ...prev,
        [orderId]: 'Invalid format or check digit. Expected e.g. EE123456785IN.',
      }));
      return;
    }
    dispatchMutation.mutate({ orderId, consignment: clean });
  };

  return (
    <div className="fulfilment-queue">
      <div className="page-head">
        <div>
          <div className="eyebrow">ORDER FULFILMENT</div>
          <h1>Packing &amp; Dispatch</h1>
          <p className="muted">
            Pack verified orders and dispatch home deliveries via India Post.
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
              setSelectedIds([]);
              setPackFeedback(null);
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
              setSelectedIds([]);
              setPackFeedback(null);
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
              setSelectedIds([]);
              setPackFeedback(null);
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

      {/* Feedback banner for pack actions */}
      {packFeedback && (
        <div
          className={`feedback-banner ${packFeedback.packed > 0 ? 'notice' : 'error'}`}
          style={{ marginBottom: '16px', padding: '12px 16px' }}
        >
          {packFeedback.message}
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

        {stage === 'to_pack' && (
          <div className="pack-action-bar" style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <label style={{ margin: 0 }}>
              <span>Pack Note (optional)</span>
              <input
                type="text"
                placeholder="e.g. Packed in standard carton"
                value={packNote}
                onChange={(e) => setPackNote(e.target.value)}
                style={{ height: '38px', minWidth: '200px' }}
              />
            </label>
            <button
              className="primary"
              disabled={
                selectedIds.length === 0 ||
                packMutation.isPending ||
                Boolean(effectiveRuleNotice)
              }
              onClick={() => packMutation.mutate()}
              style={{ minHeight: '38px' }}
            >
              {packMutation.isPending
                ? 'Packing…'
                : `Pack Selected (${selectedIds.length})`}
            </button>
          </div>
        )}
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
              ? 'Confirmed orders that are ready to be packed will appear here.'
              : stage === 'to_dispatch'
              ? 'Packed orders awaiting India Post consignment or school counter pickup.'
              : 'Orders dispatched with tracking numbers or marked ready.'}
          </p>
        </div>
      )}

      {/* Content: Orders list (Desktop table + Mobile cards) */}
      {!isLoading && !isError && orders.length > 0 && (
        <div className="card">
          {/* Desktop table (hidden below 640px via CSS) */}
          <div className="table-scroll fulfilment-table">
            <table className="data">
              <thead>
                <tr>
                  {stage === 'to_pack' && (
                    <th style={{ width: '40px' }}>
                      <input
                        type="checkbox"
                        aria-label="Select all eligible orders"
                        checked={
                          selectedIds.length > 0 &&
                          selectedIds.length ===
                            orders.filter((o) => o.can_pack !== false).length
                        }
                        onChange={(e) => handleSelectAll(e.target.checked)}
                      />
                    </th>
                  )}
                  <th>Order #</th>
                  <th>School</th>
                  <th>Student</th>
                  <th className="r">Items</th>
                  <th>Payment</th>
                  <th>Delivery</th>
                  {stage === 'to_pack' && <th>Gate Status</th>}
                  {stage === 'to_dispatch' && <th>Consignment / Dispatch</th>}
                  {stage === 'dispatched' && <th>Tracking &amp; Actions</th>}
                  <th>Tailor Sheet</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const isBlocked = stage === 'to_pack' && order.can_pack === false;
                  const isSelected = selectedIds.includes(order.id);
                  const isHome = order.fulfillment_type === 'HOME_DELIVERY';
                  const dispErr = dispatchErrors[order.id];

                  return (
                    <tr
                      key={order.id}
                      className={isBlocked ? 'row-blocked' : ''}
                      data-testid={`queue-row-${order.id}`}
                    >
                      {stage === 'to_pack' && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select order ${order.order_number}`}
                            disabled={isBlocked || Boolean(ruleNotWiredNotice)}
                            checked={isSelected}
                            onChange={(e) =>
                              handleSelectOne(order.id, e.target.checked)
                            }
                          />
                        </td>
                      )}
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

                      {/* To Pack: Gate Status */}
                      {stage === 'to_pack' && (
                        <td>
                          {isBlocked ? (
                            <div className="gate-blocked" title={order.blocked_reason || ''}>
                              <span className="badge s-cancelled">Blocked</span>
                              <span className="blocked-message">{order.blocked_message}</span>
                            </div>
                          ) : (
                            <span className="badge s-approved">Ready to pack</span>
                          )}
                        </td>
                      )}

                      {/* To Dispatch: India Post input or pickup button */}
                      {stage === 'to_dispatch' && (
                        <td>
                          {isHome ? (
                            <div className="dispatch-action-cell">
                              <label className="consignment-label">
                                <span className="sr-only">Consignment number</span>
                                <input
                                  type="text"
                                  inputMode="text"
                                  autoCapitalize="characters"
                                  placeholder="EE123456785IN"
                                  value={consignmentInputs[order.id] || ''}
                                  onChange={(e) => {
                                    const val = e.target.value.toUpperCase();
                                    setConsignmentInputs((prev) => ({
                                      ...prev,
                                      [order.id]: val,
                                    }));
                                  }}
                                  className={`consignment-input ${dispErr ? 'has-error' : ''}`}
                                />
                              </label>
                              <button
                                className="primary dispatch-btn"
                                onClick={() => handleDispatchSubmit(order.id)}
                                disabled={dispatchMutation.isPending}
                              >
                                Dispatch
                              </button>
                              {dispErr && <div className="field-error">{dispErr}</div>}
                            </div>
                          ) : (
                            <button
                              className="secondary pickup-btn"
                              onClick={() => readyPickupMutation.mutate(order.id)}
                              disabled={readyPickupMutation.isPending}
                            >
                              Ready for pickup
                            </button>
                          )}
                        </td>
                      )}

                      {/* Sent: Tracking number & Deliver button */}
                      {stage === 'dispatched' && (
                        <td>
                          <div className="sent-cell">
                            {order.consignment_number ? (
                              <div className="tracking-info mono">
                                <b>{order.consignment_number}</b>
                                {order.dispatched_at && (
                                  <small className="muted d-block">
                                    {new Date(order.dispatched_at).toLocaleDateString()}
                                  </small>
                                )}
                              </div>
                            ) : (
                              <span className="muted">Counter Pickup</span>
                            )}
                            <button
                              className="secondary deliver-btn"
                              onClick={() => deliveredMutation.mutate(order.id)}
                              disabled={deliveredMutation.isPending}
                            >
                              Mark delivered
                            </button>
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

          {/* Mobile cards view (displayed below 640px via CSS) */}
          <div className="fulfilment-cards">
            {orders.map((order) => {
              const isBlocked = stage === 'to_pack' && order.can_pack === false;
              const isSelected = selectedIds.includes(order.id);
              const isHome = order.fulfillment_type === 'HOME_DELIVERY';
              const dispErr = dispatchErrors[order.id];

              return (
                <div
                  key={order.id}
                  className={`fulfilment-card ${isBlocked ? 'card-blocked' : ''}`}
                >
                  <div className="card-top">
                    {stage === 'to_pack' && (
                      <input
                        type="checkbox"
                        aria-label={`Select order ${order.order_number}`}
                        disabled={isBlocked || Boolean(ruleNotWiredNotice)}
                        checked={isSelected}
                        onChange={(e) =>
                          handleSelectOne(order.id, e.target.checked)
                        }
                      />
                    )}
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

                    {stage === 'to_dispatch' && (
                      <div className="card-dispatch-actions">
                        {isHome ? (
                          <>
                            <input
                              type="text"
                              inputMode="text"
                              autoCapitalize="characters"
                              placeholder="EE123456785IN"
                              value={consignmentInputs[order.id] || ''}
                              onChange={(e) => {
                                const val = e.target.value.toUpperCase();
                                setConsignmentInputs((prev) => ({
                                  ...prev,
                                  [order.id]: val,
                                }));
                              }}
                              className={`consignment-input ${dispErr ? 'has-error' : ''}`}
                            />
                            {dispErr && <div className="field-error">{dispErr}</div>}
                            <button
                              className="primary touch-btn"
                              onClick={() => handleDispatchSubmit(order.id)}
                              disabled={dispatchMutation.isPending}
                            >
                              Dispatch India Post
                            </button>
                          </>
                        ) : (
                          <button
                            className="secondary touch-btn"
                            onClick={() => readyPickupMutation.mutate(order.id)}
                            disabled={readyPickupMutation.isPending}
                          >
                            Ready for pickup
                          </button>
                        )}
                      </div>
                    )}

                    {stage === 'dispatched' && (
                      <div className="card-sent-actions">
                        {order.consignment_number && (
                          <div className="mono">Tracking: <b>{order.consignment_number}</b></div>
                        )}
                        <button
                          className="secondary touch-btn"
                          onClick={() => deliveredMutation.mutate(order.id)}
                          disabled={deliveredMutation.isPending}
                        >
                          Mark delivered
                        </button>
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
    </div>
  );
}
