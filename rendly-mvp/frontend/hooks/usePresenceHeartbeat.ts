'use client';

import { useEffect } from 'react';
import { authFetch } from '@/lib/api';
import { getStoredAuthToken } from '@/lib/auth-storage';

/** How often the signed-in user tells the server they are online. The server counts 60 seconds. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Keeps the user's presence fresh while a dashboard page is open. A failed heartbeat is
 * ignored: the next one will try again, and the online count simply drops this user if the
 * network is down for more than a minute.
 */
export function usePresenceHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const sendHeartbeat = () => {
      if (!getStoredAuthToken()) return;
      authFetch('/api/presence/heartbeat', { method: 'POST' }).catch(() => {
        // Retried on the next tick.
      });
    };
    sendHeartbeat();
    const timer = setInterval(() => {
      if (!cancelled) sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
}
