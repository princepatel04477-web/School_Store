/**
 * Suggests a size from the school's own size labels, e.g. "30 (Class 4-6)".
 * Only labels that name a class range are used; anything else (shoe sizes, waist
 * inches) is left for the parent to choose, because a wrong guess costs an exchange.
 */

export interface SizeChoice {
  id: string;
  size: string;
  inStock: boolean;
}

/** Nursery -2, Junior KG -1, Senior KG 0, Class N -> N. */
export function classNumber(name?: string): number | null {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  if (lower.includes('nursery')) return -2;
  if (lower.startsWith('junior') || lower === 'jr kg' || lower === 'lkg') return -1;
  if (lower.startsWith('senior') || lower === 'sr kg' || lower === 'ukg') return 0;
  const match = /(\d{1,2})/.exec(lower);
  return match ? Number(match[1]) : null;
}

const CLASS_RANGE = /class(?:es)?\s*(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})/i;
const SINGLE_CLASS = /class\s*(\d{1,2})(?!\s*(?:-|–|to)\s*\d)/i;

function classesInLabel(label: string): [number, number] | null {
  const range = CLASS_RANGE.exec(label);
  if (range) return [Number(range[1]), Number(range[2])];
  const single = SINGLE_CLASS.exec(label);
  if (single) return [Number(single[1]), Number(single[1])];
  if (/nursery|kg/i.test(label) && !/\d/.test(label.replace(/kg/gi, ''))) return [-2, 0];
  return null;
}

export function suggestSizeId(sizes: SizeChoice[], className?: string): string | undefined {
  const available = sizes.filter((s) => s.inStock);
  // A one-size item (tie, ID card) needs no choice; never "the only size left" for a sized item.
  if (sizes.length === 1) return available[0]?.id;
  const number = classNumber(className);
  if (number === null) return undefined;
  const matches = available.filter((s) => {
    const range = classesInLabel(s.size);
    return range !== null && number >= range[0] && number <= range[1];
  });
  return matches.length === 1 ? matches[0].id : undefined;
}

/** True when the label names no class, or the child's class sits inside that range. */
export function sizeFitsClass(label: string, className?: string): boolean {
  const number = classNumber(className);
  if (number === null) return true;
  const range = classesInLabel(label);
  if (range === null) return true;
  return number >= range[0] && number <= range[1];
}
