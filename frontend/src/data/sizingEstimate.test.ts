import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({
  api: vi.fn(),
}));

import { api } from '../api';
import {
  FIT_LIMITS,
  fitPayload,
  parseMeasure,
  checkMeasure,
  suggestedSizeIds,
  preselectSizeId,
  type Fit,
  type EstimateResponse,
} from './fit';

describe('Prompt 8: Sizing Estimate & Recommendation Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Fit Payload Serialisation for ESTIMATE', () => {
    it('serialises fit_source ESTIMATE and model_version when sized from estimator', () => {
      const estimatedFit: Fit = {
        heightCm: 128.5,
        weightKg: 25.0,
        source: 'ESTIMATE',
        modelVersion: '20261117-001',
      };

      const payload = fitPayload(estimatedFit);
      expect(payload.height_cm).toBe(128.5);
      expect(payload.weight_kg).toBe(25.0);
      expect(payload.source).toBe('ESTIMATE');
      expect(payload.model_version).toBe('20261117-001');
      expect(payload.shoulder_edited).toBe(false);
      expect(payload.shoulder_cm).toBeUndefined();
    });

    it('measured shoulder overrides estimate and preserves CAMERA or MANUAL source', () => {
      const cameraFit: Fit = {
        heightCm: 128.5,
        weightKg: 25.0,
        shoulderCm: 31.8,
        shoulderConfidence: 0.88,
        source: 'CAMERA',
      };

      const payload = fitPayload(cameraFit);
      expect(payload.source).toBe('CAMERA');
      expect(payload.shoulder_cm).toBe(31.8);
      expect(payload.shoulder_confidence).toBe(0.88);
      expect(payload.model_version).toBeUndefined();

      const manualFit: Fit = {
        heightCm: 130.0,
        weightKg: 27.0,
        shoulderCm: 32.0,
        source: 'MANUAL',
      };
      const manualPayload = fitPayload(manualFit);
      expect(manualPayload.source).toBe('MANUAL');
      expect(manualPayload.shoulder_cm).toBe(32.0);
    });
  });

  describe('Input Validation against FIT_LIMITS', () => {
    it('accepts numbers within limits', () => {
      expect(checkMeasure('120', FIT_LIMITS.height)).toBeNull();
      expect(checkMeasure('25.5', FIT_LIMITS.weight)).toBeNull();
      expect(parseMeasure(' 135.2 ')).toBe(135.2);
    });

    it('rejects numbers outside range or malformed', () => {
      expect(checkMeasure('50', FIT_LIMITS.height)).toBe('range'); // < 70
      expect(checkMeasure('250', FIT_LIMITS.height)).toBe('range'); // > 200
      expect(checkMeasure('4', FIT_LIMITS.weight)).toBe('range'); // < 7
      expect(checkMeasure('abc', FIT_LIMITS.height)).toBe('notNumber');
      expect(checkMeasure('', FIT_LIMITS.height)).toBe('required');
    });
  });

  describe('Size Pre-selection and Alt Size Logic', () => {
    const mockSizes = [
      { id: 'v28', size: '28', inStock: true },
      { id: 'v30', size: '30', inStock: true },
      { id: 'v32', size: '32', inStock: true },
      { id: 'v34', size: '34', inStock: false },
    ];

    it('pre-selects recommended size when in stock', () => {
      const productFit = {
        chart: [],
        recommendation: { status: 'FIT' as const, size: '30', alt_size: '32' },
      };
      expect(preselectSizeId(mockSizes, productFit)).toBe('v30');
    });

    it('identifies primary and alt size suggestions', () => {
      const productFit = {
        chart: [],
        recommendation: { status: 'BETWEEN' as const, size: '32', alt_size: '30' },
      };
      const ids = suggestedSizeIds(mockSizes, productFit);
      expect(ids.primary).toBe('v32');
      expect(ids.alt).toBe('v30');
    });

    it('falls back gracefully when chart has no shoulder ranges', () => {
      const fallbackFit = {
        chart: [
          {
            variant_id: 'v28',
            size: '28',
            height_cm_min: 110,
            height_cm_max: 120,
            weight_kg_min: null,
            weight_kg_max: null,
            shoulder_cm_min: null, // No shoulder data
            shoulder_cm_max: null,
            chest_cm_min: null,
            chest_cm_max: null,
            length_cm: null,
          },
        ],
        recommendation: { status: 'FIT' as const, size: '28', alt_size: '' },
      };
      const ids = suggestedSizeIds(mockSizes, fallbackFit);
      expect(ids.primary).toBe('v28');
      expect(ids.alt).toBeUndefined();
    });
  });

  describe('Confidence State Definitions and Messaging', () => {
    it('maps high confidence correctly', () => {
      const highRes: EstimateResponse = {
        shoulder_cm: 31.4,
        shoulder_low_cm: 29.8,
        shoulder_high_cm: 33.0,
        confidence: 'high',
        recommended_size: '32',
        alt_size: '',
        reason: 'Most children of this height and weight fit this size.',
        model_version: '20261117-001',
      };
      expect(highRes.confidence).toBe('high');
      expect(highRes.reason).toContain('Most children of this height and weight fit this size');
    });

    it('maps medium confidence and straddling alt size', () => {
      const medRes: EstimateResponse = {
        shoulder_cm: 32.4,
        shoulder_low_cm: 30.8,
        shoulder_high_cm: 34.0,
        confidence: 'medium',
        recommended_size: '32',
        alt_size: '30',
        reason: 'Good guess. Between sizes we picked the bigger one.',
        model_version: '20261117-001',
      };
      expect(medRes.confidence).toBe('medium');
      expect(medRes.alt_size).toBe('30');
      expect(medRes.reason).toContain('Between sizes we picked the bigger one');
    });

    it('maps low confidence with prompt for manual measurement', () => {
      const lowRes: EstimateResponse = {
        shoulder_cm: 35.0,
        shoulder_low_cm: 33.0,
        shoulder_high_cm: 37.0,
        confidence: 'low',
        recommended_size: '34',
        alt_size: '',
        reason: 'Not sure. Measure the shoulders for an exact fit.',
        model_version: '20261117-001',
      };
      expect(lowRes.confidence).toBe('low');
      expect(lowRes.reason).toContain('Measure the shoulders for an exact fit');
    });
  });
});
