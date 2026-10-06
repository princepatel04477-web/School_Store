export interface SchoolCrestProps {
  name: string;
  code?: string;
  logoUrl?: string;
  size?: number;
  className?: string;
}

export function SchoolCrest({
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
        backgroundColor: 'var(--brand-tint)',
        border: '1px solid rgba(47, 93, 80, 0.15)',
        color: 'var(--brand)',
        fontFamily: 'var(--font-display)',
        fontWeight: 500,
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
