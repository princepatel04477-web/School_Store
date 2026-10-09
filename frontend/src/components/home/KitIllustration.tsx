export type KitKind = 'uniform' | 'trousers' | 'shoes' | 'accessories' | 'stationery' | 'idcard';

export interface KitIllustrationProps {
  kind: KitKind;
  /** Main fill. Defaults to the active accent. */
  color?: string;
  className?: string;
}

const INK = 'var(--ink)';
const PAPER = 'var(--paper-raised)';

/**
 * Bold flat drawings of the school kit, one per category. Each takes a single
 * fill colour; outlines and details are ink so they read on any background.
 * Used in place of photos until real product shots exist.
 */
export function KitIllustration({ kind, color = 'var(--brand)', className = '' }: KitIllustrationProps) {
  const stroke = { stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

  return (
    <svg viewBox="0 0 120 120" className={`kit-illustration ${className}`.trim()} aria-hidden="true" focusable="false">
      {kind === 'uniform' && (
        <g>
          {/* Half-sleeve shirt */}
          <path
            d="M44 18 22 30l9 20 11-5v55h36V45l11 5 9-20-22-12c-4 7-10 10-16 10s-12-3-16-10Z"
            fill={color}
            {...stroke}
          />
          {/* Collar */}
          <path d="M44 18l16 14 16-14" fill={PAPER} {...stroke} />
          {/* Placket and buttons */}
          <path d="M60 32v68" {...stroke} fill="none" />
          <circle cx="66" cy="48" r="2.4" fill={INK} />
          <circle cx="66" cy="64" r="2.4" fill={INK} />
          <circle cx="66" cy="80" r="2.4" fill={INK} />
          {/* Pocket with crest */}
          <path d="M70 50h12v13c0 3-3 5-6 5s-6-2-6-5Z" fill={PAPER} {...stroke} />
        </g>
      )}

      {kind === 'trousers' && (
        <g>
          {/* Trousers with waistband and centre crease */}
          <path d="M34 14h52l6 94H66L60 52l-6 56H28Z" fill={color} {...stroke} />
          <path d="M34 14h52v12H34Z" fill={PAPER} {...stroke} />
          <path d="M60 26v26" {...stroke} fill="none" />
          <path d="M44 34l-4 70M76 34l4 70" stroke={INK} strokeWidth={1.5} strokeLinecap="round" opacity={0.45} />
        </g>
      )}

      {kind === 'shoes' && (
        <g>
          {/* School shoe, side view, with velcro strap */}
          <path
            d="M14 74c0-12 4-24 10-30l16 4c10 3 20 4 30 2l8-6c10 12 22 18 30 20 4 1 6 4 6 8v8H14Z"
            fill={color}
            {...stroke}
          />
          <path d="M14 80h96v10H14Z" fill={PAPER} {...stroke} />
          <path d="M44 52l26 22M56 49l20 18" {...stroke} fill="none" />
          <path d="M38 62h46" stroke={PAPER} strokeWidth={7} strokeLinecap="round" />
          <path d="M38 62h46" {...stroke} fill="none" strokeWidth={2} />
        </g>
      )}

      {kind === 'accessories' && (
        <g>
          {/* Striped tie */}
          <path d="M40 10h20l-5 12 9 56-14 20-14-20 9-56Z" fill={color} {...stroke} />
          <path d="M44 22h12" {...stroke} fill="none" />
          <path d="M41 40l18-8M40 56l20-9M42 72l17-8" stroke={PAPER} strokeWidth={4} strokeLinecap="round" />
          {/* Belt with buckle */}
          <rect x="70" y="20" width="14" height="86" rx="3" fill={INK} />
          <rect x="66" y="52" width="22" height="20" rx="3" fill={PAPER} {...stroke} />
          <path d="M77 56v12" {...stroke} fill="none" />
        </g>
      )}

      {kind === 'stationery' && (
        <g>
          {/* Long notebook */}
          <rect x="22" y="14" width="56" height="88" rx="4" fill={color} {...stroke} />
          <path d="M32 14v88" {...stroke} fill="none" />
          <rect x="40" y="30" width="30" height="16" rx="2" fill={PAPER} {...stroke} />
          <path d="M45 36h20M45 41h14" stroke={INK} strokeWidth={2} strokeLinecap="round" />
          {/* Pencil */}
          <g transform="rotate(28 92 64)">
            <rect x="86" y="18" width="12" height="70" fill={PAPER} {...stroke} />
            <path d="M86 88h12l-6 14Z" fill={PAPER} {...stroke} />
            <path d="M90 97l2 5 2-5Z" fill={INK} />
            <rect x="86" y="18" width="12" height="9" fill={color} {...stroke} />
          </g>
        </g>
      )}

      {kind === 'idcard' && (
        <g>
          {/* Lanyard */}
          <path d="M42 6l18 34 18-34" fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
          <path d="M42 6l18 34 18-34" fill="none" {...stroke} strokeWidth={2} />
          {/* Clip */}
          <rect x="54" y="36" width="12" height="10" rx="2" fill={INK} />
          {/* Card */}
          <rect x="28" y="44" width="64" height="66" rx="6" fill={PAPER} {...stroke} />
          <rect x="28" y="44" width="64" height="16" rx="6" fill={color} {...stroke} />
          <circle cx="60" cy="76" r="9" fill={color} {...stroke} />
          <path d="M42 96h36M48 103h24" {...stroke} fill="none" />
        </g>
      )}
    </svg>
  );
}
