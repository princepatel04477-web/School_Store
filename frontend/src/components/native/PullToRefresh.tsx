import { useState, useRef, type ReactNode, type TouchEvent } from 'react';
import { haptic } from '../../native/haptics';
import './pullToRefresh.css';

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<unknown> | void;
}

const THRESHOLD = 65;
const MAX_PULL = 110;

export function PullToRefresh({ children, onRefresh }: PullToRefreshProps) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);

  const handleTouchStart = (e: TouchEvent) => {
    if (window.scrollY <= 0 && !refreshing) {
      startYRef.current = e.touches[0].clientY;
      isPullingRef.current = true;
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isPullingRef.current || refreshing) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startYRef.current;

    if (diff > 0 && window.scrollY <= 0) {
      // Damped pull distance
      const damped = Math.min(diff * 0.45, MAX_PULL);
      setPullY(damped);
    } else {
      setPullY(0);
      isPullingRef.current = false;
    }
  };

  const handleTouchEnd = async () => {
    if (!isPullingRef.current || refreshing) return;
    isPullingRef.current = false;

    if (pullY >= THRESHOLD) {
      haptic.impactLight();
      setRefreshing(true);
      setPullY(45); // Hold at spinner height
      try {
        await Promise.resolve(onRefresh());
      } finally {
        setRefreshing(false);
        setPullY(0);
      }
    } else {
      setPullY(0);
    }
  };

  return (
    <div
      className="pull-to-refresh-container"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={`pull-to-refresh-indicator ${refreshing ? 'is-refreshing' : ''}`}
        style={{
          height: `${pullY}px`,
          opacity: Math.min(pullY / 40, 1),
        }}
        aria-hidden="true"
      >
        <div className="pull-spinner">
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" fill="none">
            <circle
              cx="12"
              cy="12"
              r="9"
              strokeWidth="2.5"
              strokeDasharray="40"
              strokeDashoffset={refreshing ? '15' : String(40 - Math.min(pullY, 40))}
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
      <div
        className="pull-to-refresh-content"
        style={{
          transform: pullY > 0 ? `translate3d(0, ${pullY}px, 0)` : undefined,
          transition: isPullingRef.current ? 'none' : 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
