import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import limits from '../../../shared/fit_limits.json';

/**
 * The size check: the parent types the child's height and weight once, and the
 * server suggests a size for every item that comes in sizes.
 *
 * The numbers stay on this phone for this visit only (sessionStorage) and are
 * sent with the order, where they are kept on the order lines. There is no
 * child profile.
 */

export const FIT_LIMITS = { height: limits.height_cm, weight: limits.weight_kg };

export interface Fit {
  heightCm: number;
  weightKg: number;
  /** From the optional camera step. Only these two numbers ever leave the phone. */
  shoulderCm?: number;
  shoulderConfidence?: number;
}

/** The fit as the API takes it (size check and order). */
export function fitPayload(fit: Fit) {
  return {
    height_cm: fit.heightCm,
    weight_kg: fit.weightKg,
    ...(fit.shoulderCm !== undefined && fit.shoulderConfidence !== undefined
      ? { shoulder_cm: fit.shoulderCm, shoulder_confidence: fit.shoulderConfidence }
      : {}),
  };
}
/** null: not asked yet. 'skipped': the parent chose sizes themselves. */
export type FitAnswer = Fit | 'skipped' | null;

export type FitStatus = 'FIT' | 'BETWEEN' | 'BELOW_CHART' | 'ABOVE_CHART' | 'NO_CHART';
export type FitWarning = 'HEIGHT_UNUSUAL_FOR_CLASS' | 'WEIGHT_UNUSUAL_FOR_CLASS' | 'HEIGHT_WEIGHT_UNUSUAL';

export interface ChartRow {
  variant_id: string;
  size: string;
  height_cm_min: number;
  height_cm_max: number;
  weight_kg_min: number | null;
  weight_kg_max: number | null;
  shoulder_cm_min: number | null;
  shoulder_cm_max: number | null;
  chest_cm_min: number | null;
  chest_cm_max: number | null;
  length_cm: number | null;
}

export interface Recommendation {
  status: FitStatus;
  size: string;
  alt_size: string;
}

export interface ProductFit {
  chart: ChartRow[];
  recommendation: Recommendation | null;
}

interface SizeFitResponse {
  fit: { height_cm: number; weight_kg: number; shoulder_cm: number | null; warnings: FitWarning[] } | null;
  products: Record<string, ProductFit>;
}

// ---------------------------------------------------------------------------
// The parent's answer, kept for the school + class + boy/girl it was given for
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'schoolstore_fit';
type Saved = { forKey: string; answer: Fit | 'skipped' };

function load(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

let saved: Saved | null = load();
const listeners = new Set<() => void>();

export function fitKey(schoolId?: string, classId?: string, gender?: string | null): string {
  return schoolId && classId && gender ? `${schoolId}|${classId}|${gender}` : '';
}

export function getFit(forKey: string): FitAnswer {
  return forKey && saved?.forKey === forKey ? saved.answer : null;
}

export function setFit(forKey: string, answer: Fit | 'skipped' | null) {
  saved = answer && forKey ? { forKey, answer } : null;
  try {
    if (saved) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the answer lasts until the page closes.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFitAnswer(forKey: string): FitAnswer {
  return useSyncExternalStore(subscribe, () => getFit(forKey));
}

// ---------------------------------------------------------------------------
// Checking what the parent typed (the server checks again)
// ---------------------------------------------------------------------------
export type FitFieldError = 'required' | 'notNumber' | 'range';

export function parseMeasure(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : NaN;
}

export function checkMeasure(text: string, limit: { min: number; max: number }): FitFieldError | null {
  const value = parseMeasure(text);
  if (value === null) return 'required';
  if (Number.isNaN(value)) return 'notNumber';
  if (value < limit.min || value > limit.max) return 'range';
  return null;
}

// ---------------------------------------------------------------------------
// Charts and suggestions from the server
// ---------------------------------------------------------------------------
const MAX_PRODUCTS = 60;

export function useSizeFit(productIds: string[], answer: FitAnswer, className?: string) {
  const ids = productIds.slice(0, MAX_PRODUCTS);
  const fit = answer && answer !== 'skipped' ? answer : null;
  return useQuery({
    queryKey: [
      'size-fit',
      ids.join(','),
      fit ? `${fit.heightCm}|${fit.weightKg}|${fit.shoulderCm ?? ''}|${fit.shoulderConfidence ?? ''}` : String(answer),
      className ?? '',
    ],
    queryFn: () =>
      api<SizeFitResponse>('/public/size-fit/', {
        method: 'POST',
        body: JSON.stringify({
          products: ids,
          ...(fit ? { ...fitPayload(fit), class: className } : {}),
        }),
      }),
    enabled: ids.length > 0 && answer !== null,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Matches the suggested size labels to this product's size buttons. */
export function suggestedSizeIds(
  sizes: { id: string; size: string; inStock: boolean }[],
  productFit?: ProductFit,
): { primary?: string; alt?: string } {
  const rec = productFit?.recommendation;
  if (!rec || rec.status === 'NO_CHART') return {};
  const idOf = (label: string) => (label ? sizes.find((s) => s.size === label)?.id : undefined);
  return { primary: idOf(rec.size), alt: idOf(rec.alt_size) };
}

/** The size to pre-select: the suggestion, when it is in stock. */
export function preselectSizeId(
  sizes: { id: string; size: string; inStock: boolean }[],
  productFit?: ProductFit,
): string | undefined {
  const { primary } = suggestedSizeIds(sizes, productFit);
  return sizes.find((s) => s.id === primary && s.inStock)?.id;
}

/** "128" or "128.5": charts are stored to one decimal place. */
export function formatMeasure(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
