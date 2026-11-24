/**
 * The state's landmark logo (colourful SVG files in public/brand/states), or its
 * initials when there is no file yet. Landmarks, not official emblems or maps:
 * a state's official emblem and the drawing of India's borders both have legal
 * rules in India.
 */
const KNOWN_STATES = new Set([
  'chandigarh',
  'delhi',
  'gujarat',
  'haryana',
  'himachal-pradesh',
  'jammu-and-kashmir',
  'ladakh',
  'punjab',
  'rajasthan',
  'uttar-pradesh',
  'uttarakhand',
]);

function slugFor(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w && w.toLowerCase() !== 'and')
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function hasStateEmblem(name: string): boolean {
  return KNOWN_STATES.has(slugFor(name));
}

export interface StateEmblemProps {
  name: string;
  size?: number;
  className?: string;
}

export function StateEmblem({ name, size = 96, className = '' }: StateEmblemProps) {
  const slug = slugFor(name);
  if (!KNOWN_STATES.has(slug)) {
    return (
      <span className={`state-emblem state-emblem--initials ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      src={`/brand/states/${slug}.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`state-emblem ${className}`.trim()}
    />
  );
}
