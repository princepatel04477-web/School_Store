import type { ReactNode, SVGProps } from 'react';

/**
 * The store's own icon set (replaces lucide-react).
 * Drawn on a 24px grid with square line ends and sharp joins so they read as
 * part of this brand rather than a stock set. Same props as before:
 * width, height, strokeWidth, className, plus any SVG attribute.
 */
export type IconProps = SVGProps<SVGSVGElement>;

function makeIcon(name: string, children: ReactNode) {
  function StoreIcon({ width = 24, height = 24, strokeWidth = 1.75, className = '', ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={width}
        height={height}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="miter"
        className={`store-icon store-icon-${name} ${className}`.trim()}
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {children}
      </svg>
    );
  }
  StoreIcon.displayName = name;
  return StoreIcon;
}

export const X = makeIcon('x', <path d="M6 6l12 12M18 6L6 18" />);
export const ArrowRight = makeIcon('arrow-right', <path d="M4 12h15M13 6l6 6-6 6" />);
export const ArrowLeft = makeIcon('arrow-left', <path d="M20 12H5M11 6l-6 6 6 6" />);
export const Search = makeIcon(
  'search',
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L20 20" />
  </>
);
export const Plus = makeIcon('plus', <path d="M12 5v14M5 12h14" />);
export const Minus = makeIcon('minus', <path d="M5 12h14" />);
export const Menu = makeIcon('menu', <path d="M4 7h16M4 12h16M4 17h10" />);
export const ChevronDown = makeIcon('chevron-down', <path d="M6 9l6 6 6-6" />);
export const ChevronUp = makeIcon('chevron-up', <path d="M6 15l6-6 6 6" />);
export const Check = makeIcon('check', <path d="M5 12.5l4.5 4.5L19 7" />);
export const ShoppingBag = makeIcon(
  'bag',
  <>
    <path d="M5 8h14l-1 12H6L5 8z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </>
);
export const User = makeIcon(
  'user',
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </>
);
export const Truck = makeIcon(
  'truck',
  <>
    <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" />
    <circle cx="7" cy="18" r="1.8" />
    <circle cx="17" cy="18" r="1.8" />
  </>
);
export const Trash2 = makeIcon(
  'trash',
  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
);
export const Ruler = makeIcon('ruler', <path d="M3 15L15 3l6 6L9 21zM7 11l2 2M10 8l2 2M13 5l2 2" />);
export const RefreshCw = makeIcon(
  'refresh',
  <path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4" />
);
export const MessageCircle = makeIcon('message', <path d="M4 20l1.5-4A8 8 0 1 1 8 18.5L4 20z" />);
export const ShieldCheck = makeIcon(
  'shield',
  <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6zM9 12l2 2 4-4" />
);
export const AlertCircle = makeIcon(
  'alert',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16.5v.5" />
  </>
);
