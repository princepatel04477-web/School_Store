import { type CSSProperties } from 'react';
import './ui.css';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width, height, borderRadius, className = '', style }: SkeletonProps) {
  return (
    <div
      className={`skeleton-root ${className}`.trim()}
      aria-hidden="true"
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
        ...style,
      }}
    />
  );
}
