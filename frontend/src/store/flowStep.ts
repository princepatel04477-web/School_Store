/**
 * Which step of the shop to show. A link that names no step (the header's
 * categories, for example) opens at the first question not yet answered, and no
 * link can open a step whose earlier answers are missing.
 */
export function resolveFlowStep(
  requested: string | null,
  answers: { school: boolean; grade: boolean; gender: boolean }
): number {
  const furthest = !answers.school ? 1 : !answers.grade ? 2 : !answers.gender ? 3 : 4;
  const step = Number.parseInt(requested ?? '', 10);
  return Number.isNaN(step) ? furthest : Math.min(Math.max(step, 1), furthest);
}
