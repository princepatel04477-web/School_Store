import { useEffect, useState } from 'react';
import { type BranchAvailability, getRemainingTime } from '../../data/availability';
import { Clock } from '../ui/icons';

export interface RestockCountdownBannerProps {
  availability: BranchAvailability;
  className?: string;
}

export function RestockCountdownBanner({ availability, className = '' }: RestockCountdownBannerProps) {
  const [remaining, setRemaining] = useState(() => getRemainingTime(availability.restockEta));

  useEffect(() => {
    if (!availability.restockEta || availability.status !== 'RESTOCKING') return;

    const interval = setInterval(() => {
      const next = getRemainingTime(availability.restockEta);
      setRemaining(next);
      if (next.isExpired) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [availability.restockEta, availability.status]);

  if (availability.status === 'IN_STOCK' || (availability.status === 'RESTOCKING' && remaining.isExpired)) {
    return (
      <div
        className={`restock-banner in-stock ${className}`.trim()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 14px',
          background: '#E8F5E9',
          color: '#1B5E20',
          border: '1px solid #C8E6C9',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          marginBottom: '16px',
        }}
      >
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2E7D32', display: 'inline-block' }} />
        <span>In Stock in your city · Ready for dispatch within 24 hours</span>
      </div>
    );
  }

  if (availability.status === 'OUT_OF_STOCK') {
    return (
      <div
        className={`restock-banner out-of-stock ${className}`.trim()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          background: '#FFEBEE',
          color: '#C62828',
          border: '1px solid #FFCDD2',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          marginBottom: '16px',
        }}
      >
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#C62828', display: 'inline-block' }} />
        <span>Currently out of stock in this city. Next delivery batch scheduled soon.</span>
      </div>
    );
  }

  return (
    <div
      className={`restock-banner restocking ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '12px 16px',
        background: '#FFF8E1',
        color: '#E65100',
        border: '1px solid #FFE082',
        borderRadius: '10px',
        fontSize: '13px',
        marginBottom: '16px',
        boxShadow: '0 2px 6px rgba(230, 81, 0, 0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '14px' }}>
          <Clock width={18} height={18} style={{ color: '#E65100' }} />
          <span>Stock Available in 24 Hours</span>
        </div>
        <div
          style={{
            fontFamily: 'monospace',
            fontWeight: 800,
            fontSize: '14px',
            background: '#FFE082',
            padding: '4px 10px',
            borderRadius: '6px',
            letterSpacing: '0.05em',
            color: '#B74700',
          }}
        >
          ⏱️ {remaining.formatted}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: '12.5px', color: '#8D3600', lineHeight: 1.4 }}>
        {availability.customNotice || 'Stock will be available in 24 hours. Pre-order now to secure delivery!'}
      </p>
    </div>
  );
}
