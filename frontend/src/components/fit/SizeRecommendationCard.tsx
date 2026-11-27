import React, { useEffect, useId, useState } from 'react';
import { Camera, Ruler } from '../ui/icons';
import { FIT_LIMITS, formatMeasure, useEstimateFit, type Fit } from '../../data/fit';
import { haptic } from '../../native/haptics';
import './fit.css';

export interface SizeRecommendationCardProps {
  measurement?: Fit | null;
  productId?: string;
  schoolId?: string;
  classId?: string;
  className?: string;
  gender?: string | null;
  onSelectSize?: (size: string) => void;
  onSave: (fit: Fit) => Promise<boolean> | boolean;
  onOpenMeasureFlow: (mode?: 'camera' | 'tape') => void;
}

export function SizeRecommendationCard({
  measurement,
  productId,
  schoolId,
  classId,
  className,
  gender,
  onSelectSize,
  onSave,
  onOpenMeasureFlow,
}: SizeRecommendationCardProps) {
  const isMeasured = Boolean(
    measurement?.shoulderCm != null &&
    measurement.source &&
    measurement.source !== 'ESTIMATE'
  );

  const [unitMode, setUnitMode] = useState<'cm' | 'ft'>('cm');
  const [heightInput, setHeightInput] = useState<string>(
    measurement?.heightCm ? String(measurement.heightCm) : ''
  );
  const [feetInput, setFeetInput] = useState<string>('');
  const [inchesInput, setInchesInput] = useState<string>('');
  const [weightInput, setWeightInput] = useState<string>(
    measurement?.weightKg ? String(measurement.weightKg) : ''
  );

  // Debounced height and weight
  const [debouncedHeight, setDebouncedHeight] = useState<number | null>(
    measurement?.heightCm ?? null
  );
  const [debouncedWeight, setDebouncedWeight] = useState<number | null>(
    measurement?.weightKg ?? null
  );

  const heightId = useId();
  const weightId = useId();
  const feetId = useId();
  const inchesId = useId();

  // Convert ft/in to cm whenever feet or inches change in ft mode
  useEffect(() => {
    if (unitMode === 'ft') {
      const f = parseFloat(feetInput);
      const i = parseFloat(inchesInput || '0');
      if (!Number.isNaN(f) && f > 0) {
        const totalInches = f * 12 + (Number.isNaN(i) ? 0 : i);
        const cm = Math.round(totalInches * 2.54 * 10) / 10;
        setHeightInput(String(cm));
      }
    }
  }, [feetInput, inchesInput, unitMode]);

  // Handle debounce (400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      const h = parseFloat(heightInput);
      const w = parseFloat(weightInput);
      const validH =
        !Number.isNaN(h) &&
        h >= FIT_LIMITS.height.min &&
        h <= FIT_LIMITS.height.max
          ? h
          : null;
      const validW =
        !Number.isNaN(w) &&
        w >= FIT_LIMITS.weight.min &&
        w <= FIT_LIMITS.weight.max
          ? w
          : null;

      setDebouncedHeight(validH);
      setDebouncedWeight(validW);
    }, 400);

    return () => clearTimeout(timer);
  }, [heightInput, weightInput]);

  // Query size estimate from Prompt 7 endpoint
  const { data: estimate, isFetching } = useEstimateFit({
    schoolId,
    classId,
    className,
    gender,
    productId,
    heightCm: debouncedHeight,
    weightKg: debouncedWeight,
    enabled: !isMeasured && debouncedHeight != null && debouncedWeight != null,
  });

  // When recommendation arrives: trigger light haptic, preselect size, save estimated fit
  useEffect(() => {
    if (estimate && estimate.recommended_size) {
      haptic.impactLight().catch(() => {});
      if (onSelectSize) {
        onSelectSize(estimate.recommended_size);
      }
      if (debouncedHeight && debouncedWeight) {
        onSave({
          heightCm: debouncedHeight,
          weightKg: debouncedWeight,
          source: 'ESTIMATE',
          modelVersion: estimate.model_version,
          measuredAt: new Date().toISOString(),
        });
      }
    }
  }, [estimate?.recommended_size, estimate?.model_version]);

  // 1. If shoulder has already been measured (camera or tape), show Measured Card
  if (isMeasured && measurement) {
    return (
      <div className="size-recommendation-card measured-state" role="region" aria-label="Measured Fit">
        <div className="size-rec-header">
          <div className="size-rec-title-wrap">
            <span className="size-rec-title">Measured Fit</span>
            <span className="confidence-chip conf-measured">Measured</span>
          </div>
          <button
            type="button"
            className="size-action-link"
            onClick={() => onOpenMeasureFlow('camera')}
          >
            Measure again
          </button>
        </div>
        <div className="size-rec-values-grid">
          <div className="size-rec-stat">
            <span className="stat-label">Height</span>
            <span className="stat-val">{formatMeasure(measurement.heightCm)} cm</span>
          </div>
          <div className="size-rec-stat">
            <span className="stat-label">Weight</span>
            <span className="stat-val">{formatMeasure(measurement.weightKg)} kg</span>
          </div>
          <div className="size-rec-stat">
            <span className="stat-label">Shoulder</span>
            <span className="stat-val">{formatMeasure(measurement.shoulderCm)} cm</span>
          </div>
        </div>
      </div>
    );
  }

  // 2. Height & Weight Inputs + Live Estimate Card
  return (
    <div className="size-recommendation-card" role="region" aria-label="Size Recommendation">
      <div className="size-rec-input-header">
        <span className="size-input-heading">Fit Assistant</span>
        <div className="unit-toggle" role="radiogroup" aria-label="Height units">
          <button
            type="button"
            role="radio"
            aria-checked={unitMode === 'cm'}
            className={`unit-btn ${unitMode === 'cm' ? 'is-active' : ''}`}
            onClick={() => setUnitMode('cm')}
          >
            cm
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={unitMode === 'ft'}
            className={`unit-btn ${unitMode === 'ft' ? 'is-active' : ''}`}
            onClick={() => {
              setUnitMode('ft');
              if (heightInput) {
                const totalIn = parseFloat(heightInput) / 2.54;
                const ft = Math.floor(totalIn / 12);
                const inch = Math.round(totalIn % 12);
                setFeetInput(String(ft));
                setInchesInput(String(inch));
              }
            }}
          >
            ft & in
          </button>
        </div>
      </div>

      <div className="size-inputs-row">
        {unitMode === 'cm' ? (
          <div className="size-field">
            <label htmlFor={heightId} className="size-field-label">
              Height (cm)
            </label>
            <input
              id={heightId}
              type="text"
              inputMode="decimal"
              className="size-num-input"
              placeholder={`${FIT_LIMITS.height.min} - ${FIT_LIMITS.height.max}`}
              value={heightInput}
              onChange={(e) => setHeightInput(e.target.value)}
              aria-label="Height in centimeters"
            />
          </div>
        ) : (
          <div className="size-field-dual">
            <div className="size-field-sub">
              <label htmlFor={feetId} className="size-field-label">
                Feet
              </label>
              <input
                id={feetId}
                type="text"
                inputMode="numeric"
                className="size-num-input"
                placeholder="ft"
                value={feetInput}
                onChange={(e) => setFeetInput(e.target.value)}
                aria-label="Height in feet"
              />
            </div>
            <div className="size-field-sub">
              <label htmlFor={inchesId} className="size-field-label">
                Inches
              </label>
              <input
                id={inchesId}
                type="text"
                inputMode="numeric"
                className="size-num-input"
                placeholder="in"
                value={inchesInput}
                onChange={(e) => setInchesInput(e.target.value)}
                aria-label="Height in inches"
              />
            </div>
          </div>
        )}

        <div className="size-field">
          <label htmlFor={weightId} className="size-field-label">
            Weight (kg)
          </label>
          <input
            id={weightId}
            type="text"
            inputMode="decimal"
            className="size-num-input"
            placeholder={`${FIT_LIMITS.weight.min} - ${FIT_LIMITS.weight.max}`}
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            aria-label="Weight in kilograms"
          />
        </div>
      </div>

      {/* Result Card when estimate is available */}
      {estimate && estimate.recommended_size && (
        <div
          className="size-result-box"
          role="status"
          aria-live="polite"
        >
          <div className="result-main-line">
            <span className="recommended-label">
              Recommended size: <strong>{estimate.recommended_size}</strong>
            </span>
            <span
              className={`confidence-chip conf-${estimate.confidence}`}
              aria-label={`Confidence: ${estimate.confidence}`}
            >
              {estimate.confidence.charAt(0).toUpperCase() + estimate.confidence.slice(1)}
            </span>
          </div>

          {/* Shoulder range estimate (hidden if chart has no shoulder data) */}
          {estimate.shoulder_low_cm != null && estimate.shoulder_high_cm != null && (
            <div className="shoulder-range-line">
              Shoulder about {estimate.shoulder_low_cm} to {estimate.shoulder_high_cm} cm, estimated from height and weight
            </div>
          )}

          {/* Confidence plain explanation */}
          <div className="confidence-reason">
            {estimate.confidence === 'high' &&
              'Most children of this height and weight fit this size.'}
            {estimate.confidence === 'medium' &&
              'Good guess. Between sizes we picked the bigger one.'}
            {estimate.confidence === 'low' &&
              'Not sure. Measure the shoulders for an exact fit.'}
          </div>

          {/* Alt size option */}
          {estimate.alt_size && (
            <div className="alt-size-line">
              If they like a looser fit: <strong>{estimate.alt_size}</strong>
            </div>
          )}

          {/* Secondary fallback actions when confidence is not High */}
          {estimate.confidence !== 'high' && (
            <div className="measure-fallback-actions">
              <button
                type="button"
                className="measure-shoulders-btn"
                onClick={() => onOpenMeasureFlow('camera')}
              >
                <Camera width={16} height={16} />
                <span>Measure shoulders</span>
              </button>
              <button
                type="button"
                className="tape-fallback-btn"
                onClick={() => onOpenMeasureFlow('tape')}
              >
                <Ruler width={16} height={16} />
                <span>Use a tape instead</span>
              </button>
            </div>
          )}
        </div>
      )}

      {isFetching && (
        <div className="size-estimating-indicator" aria-live="polite">
          Calculating best size...
        </div>
      )}
    </div>
  );
}
