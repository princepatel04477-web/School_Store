import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import limits from '../../../shared/fit_limits.json';

/**
 * The child's measurement: height and weight typed by the parent, and the
 * shoulder width from the camera or a tape measure. Measured once, it fills
 * every shirt and trouser for that child (Prompt 21), and the server suggests
 * a size for every item that has a size chart.
 *
 * On this phone it is kept for this visit (sessionStorage). It is copied onto
 * each bag line it sized, sent with the order, and saved on the child's record
 * then (or straight away when a teacher or signed-in parent has the child).
 */

export const FIT_LIMITS = { height: limits.height_cm, weight: limits.weight_kg, shoulder: limits.shoulder_cm };

export type FitSource = 'CAMERA' | 'MANUAL';

export interface Fit {
  heightCm: number;
  weightKg: number;
  /** From the camera (numbers only ever leave the phone) or typed from a tape measure. */
  shoulderCm?: number;
  /** Only for a camera reading: how sure the phone was, 0 to 1. */
  shoulderConfidence?: number;
  source?: FitSource;
  /** The parent changed the shoulder width the camera measured. */
  shoulderEdited?: boolean;
  /** ISO date and time it was measured. */
  measuredAt?: string;
}

/** The fit as the API takes it (order line, child's record). */
export function fitPayload(fit: Fit) {
  return {
    height_cm: fit.heightCm,
    weight_kg: fit.weightKg,
    ...(fit.shoulderCm !== undefined ? { shoulder_cm: fit.shoulderCm } : {}),
    ...(fit.shoulderCm !== undefined && fit.shoulderConfidence !== undefined
      ? { shoulder_confidence: fit.shoulderConfidence }
      : {}),
    source: fit.source ?? (fit.shoulderConfidence !== undefined ? 'CAMERA' : 'MANUAL'),
    shoulder_edited: Boolean(fit.shoulderEdited),
  };
}

/** Only the numbers, for the size suggestion. */
function sizeFitNumbers(fit: Fit) {
  const { source: _source, shoulder_edited: _edited, ...numbers } = fitPayload(fit);
  return numbers;
}

// ---------------------------------------------------------------------------
// The child's record on the server (teacher, or a parent who picked the child)
// ---------------------------------------------------------------------------
interface ServerMeasurement {
  height_cm: number;
  weight_kg: number;
  shoulder_cm: number | null;
  shoulder_confidence: number | null;
  source: FitSource;
  shoulder_edited: boolean;
  measured_at: string;
}

function fromServer(row: ServerMeasurement): Fit {
  return {
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    ...(row.shoulder_cm !== null ? { shoulderCm: row.shoulder_cm } : {}),
    ...(row.shoulder_confidence !== null ? { shoulderConfidence: row.shoulder_confidence } : {}),
    source: row.source,
    shoulderEdited: row.shoulder_edited,
    measuredAt: row.measured_at,
  };
}

/** The child's newest saved measurement, or null. */
export function useLatestMeasurement(studentId?: string | null) {
  return useQuery({
    queryKey: ['measurement-latest', studentId],
    queryFn: async () => {
      const row = await api<ServerMeasurement | undefined>(`/students/${studentId}/measurements/latest/`);
      return row ? fromServer(row) : null;
    },
    enabled: Boolean(studentId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export async function saveMeasurement(studentId: string, fit: Fit): Promise<Fit> {
  const row = await api<ServerMeasurement>(`/students/${studentId}/measurements/`, {
    method: 'POST',
    body: JSON.stringify(fitPayload(fit)),
  });
  return fromServer(row);
}

/** {product_id: size} the child last had, to choose shoe, tie, belt and sock sizes (Prompt 24). */
export function useLastSizes(studentId?: string | null) {
  return useQuery({
    queryKey: ['last-sizes', studentId],
    queryFn: () => api<Record<string, string>>(`/students/${studentId}/last-sizes/`),
    enabled: Boolean(studentId),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Settings for the camera step, read when it opens (see SHOULDER_CALIBRATION_FACTOR). */
export function useMeasureConfig(enabled: boolean) {
  return useQuery({
    queryKey: ['measure-config'],
    queryFn: () => api<{ shoulder_calibration_factor: number }>('/public/measure-config/'),
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
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

export function useSizeFit(productIds: string[], answer: FitAnswer, className?: string, enabled = true) {
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
          ...(fit ? { ...sizeFitNumbers(fit), class: className } : {}),
        }),
      }),
    // Fetched before the parent answers too: the chart is shown next to the sizes.
    enabled: enabled && ids.length > 0,
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

/** "18 Oct 2026" for the measurement card. */
export function formatMeasuredOn(iso?: string, locale = 'en-IN'): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Items the child's measurement sizes: uniform clothes that come in sizes
 * (shirts, trousers, skirts, blazers). Shoes, ties, belts and socks are picked by hand.
 */
export function usesMeasurement(product: { category: string; sizes: unknown[] }): boolean {
  return product.category === 'Uniform' && product.sizes.length > 1;
}

const TOP_WORDS = /shirt|blouse|kurta|kameez|tee\b|polo|top\b|blazer|sweater|pullover|cardigan|jacket/i;
const BOTTOM_WORDS = /trouser|pant|skirt|shorts|chino|salwar|pinafore/i;

/** Worn on top or below, so a shirt can suggest its matching trouser (Prompt 24). */
export function garmentKind(name: string): 'top' | 'bottom' | null {
  // "Salwar Kameez Set" is a whole outfit, not one half.
  if (/\bset\b/i.test(name)) return null;
  if (BOTTOM_WORDS.test(name)) return 'bottom';
  if (TOP_WORDS.test(name)) return 'top';
  return null;
}
