import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldShowFeedbackPrompt,
  getFeedbackLabel,
  submitFitFeedback,
} from './FitFeedbackPrompt';

vi.mock('../../api', () => ({
  api: vi.fn(),
}));

import { api } from '../../api';

describe('Prompt 9: Fit Feedback logic and API contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldShowFeedbackPrompt', () => {
    it('returns false when status is not DELIVERED', () => {
      const items = [{ id: '1', chosen_size: '32' }];
      expect(shouldShowFeedbackPrompt('CONFIRMED', items)).toBe(false);
      expect(shouldShowFeedbackPrompt('PLACED', items)).toBe(false);
      expect(shouldShowFeedbackPrompt('PACKED', items)).toBe(false);
      expect(shouldShowFeedbackPrompt('DISPATCHED', items)).toBe(false);
      expect(shouldShowFeedbackPrompt('', items)).toBe(false);
    });

    it('returns false when there are no items or no fitted items', () => {
      expect(shouldShowFeedbackPrompt('DELIVERED', [])).toBe(false);
      expect(
        shouldShowFeedbackPrompt('DELIVERED', [
          { id: '1', product_name: 'Belt' },
        ])
      ).toBe(false);
    });

    it('returns true when status is DELIVERED and fitted items exist', () => {
      expect(
        shouldShowFeedbackPrompt('DELIVERED', [
          { id: '1', chosen_size: '32' },
        ])
      ).toBe(true);

      expect(
        shouldShowFeedbackPrompt('delivered', [
          { id: '2', recommended_size: '28' },
        ])
      ).toBe(true);

      expect(
        shouldShowFeedbackPrompt('DELIVERED', [
          { id: '3', variant_size: '30' },
        ])
      ).toBe(true);
    });
  });

  describe('getFeedbackLabel', () => {
    it('maps feedback codes to clear human labels', () => {
      expect(getFeedbackLabel('TOO_TIGHT')).toBe('Too tight');
      expect(getFeedbackLabel('FITS_WELL')).toBe('Fits well');
      expect(getFeedbackLabel('TOO_LOOSE')).toBe('Too loose');
      expect(getFeedbackLabel('OTHER')).toBe('OTHER');
    });
  });

  describe('submitFitFeedback', () => {
    it('sends POST request to order line fit-feedback endpoint', async () => {
      (api as any).mockResolvedValueOnce({
        status: 'ok',
        fit_feedback: 'FITS_WELL',
        fit_feedback_answered_at: '2026-11-17T12:00:00Z',
      });

      const res = (await submitFitFeedback('order-123', 'item-456', 'FITS_WELL')) as any;

      expect(api).toHaveBeenCalledWith('/orders/order-123/items/item-456/fit-feedback/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fit_feedback: 'FITS_WELL' }),
      });
      expect(res.status).toBe('ok');
      expect(res.fit_feedback).toBe('FITS_WELL');
    });

    it('supports submitting TOO_TIGHT and TOO_LOOSE', async () => {
      (api as any).mockResolvedValueOnce({ status: 'ok', fit_feedback: 'TOO_TIGHT' });
      await submitFitFeedback('order-1', 'item-1', 'TOO_TIGHT');
      expect(api).toHaveBeenCalledWith(
        '/orders/order-1/items/item-1/fit-feedback/',
        expect.objectContaining({ body: JSON.stringify({ fit_feedback: 'TOO_TIGHT' }) })
      );

      (api as any).mockResolvedValueOnce({ status: 'ok', fit_feedback: 'TOO_LOOSE' });
      await submitFitFeedback('order-1', 'item-2', 'TOO_LOOSE');
      expect(api).toHaveBeenCalledWith(
        '/orders/order-1/items/item-2/fit-feedback/',
        expect.objectContaining({ body: JSON.stringify({ fit_feedback: 'TOO_LOOSE' }) })
      );
    });
  });
});
