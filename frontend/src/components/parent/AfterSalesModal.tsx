import { useState, useEffect } from 'react';
import { AlertCircle, Check, X } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import { useLang } from '../../i18n';
import {
  orderApi,
  type Order,
  type OrderAfterSalesEligibility,
  type ItemAfterSalesEligibility,
  type ReplacementSizeOption,
} from '../../api';

interface AfterSalesModalProps {
  order: Order;
  initialType: 'CANCEL' | 'EXCHANGE' | 'RETURN' | 'REPLACE';
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AfterSalesModal({ order, initialType, isOpen, onClose, onSuccess }: AfterSalesModalProps) {
  const { t } = useLang();
  const [reqType, setReqType] = useState<'CANCEL' | 'EXCHANGE' | 'RETURN' | 'REPLACE'>(initialType);
  const [eligibility, setEligibility] = useState<OrderAfterSalesEligibility | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [targetSize, setTargetSize] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [reasonDetails, setReasonDetails] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  useEffect(() => {
    setReqType(initialType);
  }, [initialType]);

  useEffect(() => {
    if (!isOpen) {
      setEligibility(null);
      setError(null);
      setSelectedItemId('');
      setTargetSize('');
      setReason('');
      setReasonDetails('');
      setSubmitSuccess(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    orderApi
      .getAfterSalesEligibility(order.id)
      .then((data) => {
        if (!isMounted) return;
        setEligibility(data);
        setIsLoading(false);

        // Auto-select first eligible item if applicable
        if (reqType === 'EXCHANGE') {
          const firstEx = data.items.find((it) => it.can_exchange);
          if (firstEx) {
            setSelectedItemId(firstEx.item_id);
            setReason('TOO_SMALL');
            const firstAvail = firstEx.replacement_sizes.find((s) => s.available);
            if (firstAvail) setTargetSize(firstAvail.size);
          }
        } else if (reqType === 'RETURN' || reqType === 'REPLACE') {
          const firstRet = data.items.find((it) => it.can_return);
          if (firstRet) {
            setSelectedItemId(firstRet.item_id);
            setReason('DAMAGED');
          }
        } else if (reqType === 'CANCEL') {
          setReason('CHANGE_OF_MIND');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setIsLoading(false);
        setError(err instanceof Error ? err.message : 'Failed to load eligibility details.');
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, order.id, reqType]);

  if (!isOpen) return null;

  const currentItem: ItemAfterSalesEligibility | undefined = eligibility?.items.find(
    (it) => it.item_id === selectedItemId
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await orderApi.requestAfterSale(order.id, {
        order_item: reqType === 'CANCEL' ? null : selectedItemId || null,
        request_type: reqType,
        reason: reason,
        reason_details: reasonDetails,
        target_size: reqType === 'EXCHANGE' ? targetSize : undefined,
      });
      setIsSubmitting(false);
      setSubmitSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1400);
    } catch (err: any) {
      setIsSubmitting(false);
      setError(err?.data?.detail || err?.message || 'Failed to submit request.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="after-sales-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          maxWidth: '520px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '1.5rem',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <span className="eyebrow" style={{ display: 'block', fontSize: '10px' }}>
              {order.order_number}
            </span>
            <h2 id="after-sales-title" style={{ margin: '0.25rem 0 0', fontSize: '1.25rem' }}>
              {reqType === 'CANCEL'
                ? t('aftersales.cancelOrder')
                : reqType === 'EXCHANGE'
                ? t('aftersales.requestExchange')
                : t('aftersales.reportIssue')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label={t('common.close')}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink-soft)',
              padding: '4px',
              display: 'inline-flex',
            }}
          >
            <X width={20} height={20} strokeWidth={2} />
          </button>
        </div>

        {isLoading ? (
          <div style={{ display: 'grid', gap: '0.75rem' }} role="status" aria-busy="true">
            <Skeleton height="32px" borderRadius="var(--radius-sm)" />
            <Skeleton height="60px" borderRadius="var(--radius-sm)" />
            <Skeleton height="80px" borderRadius="var(--radius-sm)" />
          </div>
        ) : error && !eligibility ? (
          <div
            role="alert"
            style={{
              padding: '1rem',
              background: 'var(--paper-sunk)',
              border: '1px solid var(--line)',
              borderLeft: '4px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.9rem',
              color: 'var(--danger)',
              marginBottom: '1rem',
            }}
          >
            {error}
          </div>
        ) : submitSuccess ? (
          <div
            role="status"
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                color: 'var(--brand-deep)',
                background: 'var(--brand-tint)',
                padding: '10px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1rem',
              }}
            >
              <Check width={32} height={32} strokeWidth={2.5} />
            </div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{t('aftersales.requestSubmitted')}</h3>
            {reqType === 'EXCHANGE' && (
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--ink-soft)' }}>
                {t('aftersales.stockReserved')}
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div
                role="alert"
                style={{
                  padding: '0.75rem',
                  background: 'var(--paper-sunk)',
                  border: '1px solid var(--line)',
                  borderLeft: '4px solid var(--danger)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  color: 'var(--danger)',
                  marginBottom: '1rem',
                }}
              >
                {error}
              </div>
            )}

            {/* CANCELLATION FLOW */}
            {reqType === 'CANCEL' && (
              <>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem', color: 'var(--ink-soft)' }}>
                  {t('aftersales.cancelConfirm')}
                </p>
                <div style={{ marginBottom: '1rem' }}>
                  <label htmlFor="cancel-reason" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    {t('aftersales.selectReason')}
                  </label>
                  <select
                    id="cancel-reason"
                    className="select-field"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'var(--paper)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.9rem',
                    }}
                  >
                    <option value="CHANGE_OF_MIND">{t('aftersales.reason.CHANGE_OF_MIND')}</option>
                    <option value="ORDERED_BY_MISTAKE">{t('aftersales.reason.ORDERED_BY_MISTAKE')}</option>
                    <option value="DELIVERY_DELAY">{t('aftersales.reason.DELIVERY_DELAY')}</option>
                    <option value="OTHER">{t('aftersales.reason.OTHER')}</option>
                  </select>
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label htmlFor="cancel-details" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    {t('aftersales.reasonDetails')}
                  </label>
                  <textarea
                    id="cancel-details"
                    rows={2}
                    value={reasonDetails}
                    onChange={(e) => setReasonDetails(e.target.value)}
                    placeholder="Provide any additional notes..."
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'var(--paper)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </>
            )}

            {/* SIZE EXCHANGE FLOW */}
            {reqType === 'EXCHANGE' && (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <label htmlFor="exchange-item" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    {t('aftersales.selectItem')}
                  </label>
                  <select
                    id="exchange-item"
                    value={selectedItemId}
                    onChange={(e) => {
                      setSelectedItemId(e.target.value);
                      const itm = eligibility?.items.find((i) => i.item_id === e.target.value);
                      const firstAvail = itm?.replacement_sizes.find((s) => s.available);
                      if (firstAvail) setTargetSize(firstAvail.size);
                    }}
                    required
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'var(--paper)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.9rem',
                    }}
                  >
                    {eligibility?.items
                      .filter((it) => it.can_exchange)
                      .map((it) => (
                        <option key={it.item_id} value={it.item_id}>
                          {it.product_name} ({it.current_size}) - ₹{it.unit_price}
                        </option>
                      ))}
                  </select>
                </div>

                {currentItem && (
                  <>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                        {t('aftersales.selectSize')}
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.5rem' }}>
                        {currentItem.replacement_sizes.map((sz: ReplacementSizeOption) => (
                          <button
                            key={sz.variant_id}
                            type="button"
                            disabled={!sz.available}
                            onClick={() => setTargetSize(sz.size)}
                            style={{
                              padding: '0.5rem',
                              textAlign: 'left',
                              background: targetSize === sz.size ? 'var(--brand-tint)' : 'var(--paper)',
                              border: targetSize === sz.size ? '2px solid var(--brand)' : '1px solid var(--line)',
                              borderRadius: 'var(--radius-sm)',
                              opacity: sz.available ? 1 : 0.45,
                              cursor: sz.available ? 'pointer' : 'not-allowed',
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{sz.size}</div>
                            <div style={{ fontSize: '0.75rem', color: sz.available ? 'var(--ink-soft)' : 'var(--danger)' }}>
                              {sz.stock_flag === 'IN_STOCK'
                                ? t('aftersales.inStock')
                                : sz.stock_flag === 'LOW_STOCK'
                                ? t('aftersales.lowStock')
                                : t('aftersales.outOfStock')}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      <label htmlFor="exchange-reason" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                        {t('aftersales.selectReason')}
                      </label>
                      <select
                        id="exchange-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        required
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          background: 'var(--paper)',
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.9rem',
                        }}
                      >
                        <option value="TOO_SMALL">{t('aftersales.reason.TOO_SMALL')}</option>
                        <option value="TOO_BIG">{t('aftersales.reason.TOO_BIG')}</option>
                        <option value="OTHER">{t('aftersales.reason.OTHER')}</option>
                      </select>
                    </div>

                    <div
                      style={{
                        padding: '0.75rem',
                        background: 'var(--paper-sunk)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.8rem',
                        color: 'var(--ink-soft)',
                        marginBottom: '1.25rem',
                      }}
                    >
                      {t('aftersales.firstExchangeFree')}
                    </div>
                  </>
                )}
              </>
            )}

            {/* DAMAGED / WRONG ITEM FLOW */}
            {(reqType === 'RETURN' || reqType === 'REPLACE') && (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Resolution
                  </label>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem' }}>
                      <input
                        type="radio"
                        name="resolution"
                        checked={reqType === 'REPLACE'}
                        onChange={() => setReqType('REPLACE')}
                      />
                      {t('aftersales.reqType.REPLACE')}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem' }}>
                      <input
                        type="radio"
                        name="resolution"
                        checked={reqType === 'RETURN'}
                        onChange={() => setReqType('RETURN')}
                      />
                      {t('aftersales.reqType.RETURN')}
                    </label>
                  </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label htmlFor="defect-item" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    {t('aftersales.selectItem')}
                  </label>
                  <select
                    id="defect-item"
                    value={selectedItemId}
                    onChange={(e) => setSelectedItemId(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'var(--paper)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.9rem',
                    }}
                  >
                    {eligibility?.items
                      .filter((it) => it.can_return)
                      .map((it) => (
                        <option key={it.item_id} value={it.item_id}>
                          {it.product_name} ({it.current_size}) - ₹{it.unit_price}
                        </option>
                      ))}
                  </select>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label htmlFor="defect-reason" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    {t('aftersales.selectReason')}
                  </label>
                  <select
                    id="defect-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'var(--paper)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.9rem',
                    }}
                  >
                    <option value="DAMAGED">{t('aftersales.reason.DAMAGED')}</option>
                    <option value="DEFECTIVE">{t('aftersales.reason.DEFECTIVE')}</option>
                    <option value="WRONG_ITEM">{t('aftersales.reason.WRONG_ITEM')}</option>
                    <option value="OTHER">{t('aftersales.reason.OTHER')}</option>
                  </select>
                </div>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label htmlFor="defect-details" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    {t('aftersales.reasonDetails')}
                  </label>
                  <textarea
                    id="defect-details"
                    rows={2}
                    value={reasonDetails}
                    onChange={(e) => setReasonDetails(e.target.value)}
                    placeholder="Describe the issue in detail..."
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'var(--paper)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn btn-outline"
                disabled={isSubmitting}
                onClick={onClose}
              >
                {t('common.close')}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || (reqType === 'EXCHANGE' && !targetSize)}
              >
                {isSubmitting ? t('aftersales.submitting') : t('aftersales.submitRequest')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
