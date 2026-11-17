import { useState } from 'react';
import './offlineScreen.css';

interface OfflineScreenProps {
  onRetry?: () => void;
  message?: string;
}

export function OfflineScreen({
  onRetry,
  message = "SchoolStore needs an internet connection. Check your Wi-Fi or mobile data and try again.",
}: OfflineScreenProps) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = () => {
    setRetrying(true);
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
    setTimeout(() => setRetrying(false), 1000);
  };

  return (
    <div className="offline-screen-root" role="status" aria-live="polite">
      <main className="offline-card">
        <div className="offline-logo" aria-hidden="true">
          S
        </div>
        <h1 className="offline-title">You're offline</h1>
        <p className="offline-text">{message}</p>
        <button
          type="button"
          className="offline-retry-btn"
          onClick={handleRetry}
          disabled={retrying}
        >
          {retrying ? 'Connecting…' : 'Try again'}
        </button>
      </main>
    </div>
  );
}
