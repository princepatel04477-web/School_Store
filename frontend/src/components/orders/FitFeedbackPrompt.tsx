import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';

export interface OrderItemFeedbackProps {
  id: string;
  chosen_size?: string;
  recommended_size?: string;
  variant_size?: string;
  fit_feedback?: string;
  product_name?: string;
}

export interface FitFeedbackPromptProps {
  orderId: string;
  orderStatus: string;
  orderCreatedAt?: string;
  items?: OrderItemFeedbackProps[];
  onFeedbackSubmitted?: (itemId: string, feedback: string) => void;
}

export function shouldShowFeedbackPrompt(
  orderStatus?: string,
  items?: OrderItemFeedbackProps[]
): boolean {
  const isDelivered = (orderStatus || '').toUpperCase() === 'DELIVERED';
  if (!isDelivered || !items || items.length === 0) {
    return false;
  }
  return items.some((item) => Boolean(item.chosen_size || item.recommended_size || item.variant_size));
}

export function getFeedbackLabel(code: string): string {
  if (code === 'TOO_TIGHT') return 'Too tight';
  if (code === 'FITS_WELL') return 'Fits well';
  if (code === 'TOO_LOOSE') return 'Too loose';
  return code;
}

export async function submitFitFeedback(
  orderId: string,
  itemId: string,
  feedback: 'TOO_TIGHT' | 'FITS_WELL' | 'TOO_LOOSE'
) {
  return api(`/orders/${orderId}/items/${itemId}/fit-feedback/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fit_feedback: feedback }),
  });
}

export function FitFeedbackPrompt({
  orderId,
  orderStatus,
  orderCreatedAt,
  items = [],
  onFeedbackSubmitted,
}: FitFeedbackPromptProps) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDelivered = (orderStatus || '').toUpperCase() === 'DELIVERED';

  const { data: orderDetail } = useQuery({
    queryKey: ['order-detail-feedback', orderId],
    queryFn: () => api<any>(`/orders/${orderId}/`),
    enabled: isDelivered && items.length === 0,
  });

  const effectiveItems: OrderItemFeedbackProps[] =
    items.length > 0 ? items : (orderDetail?.items || []);

  if (!shouldShowFeedbackPrompt(orderStatus, effectiveItems)) {
    return null;
  }

  // Find items that have a size
  const fittedItems = effectiveItems.filter(
    (item) => item.chosen_size || item.recommended_size || item.variant_size
  );

  const handleFeedback = async (itemId: string, feedback: 'TOO_TIGHT' | 'FITS_WELL' | 'TOO_LOOSE') => {
    try {
      setSubmittingId(itemId);
      setErrorMsg(null);
      await submitFitFeedback(orderId, itemId, feedback);
      setAnswers((prev) => ({ ...prev, [itemId]: feedback }));
      if (onFeedbackSubmitted) {
        onFeedbackSubmitted(itemId, feedback);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not submit feedback.');
    } finally {
      setSubmittingId(null);
    }
  };

  const getLabel = (code: string) => {
    if (code === 'TOO_TIGHT') return 'Too tight';
    if (code === 'FITS_WELL') return 'Fits well';
    if (code === 'TOO_LOOSE') return 'Too loose';
    return code;
  };

  return (
    <div
      className="fit-feedback-wrapper"
      role="region"
      aria-label="Order size fit feedback"
      style={{
        marginTop: '12px',
        padding: '12px',
        backgroundColor: '#f8faf9',
        border: '1px solid #dce5df',
        borderRadius: '8px',
        fontSize: '14px',
      }}
    >
      {fittedItems.map((item) => {
        const currentFeedback = answers[item.id] || item.fit_feedback;
        const sizeLabel = item.chosen_size || item.recommended_size || item.variant_size;

        if (currentFeedback) {
          return (
            <div
              key={item.id}
              className="fit-feedback-answered"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: '#2e7d32',
                fontWeight: 500,
              }}
            >
              <span>✓ Size {sizeLabel} feedback recorded:</span>
              <strong style={{ color: '#1b5e20' }}>{getLabel(currentFeedback)}</strong>
            </div>
          );
        }

        const isBusy = submittingId === item.id;

        return (
          <div key={item.id} className="fit-feedback-row" style={{ marginBottom: '8px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: '#1f2937' }}>
              How did size {sizeLabel} fit?
              {item.product_name && (
                <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>
                  ({item.product_name})
                </span>
              )}
            </p>
            <div
              className="fit-feedback-actions"
              style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
            >
              <button
                type="button"
                className="fit-btn fit-btn-tight"
                aria-label="Too tight"
                disabled={isBusy}
                onClick={() => handleFeedback(item.id, 'TOO_TIGHT')}
                style={{
                  flex: '1 1 auto',
                  minHeight: '38px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  backgroundColor: '#ffffff',
                  color: '#374151',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                Too tight
              </button>
              <button
                type="button"
                className="fit-btn fit-btn-well"
                aria-label="Fits well"
                disabled={isBusy}
                onClick={() => handleFeedback(item.id, 'FITS_WELL')}
                style={{
                  flex: '1 1 auto',
                  minHeight: '38px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #2e8b57',
                  backgroundColor: '#f0fdf4',
                  color: '#15803d',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                Fits well
              </button>
              <button
                type="button"
                className="fit-btn fit-btn-loose"
                aria-label="Too loose"
                disabled={isBusy}
                onClick={() => handleFeedback(item.id, 'TOO_LOOSE')}
                style={{
                  flex: '1 1 auto',
                  minHeight: '38px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  backgroundColor: '#ffffff',
                  color: '#374151',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                Too loose
              </button>
            </div>
          </div>
        );
      })}
      {errorMsg && (
        <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '6px' }}>{errorMsg}</div>
      )}
    </div>
  );
}
