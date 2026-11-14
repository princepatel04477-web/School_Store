import { describe, expect, it } from 'vitest';
import { chartFor, checkFit, recommendSize, refineWithShoulder, suggest } from './showcaseSizing.js';

const variants = (...sizes) => sizes.map((size, i) => ({ id: `v${i}`, size, stock_status: 'IN_STOCK' }));
const shirt = { name: 'DPS Everyday Formal Half-Sleeve Shirt', category: 'Uniform', variants: variants('28 (Class 1-3)', '30 (Class 4-6)', '32 (Class 7-9)', '34 (Class 10-12)') };
const trousers = { name: 'DPS Boys Grey Formal Trousers', category: 'Uniform', variants: variants('22', '24', '26', '28', '30', '32') };
const fit = (height, weight, shoulder = null, confidence = null) =>
  ({ height_cm: height, weight_kg: weight, shoulder_cm: shoulder, shoulder_confidence: confidence });

describe('chartFor', () => {
  it('reads the size number from labels like "28 (Class 1-3)"', () => {
    expect(chartFor(shirt).map((r) => r.size)).toEqual(['28 (Class 1-3)', '30 (Class 4-6)', '32 (Class 7-9)', '34 (Class 10-12)']);
    expect(chartFor(shirt)[0].shoulder_cm_min).toBe(28);
  });
  it('gives waist sizes no shoulder range', () => {
    expect(chartFor(trousers)[0].shoulder_cm_min).toBeNull();
  });
  it('has no chart for S/M/L, sets, or non-uniform items', () => {
    expect(chartFor({ name: 'Polo Tee', category: 'Uniform', variants: variants('S', 'M', 'L') })).toEqual([]);
    expect(chartFor({ name: 'Salwar Kameez Set', category: 'Uniform', variants: variants('S') })).toEqual([]);
    expect(chartFor({ name: 'School Belt', category: 'Uniform Accessories', variants: variants('28 Inch') })).toEqual([]);
  });
});

describe('recommendSize', () => {
  const rows = chartFor(trousers);
  it('picks the one size the height covers', () => expect(recommendSize(rows, 135, 30)).toEqual({ status: 'FIT', size: '26', alt_size: '' }));
  it('offers both sizes where ranges overlap, bigger first', () => expect(recommendSize(rows, 130.5, 26).status).toBe('BETWEEN'));
  it('moves up a size when heavier than the range', () => expect(recommendSize(rows, 135, 40)).toEqual({ status: 'BETWEEN', size: '28', alt_size: '26' }));
  it('says when the child is outside the chart', () => {
    expect(recommendSize(rows, 100, 15).status).toBe('BELOW_CHART');
    expect(recommendSize(rows, 190, 70).status).toBe('ABOVE_CHART');
  });
  it('has no suggestion without a chart', () => expect(recommendSize([], 130, 30).status).toBe('NO_CHART'));
});

describe('shoulder', () => {
  const rows = chartFor(shirt);
  it('a wide shoulder moves up a size', () => {
    expect(suggest(rows, fit(125, 24, 31))).toEqual({ status: 'BETWEEN', size: '30 (Class 4-6)', alt_size: '28 (Class 1-3)' });
  });
  it('picks one of two sizes when the shoulder fits only one', () => {
    const between = { status: 'BETWEEN', size: '30 (Class 4-6)', alt_size: '28 (Class 1-3)' };
    expect(refineWithShoulder(rows, between, 29).size).toBe('28 (Class 1-3)');
    expect(refineWithShoulder(rows, between, 32).size).toBe('30 (Class 4-6)');
  });
  it('ignores an unsure camera reading but trusts a tape measure', () => {
    expect(suggest(rows, fit(125, 24, 31, 0.3)).status).toBe('FIT');
    expect(suggest(rows, fit(125, 24, 31, 0.9)).status).toBe('BETWEEN');
    expect(suggest(rows, fit(125, 24, 31)).status).toBe('BETWEEN');
  });
});

describe('checkFit', () => {
  it('rejects typing mistakes', () => {
    expect(checkFit({ height_cm: 'abc', weight_kg: 30 }).errors.height_cm).toEqual(['NOT_A_NUMBER']);
    expect(checkFit({ height_cm: 300, weight_kg: 30 }).errors.height_cm).toEqual(['OUT_OF_RANGE']);
    expect(checkFit({ height_cm: 130, weight_kg: 30, shoulder_cm: 5 }).errors.shoulder_cm).toEqual(['OUT_OF_RANGE']);
    expect(checkFit({ height_cm: 130, weight_kg: 30, shoulder_cm: 30, shoulder_confidence: 2 }).errors.shoulder_confidence).toBeDefined();
  });
  it('rounds to one decimal', () => {
    expect(checkFit({ height_cm: '130.46', weight_kg: 30, shoulder_cm: 30.04 }).fit).toEqual(fit(130.5, 30, 30));
  });
});
