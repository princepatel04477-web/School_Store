import { useState } from 'react';

export interface StateEmblemProps {
  name: string;
  size?: number;
  className?: string;
}

const STATE_LOGO_MAP: Record<string, string> = {
  chandigarh: '/brand/states/chandigarh.svg',
  delhi: '/brand/states/delhi.svg',
  'nct-of-delhi': '/brand/states/delhi.svg',
  'national-capital-territory-of-delhi': '/brand/states/delhi.svg',
  'delhi-ncr': '/brand/states/delhi.svg',
  gujarat: '/brand/states/gujarat.svg',
  haryana: '/brand/states/haryana.svg',
  'himachal-pradesh': '/brand/states/himachal-pradesh.svg',
  himachal: '/brand/states/himachal-pradesh.svg',
  'jammu-and-kashmir': '/brand/states/jammu-and-kashmir.svg',
  'jammu-kashmir': '/brand/states/jammu-and-kashmir.svg',
  'jammu-and-kashmir-ut': '/brand/states/jammu-and-kashmir.svg',
  ladakh: '/brand/states/ladakh.svg',
  punjab: '/brand/states/punjab.svg',
  rajasthan: '/brand/states/rajasthan.svg',
  'uttar-pradesh': '/brand/states/uttar-pradesh.svg',
  uttarakhand: '/brand/states/uttarakhand.svg',
  uttaranchal: '/brand/states/uttarakhand.svg',
};

export function getStateLogoUrl(name: string): string | null {
  if (!name) return null;
  const norm = name
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return STATE_LOGO_MAP[norm] ?? null;
}

export function StateEmblem({ name, size = 52, className = '' }: StateEmblemProps) {
  const [loadError, setLoadError] = useState(false);
  const logoUrl = getStateLogoUrl(name);

  if (logoUrl && !loadError) {
    return (
      <img
        src={logoUrl}
        alt={`${name} emblem`}
        width={size}
        height={size}
        className={`state-emblem-img ${className}`.trim()}
        loading="lazy"
        onError={() => setLoadError(true)}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '8px',
          objectFit: 'contain',
          flexShrink: 0,
          background: 'var(--surface-card, #ffffff)',
          border: '1px solid var(--line, rgba(0, 0, 0, 0.08))',
          padding: '4px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}
      />
    );
  }

  // Fallback 2-letter monogram tile with Emerald styling
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      className={`state-emblem-fallback ${className}`.trim()}
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '8px',
        backgroundColor: 'var(--brand-tint, #e8f5e9)',
        color: 'var(--brand, #0e5b38)',
        border: '1px solid var(--line, rgba(0, 0, 0, 0.08))',
        fontFamily: 'var(--font-display, inherit)',
        fontWeight: 800,
        fontSize: `${Math.round(size * 0.38)}px`,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initials || 'IN'}
    </div>
  );
}
