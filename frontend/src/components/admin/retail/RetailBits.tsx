import { useEffect, useState } from 'react';
import { fetchBlobUrl, type RequestStatus } from '../../../api';
import { Skeleton } from '../../ui/Skeleton';
import './retail.css';

const STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
const STATUS_CLASS: Record<RequestStatus, string> = {
  PENDING: 's-pending',
  APPROVED: 's-approved',
  REJECTED: 's-cancelled',
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** A logo that needs the signed-in user's token to load (a request's logo). */
export function SignedInLogo({ path, alt, small = false }: { path: string; alt: string; small?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    fetchBlobUrl(path)
      .then((objectUrl) => {
        url = objectUrl;
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setSrc(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  const className = `retail-logo${small ? ' small' : ''}`;
  if (failed) return <span className={`${className} retail-logo-empty`}>No logo</span>;
  if (!src) return <Skeleton className={className} width={small ? 40 : 72} height={small ? 40 : 72} />;
  return <img className={className} src={src} alt={alt} />;
}

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

/** Rows of grey blocks while a list loads. */
export function RequestSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="retail-skeleton-row" key={i}>
          <Skeleton width={72} height={72} />
          <div className="retail-skeleton-lines">
            <Skeleton width="45%" height={16} />
            <Skeleton width="70%" height={12} />
            <Skeleton width="30%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}
