import { seedClasses, type SeedClass } from '../../data/seedData';

const ROMAN_NUMERALS: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
};

/**
 * Normalizes varied roster class representations ("V", "5th", "5", "Class 5", "Grade 5", "Std 5")
 * into a canonical Class Name matching shared/classes.json (e.g. "Class 5").
 */
export function normalizeClassString(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase();

  // Pre-primary
  if (clean === 'nursery') return 'Nursery';
  if (['junior kg', 'jr kg', 'jr. kg', 'lkg', 'kg', 'kindergarten'].includes(clean)) return 'Junior KG';
  if (['senior kg', 'sr kg', 'sr. kg', 'ukg'].includes(clean)) return 'Senior KG';

  // Roman numerals ("v", "iv", "xii")
  if (ROMAN_NUMERALS[clean]) {
    return `Class ${ROMAN_NUMERALS[clean]}`;
  }

  // Ordinals ("5th", "1st", "2nd", "3rd", "10th")
  const ordinalMatch = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(clean);
  if (ordinalMatch) {
    return `Class ${parseInt(ordinalMatch[1], 10)}`;
  }

  // "Class 5", "Grade 5", "Std 5", "Standard 5", "5"
  const classNumberMatch = /^(?:class|grade|std|standard)?\s*(\d{1,2})$/.exec(clean);
  if (classNumberMatch) {
    return `Class ${parseInt(classNumberMatch[1], 10)}`;
  }

  // Direct match in seedClasses ignoring case
  const direct = seedClasses.find((c) => c.name.toLowerCase() === clean);
  if (direct) return direct.name;

  return null;
}

/**
 * Maps a roster class string to a static SeedClass entry in seedClasses.
 */
export function mapRosterClassToSeedClass(raw: string | undefined | null): SeedClass | null {
  const normalized = normalizeClassString(raw);
  if (!normalized) return null;
  return seedClasses.find((c) => c.name.toLowerCase() === normalized.toLowerCase()) || null;
}
