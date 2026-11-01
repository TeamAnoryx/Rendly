'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import websocket from '@/services/websocket';
import { getStoredAuthToken } from '@/lib/auth-storage';

type PresenceValue = {
  connected: boolean;
  /** True when the user is known to be online. */
  isOnline: (userId: string | null | undefined) => boolean;
  /** Ask the server about these users (e.g. a conversation list). Cheap to call repeatedly. */
  watch: (userIds: string[]) => void;
  /** Bumps whenever presence changes, so consumers re-render. */
  version: number;
};

const PresenceContext = createContext<PresenceValue | null>(null);

export function usePresence(): PresenceValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error('usePresence must be used within SocketProvider');
  return ctx;
}

/**
 * Opens the app-wide chat socket for the dashboard and tracks who is online. Presence starts
 * from a snapshot for the users we care about, then follows user:online / user:offline.
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState(0);
  const onlineRef = useRef<Set<string>>(new Set());
  const watchedRef = useRef<Set<string>>(new Set());

  const refreshSnapshot = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || !websocket.isConnected()) return;
    try {
      const online = new Set(await websocket.queryPresence(ids));
      let changed = false;
      for (const id of ids) {
        const was = onlineRef.current.has(id);
        const now = online.has(id);
        if (was !== now) {
          changed = true;
          if (now) onlineRef.current.add(id);
          else onlineRef.current.delete(id);
        }
      }
      if (changed) setVersion((v) => v + 1);
    } catch (err) {
      console.warn('[presence] snapshot failed', err);
    }
  }, []);

  useEffect(() => {
    const token = getStoredAuthToken();
    if (token) websocket.connect(token).catch((err) => console.warn('[socket] connect failed', err));
    setConnected(websocket.isConnected());
    const offStatus = websocket.onStatus((c) => {
      setConnected(c);
      if (c) void refreshSnapshot(Array.from(watchedRef.current));
    });
    const offOnline = websocket.onUserOnline(({ user_id }) => {
      if (!onlineRef.current.has(user_id)) {
        onlineRef.current.add(user_id);
        setVersion((v) => v + 1);
      }
    });
    const offOffline = websocket.onUserOffline(({ user_id }) => {
      if (onlineRef.current.delete(user_id)) setVersion((v) => v + 1);
    });
    return () => {
      offStatus();
      offOnline();
      offOffline();
      // The dashboard layout unmounts on logout or leaving the app: close the socket then.
      websocket.disconnect();
    };
  }, [refreshSnapshot]);

  const watch = useCallback(
    (ids: string[]) => {
      const fresh = ids.filter((id) => id && !watchedRef.current.has(id));
      fresh.forEach((id) => watchedRef.current.add(id));
      if (fresh.length) void refreshSnapshot(fresh);
    },
    [refreshSnapshot]
  );

  const isOnline = useCallback((id: string | null | undefined) => (id ? onlineRef.current.has(id) : false), []);

  const value = useMemo(() => ({ connected, isOnline, watch, version }), [connected, isOnline, watch, version]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}
