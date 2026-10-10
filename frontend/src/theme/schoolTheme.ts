import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { seedSchools } from '../data/seedData';
import { useStoreState } from '../store/storeState';

/**
 * Uniform-like colours used when a school has no colour set yet.
 * Each one passes 4.5:1 contrast with white text.
 */
const FALLBACK_COLORS = [
  '#7A1F2B', // maroon
  '#1D3461', // navy
  '#1F5C3F', // bottle green
  '#1F4FA3', // royal blue
  '#9A3B12', // rust
  '#0F5E63', // teal
  '#33383F', // charcoal
];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Darkens a colour until white text on it passes WCAG AA (4.5:1). */
export function ensureReadable(hex: string): string {
  let rgb = parseHex(hex);
  if (!rgb) return FALLBACK_COLORS[1];
  for (let i = 0; i < 20 && 1.05 / (luminance(rgb) + 0.05) < 4.5; i++) {
    rgb = rgb.map((c) => Math.round(c * 0.9)) as [number, number, number];
  }
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The colour a school's pages are tinted with. */
export function getSchoolColor(school: { id: string; color?: string }): string {
  if (school.color) return ensureReadable(school.color);
  return FALLBACK_COLORS[hash(school.id) % FALLBACK_COLORS.length];
}

export function getSchoolColorById(schoolId: string): string {
  const school = seedSchools.find((s) => s.id === schoolId);
  return getSchoolColor(school ?? { id: schoolId });
}

/**
 * Tints the whole site with the picked school's colour. With no school
 * picked (or on staff pages), the store's own navy comes back. The change
 * fades (see tokens.css).
 */
export function useSchoolTheme(enabled = true) {
  const { selection } = useStoreState();
  const location = useLocation();
  // A shared link like /flow?school=sch-1 shows that school even before it is saved
  const linkedSchool = location.pathname.startsWith('/flow')
    ? new URLSearchParams(location.search).get('school')
    : null;
  const schoolId = enabled ? linkedSchool || selection?.schoolId : undefined;

  useEffect(() => {
    const root = document.documentElement;
    if (schoolId) {
      root.style.setProperty('--brand', getSchoolColorById(schoolId));
      root.dataset.school = 'picked';
    } else {
      root.style.removeProperty('--brand');
      delete root.dataset.school;
    }
  }, [schoolId]);
}
