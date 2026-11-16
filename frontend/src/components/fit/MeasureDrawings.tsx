/**
 * Simple line drawings for the measuring how-to and the shoulder diagram,
 * drawn in the same square-ended line style as components/ui/icons.tsx.
 */

const LINE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
};

function Child({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} {...LINE}>
      <circle cx="0" cy="6" r="6" />
      <path d="M0 12v26M-10 18l-6 16M10 18l6 16M-8 16h16M0 38l-6 26M0 38l6 26" />
    </g>
  );
}

export type DrawingKind = 'wall' | 'phone' | 'light' | 'shirtFlat' | 'shirtCard' | 'shirtSnap';

export function InstructionDrawing({ kind }: { kind: DrawingKind }) {
  return (
    <svg className="mflow-drawing" viewBox="0 0 120 84" aria-hidden="true">
      {kind === 'wall' && (
        <>
          <rect x="34" y="4" width="52" height="72" {...LINE} />
          <path d="M14 76h92" {...LINE} />
          <Child x={60} y={8} />
        </>
      )}
      {kind === 'phone' && (
        <>
          <path d="M6 76h108" {...LINE} />
          <Child x={96} y={10} />
          <rect x="14" y="28" width="12" height="20" {...LINE} />
          <path d="M30 38h44M68 33l6 5-6 5" {...LINE} strokeDasharray="3 3" />
          <path d="M28 66h52" {...LINE} />
          <text x="54" y="62" textAnchor="middle" fontSize="9" fill="currentColor">2-3 m</text>
        </>
      )}
      {kind === 'light' && (
        <>
          <circle cx="24" cy="22" r="8" {...LINE} />
          <path d="M24 6v4M24 34v4M8 22h4M36 22h4M13 11l3 3M32 30l3 3M35 11l-3 3M16 30l-3 3" {...LINE} />
          <path d="M14 76h92" {...LINE} />
          <Child x={78} y={10} />
        </>
      )}
      {kind === 'shirtFlat' && (
        <>
          <path d="M46 12h28l18 10-8 14-10-5v41H46V31l-10 5-8-14z" {...LINE} />
          <path d="M52 12c3 5 13 5 16 0" {...LINE} />
        </>
      )}
      {kind === 'shirtCard' && (
        <>
          <path d="M46 12h28l18 10-8 14-10-5v41H46V31l-10 5-8-14z" {...LINE} />
          <rect x="50" y="38" width="20" height="13" {...LINE} />
          <path d="M53 43h8" {...LINE} />
        </>
      )}
      {kind === 'shirtSnap' && (
        <>
          <rect x="48" y="8" width="24" height="12" {...LINE} />
          <circle cx="60" cy="14" r="2" fill="currentColor" />
          <path d="M54 22l-14 26M66 22l14 26" {...LINE} strokeDasharray="3 3" />
          <path d="M36 52h48l-6 22H42z" {...LINE} />
          <rect x="52" y="58" width="16" height="10" {...LINE} />
        </>
      )}
    </svg>
  );
}

/** Back view: the shoulder width is measured from one shoulder bone to the other. */
export function ShoulderDiagram({ label }: { label: string }) {
  return (
    <figure className="mflow-diagram">
      <svg viewBox="0 0 160 120" role="img" aria-label={label}>
        <g {...LINE}>
          <circle cx="80" cy="20" r="14" />
          <path d="M72 34v8M88 34v8" />
          <path d="M72 42l-30 8c-6 2-8 6-9 12l-5 50M88 42l30 8c6 2 8 6 9 12l5 50" />
          <path d="M46 56v56M114 56v56" />
        </g>
        <circle cx="40" cy="51" r="3" fill="currentColor" />
        <circle cx="120" cy="51" r="3" fill="currentColor" />
        <path d="M40 40h80M40 36v8M120 36v8" {...LINE} className="mflow-diagram-measure" />
        <text x="80" y="36" textAnchor="middle" fontSize="10" fill="currentColor">cm</text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
