import { useState } from 'react';

export interface SmartImageProps {
  src: string;
  alt: string; // Required per brief
  width: number;
  height: number;
  aspectRatio?: string; // e.g. "4 / 5", "1 / 1"
  priority?: boolean; // Eager loading + fetchpriority high for hero
  sizes?: string;
  className?: string;
  style?: React.CSSProperties;
  placeholderColor?: string;
}

export function SmartImage({
  src,
  alt,
  width,
  height,
  aspectRatio = `${width} / ${height}`,
  priority = false,
  sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw',
  className = '',
  style = {},
  placeholderColor = 'var(--paper-sunk)',
}: SmartImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className={`smart-image-box ${className}`.trim()}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        aspectRatio,
        backgroundColor: placeholderColor,
        ...style,
      }}
    >
      {/* Blurred placeholder backdrop to eliminate layout shift */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: placeholderColor,
          opacity: loaded ? 0 : 1,
          filter: 'blur(8px)',
          transform: 'scale(1.06)',
          transition: 'opacity var(--duration-fast) var(--ease-standard)',
          pointerEvents: 'none',
        }}
      />

      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        // @ts-expect-error React 18 fetchPriority support
        fetchpriority={priority ? 'high' : 'auto'}
        decoding={priority ? 'sync' : 'async'}
        sizes={sizes}
        onLoad={() => setLoaded(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          opacity: loaded ? 1 : 0,
          filter: loaded ? 'blur(0px)' : 'blur(6px)',
          transition: 'opacity var(--duration-fast) var(--ease-standard), filter var(--duration-base) var(--ease-standard)',
        }}
      />
    </div>
  );
}
