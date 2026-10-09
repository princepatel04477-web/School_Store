import { getSchoolColor, getSchoolColorById } from '../../theme/schoolTheme';

export interface SchoolCrestProps {
  /** Used to pick the school's colour for the monogram */
  id?: string;
  color?: string;
  name: string;
  code?: string;
  logoUrl?: string;
  size?: number;
  className?: string;
}

export function SchoolCrest({
  id,
  color,
  name,
  code,
  logoUrl,
  size = 48,
  className = '',
}: SchoolCrestProps) {
  const monogram = (
    code ||
    name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
  ).toUpperCase();

  // Each school's monogram wears that school's colour, so a list of schools
  // reads as a row of different crests rather than identical tiles
  const schoolColor = color || !id ? getSchoolColor({ id: id ?? name, color }) : getSchoolColorById(id);

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${name} crest`}
        width={size}
        height={size}
        className={`school-crest-img ${className}`.trim()}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '12px',
          objectFit: 'contain',
        }}
      />
    );
  }

  return (
    <div
      className={`school-crest-monogram ${className}`.trim()}
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: size > 40 ? '14px' : '10px',
        backgroundColor: schoolColor,
        color: 'var(--on-brand)',
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontStretch: '80%',
        fontSize: `${Math.round(size * 0.42)}px`,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        letterSpacing: '0.04em',
        userSelect: 'none',
      }}
    >
      {monogram}
    </div>
  );
}
