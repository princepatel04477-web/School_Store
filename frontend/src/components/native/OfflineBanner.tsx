import { useNetworkStatus } from '../../native/network';
import './offlineBanner.css';

export function OfflineBanner() {
  const status = useNetworkStatus();

  if (status.connected) {
    return null;
  }

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <span className="offline-dot" />
      <span>You're offline: showing saved items</span>
    </div>
  );
}
