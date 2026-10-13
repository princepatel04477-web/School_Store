import { sizeFitsClass } from '../data/sizes';

export interface ChartRow {
  size: string;
  heightCmMin: number;
  heightCmMax: number;
  weightKgMin: number;
  weightKgMax: number;
  shoulderCmMin: number;
  shoulderCmMax: number;
}

export interface RecommendInput {
  heightCm: number;
  weightKg: number;
  className?: string;
  rows: ChartRow[];
  /** Used only when useShoulder is true. A miss falls back to height and weight. */
  shoulderCm?: number | null;
  useShoulder?: boolean;
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function tightest(rows: ChartRow[], span: (row: ChartRow) => number): ChartRow {
  return [...rows].sort((a, b) => span(a) - span(b) || a.size.localeCompare(b.size))[0];
}

/**
 * One size from the chart, or null when height and weight match nothing.
 * A shoulder reading is applied only when the caller marks it strong.
 */
export function recommendSize(input: RecommendInput): string | null {
  const body = input.rows.filter(
    (row) =>
      inRange(input.heightCm, row.heightCmMin, row.heightCmMax) &&
      inRange(input.weightKg, row.weightKgMin, row.weightKgMax) &&
      sizeFitsClass(row.size, input.className),
  );
  if (body.length === 0) return null;

  if (input.useShoulder && input.shoulderCm != null) {
    const shoulder = input.shoulderCm;
    const matched = body.filter((row) => inRange(shoulder, row.shoulderCmMin, row.shoulderCmMax));
    if (matched.length > 0) {
      return tightest(matched, (row) => row.shoulderCmMax - row.shoulderCmMin).size;
    }
  }

  return tightest(body, (row) => row.heightCmMax - row.heightCmMin).size;
}
