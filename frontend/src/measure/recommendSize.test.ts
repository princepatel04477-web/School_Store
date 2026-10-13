import { describe, expect, it } from 'vitest';
import { recommendSize, type ChartRow } from './recommendSize';

const rows: ChartRow[] = [
  {
    size: '30 (Class 4-6)',
    heightCmMin: 120,
    heightCmMax: 135,
    weightKgMin: 20,
    weightKgMax: 30,
    shoulderCmMin: 28,
    shoulderCmMax: 32,
  },
  {
    size: '32 (Class 4-6)',
    heightCmMin: 120,
    heightCmMax: 140,
    weightKgMin: 20,
    weightKgMax: 32,
    shoulderCmMin: 33,
    shoulderCmMax: 36,
  },
];

describe('recommendSize', () => {
  it('picks from height and weight', () => {
    expect(
      recommendSize({
        heightCm: 128,
        weightKg: 25,
        className: 'Class 5',
        rows,
      }),
    ).toBe('30 (Class 4-6)');
  });

  it('ignores a shoulder reading the caller marks as weak', () => {
    expect(
      recommendSize({
        heightCm: 128,
        weightKg: 25,
        className: 'Class 5',
        rows,
        shoulderCm: 34,
        useShoulder: false,
      }),
    ).toBe('30 (Class 4-6)');
  });

  it('falls back to height and weight when the shoulder matches no row', () => {
    expect(
      recommendSize({
        heightCm: 128,
        weightKg: 25,
        className: 'Class 5',
        rows,
        shoulderCm: 50,
        useShoulder: true,
      }),
    ).toBe('30 (Class 4-6)');
  });

  it('uses a strong shoulder when it matches a row', () => {
    expect(
      recommendSize({
        heightCm: 128,
        weightKg: 25,
        className: 'Class 5',
        rows,
        shoulderCm: 34,
        useShoulder: true,
      }),
    ).toBe('32 (Class 4-6)');
  });
});
