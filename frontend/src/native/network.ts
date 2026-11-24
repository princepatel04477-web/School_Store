import { useEffect, useState } from 'react';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { isNativeApp } from './nativePlatform';

type NetworkListener = (status: ConnectionStatus) => void;
const listeners = new Set<NetworkListener>();

let currentStatus: ConnectionStatus = {
  connected: typeof navigator !== 'undefined' ? navigator.onLine : true,
  connectionType: 'unknown',
};

let initialized = false;

export async function initNetworkMonitoring(onReconnect?: () => void): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (isNativeApp()) {
    try {
      currentStatus = await Network.getStatus();
      await Network.addListener('networkStatusChange', (status) => {
        const wasOffline = !currentStatus.connected;
        currentStatus = status;
        listeners.forEach((fn) => fn(status));
        if (wasOffline && status.connected && onReconnect) {
          onReconnect();
        }
      });
    } catch (e) {
      console.warn('Capacitor Network init failed:', e);
    }
  } else if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      currentStatus = { connected: true, connectionType: 'wifi' };
      listeners.forEach((fn) => fn(currentStatus));
      if (onReconnect) onReconnect();
    });
    window.addEventListener('offline', () => {
      currentStatus = { connected: false, connectionType: 'none' };
      listeners.forEach((fn) => fn(currentStatus));
    });
  }
}

export function subscribeNetworkStatus(fn: NetworkListener): () => void {
  listeners.add(fn);
  fn(currentStatus);
  return () => {
    listeners.delete(fn);
  };
}

export function getNetworkStatus(): ConnectionStatus {
  return currentStatus;
}

export function useNetworkStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(currentStatus);

  useEffect(() => {
    return subscribeNetworkStatus((newStatus) => {
      setStatus({ ...newStatus });
    });
  }, []);

  return status;
}
