import { useEffect, useState } from 'react';
import { fetchProtectedBlobUrl } from '../../api';
import { Skeleton } from '../ui/Skeleton';

// One download per photo version while the page is open (the URL carries ?v=<saved time>).
const cache = new Map<string, Promise<string>>();
function loadPhoto(url: string) {
  let hit = cache.get(url);
  if (!hit) {
    hit = fetchProtectedBlobUrl(url);
    hit.catch(() => cache.delete(url));
    cache.set(url, hit);
  }
  return hit;
}

/**
 * A student's ID card photo. The file is private, so it is fetched with the
 * signed-in user's token instead of a plain <img src>.
 */
export function StudentPhoto({
  url,
  name,
  size = 44,
  localUrl,
}: {
  url?: string | null;
  name?: string;
  size?: number;
  /** A just-picked photo shown before it is uploaded. */
  localUrl?: string;
}) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (localUrl || !url) {
      setSrc('');
      return;
    }
    let alive = true;
    setFailed(false);
    loadPhoto(url)
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [url, localUrl]);

  const box = { width: size, height: Math.round(size * 1.2) };
  const shown = localUrl || src;

  if (shown) {
    return <img className="tp-photo" src={shown} alt={name ? `Photo of ${name}` : 'Student photo'} style={box} />;
  }
  if (url && !failed) {
    return <Skeleton width={box.width} height={box.height} />;
  }
  return (
    <span className="tp-photo tp-photo-empty" style={box} aria-label="No photo yet">
      {(name || 'S').trim().charAt(0).toUpperCase()}
    </span>
  );
}
