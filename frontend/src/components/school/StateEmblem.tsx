import type { ReactNode } from 'react';

/**
 * A landmark drawn for each state, so parents spot theirs at a glance.
 * Line drawings, not official emblems or maps: a state's official emblem and
 * the drawing of India's borders both have legal rules in India, and a small
 * landmark reads faster than an outline anyway.
 */
const MARKS: Record<string, ReactNode> = {
  // Open Hand monument
  chandigarh: (
    <>
      <path d="M24 44V31" />
      <path d="M18 44h12" />
      <path d="M17 31c-3-4-4-9-3-15l3 5 1-10 3 9 3-10 2 10 3-8v9l4-4c0 7-3 12-8 14z" />
    </>
  ),
  // India Gate
  delhi: (
    <>
      <path d="M8 43h32" />
      <path d="M12 43V16h24v27" />
      <path d="M19 43V28a5 5 0 0 1 10 0v15" />
      <path d="M10 16h28M14 16v-4h20v4" />
      <path d="M20 12a4 3 0 0 1 8 0" />
    </>
  ),
  // A kite for Uttarayan
  gujarat: (
    <>
      <path d="M24 5l14 15-14 19-14-19z" />
      <path d="M24 5v34M10 20c9-3 19-3 28 0" />
      <path d="M24 39c3 2-3 4 0 6" />
      <path d="M21 45l3-2 3 2" />
    </>
  ),
  // Wheat
  haryana: (
    <>
      <path d="M24 44V12" />
      <path d="M24 12c-3-3-3-6 0-9 3 3 3 6 0 9z" />
      <path d="M24 20c-5-1-7-4-7-8 4 1 7 4 7 8zM24 20c5-1 7-4 7-8-4 1-7 4-7 8z" />
      <path d="M24 28c-5-1-7-4-7-8 4 1 7 4 7 8zM24 28c5-1 7-4 7-8-4 1-7 4-7 8z" />
      <path d="M24 36c-5-1-7-4-7-8 4 1 7 4 7 8zM24 36c5-1 7-4 7-8-4 1-7 4-7 8z" />
    </>
  ),
  // Snow peaks and a deodar
  'himachal pradesh': (
    <>
      <path d="M4 41l13-22 8 12 6-8 13 18z" />
      <path d="M13 26l4 2 4-2" />
      <path d="M36 41v-4M36 22l-5 8h3l-4 6h12l-4-6h3z" />
    </>
  ),
  // Chinar leaf
  'jammu and kashmir': (
    <>
      <path d="M24 45V30" />
      <path d="M24 30l-10 4 2-6-8-2 5-4-5-8 9 2 1-8 6 6 6-6 1 8 9-2-5 8 5 4-8 2 2 6z" />
      <path d="M24 30V14M24 30l-11-8M24 30l11-8" />
    </>
  ),
  // Stupa with prayer flags
  ladakh: (
    <>
      <path d="M11 43h26M14 43v-4h20v4M17 39v-4h14v4" />
      <path d="M18 35a6 6 0 0 1 12 0" />
      <path d="M24 29V15M21 23h6M22 19h4" />
      <circle cx="24" cy="12.5" r="1.5" />
      <path d="M4 14c7 4 13 4 20-1M24 13c7 5 13 5 20 1" />
    </>
  ),
  // Golden Temple
  punjab: (
    <>
      <path d="M7 43h34" />
      <path d="M12 43V30h24v13" />
      <path d="M21 43v-6a3 3 0 0 1 6 0v6" />
      <path d="M16 30c0-6 4-10 8-12 4 2 8 6 8 12" />
      <path d="M24 18v-5" />
      <path d="M12 30v-3a2 2 0 0 1 4 0v3M32 30v-3a2 2 0 0 1 4 0v3" />
    </>
  ),
  // Hawa Mahal
  rajasthan: (
    <>
      <path d="M9 43h30M10 43V31h28v12M14 31v-8h20v8M18 23v-6h12v6M21 17v-5h6v5" />
      <path d="M14 38a2 2 0 0 1 4 0M22 38a2 2 0 0 1 4 0M30 38a2 2 0 0 1 4 0" />
      <path d="M18 28a2 2 0 0 1 4 0M26 28a2 2 0 0 1 4 0" />
    </>
  ),
  // Taj Mahal
  'uttar pradesh': (
    <>
      <path d="M5 43h38" />
      <path d="M14 43V29h20v14" />
      <path d="M21 43v-7a3 3 0 0 1 6 0v7" />
      <path d="M16 29c0-7 4-11 8-12 4 1 8 5 8 12" />
      <path d="M24 17v-4" />
      <path d="M8 43V21M40 43V21M7 21h2M39 21h2" />
    </>
  ),
  // Peaks with a hill temple
  uttarakhand: (
    <>
      <path d="M4 41l12-23 8 11 8-10 12 22z" />
      <path d="M19 41v-8h10v8" />
      <path d="M19 33l5-9 5 9" />
      <path d="M24 24v-4l3 1-3 1" />
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
export function StateEmblem({ name, size = 44, className = '' }: StateEmblemProps) {
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
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mark}
    </svg>
  );
}
