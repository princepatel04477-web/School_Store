import type { ReactNode } from 'react';

/**
 * A landmark line drawing for each state, in one style: thin even strokes, a
 * ground line, architectural detail. Landmarks, not official emblems or maps:
 * a state's official emblem and the drawing of India's borders both have legal
 * rules in India.
 */
const MARKS: Record<string, ReactNode> = {
  // Open Hand monument on its plinth
  chandigarh: (
    <>
      <path d="M6 58h52" />
      <path d="M18 58v-5h28v5M22 53v-4h20v4" />
      <path d="M30 49V40" />
      <path d="M26 40c-5-2-8-6-8-11 0-3 2-4 4-3l2 3V17c0-2 3-2 3 0v9l1-12c0-2 3-2 3 0l-1 12 3-10c1-2 4-1 3 1l-3 11 5-6c1-1 3 0 2 2l-6 10c-2 4-5 6-11 6z" />
    </>
  ),
  // India Gate
  delhi: (
    <>
      <path d="M6 58h52" />
      <path d="M14 58V20h36v38" />
      <path d="M25 58V38a7 7 0 0 1 14 0v20" />
      <path d="M12 20h40M14 16h36v4M18 12h28v4" />
      <path d="M27 12a5 4 0 0 1 10 0" />
      <path d="M18 42h3v9h-3zM43 42h3v9h-3z" />
      <path d="M14 31h11M39 31h11" />
    </>
  ),
  // Ahmedabad's Jama Masjid: three arches, two minarets
  gujarat: (
    <>
      <path d="M6 58h52" />
      <path d="M8 58V36h48v22" />
      <path d="M14 58v-9a4 4 0 0 1 8 0v9M28 58V45a4 4 0 0 1 8 0v13M42 58v-9a4 4 0 0 1 8 0v9" />
      <path d="M8 36h48M10 32h44v4" />
      <path d="M18 32V14M15 14h6M16 14l2-4 2 4M16 22h4M46 32V14M43 14h6M44 14l2-4 2 4M44 22h4" />
      <path d="M26 32a6 6 0 0 1 12 0M32 26v-3" />
    </>
  ),
  // Temple at Brahma Sarovar, Kurukshetra
  haryana: (
    <>
      <path d="M6 58h52" />
      <path d="M10 58v-4h44v4" />
      <path d="M14 54V41h14v13M15 41l6-6 6 6" />
      <path d="M30 54V34c0-10 5-18 10-22 5 4 10 12 10 22v20M30 34h20M33 27h14M35 20h10" />
      <path d="M40 12V7l4 1-4 1" />
      <path d="M37 54v-8a3 3 0 0 1 6 0v8" />
    </>
  ),
  // Christ Church, Shimla
  'himachal pradesh': (
    <>
      <path d="M6 58h52" />
      <path d="M10 58V37l10-8 10 8v21" />
      <path d="M17 58v-8a3 3 0 0 1 6 0v8" />
      <path d="M30 58V25h12v33M30 25l6-10 6 10M36 15V8M34 10h4" />
      <circle cx="36" cy="32" r="3" />
      <path d="M34 47v-6a2 2 0 0 1 4 0v6" />
      <path d="M42 58V41h10v17M45 50v-4a2 2 0 0 1 4 0v4" />
    </>
  ),
  // Houseboat on Dal Lake below the mountains
  'jammu and kashmir': (
    <>
      <path d="M4 40l12-16 8 10 10-14 14 20M48 40l5-7 7 7" />
      <path d="M12 50h40l-4 6H16z" />
      <path d="M16 50v-7h32v7M14 43l4-4h28l4 4" />
      <path d="M20 46h4M28 46h4M36 46h4" />
      <path d="M6 60c4-2 8 2 12 0s8 2 12 0 8 2 12 0 8 2 12 0" />
    </>
  ),
  // Thiksey Monastery stacked on its hill
  ladakh: (
    <>
      <path d="M4 58c10-3 18-8 28-8s18 5 28 8" />
      <path d="M18 50v-9h28v9M22 41v-7h20v7M26 34v-6h12v6" />
      <path d="M22 45h3M29 45h3M36 45h3M26 37h3M33 37h3" />
      <path d="M30 28v-4h4v4M32 24v-3" />
      <path d="M6 18c8 4 16 4 26-2 8 6 16 6 26 2" />
      <path d="M12 20v3M20 21v3M44 21v3M52 20v3" />
    </>
  ),
  // Golden Temple on its sarovar
  punjab: (
    <>
      <path d="M4 58h56M6 53h52" />
      <path d="M18 53V36h28v17M22 36v-6h20v6" />
      <path d="M24 30c0-6 4-10 8-12 4 2 8 6 8 12M32 18v-4" />
      <path d="M18 36v-3a2 2 0 0 1 4 0v3M42 36v-3a2 2 0 0 1 4 0v3" />
      <path d="M22 53v-6a2 2 0 0 1 4 0v6M30 53v-7a2 2 0 0 1 4 0v7M38 53v-6a2 2 0 0 1 4 0v6" />
      <path d="M26 33h3M35 33h3" />
    </>
  ),
  // Hawa Mahal
  rajasthan: (
    <>
      <path d="M6 58h52" />
      <path d="M8 58V40h48v18M12 40v-8h40v8M16 32v-8h32v8M21 24v-7h22v7M26 17v-6h12v6" />
      <path d="M29 11a3 3 0 0 1 6 0" />
      <path d="M12 58v-5a2 2 0 0 1 4 0v5M20 58v-5a2 2 0 0 1 4 0v5M40 58v-5a2 2 0 0 1 4 0v5M48 58v-5a2 2 0 0 1 4 0v5" />
      <path d="M29 58v-6a3 3 0 0 1 6 0v6" />
      <path d="M16 38v-2a2 2 0 0 1 4 0v2M23 38v-2a2 2 0 0 1 4 0v2M30 38v-2a2 2 0 0 1 4 0v2M37 38v-2a2 2 0 0 1 4 0v2M44 38v-2a2 2 0 0 1 4 0v2" />
      <path d="M20 30v-2a2 2 0 0 1 4 0v2M28 30v-2a2 2 0 0 1 4 0v2M36 30v-2a2 2 0 0 1 4 0v2" />
      <path d="M25 22v-2a2 2 0 0 1 4 0v2M35 22v-2a2 2 0 0 1 4 0v2" />
    </>
  ),
  // Taj Mahal
  'uttar pradesh': (
    <>
      <path d="M4 58h56M6 58v-3h52v3" />
      <path d="M16 55V38h32v17" />
      <path d="M27 55V45a5 5 0 0 1 10 0v10" />
      <path d="M19 55v-6a2 2 0 0 1 4 0v6M41 55v-6a2 2 0 0 1 4 0v6" />
      <path d="M22 38c0-9 5-15 10-17 5 2 10 8 10 17M32 21v-5" />
      <path d="M17 38v-3a2.5 2.5 0 0 1 5 0v3M42 38v-3a2.5 2.5 0 0 1 5 0v3" />
      <path d="M9 55V24M55 55V24M7 24h4M8 24l1-3 1 3M53 24h4M54 24l1-3 1 3M8 34h2M8 44h2M54 34h2M54 44h2" />
    </>
  ),
  // Kedarnath temple below the peaks
  uttarakhand: (
    <>
      <path d="M2 46l10-22 8 12M44 36l8-14 10 24" />
      <path d="M9 30l3 2 3-3M49 27l3 1 2-2" />
      <path d="M6 58h52M14 58v-4h36v4" />
      <path d="M20 54V42h24v12" />
      <path d="M29 54v-7a3 3 0 0 1 6 0v7" />
      <path d="M22 42c0-6 3-10 10-14 7 4 10 8 10 14M32 28v-5M30 25h4" />
    </>
  ),
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w && w.toLowerCase() !== 'and')
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function hasStateEmblem(name: string): boolean {
  return name.trim().toLowerCase() in MARKS;
}

export interface StateEmblemProps {
  name: string;
  size?: number;
  className?: string;
}

/** The state's landmark, or its initials when we have not drawn one yet. */
export function StateEmblem({ name, size = 72, className = '' }: StateEmblemProps) {
  const mark = MARKS[name.trim().toLowerCase()];
  if (!mark) {
    return (
      <span className={`state-emblem state-emblem--initials ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
        {initials(name)}
      </span>
    );
  }
  return (
    <svg
      className={`state-emblem ${className}`.trim()}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mark}
    </svg>
  );
}
