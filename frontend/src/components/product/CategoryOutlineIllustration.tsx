export function CategoryOutlineIllustration({ category, className = '' }: { category: string; className?: string }) {
  const norm = category.toLowerCase();

  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ width: '64%', height: '64%', stroke: 'var(--ink-faint)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}
      aria-hidden="true"
    >
      {norm.includes('shoe') ? (
        // Shoes
        <path d="M 15 65 C 20 40 45 40 60 50 C 75 55 88 52 85 70 C 80 75 25 78 15 65 Z M 40 48 L 50 54 M 43 55 L 53 61" />
      ) : norm.includes('access') || norm.includes('tie') || norm.includes('belt') ? (
        // Tie & Belt
        <g>
          <path d="M 45 20 L 55 20 L 58 30 L 42 30 Z" />
          <path d="M 42 30 L 40 70 L 50 82 L 60 70 L 58 30 Z" />
        </g>
      ) : norm.includes('station') || norm.includes('book') ? (
        // Notebook
        <g>
          <rect x="25" y="18" width="50" height="64" rx="4" />
          <line x1="34" y1="18" x2="34" y2="82" />
          <line x1="44" y1="32" x2="65" y2="32" />
          <line x1="44" y1="42" x2="65" y2="42" />
        </g>
      ) : norm.includes('id') || norm.includes('card') ? (
        // ID Card
        <g>
          <rect x="25" y="20" width="50" height="60" rx="4" />
          <circle cx="50" cy="42" r="10" />
          <path d="M 38 64 C 38 56 62 56 62 64" />
          <line x1="40" y1="12" x2="60" y2="12" strokeWidth="2.5" />
        </g>
      ) : (
        // Shirt / Uniform Default
        <g>
          <path d="M 32 30 L 20 45 L 28 52 L 34 42 L 34 78 L 66 78 L 66 42 L 72 52 L 80 45 L 68 30 Z" />
          <path d="M 42 30 L 50 38 L 58 30" />
          <line x1="50" y1="38" x2="50" y2="78" />
        </g>
      )}
    </svg>
  );
}
