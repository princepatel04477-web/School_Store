export function FlatLayIllustration({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flat-lay-composition ${className}`.trim()}
      role="img"
      aria-label="School uniform, shoes, notebook and student ID flat lay illustration"
      style={{
        width: '100%',
        height: '100%',
        minHeight: '340px',
        backgroundColor: 'var(--paper-sunk)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 500 420"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '100%', height: 'auto', maxHeight: '380px' }}
      >
        {/* Soft background accents */}
        <circle cx="250" cy="210" r="180" fill="var(--paper)" opacity="0.6" />

        {/* Uniform Shirt */}
        <g transform="translate(60, 40)">
          {/* Shirt Body */}
          <path
            d="M 60 70 L 40 180 L 160 180 L 140 70 Z"
            fill="var(--paper-raised)"
            stroke="var(--line)"
            strokeWidth="1.5"
          />
          {/* Sleeves */}
          <path
            d="M 60 70 L 10 110 L 30 130 L 50 90 Z"
            fill="var(--paper-raised)"
            stroke="var(--line)"
            strokeWidth="1.5"
          />
          <path
            d="M 140 70 L 190 110 L 170 130 L 150 90 Z"
            fill="var(--paper-raised)"
            stroke="var(--line)"
            strokeWidth="1.5"
          />
          {/* Collar */}
          <path
            d="M 60 70 L 100 95 L 75 60 Z"
            fill="var(--brand-tint)"
            stroke="var(--brand)"
            strokeWidth="1.5"
          />
          <path
            d="M 140 70 L 100 95 L 125 60 Z"
            fill="var(--brand-tint)"
            stroke="var(--brand)"
            strokeWidth="1.5"
          />
          {/* Placket & Buttons */}
          <line x1="100" y1="95" x2="100" y2="180" stroke="var(--line)" strokeWidth="1.5" />
          <circle cx="100" cy="115" r="3" fill="var(--brand)" />
          <circle cx="100" cy="135" r="3" fill="var(--brand)" />
          <circle cx="100" cy="155" r="3" fill="var(--brand)" />
          {/* Pocket with crest accent */}
          <rect
            x="115"
            y="110"
            width="25"
            height="30"
            rx="3"
            fill="var(--paper-raised)"
            stroke="var(--line)"
            strokeWidth="1.5"
          />
          <line x1="120" y1="120" x2="135" y2="120" stroke="var(--accent)" strokeWidth="1.5" />
        </g>

        {/* School Shoes */}
        <g transform="translate(260, 60)">
          <path
            d="M 30 110 C 20 80 50 60 90 70 C 130 80 150 120 140 140 C 130 150 40 150 30 110 Z"
            fill="var(--ink)"
          />
          {/* Sole */}
          <path
            d="M 25 125 C 20 145 130 155 145 140 C 145 148 120 154 25 138 Z"
            fill="var(--brand-deep)"
          />
          {/* Laces / Eyelets */}
          <line x1="75" y1="90" x2="95" y2="95" stroke="var(--line)" strokeWidth="1.5" />
          <line x1="78" y1="102" x2="98" y2="107" stroke="var(--line)" strokeWidth="1.5" />
          <line x1="82" y1="114" x2="102" y2="119" stroke="var(--line)" strokeWidth="1.5" />
        </g>

        {/* Notebook */}
        <g transform="translate(60, 240)">
          <rect
            x="20"
            y="10"
            width="120"
            height="150"
            rx="8"
            fill="var(--brand-tint)"
            stroke="var(--line)"
            strokeWidth="1.5"
          />
          {/* Spine Accent */}
          <rect x="20" y="10" width="16" height="150" rx="4" fill="var(--brand)" />
          {/* Cover Label */}
          <rect
            x="50"
            y="50"
            width="75"
            height="45"
            rx="4"
            fill="var(--paper-raised)"
            stroke="var(--line)"
            strokeWidth="1"
          />
          <line x1="60" y1="65" x2="115" y2="65" stroke="var(--ink-faint)" strokeWidth="1.5" />
          <line x1="60" y1="78" x2="100" y2="78" stroke="var(--accent)" strokeWidth="1.5" />
        </g>

        {/* ID Card with Lanyard */}
        <g transform="translate(260, 220)">
          {/* Lanyard Strap */}
          <path
            d="M 90 0 C 80 40 100 60 90 90"
            stroke="var(--brand)"
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
          />
          {/* Clip */}
          <rect x="83" y="85" width="14" height="12" rx="2" fill="var(--accent)" />
          {/* Card Badge */}
          <rect
            x="45"
            y="98"
            width="90"
            height="125"
            rx="6"
            fill="var(--paper-raised)"
            stroke="var(--line)"
            strokeWidth="1.5"
          />
          {/* Header bar */}
          <rect x="45" y="98" width="90" height="24" rx="4" fill="var(--brand)" />
          {/* Photo box */}
          <rect
            x="68"
            y="132"
            width="44"
            height="46"
            rx="4"
            fill="var(--paper-sunk)"
            stroke="var(--line)"
            strokeWidth="1"
          />
          {/* Student details lines */}
          <line x1="60" y1="190" x2="120" y2="190" stroke="var(--ink)" strokeWidth="2" />
          <line x1="68" y1="202" x2="112" y2="202" stroke="var(--ink-soft)" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}
