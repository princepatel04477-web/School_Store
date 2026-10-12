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
