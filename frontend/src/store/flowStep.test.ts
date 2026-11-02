import { describe, expect, it } from 'vitest';
import { resolveFlowStep } from './flowStep';

const none = { school: false, grade: false, gender: false };
const school = { ...none, school: true };
const grade = { ...school, grade: true };
const all = { ...grade, gender: true };

describe('resolveFlowStep', () => {
  it('opens at the first unanswered question when no step is named', () => {
    expect(resolveFlowStep(null, none)).toBe(1);
    expect(resolveFlowStep(null, school)).toBe(2);
    expect(resolveFlowStep(null, grade)).toBe(3);
    expect(resolveFlowStep(null, all)).toBe(4);
  });

  it('honours an earlier step, so a parent can still change the school', () => {
    expect(resolveFlowStep('1', all)).toBe(1);
    expect(resolveFlowStep('3', all)).toBe(3);
  });

  it('never opens a step whose answers are missing', () => {
    expect(resolveFlowStep('4', school)).toBe(2);
    expect(resolveFlowStep('3', none)).toBe(1);
  });

  it('survives a broken link', () => {
    expect(resolveFlowStep('abc', grade)).toBe(3);
    expect(resolveFlowStep('0', all)).toBe(1);
    expect(resolveFlowStep('9', all)).toBe(4);
  });
});
