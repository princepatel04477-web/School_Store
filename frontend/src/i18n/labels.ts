import type { MessageKey } from './messages';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Server category names are English; parents see them in their language. */
const CATEGORY_KEYS: Record<string, MessageKey> = {
  Uniform: 'cat.uniform',
  'School Shoes': 'cat.shoes',
  'Uniform Accessories': 'cat.accessories',
  Stationery: 'cat.stationery',
  'ID Cards': 'cat.idcard',
};

export function categoryLabel(category: string, t: T): string {
  const key = CATEGORY_KEYS[category];
  return key ? t(key) : category;
}

/** "Class 5", "Nursery", "Junior KG", "Senior KG" in the parent's language. */
export function classLabel(name: string | undefined, t: T): string {
  if (!name) return '';
  const trimmed = name.trim();
  const number = /^(?:class\s*)?(\d{1,2})$/i.exec(trimmed);
  if (number) return t('cls.n', { n: number[1] });
  const lower = trimmed.toLowerCase();
  if (lower === 'nursery') return t('cls.nursery');
  if (lower.startsWith('junior')) return t('cls.jkg');
  if (lower.startsWith('senior')) return t('cls.skg');
  return trimmed;
}

export function genderLabel(gender: 'boy' | 'girl' | null | undefined, t: T): string {
  if (gender === 'boy') return t('g.boy');
  if (gender === 'girl') return t('g.girl');
  return '';
}
