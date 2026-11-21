import './skeleton.css';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({
  width = '100%',
  height = '1rem',
  borderRadius,
  className = '',
  style = {},
}: SkeletonProps) {
  return (
    <div
      className={`skeleton-box ${className}`.trim()}
      style={{
        width,
        height,
        borderRadius: borderRadius !== undefined ? borderRadius : undefined,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

/** Shown while a page's code loads: a title, a line and a grid, instead of the word "Loading…". */
export function PageSkeleton() {
  return (
    <div className="page-skeleton" role="status" aria-label="Loading">
      <Skeleton width="min(420px, 70%)" height="40px" />
      <Skeleton width="min(260px, 50%)" height="16px" style={{ marginTop: 14 }} />
      <div className="page-skeleton-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height="132px" />
        ))}
      </div>
    </div>
  );
}

export function SchoolPickerSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="school-picker-skeleton-grid" aria-label="Loading schools...">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="school-card-skeleton">
          <Skeleton className="crest-skeleton" width={52} height={52} borderRadius={4} />
          <div className="text-group">
            <Skeleton width="75%" height="18px" />
            <Skeleton width="45%" height="14px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="product-grid-skeleton" aria-label="Loading products...">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="product-card-skeleton">
          <Skeleton className="image-skeleton" width="100%" height="auto" />
          <div className="content-skeleton">
            <Skeleton width="80%" height="18px" />
            <Skeleton width="50%" height="14px" />
            <Skeleton width="30%" height="20px" />
            <Skeleton width="100%" height="40px" borderRadius={4} style={{ marginTop: '8px' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SizeChartSkeleton({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div className="size-chart-skeleton" role="status" aria-label={label}>
      <Skeleton width="30%" height="14px" />
      <div className="size-chart-skeleton-table">
        <Skeleton width="100%" height="14px" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} width="100%" height="18px" />
        ))}
      </div>
    </div>
  );
}

export function OrderCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="orders-skeleton-list" role="status" aria-label="Loading orders...">
      {Array.from({ length: count }).map((_, i) => (
        <article
          key={i}
          className="order-card"
          style={{
            background: 'var(--paper-raised, #fff)',
            border: '1px solid var(--line, #DCE0E5)',
            borderRadius: 'var(--radius-lg, 6px)',
            padding: '18px',
            marginBottom: '13px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Skeleton width="120px" height="18px" borderRadius="3px" />
              <Skeleton width="80px" height="12px" borderRadius="3px" />
            </div>
            <Skeleton width="70px" height="24px" borderRadius="4px" />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <Skeleton width="160px" height="14px" borderRadius="3px" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', paddingTop: '14px', borderTop: '1px solid var(--line, #DCE0E5)' }}>
            {Array.from({ length: 5 }).map((_, stepIdx) => (
              <div key={stepIdx} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <Skeleton width="20px" height="20px" borderRadius="50%" />
                <Skeleton width="80%" height="10px" borderRadius="2px" />
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
