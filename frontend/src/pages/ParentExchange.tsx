import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLang } from '../i18n';
import {
  exchangeService,
  type OrderExchangeSummary,
  type ExchangeOrderItem,
  type SizeExchangeRequestItem,
} from '../services/exchange';
import './ParentExchange.css';

export default function ParentExchange() {
  const { orderId } = useParams<{ orderId: string }>();
  const { t } = useLang();
  const queryClient = useQueryClient();

  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [fromSize, setFromSize] = useState<string>('');
  const [toSize, setToSize] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [reason, setReason] = useState<'TOO_SMALL' | 'TOO_BIG' | 'NOT_SIZE'>('TOO_SMALL');
  const [parentNote, setParentNote] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const { data: summary, isLoading, isError, error } = useQuery<OrderExchangeSummary>({
    queryKey: ['order-exchange-summary', orderId],
    queryFn: () => exchangeService.getOrderSummary(orderId!),
    enabled: Boolean(orderId),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      exchangeService.submitRequest(orderId!, {
        order_item_id: selectedItem!,
        from_size: fromSize,
        to_size: toSize,
        quantity,
        reason,
        parent_note: parentNote || undefined,
      }),
    onSuccess: () => {
      setActionSuccess(t('exchange.successSubmitted'));
      setSelectedItem(null);
      setFromSize('');
      setToSize('');
      setQuantity(1);
      setParentNote('');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['order-exchange-summary', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to submit exchange request.');
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: (requestId: string) => exchangeService.withdrawRequest(orderId!, requestId),
    onSuccess: () => {
      setActionSuccess(t('exchange.successWithdrawn'));
      void queryClient.invalidateQueries({ queryKey: ['order-exchange-summary', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to withdraw exchange request.');
    },
  });

  if (isLoading) {
    return (
      <div className="parent-exchange-container" aria-busy="true">
        <div className="checkout-skeleton" style={{ height: '300px' }} />
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="parent-exchange-container">
        <div className="parent-exchange-header">
          <Link to="/parent/orders" className="text-button">
            &larr; {t('exchange.backToOrders')}
          </Link>
          <h2>{t('exchange.title')}</h2>
        </div>
        <p role="alert" className="error">
          {(error as Error)?.message || 'Failed to load exchange details for this order.'}
        </p>
      </div>
    );
  }

  const handleStartExchange = (item: ExchangeOrderItem) => {
    setSelectedItem(item.id);
    const availableFromSizes = Object.keys(item.current_holdings).filter(
      (s) => item.current_holdings[s] > 0
    );
    const initialFrom = availableFromSizes[0] || '';
    setFromSize(initialFrom);

    const firstCandidate = item.candidate_sizes.find((c) => c.size !== initialFrom);
    setToSize(firstCandidate?.size || '');
    setQuantity(1);
    setFormError(null);
    setActionSuccess(null);
  };

  const activeItemObj = summary.items.find((it) => it.id === selectedItem);

  return (
    <div className="parent-exchange-container">
      <div className="parent-exchange-header">
        <Link to="/parent/orders" className="text-button">
          &larr; {t('exchange.backToOrders')}
        </Link>
        <div>
          <span className="eyebrow">ORDER {summary.order_number}</span>
          <h2>{t('exchange.title')}</h2>
          <p className="muted">{t('exchange.subtitle')}</p>
        </div>
      </div>

      {actionSuccess && (
        <div className="parent-exchange-banner open" role="status">
          {actionSuccess}
        </div>
      )}

      {/* 7-day Exchange Window Status Banner */}
      {summary.delivered_event_exists ? (
        summary.within_window ? (
          <div className="parent-exchange-banner open">
            {t('exchange.windowOpen', {
              time: summary.window_ends_at
                ? new Date(summary.window_ends_at).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : 'soon',
            })}
          </div>
        ) : (
          <div className="parent-exchange-banner closed">
            {t('exchange.windowClosed', {
              time: summary.window_ends_at
                ? new Date(summary.window_ends_at).toLocaleDateString('en-IN')
                : 'past',
            })}
            . Submissions will be held for staff review.
          </div>
        )
      ) : (
        <div className="parent-exchange-banner warning">
          {t('exchange.noDeliveryRecord')}
        </div>
      )}

      {/* Delivered Order Items eligible for size exchange */}
      <section>
        <div className="section-row" style={{ marginBottom: '0.75rem' }}>
          <h3>Delivered Garments</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {summary.items.map((item) => {
            const isEditing = selectedItem === item.id;
            const holdingsStr = Object.entries(item.current_holdings)
              .filter(([_, q]) => q > 0)
              .map(([sz, q]) => `Size ${sz}: ${q}`)
              .join(', ');

            return (
              <article key={item.id} className="exchange-item-card">
                <div className="exchange-item-title">
                  <div>
                    <h4>{item.garment_name}</h4>
                    <span className="exchange-holdings-tag">Holdings: {holdingsStr || 'None'}</span>
                  </div>
                  {item.has_active_exchange ? (
                    <span className="exchange-badge under_review">
                      {t('exchange.activeExchangeExists')}
                    </span>
                  ) : item.exchangeable_units > 0 ? (
                    !isEditing && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleStartExchange(item)}
                      >
                        {t('exchange.changeSize')}
                      </button>
                    )
                  ) : (
                    <span className="muted" style={{ fontSize: '0.8125rem' }}>
                      {t('exchange.notEligible')}
                    </span>
                  )}
                </div>

                {/* Form to submit exchange for this item */}
                {isEditing && activeItemObj && (
                  <form
                    className="exchange-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitMutation.mutate();
                    }}
                  >
                    <div className="exchange-form-row">
                      <div className="exchange-field">
                        <label htmlFor={`from-size-${item.id}`}>From Size</label>
                        <select
                          id={`from-size-${item.id}`}
                          value={fromSize}
                          onChange={(e) => {
                            const newFrom = e.target.value;
                            setFromSize(newFrom);
                            if (toSize === newFrom) {
                              const candidate = item.candidate_sizes.find((c) => c.size !== newFrom);
                              setToSize(candidate?.size || '');
                            }
                          }}
                        >
                          {Object.entries(item.current_holdings)
                            .filter(([_, q]) => q > 0)
                            .map(([sz, q]) => (
                              <option key={sz} value={sz}>
                                Size {sz} ({q} available)
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="exchange-field">
                        <label htmlFor={`to-size-${item.id}`}>{t('exchange.selectSize')}</label>
                        <select
                          id={`to-size-${item.id}`}
                          value={toSize}
                          onChange={(e) => setToSize(e.target.value)}
                          required
                        >
                          <option value="" disabled>
                            -- Choose size --
                          </option>
                          {item.candidate_sizes
                            .filter((c) => c.size !== fromSize)
                            .map((c) => {
                              const statusLabel =
                                c.available_qty > 0
                                  ? `${c.available_qty} in stock`
                                  : 'Out of stock';
                              return (
                                <option key={c.size} value={c.size}>
                                  Size {c.size} ({statusLabel})
                                  {c.recommended ? ' · Recommended' : ''}
                                </option>
                              );
                            })}
                        </select>
                      </div>
                    </div>

                    <div className="exchange-form-row">
                      <div className="exchange-field">
                        <label htmlFor={`qty-${item.id}`}>{t('exchange.quantity')}</label>
                        <input
                          id={`qty-${item.id}`}
                          type="number"
                          min={1}
                          max={item.current_holdings[fromSize] || item.exchangeable_units}
                          value={quantity}
                          onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                          required
                        />
                      </div>

                      <div className="exchange-field">
                        <label htmlFor={`reason-${item.id}`}>{t('exchange.reasonPrompt')}</label>
                        <select
                          id={`reason-${item.id}`}
                          value={reason}
                          onChange={(e) =>
                            setReason(e.target.value as 'TOO_SMALL' | 'TOO_BIG' | 'NOT_SIZE')
                          }
                        >
                          <option value="TOO_SMALL">{t('exchange.reasonTooSmall')}</option>
                          <option value="TOO_BIG">{t('exchange.reasonTooBig')}</option>
                          <option value="NOT_SIZE">{t('exchange.reasonNotSize')}</option>
                        </select>
                      </div>
                    </div>

                    <div className="exchange-field">
                      <label htmlFor={`note-${item.id}`}>{t('exchange.parentNote')}</label>
                      <textarea
                        id={`note-${item.id}`}
                        rows={2}
                        value={parentNote}
                        onChange={(e) => setParentNote(e.target.value)}
                        placeholder="Tell us what fit best or any details..."
                      />
                    </div>

                    {formError && (
                      <p role="alert" className="error" style={{ fontSize: '0.8125rem' }}>
                        {formError}
                      </p>
                    )}

                    <div className="exchange-btn-row">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedItem(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="primary"
                        disabled={submitMutation.isPending || !toSize}
                      >
                        {submitMutation.isPending
                          ? t('exchange.submitting')
                          : t('exchange.submit')}
                      </button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* Existing Exchange Requests for this Order */}
      {summary.requests.length > 0 && (
        <section style={{ marginTop: '1rem' }}>
          <div className="section-row" style={{ marginBottom: '0.75rem' }}>
            <h3>{t('exchange.requestsTitle')}</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {summary.requests.map((req: SizeExchangeRequestItem) => (
              <article key={req.id} className="exchange-request-card">
                <div className="exchange-item-title">
                  <div>
                    <b>{req.garment_name}</b>
                    <div style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                      Exchanging <strong>{req.quantity}</strong> unit(s): Size{' '}
                      <strong>{req.from_size}</strong> &rarr; Size <strong>{req.to_size}</strong>
                    </div>
                  </div>
                  <span className={`exchange-badge ${req.status.toLowerCase()}`}>
                    {req.status.replace(/_/g, ' ')}
                  </span>
                </div>

                {req.parent_note && (
                  <p style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
                    <em>Note: {req.parent_note}</em>
                  </p>
                )}

                {req.review_note && (
                  <div
                    style={{
                      background: 'var(--bg-subtle, #f5f6f8)',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '4px',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <strong>Staff update:</strong> {req.review_note}
                  </div>
                )}

                {(req.window_start || req.window_end) && (
                  <div
                    style={{
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '4px',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <strong>Handover window:</strong>{' '}
                    {req.window_start ? new Date(req.window_start).toLocaleDateString('en-IN') : 'TBD'}{' '}
                    to {req.window_end ? new Date(req.window_end).toLocaleDateString('en-IN') : 'TBD'}
                  </div>
                )}

                {req.can_withdraw && (
                  <div className="exchange-btn-row">
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: '0.8125rem' }}
                      disabled={withdrawMutation.isPending}
                      onClick={() => {
                        if (window.confirm('Are you sure you want to withdraw this exchange request?')) {
                          withdrawMutation.mutate(req.id);
                        }
                      }}
                    >
                      {withdrawMutation.isPending
                        ? t('exchange.withdrawing')
                        : t('exchange.withdraw')}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
